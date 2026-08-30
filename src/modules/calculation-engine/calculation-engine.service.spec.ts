import { Decimal } from 'decimal.js';
import { CalculationEngineService } from './calculation-engine.service';
import { BusinessRules, ItemMeasurement, OutstandingBreakdown, RateSnapshot } from './calculation.types';

describe('CalculationEngineService', () => {
  let engine: CalculationEngineService;

  const baseRules: BusinessRules = {
    ruleSetId: 'rule-1',
    eligibilityPercent: new Decimal(70),
    marginType: 'FIXED',
    marginValue: new Decimal(5000),
    interestMethod: 'FLAT_MONTHLY',
    interestPercent: new Decimal(2),
    gracePeriodDays: 0,
    loanTermDays: 0,
    roundingRule: 'NONE',
    paymentAllocationOrder: ['PENALTY', 'CHARGES', 'INTEREST', 'PRINCIPAL'],
  };

  beforeEach(() => {
    engine = new CalculationEngineService();
  });

  describe('gold item valuation (worked example from spec)', () => {
    it('12.5g gross / 0.5g stone / 22K -> matches the documented example', () => {
      const item: ItemMeasurement = {
        itemId: 'item-1',
        grossWeight: new Decimal('12.500'),
        stoneWeight: new Decimal('0.500'),
        purityCode: '22K',
        fineFactor: new Decimal('0.9167'), // approx 22/24
      };

      const netWeight = engine.calculateNetWeight(item);
      expect(netWeight.toString()).toBe('12');

      const fineWeight = engine.calculateFineWeight(netWeight, item.fineFactor);
      // 12 * 0.9167 = 11.0004 (close to the documented "11.000g" — factor precision dependent)
      expect(fineWeight.toDecimalPlaces(3).toString()).toBe('11');

      const rate = new Decimal(6000); // ₹/g, arbitrary example rate
      const metalValue = engine.calculateMetalValue(fineWeight, rate);
      expect(metalValue.toDecimalPlaces(2).toNumber()).toBeCloseTo(66002.4, 1);
    });
  });

  describe('eligibility, margin, and loan amount (₹100,000 example from spec)', () => {
    it('70% eligibility, ₹5,000 fixed margin -> ₹65,000 max loan', () => {
      const metalValue = new Decimal(100000);
      const eligibleValue = engine.calculateEligibleValue(metalValue, baseRules.eligibilityPercent);
      expect(eligibleValue.toString()).toBe('70000');

      const rates: Record<string, RateSnapshot> = {
        GOLD: { metalCode: 'GOLD', ratePerGram: new Decimal(6000), rateId: 'rate-1' },
      };
      const items: ItemMeasurement[] = [
        {
          itemId: 'item-1',
          grossWeight: metalValue.dividedBy(6000), // constructed to make metalValue land at 100,000
          stoneWeight: new Decimal(0),
          purityCode: '24K',
          fineFactor: new Decimal(1),
        },
      ];

      const result = engine.calculatePledgeValue(items, rates, baseRules, 'GOLD');
      expect(result.totalMetalValue.toDecimalPlaces(2).toNumber()).toBeCloseTo(100000, 1);
      expect(result.eligibleValue.toString()).toBe('70000');
      expect(result.marginApplied.toString()).toBe('5000');
      expect(result.maxLoanAmount.toString()).toBe('65000');
    });

    it('percentage margin applies against eligible value, not metal value', () => {
      const percentMarginRules: BusinessRules = {
        ...baseRules,
        marginType: 'PERCENT',
        marginValue: new Decimal(10), // 10% of eligible value
      };
      const eligibleValue = new Decimal(70000);
      const margin = engine['resolveMargin'](eligibleValue, percentMarginRules);
      expect(margin.toString()).toBe('7000');
    });

    it('never returns a negative loan amount if margin exceeds eligible value', () => {
      const rules: BusinessRules = { ...baseRules, marginValue: new Decimal(999999) };
      const result = engine.applyMargin(new Decimal(70000), new Decimal(999999), rules);
      expect(result.toString()).toBe('0');
    });

    it('applies ROUND_NEAREST_10 rounding when configured', () => {
      const rules: BusinessRules = { ...baseRules, roundingRule: 'ROUND_NEAREST_10' };
      const rounded = engine.applyRounding(new Decimal(64997), rules.roundingRule);
      expect(rounded.toString()).toBe('65000');
    });
  });

  describe('interest calculation (₹50,000 @ 2%/month example from spec)', () => {
    it('1 month -> ₹1,000 interest', () => {
      const interest = engine.calculateInterest(new Decimal(50000), baseRules, 1);
      expect(interest.toString()).toBe('1000');
    });

    it('3 months -> ₹3,000 interest, total ₹53,000', () => {
      const interest = engine.calculateInterest(new Decimal(50000), baseRules, 3);
      expect(interest.toString()).toBe('3000');
      expect(new Decimal(50000).plus(interest).toString()).toBe('53000');
    });

    it('0 elapsed periods -> zero interest (grace period case)', () => {
      const interest = engine.calculateInterest(new Decimal(50000), baseRules, 0);
      expect(interest.toString()).toBe('0');
    });

    it('DAILY method scales linearly with days elapsed', () => {
      const dailyRules: BusinessRules = { ...baseRules, interestMethod: 'DAILY', interestPercent: new Decimal(0.1) };
      const interest = engine.calculateInterest(new Decimal(50000), dailyRules, 15);
      expect(interest.toString()).toBe('750'); // 50000 * 0.001 * 15
    });
  });

  describe('payment allocation (₹53,000 outstanding, ₹10,000 payment example from spec)', () => {
    it('allocates penalty -> charges -> interest -> principal in configured order', () => {
      const outstanding: OutstandingBreakdown = {
        principal: new Decimal(50000),
        interestAccrued: new Decimal(3000),
        charges: new Decimal(0),
        penalty: new Decimal(0),
        paymentsAppliedToPrincipal: new Decimal(0),
        paymentsAppliedToInterest: new Decimal(0),
      };

      const allocation = engine.calculatePaymentAllocation(new Decimal(10000), outstanding, baseRules);

      expect(allocation.interest.toString()).toBe('3000'); // interest paid off first (after penalty/charges, both 0)
      expect(allocation.principal.toString()).toBe('7000'); // remainder to principal
      expect(allocation.remainingOutstanding.toString()).toBe('43000');
    });

    it('a payment smaller than interest due only reduces interest, principal untouched', () => {
      const outstanding: OutstandingBreakdown = {
        principal: new Decimal(50000),
        interestAccrued: new Decimal(3000),
        charges: new Decimal(0),
        penalty: new Decimal(0),
        paymentsAppliedToPrincipal: new Decimal(0),
        paymentsAppliedToInterest: new Decimal(0),
      };

      const allocation = engine.calculatePaymentAllocation(new Decimal(1500), outstanding, baseRules);
      expect(allocation.interest.toString()).toBe('1500');
      expect(allocation.principal.toString()).toBe('0');
    });

    it('respects a retailer-configured allocation order (principal before interest)', () => {
      const principalFirstRules: BusinessRules = {
        ...baseRules,
        paymentAllocationOrder: ['PRINCIPAL', 'INTEREST', 'CHARGES', 'PENALTY'],
      };
      const outstanding: OutstandingBreakdown = {
        principal: new Decimal(50000),
        interestAccrued: new Decimal(3000),
        charges: new Decimal(0),
        penalty: new Decimal(0),
        paymentsAppliedToPrincipal: new Decimal(0),
        paymentsAppliedToInterest: new Decimal(0),
      };
      const allocation = engine.calculatePaymentAllocation(new Decimal(10000), outstanding, principalFirstRules);
      expect(allocation.principal.toString()).toBe('10000');
      expect(allocation.interest.toString()).toBe('0');
    });
  });

  describe('redemption', () => {
    it('redemption amount equals full outstanding', () => {
      const outstanding: OutstandingBreakdown = {
        principal: new Decimal(46000),
        interestAccrued: new Decimal(0),
        charges: new Decimal(0),
        penalty: new Decimal(0),
        paymentsAppliedToPrincipal: new Decimal(0),
        paymentsAppliedToInterest: new Decimal(0),
      };
      expect(engine.calculateRedemptionAmount(outstanding).toString()).toBe('46000');
    });
  });

  describe('edge cases (Section 73)', () => {
    it('rejects an item where stone weight exceeds gross weight', () => {
      const badItem: ItemMeasurement = {
        itemId: 'bad-item',
        grossWeight: new Decimal(5),
        stoneWeight: new Decimal(6),
        purityCode: '22K',
        fineFactor: new Decimal(0.9167),
      };
      expect(() => engine.calculateNetWeight(badItem)).toThrow();
    });

    it('outstanding never goes negative even if overpaid', () => {
      const outstanding: OutstandingBreakdown = {
        principal: new Decimal(1000),
        interestAccrued: new Decimal(0),
        charges: new Decimal(0),
        penalty: new Decimal(0),
        paymentsAppliedToPrincipal: new Decimal(5000), // overpayment scenario
        paymentsAppliedToInterest: new Decimal(0),
      };
      expect(engine.calculateOutstanding(outstanding).toString()).toBe('0');
    });
  });

  describe('calculateCalendarMonthsElapsed (backdated-Girvi calendar-month interest rule)', () => {
    // Table straight from the business requirement: the day of the month
    // pledged must NEVER change the result — only which calendar months
    // are touched, inclusive of both the pledge month and the asOf month.

    it('same day (12-Feb-2025 -> 12-Feb-2025) => 1 month', () => {
      expect(engine.calculateCalendarMonthsElapsed(new Date(2025, 1, 12), new Date(2025, 1, 12))).toBe(1);
    });

    it('10 days later, same month (12-Feb-2025 -> 22-Feb-2025) => 1 month', () => {
      expect(engine.calculateCalendarMonthsElapsed(new Date(2025, 1, 12), new Date(2025, 1, 22))).toBe(1);
    });

    it('25 days later, crosses into next month (12-Feb-2025 -> 09-Mar-2025) => 2 months', () => {
      expect(engine.calculateCalendarMonthsElapsed(new Date(2025, 1, 12), new Date(2025, 2, 9))).toBe(2);
    });

    it('same month, late pledge (25-Feb-2025 -> 28-Feb-2025) => 1 month', () => {
      expect(engine.calculateCalendarMonthsElapsed(new Date(2025, 1, 25), new Date(2025, 1, 28))).toBe(1);
    });

    it('next month, immediately (25-Feb-2025 -> 01-Mar-2025) => 2 months', () => {
      expect(engine.calculateCalendarMonthsElapsed(new Date(2025, 1, 25), new Date(2025, 2, 1))).toBe(2);
    });

    it('next month, later (12-Feb-2025 -> 31-Mar-2025) => 2 months', () => {
      expect(engine.calculateCalendarMonthsElapsed(new Date(2025, 1, 12), new Date(2025, 2, 31))).toBe(2);
    });

    it('three months (12-Feb-2025 -> 01-Apr-2025) => 3 months', () => {
      expect(engine.calculateCalendarMonthsElapsed(new Date(2025, 1, 12), new Date(2025, 3, 1))).toBe(3);
    });

    it('year boundary (25-Dec-2025 -> 05-Jan-2026) => 2 months', () => {
      expect(engine.calculateCalendarMonthsElapsed(new Date(2025, 11, 25), new Date(2026, 0, 5))).toBe(2);
    });

    it('multiple months across a year boundary (15-Nov-2025 -> 10-Feb-2026) => 4 months', () => {
      expect(engine.calculateCalendarMonthsElapsed(new Date(2025, 10, 15), new Date(2026, 1, 10))).toBe(4);
    });

    // Every pledge day in the same month must produce the same result —
    // this is the core "no day-of-month sensitivity" assertion.
    it.each([
      [new Date(2025, 1, 1), 1],
      [new Date(2025, 1, 5), 1],
      [new Date(2025, 1, 12), 1],
      [new Date(2025, 1, 25), 1],
      [new Date(2025, 1, 28), 1],
    ])('pledge on %s within Feb-2025, asOf 28-Feb-2025 => %i month', (pledgeDate, expected) => {
      expect(engine.calculateCalendarMonthsElapsed(pledgeDate, new Date(2025, 1, 28))).toBe(expected);
    });

    // Full table from the spec, pledge = 12-Feb-2025.
    it.each([
      [new Date(2025, 1, 12), 1],
      [new Date(2025, 1, 20), 1],
      [new Date(2025, 1, 28), 1],
      [new Date(2025, 2, 1), 2],
      [new Date(2025, 2, 10), 2],
      [new Date(2025, 2, 31), 2],
      [new Date(2025, 3, 1), 3],
    ])('pledge 12-Feb-2025, asOf %s => %i months', (asOfDate, expected) => {
      expect(engine.calculateCalendarMonthsElapsed(new Date(2025, 1, 12), asOfDate)).toBe(expected);
    });

    // Full table from the spec, pledge = 25-Dec-2025.
    it.each([
      [new Date(2026, 0, 1), 2],
      [new Date(2026, 0, 31), 2],
      [new Date(2026, 1, 1), 3],
    ])('pledge 25-Dec-2025, asOf %s => %i months', (asOfDate, expected) => {
      expect(engine.calculateCalendarMonthsElapsed(new Date(2025, 11, 25), asOfDate)).toBe(expected);
    });

    it('leap year February (12-Feb-2024 -> 29-Feb-2024) => 1 month, then rolls to 2 on 01-Mar', () => {
      expect(engine.calculateCalendarMonthsElapsed(new Date(2024, 1, 12), new Date(2024, 1, 29))).toBe(1);
      expect(engine.calculateCalendarMonthsElapsed(new Date(2024, 1, 12), new Date(2024, 2, 1))).toBe(2);
    });

    it('30-day month (April) does not affect the month count', () => {
      expect(engine.calculateCalendarMonthsElapsed(new Date(2025, 3, 5), new Date(2025, 3, 30))).toBe(1);
      expect(engine.calculateCalendarMonthsElapsed(new Date(2025, 3, 5), new Date(2025, 4, 1))).toBe(2);
    });

    it('31-day month (January) does not affect the month count', () => {
      expect(engine.calculateCalendarMonthsElapsed(new Date(2025, 0, 5), new Date(2025, 0, 31))).toBe(1);
      expect(engine.calculateCalendarMonthsElapsed(new Date(2025, 0, 5), new Date(2025, 1, 1))).toBe(2);
    });

    it('throws rather than silently returning a negative/zero result when asOf predates pledge', () => {
      expect(() =>
        engine.calculateCalendarMonthsElapsed(new Date(2025, 2, 1), new Date(2025, 1, 15)),
      ).toThrow();
    });

    it('composes correctly with calculateInterest for the ₹65,000 @ 2%, 3-month example', () => {
      const months = engine.calculateCalendarMonthsElapsed(new Date(2025, 1, 12), new Date(2025, 3, 1));
      expect(months).toBe(3);
      const interest = engine.calculateInterest(new Decimal(65000), baseRules, months);
      expect(interest.toString()).toBe('3900'); // 65000 * 2% * 3
    });
  });
});