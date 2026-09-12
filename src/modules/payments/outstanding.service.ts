import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CalculationEngineService } from '../calculation-engine/calculation-engine.service';
import { RulesService } from '../rules/rules.service';
import { BusinessRules, OutstandingBreakdown } from '../calculation-engine/calculation.types';

// Exactly the includes getOutstanding() has always used — pulled out to a
// const so the bulk path below fetches the identical shape of data in one
// findMany() instead of N findFirst() calls. Exported so callers that
// already need this same shape for other purposes (e.g. the dashboard,
// which also reads `items` for gold/silver weight totals) can fetch it
// ONCE and hand the rows to computeOutstandingForPreloaded() below instead
// of this module querying the same transactions a second time.
export const TRANSACTION_INCLUDE = {
  valuation: true,
  payments: { where: { isReversed: false }, include: { allocations: true } },
  items: true,
  topUps: true,
} as const;

// Structural type for exactly what computeBreakdown() reads, rather than
// pulling in Prisma's generated GirviTransactionGetPayload<...> — keeps the
// pure calculation function decoupled from the ORM's generated type surface
// and matches whatever findFirst()/findMany() with TRANSACTION_INCLUDE
// actually returns structurally.
export interface TransactionForOutstanding {
  id: string;
  pledgeDate: Date;
  valuation: { actualLoanAmount: { toString(): string }; interestPercent: { toString(): string } } | null;
  payments: Array<{
    allocations: Array<{ category: string; amount: { toString(): string } }>;
  }>;
  items: Array<{ metalCode: string }>;
  topUps: Array<{
    amount: { toString(): string };
    topUpDate: Date;
  }>;
}

@Injectable()
export class OutstandingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: CalculationEngineService,
    private readonly rules: RulesService,
  ) {}

  /**
   * Recomputes the current outstanding balance for a Girvi transaction
   * from first principles: original loan amount, every GirviTopUp
   * tranche, every non-reversed payment's allocations, and interest
   * accrued under this SPECIFIC transaction's locked-in interest rate.
   *
   * INTEREST RATE SOURCE — this is the critical piece of the
   * transaction-specific-rate requirement: interestPercent is read from
   * `transaction.valuation.interestPercent` (frozen at creation time),
   * NEVER from `rules.interestPercent` (the currently active
   * BusinessRuleSet). Every other field — interestMethod,
   * gracePeriodDays, roundingRule, paymentAllocationOrder — still comes
   * from whichever rule set is currently active, since only the rate
   * itself is scoped to be transaction-specific per the current
   * business requirement; if that scope needs to widen later (e.g.
   * locking interestMethod too), this is the one place to extend.
   *
   * Interest period counting (per tranche) is otherwise unchanged from
   * before top-ups/rate-locking existed:
   *  - FLAT_MONTHLY / REDUCING_BALANCE: calendar-month-inclusive,
   *    anchored per-tranche via
   *    CalculationEngineService.calculateCalendarMonthsElapsed.
   *  - DAILY: day-count based, gracePeriodDays subtracted as before.
   *
   * Throws BadRequestException if "now" predates pledgeDate.
   *
   * Unchanged single-transaction entry point — still exactly one
   * transaction query + one rules query, exactly as before. Callers
   * other than the dashboard (payments, redemption, auction) go through
   * here and are untouched by the bulk path below. The actual math now
   * lives in the shared, DB-free computeBreakdown() so this method and
   * getOutstandingBulk() can never drift apart.
   */
  async getOutstanding(tenantId: string, girviTransactionId: string): Promise<OutstandingBreakdown> {
    const transaction = await this.prisma.girviTransaction.findFirst({
      where: { id: girviTransactionId, tenantId },
      include: TRANSACTION_INCLUDE,
    });
    if (!transaction || !transaction.valuation) {
      throw new NotFoundException('Girvi transaction or its valuation snapshot not found');
    }

    const metalCode = transaction.items[0]?.metalCode ?? 'GOLD';
    const activeRules = await this.rules.getActiveRules(tenantId, metalCode);

    return this.computeBreakdown(transaction, activeRules, new Date());
  }

  /**
   * Bulk equivalent of getOutstanding(), for the dashboard (and any other
   * future caller that needs outstanding for many transactions at once).
   *
   * Reduces DB round trips from ~2 per transaction (one
   * girviTransaction.findFirst + one businessRuleSet.findFirst EACH) down
   * to a small fixed number:
   *   - 1 query: every transaction + its valuation/payments/allocations/
   *     items/topUps, via findMany({ id: { in: transactionIds } })
   *   - 1 query PER DISTINCT METAL CODE actually used by those
   *     transactions (fetched once, reused for every transaction on that
   *     metal) — typically 2 (GOLD, SILVER) regardless of how many
   *     transactions there are.
   *
   * So ~41 transactions on GOLD+SILVER: was ~82 sequential DB round
   * trips, now 3 (1 + 2). The per-transaction math itself is byte-for-
   * byte the same computeBreakdown() that getOutstanding() uses — this
   * method only changes HOW the inputs are fetched, never the formula.
   *
   * Always scoped by tenantId — the transactionIds passed in must
   * already belong to the caller's tenant (dashboardSummary() sources
   * them from a tenant-scoped query), and this method re-asserts
   * tenantId in its own where clause as well, so even a caller bug
   * passing a foreign id would fetch nothing rather than leak data.
   *
   * Returns a Map so the caller can look up each breakdown by
   * transaction id; a transaction id with no active rules configured for
   * its metal, or missing/invalid data, causes the same NotFoundException/
   * BadRequestException getOutstanding() would throw for that transaction
   * — this method doesn't swallow errors to keep behavior identical to
   * calling getOutstanding() in a loop.
   */
  async getOutstandingBulk(
    tenantId: string,
    transactionIds: string[],
  ): Promise<Map<string, OutstandingBreakdown>> {
    if (transactionIds.length === 0) return new Map();

    const transactions = await this.prisma.girviTransaction.findMany({
      where: { id: { in: transactionIds }, tenantId },
      include: TRANSACTION_INCLUDE,
    });

    return this.computeOutstandingForPreloaded(tenantId, transactions);
  }

  /**
   * Same computation as getOutstandingBulk(), but for transactions the
   * caller has ALREADY fetched (with the TRANSACTION_INCLUDE shape) —
   * skips the findMany() entirely. Exists so callers that need the same
   * rows for another purpose too (e.g. ReportsService.dashboardSummary(),
   * which also reads `items` for gold/silver weight totals) fetch the
   * transaction list exactly once instead of once here and once there.
   *
   * Also parallelizes the per-distinct-metal rules lookups (was a
   * sequential `for...await` loop) via Promise.all — independent reads,
   * no reason to pay N network round trips serially.
   */
  async computeOutstandingForPreloaded(
    tenantId: string,
    transactions: TransactionForOutstanding[],
  ): Promise<Map<string, OutstandingBreakdown>> {
    if (transactions.length === 0) return new Map();

    // Fetch each distinct metal's active rules exactly once and reuse it
    // for every transaction on that metal — this is what collapses N
    // rules queries down to (number of distinct metals) queries, run
    // concurrently since each metal's rules are independent of the others.
    const metalCodes: string[] = Array.from(
      new Set(transactions.map((tx) => tx.items[0]?.metalCode ?? 'GOLD')),
    );
    const rulesEntries = await Promise.all(
      metalCodes.map(
        async (metalCode) => [metalCode, await this.rules.getActiveRules(tenantId, metalCode)] as const,
      ),
    );
    const rulesByMetal = new Map<string, BusinessRules>(rulesEntries);

    const now = new Date();
    const results = new Map<string, OutstandingBreakdown>();

    for (const transaction of transactions) {
      if (!transaction.valuation) {
        throw new NotFoundException(
          `Girvi transaction ${transaction.id} or its valuation snapshot not found`,
        );
      }
      const metalCode = transaction.items[0]?.metalCode ?? 'GOLD';
      const activeRules = rulesByMetal.get(metalCode);
      if (!activeRules) {
        // Unreachable in practice (metalCode came from the same
        // transactions list metalCodes was built from), but keeps this
        // method exception-safe rather than silently defaulting.
        throw new NotFoundException(`No active business rules configured for ${metalCode}`);
      }

      results.set(transaction.id, this.computeBreakdown(transaction, activeRules, now));
    }

    return results;
  }

  /**
   * Pure calculation core shared by getOutstanding() and
   * getOutstandingBulk() — no DB access here, only the exact same
   * arithmetic that used to live inline in getOutstanding(). Extracting
   * this is what guarantees the bulk path can never silently diverge in
   * its financial results from the single-transaction path.
   */
  private computeBreakdown(
    transaction: TransactionForOutstanding,
    activeRules: BusinessRules,
    now: Date,
  ): OutstandingBreakdown {
    const valuation = transaction.valuation;
    if (!valuation) {
      throw new NotFoundException('Girvi transaction or its valuation snapshot not found');
    }

    const principalOriginal = new Decimal(valuation.actualLoanAmount.toString());
    const topUpTotal = transaction.topUps.reduce(
      (sum, t) => sum.plus(t.amount.toString()),
      new Decimal(0),
    );
    const totalPrincipalIssued = principalOriginal.plus(topUpTotal);

    let principalPaid = new Decimal(0);
    let interestPaid = new Decimal(0);
    for (const payment of transaction.payments) {
      for (const alloc of payment.allocations) {
        if (alloc.category === 'PRINCIPAL') principalPaid = principalPaid.plus(alloc.amount.toString());
        if (alloc.category === 'INTEREST') interestPaid = interestPaid.plus(alloc.amount.toString());
      }
    }

    const remainingPrincipal = Decimal.max(0, totalPrincipalIssued.minus(principalPaid));
    const loanStillOpen = remainingPrincipal.greaterThan(0);

    // Override ONLY the interest rate with this transaction's locked-in
    // value — everything else in the rules object stays whatever is
    // currently active. This is the enforcement point for "an admin
    // changing the active rule later must never affect an existing
    // transaction's rate."
    const lockedInterestPercent = new Decimal(valuation.interestPercent.toString());
    const effectiveRules = { ...activeRules, interestPercent: lockedInterestPercent };

    const pledgeDate = transaction.pledgeDate;

    if (now.getTime() < pledgeDate.getTime()) {
      throw new BadRequestException(
        `Cannot compute outstanding: the current date (${now.toISOString()}) is earlier than this ` +
          `transaction's pledge date (${pledgeDate.toISOString()}).`,
      );
    }

    const tranches: Array<{ principal: Decimal; anchorDate: Date }> = [
      { principal: principalOriginal, anchorDate: pledgeDate },
      ...transaction.topUps.map((t) => ({
        principal: new Decimal(t.amount.toString()),
        anchorDate: pledgeDate,
      })),
    ];

    let totalInterestAccrued = new Decimal(0);
    for (const tranche of tranches) {
      if (tranche.anchorDate.getTime() > now.getTime()) {
        continue;
      }

      let periodsElapsed: number;
      if (effectiveRules.interestMethod === 'DAILY') {
        periodsElapsed = Math.floor((now.getTime() - tranche.anchorDate.getTime()) / (1000 * 60 * 60 * 24));
        periodsElapsed = Math.max(0, periodsElapsed - effectiveRules.gracePeriodDays);
      } else {
        periodsElapsed = this.engine.calculateCalendarMonthsElapsed(tranche.anchorDate, now);
      }

      const trancheInterest = this.engine.calculateInterest(
        loanStillOpen ? tranche.principal : new Decimal(0),
        effectiveRules,
        periodsElapsed,
      );
      totalInterestAccrued = totalInterestAccrued.plus(trancheInterest);
    }

    const interestOutstanding = Decimal.max(0, totalInterestAccrued.minus(interestPaid));

    return {
      principal: remainingPrincipal,
      interestAccrued: interestOutstanding,
      charges: new Decimal(0),
      penalty: new Decimal(0),
      paymentsAppliedToPrincipal: new Decimal(0),
      paymentsAppliedToInterest: new Decimal(0),
    };
  }
}