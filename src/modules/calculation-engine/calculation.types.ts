import { Decimal } from 'decimal.js';

/** One pledged item's physical measurements, as entered by staff. */
export interface ItemMeasurement {
  itemId: string;
  grossWeight: Decimal; // grams
  stoneWeight: Decimal; // grams
  purityCode: string;
  fineFactor: Decimal; // e.g. 22K -> 0.9167, looked up from Purity table
}

/** The rate snapshot to apply — must be the rate captured at pledge time. */
export interface RateSnapshot {
  metalCode: string;
  ratePerGram: Decimal;
  rateId: string; // MetalRate.id, stored for traceability
}

/** The active BusinessRuleSet for this metal, as of pledge time. */
export interface BusinessRules {
  ruleSetId: string;
  eligibilityPercent: Decimal; // e.g. 70.000
  marginType: 'FIXED' | 'PERCENT' | 'NONE';
  marginValue: Decimal;
  interestMethod: 'FLAT_MONTHLY' | 'DAILY' | 'REDUCING_BALANCE';
  interestPercent: Decimal;
  loanTermDays: number | null;
  gracePeriodDays: number;
  roundingRule: 'NONE' | 'ROUND_NEAREST_1' | 'ROUND_NEAREST_10';
  minLoanAmount?: Decimal;
  maxLoanAmount?: Decimal;
  paymentAllocationOrder: Array<'PENALTY' | 'CHARGES' | 'INTEREST' | 'PRINCIPAL'>;
}

/**
 * One interest-bearing slice of a loan's principal, with its own
 * calendar-month anchor date. The original pledge is tranche #1
 * (anchored to pledgeDate); each top-up is an additional tranche,
 * anchored either to pledgeDate (if applyPreviousInterestStartDate) or
 * to its own topUpDate. OutstandingService builds this list and sums
 * interest across tranches — CalculationEngineService itself stays
 * tranche-agnostic, just computing one tranche's interest per call via
 * the existing calculateInterest/calculateCalendarMonthsElapsed methods.
 */
export interface PrincipalTranche {
  principal: import('decimal.js').Decimal;
  anchorDate: Date;
}

/** Per-item breakdown, part of the full calculation trace. */
export interface ItemValuationResult {
  itemId: string;
  netWeight: Decimal;
  fineWeight: Decimal;
  metalValue: Decimal;
}

/** The complete result persisted into GirviValuationSnapshot. */
export interface PledgeValuationResult {
  items: ItemValuationResult[];
  totalFineWeight: Decimal;
  totalMetalValue: Decimal;
  eligibilityPercent: Decimal;
  eligibleValue: Decimal;
  marginApplied: Decimal;
  maxLoanAmount: Decimal;
  breakdown: Record<string, unknown>; // human-readable formula trace for "explain this" UI
}

export interface OutstandingBreakdown {
  principal: Decimal;
  interestAccrued: Decimal;
  charges: Decimal;
  penalty: Decimal;
  paymentsAppliedToPrincipal: Decimal;
  paymentsAppliedToInterest: Decimal;
}

export interface PaymentAllocationResult {
  penalty: Decimal;
  charges: Decimal;
  interest: Decimal;
  principal: Decimal;
  remainingOutstanding: Decimal;
}
