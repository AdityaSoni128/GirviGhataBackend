import { Decimal } from 'decimal.js';
import { OutstandingService } from './outstanding.service';
import { CalculationEngineService } from '../calculation-engine/calculation-engine.service';
import { RulesService } from '../rules/rules.service';
import { BusinessRules } from '../calculation-engine/calculation.types';
import { BadRequestException, NotFoundException } from '@nestjs/common';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

function makeRules(overrides: Partial<BusinessRules> = {}): BusinessRules {
  return {
    ruleSetId: 'rule-active',
    eligibilityPercent: new Decimal(70),
    marginType: 'NONE',
    marginValue: new Decimal(0),
    interestMethod: 'FLAT_MONTHLY',
    interestPercent: new Decimal(99), // deliberately far from any locked rate below,
    // so a test that accidentally used the "active" rate instead of the
    // transaction's locked rate would produce an obviously wrong number.
    gracePeriodDays: 0,
    loanTermDays: null,
    roundingRule: 'NONE',
    paymentAllocationOrder: ['PENALTY', 'CHARGES', 'INTEREST', 'PRINCIPAL'],
    ...overrides,
  } as BusinessRules;
}

function d(v: number | string) {
  return new Decimal(v);
}

// Minimal shape matching TRANSACTION_INCLUDE's output — enough for
// computeBreakdown()/getOutstandingBulk() to run against.
function makeTransaction(opts: {
  id: string;
  tenantId: string;
  metalCode: 'GOLD' | 'SILVER';
  pledgeDate: Date;
  actualLoanAmount: number;
  lockedInterestPercent: number;
  topUps?: Array<{ amount: number; topUpDate: Date }>;
  payments?: Array<{ isReversed: boolean; allocations: Array<{ category: string; amount: number }> }>;
}) {
  return {
    id: opts.id,
    tenantId: opts.tenantId,
    pledgeDate: opts.pledgeDate,
    valuation: {
      actualLoanAmount: d(opts.actualLoanAmount),
      interestPercent: d(opts.lockedInterestPercent),
    },
    items: [{ metalCode: opts.metalCode }],
    topUps: (opts.topUps ?? []).map((t) => ({
      amount: d(t.amount),
      topUpDate: t.topUpDate,
    })),
    // getOutstanding()/getOutstandingBulk() both query payments already
    // filtered to isReversed:false — the mock mirrors that by only
    // including non-reversed payments, exactly as Prisma's `where` would.
    payments: (opts.payments ?? [])
      .filter((p) => !p.isReversed)
      .map((p) => ({
        allocations: p.allocations.map((a) => ({ category: a.category, amount: d(a.amount) })),
      })),
  };
}

describe('OutstandingService', () => {
  let service: OutstandingService;
  let prisma: { girviTransaction: { findFirst: jest.Mock; findMany: jest.Mock } };
  let rules: { getActiveRules: jest.Mock };
  let engine: CalculationEngineService;

  const NOW = new Date('2026-04-15T10:00:00.000Z');

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    engine = new CalculationEngineService();
    prisma = { girviTransaction: { findFirst: jest.fn(), findMany: jest.fn() } };
    rules = { getActiveRules: jest.fn() };
    service = new OutstandingService(prisma as any, engine, rules as any);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  const goldRules = makeRules({ interestMethod: 'FLAT_MONTHLY', gracePeriodDays: 0 });
  const silverDailyRules = makeRules({ interestMethod: 'DAILY', gracePeriodDays: 3 });

  describe('getOutstanding (single) — unchanged behavior', () => {
    it('no payments: full principal + interest outstanding', async () => {
      const tx = makeTransaction({
        id: 'tx-1',
        tenantId: TENANT_A,
        metalCode: 'GOLD',
        pledgeDate: new Date('2026-02-15T00:00:00.000Z'),
        actualLoanAmount: 10000,
        lockedInterestPercent: 2, // 2%/month, locked — NOT the active 99%
      });
      prisma.girviTransaction.findFirst.mockResolvedValue(tx);
      rules.getActiveRules.mockResolvedValue(goldRules);

      const result = await service.getOutstanding(TENANT_A, 'tx-1');

      // Feb 15 -> Apr 15 = 3 calendar months inclusive (Feb, Mar, Apr)
      expect(result.principal.toString()).toBe('10000');
      expect(result.interestAccrued.toString()).toBe('600'); // 10000 * 0.02 * 3
      expect(rules.getActiveRules).toHaveBeenCalledWith(TENANT_A, 'GOLD');
    });

    it('uses the LOCKED interest rate, not the currently active rate', async () => {
      const tx = makeTransaction({
        id: 'tx-locked',
        tenantId: TENANT_A,
        metalCode: 'GOLD',
        pledgeDate: new Date('2026-03-15T00:00:00.000Z'),
        actualLoanAmount: 1000,
        lockedInterestPercent: 1,
      });
      prisma.girviTransaction.findFirst.mockResolvedValue(tx);
      // active rule set says 99% — must NOT be used for the rate.
      rules.getActiveRules.mockResolvedValue(makeRules({ interestPercent: d(99) }));

      const result = await service.getOutstanding(TENANT_A, 'tx-locked');

      // Mar 15 -> Apr 15 = 2 months inclusive; at the LOCKED 1% that's 20,
      // not the ~1980 a 99% rate would produce.
      expect(result.interestAccrued.toString()).toBe('20');
    });

    it('principal payment reduces remaining principal', async () => {
      const tx = makeTransaction({
        id: 'tx-2',
        tenantId: TENANT_A,
        metalCode: 'GOLD',
        pledgeDate: new Date('2026-04-01T00:00:00.000Z'),
        actualLoanAmount: 5000,
        lockedInterestPercent: 2,
        payments: [{ isReversed: false, allocations: [{ category: 'PRINCIPAL', amount: 2000 }] }],
      });
      prisma.girviTransaction.findFirst.mockResolvedValue(tx);
      rules.getActiveRules.mockResolvedValue(goldRules);

      const result = await service.getOutstanding(TENANT_A, 'tx-2');
      expect(result.principal.toString()).toBe('3000');
    });

    it('interest payment reduces interest outstanding, not principal', async () => {
      const tx = makeTransaction({
        id: 'tx-3',
        tenantId: TENANT_A,
        metalCode: 'GOLD',
        pledgeDate: new Date('2026-04-01T00:00:00.000Z'),
        actualLoanAmount: 5000,
        lockedInterestPercent: 2,
        payments: [{ isReversed: false, allocations: [{ category: 'INTEREST', amount: 50 }] }],
      });
      prisma.girviTransaction.findFirst.mockResolvedValue(tx);
      rules.getActiveRules.mockResolvedValue(goldRules);

      const result = await service.getOutstanding(TENANT_A, 'tx-3');
      expect(result.principal.toString()).toBe('5000');
      expect(result.interestAccrued.toString()).toBe('50'); // 100 accrued - 50 paid
    });

    it('reversed payments are excluded entirely (mirrors the isReversed:false query filter)', async () => {
      const tx = makeTransaction({
        id: 'tx-4',
        tenantId: TENANT_A,
        metalCode: 'GOLD',
        pledgeDate: new Date('2026-04-01T00:00:00.000Z'),
        actualLoanAmount: 5000,
        lockedInterestPercent: 2,
        payments: [
          { isReversed: true, allocations: [{ category: 'PRINCIPAL', amount: 2000 }] }, // excluded
          { isReversed: false, allocations: [{ category: 'PRINCIPAL', amount: 500 }] },
        ],
      });
      prisma.girviTransaction.findFirst.mockResolvedValue(tx);
      rules.getActiveRules.mockResolvedValue(goldRules);

      const result = await service.getOutstanding(TENANT_A, 'tx-4');
      expect(result.principal.toString()).toBe('4500'); // only the 500 applied
    });

    it('multiple allocations across multiple payments sum correctly', async () => {
      const tx = makeTransaction({
        id: 'tx-5',
        tenantId: TENANT_A,
        metalCode: 'GOLD',
        pledgeDate: new Date('2026-04-01T00:00:00.000Z'),
        actualLoanAmount: 10000,
        lockedInterestPercent: 2,
        payments: [
          {
            isReversed: false,
            allocations: [
              { category: 'PRINCIPAL', amount: 1000 },
              { category: 'INTEREST', amount: 100 },
            ],
          },
          {
            isReversed: false,
            allocations: [
              { category: 'PRINCIPAL', amount: 500 },
              { category: 'INTEREST', amount: 25 },
            ],
          },
        ],
      });
      prisma.girviTransaction.findFirst.mockResolvedValue(tx);
      rules.getActiveRules.mockResolvedValue(goldRules);

      const result = await service.getOutstanding(TENANT_A, 'tx-5');
      expect(result.principal.toString()).toBe('8500'); // 10000 - 1500
      expect(result.interestAccrued.toString()).toBe('75'); // 200 accrued - 125 paid
    });

    it('fully paid transaction: principal and interest both zero (never negative)', async () => {
      const tx = makeTransaction({
        id: 'tx-6',
        tenantId: TENANT_A,
        metalCode: 'GOLD',
        pledgeDate: new Date('2026-02-01T00:00:00.000Z'),
        actualLoanAmount: 1000,
        lockedInterestPercent: 2,
        payments: [
          {
            isReversed: false,
            allocations: [
              { category: 'PRINCIPAL', amount: 1000 },
              { category: 'INTEREST', amount: 9999 }, // overpaid on purpose
            ],
          },
        ],
      });
      prisma.girviTransaction.findFirst.mockResolvedValue(tx);
      rules.getActiveRules.mockResolvedValue(goldRules);

      const result = await service.getOutstanding(TENANT_A, 'tx-6');
      expect(result.principal.toString()).toBe('0');
      expect(result.interestAccrued.toString()).toBe('0');
    });

    it('multiple top-ups: every top-up uses the original pledgeDate for interest calculation', async () => {
      const tx = makeTransaction({
        id: 'tx-7',
        tenantId: TENANT_A,
        metalCode: 'GOLD',
        pledgeDate: new Date('2026-01-15T00:00:00.000Z'),
        actualLoanAmount: 10000,
        lockedInterestPercent: 1,
        topUps: [
          { amount: 1000, topUpDate: new Date('2026-03-01T00:00:00.000Z') },
          { amount: 2000, topUpDate: new Date('2026-04-01T00:00:00.000Z') },
        ],
      });

      prisma.girviTransaction.findFirst.mockResolvedValue(tx);
      rules.getActiveRules.mockResolvedValue(goldRules);

      const result = await service.getOutstanding(TENANT_A, 'tx-7');

      // Every top-up uses the original pledgeDate as its interest start date.
      // Jan 15 -> Apr 15 = 4 calendar months for all three tranches.
      // Original: 10000 * 1% * 4 = 400
      // Top-up 1: 1000 * 1% * 4 = 40
      // Top-up 2: 2000 * 1% * 4 = 80
      expect(result.interestAccrued.toString()).toBe('520');
      expect(result.principal.toString()).toBe('13000');
    });

    it('DAILY interest method applies gracePeriodDays', async () => {
      const tx = makeTransaction({
        id: 'tx-8',
        tenantId: TENANT_A,
        metalCode: 'SILVER',
        pledgeDate: new Date('2026-04-01T00:00:00.000Z'), // 14 days before NOW
        actualLoanAmount: 1000,
        lockedInterestPercent: 1,
      });
      prisma.girviTransaction.findFirst.mockResolvedValue(tx);
      rules.getActiveRules.mockResolvedValue(silverDailyRules); // gracePeriodDays: 3

      const result = await service.getOutstanding(TENANT_A, 'tx-8');
      // 14 days elapsed - 3 grace = 11 days * 1000 * 0.01 = 110
      expect(result.interestAccrued.toString()).toBe('110');
      expect(rules.getActiveRules).toHaveBeenCalledWith(TENANT_A, 'SILVER');
    });

    it('throws BadRequestException when now is before pledgeDate', async () => {
      const tx = makeTransaction({
        id: 'tx-9',
        tenantId: TENANT_A,
        metalCode: 'GOLD',
        pledgeDate: new Date('2099-01-01T00:00:00.000Z'), // future
        actualLoanAmount: 1000,
        lockedInterestPercent: 1,
      });
      prisma.girviTransaction.findFirst.mockResolvedValue(tx);
      rules.getActiveRules.mockResolvedValue(goldRules);

      await expect(service.getOutstanding(TENANT_A, 'tx-9')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('loanStillOpen=false (fully repaid) stops further interest from accruing on any tranche', async () => {
      const tx = makeTransaction({
        id: 'tx-10',
        tenantId: TENANT_A,
        metalCode: 'GOLD',
        pledgeDate: new Date('2026-01-01T00:00:00.000Z'),
        actualLoanAmount: 1000,
        lockedInterestPercent: 5,
        payments: [{ isReversed: false, allocations: [{ category: 'PRINCIPAL', amount: 1000 }] }],
      });
      prisma.girviTransaction.findFirst.mockResolvedValue(tx);
      rules.getActiveRules.mockResolvedValue(goldRules);

      const result = await service.getOutstanding(TENANT_A, 'tx-10');
      expect(result.principal.toString()).toBe('0');
      expect(result.interestAccrued.toString()).toBe('0');
    });
  });

  describe('getOutstandingBulk — must match getOutstanding() called per-transaction', () => {
    it('produces identical results to N individual getOutstanding() calls, across GOLD+SILVER/DAILY+MONTHLY/partial+full/top-ups, in ONE transaction query + ONE rules query per distinct metal', async () => {
      const transactions = [
        makeTransaction({
          id: 'bulk-1',
          tenantId: TENANT_A,
          metalCode: 'GOLD',
          pledgeDate: new Date('2026-02-15T00:00:00.000Z'),
          actualLoanAmount: 10000,
          lockedInterestPercent: 2,
        }),
        makeTransaction({
          id: 'bulk-2',
          tenantId: TENANT_A,
          metalCode: 'SILVER',
          pledgeDate: new Date('2026-04-05T00:00:00.000Z'),
          actualLoanAmount: 4000,
          lockedInterestPercent: 1,
          payments: [{ isReversed: false, allocations: [{ category: 'INTEREST', amount: 5 }] }],
        }),
        makeTransaction({
          id: 'bulk-3',
          tenantId: TENANT_A,
          metalCode: 'GOLD',
          pledgeDate: new Date('2026-01-10T00:00:00.000Z'),
          actualLoanAmount: 8000,
          lockedInterestPercent: 3, // locked rate differs from bulk-1's — proves per-tx locking survives batching
          topUps: [{ amount: 1000, topUpDate: new Date('2026-03-01T00:00:00.000Z') }],
          payments: [
            { isReversed: false, allocations: [{ category: 'PRINCIPAL', amount: 3000 }] },
            { isReversed: true, allocations: [{ category: 'PRINCIPAL', amount: 999999 }] }, // must be ignored
          ],
        }),
        makeTransaction({
          id: 'bulk-4-fully-paid',
          tenantId: TENANT_A,
          metalCode: 'GOLD',
          pledgeDate: new Date('2026-01-01T00:00:00.000Z'),
          actualLoanAmount: 2000,
          lockedInterestPercent: 4,
          payments: [
            {
              isReversed: false,
              allocations: [
                { category: 'PRINCIPAL', amount: 2000 },
                { category: 'INTEREST', amount: 99999 },
              ],
            },
          ],
        }),
      ];

      // --- bulk path ---
      prisma.girviTransaction.findMany.mockResolvedValue(transactions);
      rules.getActiveRules.mockImplementation((_tenantId: string, metalCode: string) =>
        Promise.resolve(metalCode === 'SILVER' ? silverDailyRules : goldRules),
      );

      const bulkResult = await service.getOutstandingBulk(
        TENANT_A,
        transactions.map((t) => t.id),
      );

      expect(prisma.girviTransaction.findMany).toHaveBeenCalledTimes(1);
      // 2 distinct metals (GOLD, SILVER) among 4 transactions -> 2 rules calls, not 4.
      expect(rules.getActiveRules).toHaveBeenCalledTimes(2);

      // --- individual path, for comparison ---
      jest.clearAllMocks();
      rules.getActiveRules.mockImplementation((_tenantId: string, metalCode: string) =>
        Promise.resolve(metalCode === 'SILVER' ? silverDailyRules : goldRules),
      );
      for (const tx of transactions) {
        prisma.girviTransaction.findFirst.mockResolvedValueOnce(tx);
      }

      const individualResults = new Map<string, { principal: string; interest: string }>();
      for (const tx of transactions) {
        const r = await service.getOutstanding(TENANT_A, tx.id);
        individualResults.set(tx.id, { principal: r.principal.toString(), interest: r.interestAccrued.toString() });
      }

      for (const tx of transactions) {
        const bulk = bulkResult.get(tx.id)!;
        const individual = individualResults.get(tx.id)!;
        expect(bulk.principal.toString()).toBe(individual.principal);
        expect(bulk.interestAccrued.toString()).toBe(individual.interest);
      }
    });

    it('tenant isolation: only fetches transactions matching tenantId, never mixes tenants', async () => {
      prisma.girviTransaction.findMany.mockResolvedValue([]); // simulates Prisma correctly filtering out tenant B's ids
      rules.getActiveRules.mockResolvedValue(goldRules);

      const result = await service.getOutstandingBulk(TENANT_A, ['foreign-tx-owned-by-tenant-b']);

      expect(prisma.girviTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: TENANT_A }),
        }),
      );
      expect(result.size).toBe(0); // nothing leaked back for the foreign id
    });

    it('returns an empty Map without querying anything when given no transaction ids', async () => {
      const result = await service.getOutstandingBulk(TENANT_A, []);
      expect(result.size).toBe(0);
      expect(prisma.girviTransaction.findMany).not.toHaveBeenCalled();
      expect(rules.getActiveRules).not.toHaveBeenCalled();
    });

    it('propagates BadRequestException for a future pledgeDate, same as the single-transaction path', async () => {
      const tx = makeTransaction({
        id: 'bulk-future',
        tenantId: TENANT_A,
        metalCode: 'GOLD',
        pledgeDate: new Date('2099-01-01T00:00:00.000Z'),
        actualLoanAmount: 1000,
        lockedInterestPercent: 1,
      });
      prisma.girviTransaction.findMany.mockResolvedValue([tx]);
      rules.getActiveRules.mockResolvedValue(goldRules);

      await expect(service.getOutstandingBulk(TENANT_A, ['bulk-future'])).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('throws NotFoundException if no active rules exist for a metal used by the batch', async () => {
      const tx = makeTransaction({
        id: 'bulk-no-rules',
        tenantId: TENANT_A,
        metalCode: 'GOLD',
        pledgeDate: new Date('2026-01-01T00:00:00.000Z'),
        actualLoanAmount: 1000,
        lockedInterestPercent: 1,
      });
      prisma.girviTransaction.findMany.mockResolvedValue([tx]);
      rules.getActiveRules.mockRejectedValue(new NotFoundException('No active business rules configured for GOLD'));

      await expect(service.getOutstandingBulk(TENANT_A, ['bulk-no-rules'])).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});