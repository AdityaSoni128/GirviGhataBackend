import { Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import {
  ItemMeasurement,
  RateSnapshot,
  BusinessRules,
  PledgeValuationResult,
  OutstandingBreakdown,
  PaymentAllocationResult,
  ItemValuationResult,
} from './calculation.types';

/**
 * Single source of truth for every financial number in the platform.
 *
 * Design rules (see Phase 1 architecture doc, Step 5):
 *  - Every method is pure: same inputs -> same output, no hidden reads of
 *    "current" rates/rules. Callers must pass explicit RateSnapshot /
 *    BusinessRules objects, which is what lets a rate change tomorrow never
 *    alter what a transaction calculated today.
 *  - All money/weight math uses Decimal.js. Never a plain JS `number`
 *    for anything that gets persisted or displayed as currency/weight.
 *  - Used identically by the Girvi module (create/validate), the Payments
 *    module, and the Reports module — never duplicated in the frontend.
 *  - The frontend may render a preview using the SAME dtos, but the backend
 *    always recalculates and persists the authoritative numbers (Section 55).
 */
@Injectable()
export class CalculationEngineService {
  // --- Item-level -----------------------------------------------------

  calculateNetWeight(item: ItemMeasurement): Decimal {
    const net = item.grossWeight.minus(item.stoneWeight);
    if (net.isNegative()) {
      throw new Error(`Stone weight exceeds gross weight for item ${item.itemId}`);
    }
    return net;
  }

  calculateFineWeight(netWeight: Decimal, fineFactor: Decimal): Decimal {
    return netWeight.times(fineFactor);
  }

  calculateMetalValue(fineWeight: Decimal, ratePerGram: Decimal): Decimal {
    return fineWeight.times(ratePerGram);
  }

  // --- Pledge / loan calculation ---------------------------------------

  /**
   * Full pipeline for one Girvi transaction: takes all items + the rate
   * snapshot(s) + the active business rules, returns the complete valuation
   * with a step-by-step trace suitable for the "explain this calculation"
   * UI (Section 67) and for persisting into GirviValuationSnapshot.
   */
  calculatePledgeValue(
    items: ItemMeasurement[],
    rates: Record<string, RateSnapshot>, // keyed by metalCode
    rules: BusinessRules,
    metalCode: string,
  ): PledgeValuationResult {
    const rate = rates[metalCode];
    if (!rate) {
      throw new Error(`No rate snapshot provided for metal ${metalCode}`);
    }

    const itemResults: ItemValuationResult[] = items.map((item) => {
      const netWeight = this.calculateNetWeight(item);
      const fineWeight = this.calculateFineWeight(netWeight, item.fineFactor);
      const metalValue = this.calculateMetalValue(fineWeight, rate.ratePerGram);
      return { itemId: item.itemId, netWeight, fineWeight, metalValue };
    });

    const totalFineWeight = itemResults.reduce(
      (sum, r) => sum.plus(r.fineWeight),
      new Decimal(0),
    );
    const totalMetalValue = itemResults.reduce(
      (sum, r) => sum.plus(r.metalValue),
      new Decimal(0),
    );

    const eligibleValue = this.calculateEligibleValue(totalMetalValue, rules.eligibilityPercent);
    const marginApplied = this.resolveMargin(eligibleValue, rules);
    const maxLoanAmount = this.applyMargin(eligibleValue, marginApplied, rules);

    return {
      items: itemResults,
      totalFineWeight,
      totalMetalValue,
      eligibilityPercent: rules.eligibilityPercent,
      eligibleValue,
      marginApplied,
      maxLoanAmount,
      breakdown: {
        rateUsed: { metalCode, ratePerGram: rate.ratePerGram.toString(), rateId: rate.rateId },
        ruleSetId: rules.ruleSetId,
        items: itemResults.map((r) => ({
          itemId: r.itemId,
          netWeight: r.netWeight.toString(),
          fineWeight: r.fineWeight.toString(),
          metalValue: r.metalValue.toString(),
        })),
        totalFineWeight: totalFineWeight.toString(),
        totalMetalValue: totalMetalValue.toString(),
        eligibilityPercent: rules.eligibilityPercent.toString(),
        eligibleValue: eligibleValue.toString(),
        marginType: rules.marginType,
        marginApplied: marginApplied.toString(),
        maxLoanAmount: maxLoanAmount.toString(),
      },
    };
  }

  calculateEligibleValue(metalValue: Decimal, eligibilityPercent: Decimal): Decimal {
    return metalValue.times(eligibilityPercent).dividedBy(100);
  }

  private resolveMargin(eligibleValue: Decimal, rules: BusinessRules): Decimal {
    switch (rules.marginType) {
      case 'NONE':
        return new Decimal(0);
      case 'FIXED':
        return rules.marginValue;
      case 'PERCENT':
        return eligibleValue.times(rules.marginValue).dividedBy(100);
      default:
        throw new Error(`Unknown margin type: ${rules.marginType}`);
    }
  }

  applyMargin(eligibleValue: Decimal, margin: Decimal, rules: BusinessRules): Decimal {
    let maxLoan = eligibleValue.minus(margin);
    if (maxLoan.isNegative()) maxLoan = new Decimal(0);
    maxLoan = this.applyRounding(maxLoan, rules.roundingRule);

    if (rules.maxLoanAmount && maxLoan.greaterThan(rules.maxLoanAmount)) {
      maxLoan = rules.maxLoanAmount;
    }
    if (rules.minLoanAmount && maxLoan.lessThan(rules.minLoanAmount)) {
      // Flagged for the caller to reject/warn — engine itself doesn't decide
      // whether to block the transaction, it just reports the computed value.
    }
    return maxLoan;
  }

  applyRounding(value: Decimal, rule: BusinessRules['roundingRule']): Decimal {
    switch (rule) {
      case 'NONE':
        return value;
      case 'ROUND_NEAREST_1':
        return value.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
      case 'ROUND_NEAREST_10':
        return value.dividedBy(10).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).times(10);
      default:
        return value;
    }
  }

  // --- Interest ----------------------------------------------------------

  /**
   * Computes interest for a single accrual period. `periodsElapsed` is
   * whole months for FLAT_MONTHLY/REDUCING_BALANCE (see
   * calculateCalendarMonthsElapsed — that is how callers should derive
   * this number; this method itself just applies the rate) or whole days
   * for DAILY. REDUCING_BALANCE expects `principal` to already reflect any
   * principal paid before this period started (caller recomputes principal
   * per period).
   */
  calculateInterest(
    principal: Decimal,
    rules: BusinessRules,
    periodsElapsed: number,
  ): Decimal {
    if (periodsElapsed <= 0) return new Decimal(0);

    switch (rules.interestMethod) {
      case 'FLAT_MONTHLY':
      case 'REDUCING_BALANCE': {
        const monthlyRate = rules.interestPercent.dividedBy(100);
        return principal.times(monthlyRate).times(periodsElapsed);
      }
      case 'DAILY': {
        const dailyRate = rules.interestPercent.dividedBy(100);
        return principal.times(dailyRate).times(periodsElapsed);
      }
      default:
        throw new Error(`Unknown interest method: ${rules.interestMethod}`);
    }
  }

  /**
   * Calendar-month-inclusive elapsed-months calculation, for backdated and
   * ordinary Girvi entries alike. Business rule: whatever day of the month
   * a loan is pledged on, that calendar month always counts as 1 full
   * month of interest — the cycle is anchored to the 1st of the pledge
   * month, never a day-to-day or days/30 calculation. This is deliberately
   * the ONLY place this rule is implemented; every caller (payments,
   * redemption, dashboard, auction — all via OutstandingService) must
   * route through this method rather than recomputing elapsed months
   * themselves.
   *
   * Returns: number of calendar months touched from the pledge month
   * through the asOf month, inclusive.
   *
   * Examples:
   *   pledge 12-Feb-2025, asOf 12-Feb-2025 -> 1
   *   pledge 12-Feb-2025, asOf 28-Feb-2025 -> 1
   *   pledge 12-Feb-2025, asOf 01-Mar-2025 -> 2
   *   pledge 12-Feb-2025, asOf 31-Mar-2025 -> 2
   *   pledge 12-Feb-2025, asOf 01-Apr-2025 -> 3
   *   pledge 25-Dec-2025, asOf 05-Jan-2026 -> 2
   *   pledge 15-Nov-2025, asOf 10-Feb-2026 -> 4
   *
   * Throws if asOfDate is earlier than pledgeDate — never silently
   * produces a zero/negative month count for an invalid date range;
   * callers should validate this themselves too where they can give a
   * more specific error (see OutstandingService).
   */
  calculateCalendarMonthsElapsed(pledgeDate: Date, asOfDate: Date): number {
    if (asOfDate.getTime() < pledgeDate.getTime()) {
      throw new Error(
        `asOfDate (${asOfDate.toISOString()}) cannot be earlier than pledgeDate (${pledgeDate.toISOString()})`,
      );
    }
    const monthDiff =
      (asOfDate.getFullYear() - pledgeDate.getFullYear()) * 12 +
      (asOfDate.getMonth() - pledgeDate.getMonth());
    return monthDiff + 1; // inclusive: the pledge month itself always counts as 1 full month
  }

  // --- Outstanding & payments ---------------------------------------------

  calculateOutstanding(breakdown: OutstandingBreakdown): Decimal {
    const totalDue = breakdown.principal
      .plus(breakdown.interestAccrued)
      .plus(breakdown.charges)
      .plus(breakdown.penalty);
    const totalPaid = breakdown.paymentsAppliedToPrincipal.plus(
      breakdown.paymentsAppliedToInterest,
    );
    const outstanding = totalDue.minus(totalPaid);
    return outstanding.isNegative() ? new Decimal(0) : outstanding;
  }

  /**
   * Allocates a single payment across categories according to the tenant's
   * configured priority order (Section 17/18). Never mutates outstanding
   * balances directly — returns the allocation, caller persists it plus a
   * new ledger entry inside one DB transaction.
   */
  calculatePaymentAllocation(
    paymentAmount: Decimal,
    outstanding: OutstandingBreakdown,
    rules: BusinessRules,
  ): PaymentAllocationResult {
    let remaining = paymentAmount;
    const result: PaymentAllocationResult = {
      penalty: new Decimal(0),
      charges: new Decimal(0),
      interest: new Decimal(0),
      principal: new Decimal(0),
      remainingOutstanding: new Decimal(0),
    };

    const dueByCategory: Record<string, Decimal> = {
      PENALTY: outstanding.penalty,
      CHARGES: outstanding.charges,
      INTEREST: outstanding.interestAccrued,
      PRINCIPAL: outstanding.principal,
    };

    for (const category of rules.paymentAllocationOrder) {
      if (remaining.lessThanOrEqualTo(0)) break;
      const due = dueByCategory[category];
      const applied = Decimal.min(remaining, due);
      remaining = remaining.minus(applied);

      switch (category) {
        case 'PENALTY':
          result.penalty = applied;
          break;
        case 'CHARGES':
          result.charges = applied;
          break;
        case 'INTEREST':
          result.interest = applied;
          break;
        case 'PRINCIPAL':
          result.principal = applied;
          break;
      }
    }

    const totalOutstandingBefore = this.calculateOutstanding(outstanding);
    result.remainingOutstanding = totalOutstandingBefore.minus(paymentAmount.minus(remaining));
    if (result.remainingOutstanding.isNegative()) {
      result.remainingOutstanding = new Decimal(0);
    }
    return result;
  }

  calculateRedemptionAmount(outstanding: OutstandingBreakdown): Decimal {
    return this.calculateOutstanding(outstanding);
  }
}