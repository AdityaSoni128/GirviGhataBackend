import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CalculationEngineService } from '../calculation-engine/calculation-engine.service';
import { RulesService } from '../rules/rules.service';
import { OutstandingBreakdown } from '../calculation-engine/calculation.types';

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
   */
  async getOutstanding(tenantId: string, girviTransactionId: string): Promise<OutstandingBreakdown> {
    const transaction = await this.prisma.girviTransaction.findFirst({
      where: { id: girviTransactionId, tenantId },
      include: {
        valuation: true,
        payments: { where: { isReversed: false }, include: { allocations: true } },
        items: true,
        topUps: true,
      },
    });
    if (!transaction || !transaction.valuation) {
      throw new NotFoundException('Girvi transaction or its valuation snapshot not found');
    }

    const principalOriginal = new Decimal(transaction.valuation.actualLoanAmount.toString());
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

    const metalCode = transaction.items[0]?.metalCode ?? 'GOLD';
    const activeRules = await this.rules.getActiveRules(tenantId, metalCode);

    // Override ONLY the interest rate with this transaction's locked-in
    // value — everything else in the rules object stays whatever is
    // currently active. This is the enforcement point for "an admin
    // changing the active rule later must never affect an existing
    // transaction's rate."
    const lockedInterestPercent = new Decimal(transaction.valuation.interestPercent.toString());
    const effectiveRules = { ...activeRules, interestPercent: lockedInterestPercent };

    const now = new Date();
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
        anchorDate: t.applyPreviousInterestStartDate ? pledgeDate : t.topUpDate,
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