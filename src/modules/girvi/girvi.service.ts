import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NumberSequenceService } from '../../common/numbering/number-sequence.service';
import { RequestContext } from '../../common/decorators/current-context.decorator';
import { CalculationEngineService } from '../calculation-engine/calculation-engine.service';
import { OutstandingService , TransactionForOutstanding} from '../payments/outstanding.service';
import { RulesService } from '../rules/rules.service';
import { CreateGirviDto } from './dto/create-girvi.dto';
import { CreateTopUpDto } from './dto/create-topup.dto';
import { ListGirviDto } from './dto/list-girvi.dto';
import { ItemMeasurement, RateSnapshot } from '../calculation-engine/calculation.types';
import { parsePagination, resolveSortField, resolveSortOrder } from '../../common/pagination/pagination.util';
import { UpdatePledgeDateDto } from './dto/update-pledge-date.dto';

/** Allowlisted sort fields for GET /girvi — never pass sortBy straight into
 * Prisma `orderBy`. */
const GIRVI_SORT_FIELDS = ['createdAt', 'pledgeDate', 'dueDate'] as const;
type GirviSortField = (typeof GIRVI_SORT_FIELDS)[number];

@Injectable()
export class GirviService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: NumberSequenceService,
    private readonly engine: CalculationEngineService,
    private readonly rules: RulesService,
    private readonly outstandingService: OutstandingService,
  ) {}

  /**
   * Creates a Girvi transaction. Every number here is recalculated
   * server-side from stored rates/rules/purities — the DTO's
   * requestedLoanAmount is only ever *validated against*, never trusted.
   * Items may span multiple metals; each metal group is valued against
   * its own rate and rule set, then combined.
   *
   * Interest-rate locking: dto.interestPercent (if supplied) is
   * range-validated here and stored on the valuation snapshot as the
   * PERMANENT rate for this transaction — see the field's doc comment
   * in schema.prisma. When omitted, the active rule's rate is used as
   * the default, matching prior behavior exactly.
   */
  async create(ctx: RequestContext, dto: CreateGirviDto) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, tenantId: ctx.tenantId, deletedAt: null },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const now = new Date();
    const pledgeDate = dto.pledgeDate ? new Date(dto.pledgeDate) : now;
    if (Number.isNaN(pledgeDate.getTime())) {
      throw new BadRequestException('pledgeDate is not a valid date');
    }
    if (pledgeDate.getTime() > now.getTime()) {
      throw new BadRequestException('Pledge date cannot be in the future');
    }

    const metalCodes = Array.from(new Set(dto.items.map((i) => i.metalCode)));

    const purityMaps: Record<string, Map<string, Decimal>> = {};
    const rates: Record<string, RateSnapshot> = {};
    const ruleSets: Record<string, Awaited<ReturnType<RulesService['getActiveRules']>>> = {};

    for (const metalCode of metalCodes) {
      const metal = await this.prisma.metal.findFirst({
        where: { tenantId: ctx.tenantId, code: metalCode },
        include: { purities: true },
      });
      if (!metal) throw new BadRequestException(`Metal ${metalCode} not configured`);

      purityMaps[metalCode] = new Map(
        metal.purities.map((p) => [p.code, new Decimal(p.fineFactor.toString())]),
      );

      const currentRate = await this.prisma.metalRate.findFirst({
        where: { tenantId: ctx.tenantId, metalId: metal.id, effectiveTo: null },
        orderBy: { effectiveFrom: 'desc' },
      });
      if (!currentRate) throw new BadRequestException(`No current rate set for ${metalCode}`);
      
      rates[metalCode] = {
        metalCode,
        ratePerGram: new Decimal(currentRate.ratePerGram.toString()),
        rateId: currentRate.id,
      };

      ruleSets[metalCode] = await this.rules.getActiveRules(ctx.tenantId, metalCode);
    }

    const itemsByMetal: Record<string, ItemMeasurement[]> = {};
    for (const item of dto.items) {
      const fineFactor = purityMaps[item.metalCode].get(item.purityCode);
      if (!fineFactor) {
        throw new BadRequestException(
          `Purity ${item.purityCode} is not configured for ${item.metalCode}`,
        );
      }
      itemsByMetal[item.metalCode] = itemsByMetal[item.metalCode] || [];
      itemsByMetal[item.metalCode].push({
        itemId: `${item.metalCode}-${itemsByMetal[item.metalCode].length}`,
        grossWeight: new Decimal(item.grossWeight),
        stoneWeight: new Decimal(item.stoneWeight ?? '0'),
        purityCode: item.purityCode,
        fineFactor,
      });
    }

    const primaryRuleMetal = metalCodes.includes('GOLD') ? 'GOLD' : metalCodes[0];
    const primaryRules = ruleSets[primaryRuleMetal];

    let appliedEligibilityPercent: Decimal;

    if (dto.eligibilityPercent !== undefined) {
      appliedEligibilityPercent = new Decimal(dto.eligibilityPercent);

      if (appliedEligibilityPercent.isNegative()) {
        throw new BadRequestException(
          'Eligibility percentage cannot be negative',
        );
      }

      if (appliedEligibilityPercent.greaterThan(100)) {
        throw new BadRequestException(
          'Eligibility percentage cannot exceed 100%',
        );
      }
    } else {
      appliedEligibilityPercent = primaryRules.eligibilityPercent;
    }

    let combinedMaxLoan = new Decimal(0);
    let combinedEligibleValue = new Decimal(0);
    let combinedFineWeight = new Decimal(0);
    let combinedMetalValue = new Decimal(0);
    let combinedMargin = new Decimal(0);
    const perMetalBreakdown: Record<string, unknown> = {};

    for (const metalCode of metalCodes) {
      const result = this.engine.calculatePledgeValue(
        itemsByMetal[metalCode],
        rates,
        ruleSets[metalCode],
        metalCode,
        appliedEligibilityPercent,
      );
      combinedMaxLoan = combinedMaxLoan.plus(result.maxLoanAmount);
      combinedEligibleValue = combinedEligibleValue.plus(result.eligibleValue);
      combinedFineWeight = combinedFineWeight.plus(result.totalFineWeight);
      combinedMetalValue = combinedMetalValue.plus(result.totalMetalValue);
      combinedMargin = combinedMargin.plus(result.marginApplied);
      perMetalBreakdown[metalCode] = result.breakdown;
    }

    const requestedLoanAmount = new Decimal(dto.requestedLoanAmount);
    if (requestedLoanAmount.greaterThan(combinedMaxLoan)) {
      throw new BadRequestException(
        `Requested loan ₹${requestedLoanAmount.toString()} exceeds the maximum eligible amount ` +
        `₹${combinedMaxLoan.toString()} calculated from current rates and rules.`,
      );
    }
    if (requestedLoanAmount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Requested loan amount must be greater than zero');
    }


    // Lock in the interest rate for this specific transaction (Section 2
    // of the interest-rate-locking requirement). Defaults to the active
    // rule's rate — identical to prior behavior — when the owner didn't
    // override it.
    let lockedInterestPercent: Decimal;
    if (dto.interestPercent !== undefined) {
      lockedInterestPercent = new Decimal(dto.interestPercent);
      if (lockedInterestPercent.isNegative()) {
        throw new BadRequestException('Interest rate cannot be negative');
      }
      if (lockedInterestPercent.greaterThan(100)) {
        throw new BadRequestException('Interest rate cannot exceed 100%');
      }
    } else {
      lockedInterestPercent = primaryRules.interestPercent;
    }

    return this.prisma.$transaction(async (tx) => {
      const girviNumber = await this.sequences.next(tx, ctx.tenantId, 'GIRVI');

      const dueDate = primaryRules.loanTermDays
        ? new Date(pledgeDate.getTime() + primaryRules.loanTermDays * 24 * 60 * 60 * 1000)
        : null;

      const transaction = await tx.girviTransaction.create({
        data: {
          tenantId: ctx.tenantId,
          branchId: dto.branchId,
          girviNumber,
          customerId: dto.customerId,
          status: 'ACTIVE',
          pledgeDate,
          dueDate,
          customerSignatureUrl: dto.customerSignatureUrl,
          createdBy: ctx.userId,
        },
      });

      for (const item of dto.items) {
        const fineFactor = purityMaps[item.metalCode].get(item.purityCode)!;
        const grossWeight = new Decimal(item.grossWeight);
        const stoneWeight = new Decimal(item.stoneWeight ?? '0');
        const netWeight = grossWeight.minus(stoneWeight);

        await tx.pledgedItem.create({
          data: {
            girviTransactionId: transaction.id,
            itemType: item.itemType,
            description: item.description,
            metalCode: item.metalCode,
            purityCode: item.purityCode,
            grossWeight: grossWeight.toString(),
            stoneWeight: stoneWeight.toString(),
            netWeight: netWeight.toString(),
            condition: item.condition,
            conditionNotes: item.conditionNotes,
            hallmark: item.hallmark,
            huid: item.huid,
          },
        });
      }

      await tx.girviValuationSnapshot.create({
        data: {
          girviTransactionId: transaction.id,
          ruleSetId: primaryRules.ruleSetDbId,
          metalRateId: rates[primaryRuleMetal].rateId,
          totalFineWeight: combinedFineWeight.toString(),
          totalMetalValue: combinedMetalValue.toString(),
          eligibilityPercent: appliedEligibilityPercent.toString(),
          eligibleValue: combinedEligibleValue.toString(),
          marginApplied: combinedMargin.toString(),
          maxLoanAmount: combinedMaxLoan.toString(),
          actualLoanAmount: requestedLoanAmount.toString(),
          interestPercent: lockedInterestPercent.toString(),
          calculationBreakdown: perMetalBreakdown.toString(),
          createdBy: ctx.userId,
        },
      });

      await tx.cashLedgerEntry.create({
        data: {
          tenantId: ctx.tenantId,
          branchId: dto.branchId,
          entryType: 'LOAN_DISBURSEMENT',
          direction: 'OUT',
          amount: requestedLoanAmount.toString(),
          accountType: 'CASH',
          createdBy: ctx.userId,
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.userId,
          action: 'GIRVI_CREATE',
          entityType: 'GirviTransaction',
          entityId: transaction.id,
          newValue: {
            girviNumber,
            customerId: dto.customerId,
            loanAmount: requestedLoanAmount.toString(),
            itemCount: dto.items.length,
            pledgeDate: pledgeDate.toISOString(),
            backdated: dto.pledgeDate ? pledgeDate.toDateString() !== now.toDateString() : false,
            hasSignature: !!dto.customerSignatureUrl,
            interestPercent: lockedInterestPercent.toString(),
            interestRateOverridden: dto.interestPercent !== undefined,
            eligibilityPercent: appliedEligibilityPercent.toString(),
            eligibilityPercentOverridden: dto.eligibilityPercent !== undefined,
          },
        },
      });

      return tx.girviTransaction.findUniqueOrThrow({
        where: { id: transaction.id },
        include: { items: true, valuation: true },
      });
    });
  }

  async topUp(ctx: RequestContext, girviId: string, dto: CreateTopUpDto) {
    const transaction = await this.prisma.girviTransaction.findFirst({
      where: { id: girviId, tenantId: ctx.tenantId },
      include: { items: true, valuation: true, topUps: true },
    });
    if (!transaction || !transaction.valuation) {
      throw new NotFoundException('Girvi transaction or its valuation snapshot not found');
    }
    if (!['ACTIVE', 'PARTIALLY_PAID', 'OVERDUE', 'RENEWED'].includes(transaction.status)) {
      throw new BadRequestException(
        `Cannot top up a transaction with status ${transaction.status}`,
      );
    }

    const amount = new Decimal(dto.amount);
    if (amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Top-up amount must be greater than zero');
    }

    const now = new Date();
    const topUpDate = dto.topUpDate ? new Date(dto.topUpDate) : now;
    if (Number.isNaN(topUpDate.getTime())) {
      throw new BadRequestException('topUpDate is not a valid date');
    }
    if (topUpDate.getTime() > now.getTime()) {
      throw new BadRequestException('Top-up date cannot be in the future');
    }
    if (topUpDate.getTime() < transaction.pledgeDate.getTime()) {
      throw new BadRequestException('Top-up date cannot be earlier than the Girvi pledge date');
    }

    const currentValuation = await this.computeCurrentValuation(ctx.tenantId, transaction);
    const existingPrincipalIssued = new Decimal(transaction.valuation.actualLoanAmount.toString()).plus(
      transaction.topUps.reduce((sum, t) => sum.plus(t.amount.toString()), new Decimal(0)),
    );
    const newTotalPrincipal = existingPrincipalIssued.plus(amount);

    if (newTotalPrincipal.greaterThan(currentValuation.currentMaxLoanAmount)) {
      throw new BadRequestException(
        `Top-up of ₹${amount.toString()} would bring total principal to ₹${newTotalPrincipal.toString()}, ` +
        `exceeding the CURRENT maximum eligible amount of ₹${currentValuation.currentMaxLoanAmount.toString()} ` +
        `(recalculated at today's rate).`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const topUp = await tx.girviTopUp.create({
        data: {
          tenantId: ctx.tenantId,
          girviTransactionId: transaction.id,
          amount: amount.toString(),
          topUpDate,
          createdBy: ctx.userId,
        },
      });

      await tx.cashLedgerEntry.create({
        data: {
          tenantId: ctx.tenantId,
          branchId: transaction.branchId,
          entryType: 'LOAN_TOPUP',
          direction: 'OUT',
          amount: amount.toString(),
          accountType: 'CASH',
          createdBy: ctx.userId,
        },
      });

      await tx.girviTransaction.update({
        where: { id: transaction.id },
        data: { updatedBy: ctx.userId },
      });

      await tx.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.userId,
          action: 'GIRVI_TOPUP',
          entityType: 'GirviTransaction',
          entityId: transaction.id,
          newValue: {
            topUpId: topUp.id,
            amount: amount.toString(),
            topUpDate: topUpDate.toISOString(),
            backdated: dto.topUpDate ? topUpDate.toDateString() !== now.toDateString() : false,
          },
        },
      });

      return tx.girviTopUp.findUniqueOrThrow({ where: { id: topUp.id } });
    });
  }

  async getCurrentValuation(ctx: RequestContext, girviId: string) {
    const transaction = await this.prisma.girviTransaction.findFirst({
      where: { id: girviId, tenantId: ctx.tenantId },
      include: { items: true, valuation: true },
    });
    if (!transaction || !transaction.valuation) {
      throw new NotFoundException('Girvi transaction or its valuation snapshot not found');
    }

    const current = await this.computeCurrentValuation(ctx.tenantId, transaction);

    return {
      pledgeValuation: {
        totalFineWeight: transaction.valuation.totalFineWeight.toString(),
        totalMetalValue: transaction.valuation.totalMetalValue.toString(),
        eligibilityPercent: transaction.valuation.eligibilityPercent.toString(),
        eligibleValue: transaction.valuation.eligibleValue.toString(),
        maxLoanAmount: transaction.valuation.maxLoanAmount.toString(),
        actualLoanAmount: transaction.valuation.actualLoanAmount.toString(),
        interestPercent: transaction.valuation.interestPercent.toString(),
      },
      currentValuation: {
        rates: current.rates,
        totalFineWeight: current.totalFineWeight.toString(),
        totalMetalValue: current.totalMetalValue.toString(),
        eligibilityPercent: current.eligibilityPercent,
        currentEligibleValue: current.currentEligibleValue.toString(),
        currentMaxLoanAmount: current.currentMaxLoanAmount.toString(),
      },
    };
  }

  private async computeCurrentValuation(
    tenantId: string,
    transaction: { items: Array<{ metalCode: string; purityCode: string; netWeight: any }> },
  ) {
    const metalCodes = Array.from(new Set(transaction.items.map((i) => i.metalCode)));

    let totalFineWeight = new Decimal(0);
    let totalMetalValue = new Decimal(0);
    let totalEligibleValue = new Decimal(0);
    let totalMaxLoan = new Decimal(0);
    const ratesUsed: Record<string, string> = {};
    let eligibilityPercentDisplay = '';

    for (const metalCode of metalCodes) {
      const metal = await this.prisma.metal.findFirst({
        where: { tenantId, code: metalCode },
        include: { purities: true },
      });
      if (!metal) continue;

      const currentRate = await this.prisma.metalRate.findFirst({
        where: { tenantId, metalId: metal.id, effectiveTo: null },
        orderBy: { effectiveFrom: 'desc' },
      });
      if (!currentRate) continue;

      ratesUsed[metalCode] = currentRate.ratePerGram.toString();

      const rules = await this.rules.getActiveRules(tenantId, metalCode);
      eligibilityPercentDisplay = rules.eligibilityPercent.toString();

      const purityMap = new Map(metal.purities.map((p) => [p.code, new Decimal(p.fineFactor.toString())]));
      const itemsForMetal = transaction.items.filter((i) => i.metalCode === metalCode);

      let metalFineWeight = new Decimal(0);
      for (const item of itemsForMetal) {
        const fineFactor = purityMap.get(item.purityCode);
        if (!fineFactor) continue;
        metalFineWeight = metalFineWeight.plus(
          this.engine.calculateFineWeight(new Decimal(item.netWeight.toString()), fineFactor),
        );
      }

      const rate = new Decimal(currentRate.ratePerGram.toString());
      const metalValue = this.engine.calculateMetalValue(metalFineWeight, rate);
      const eligibleValue = this.engine.calculateEligibleValue(metalValue, rules.eligibilityPercent);
      const margin =
        rules.marginType === 'NONE'
          ? new Decimal(0)
          : rules.marginType === 'FIXED'
            ? rules.marginValue
            : eligibleValue.times(rules.marginValue).dividedBy(100);
      const maxLoan = this.engine.applyMargin(eligibleValue, margin, rules);

      totalFineWeight = totalFineWeight.plus(metalFineWeight);
      totalMetalValue = totalMetalValue.plus(metalValue);
      totalEligibleValue = totalEligibleValue.plus(eligibleValue);
      totalMaxLoan = totalMaxLoan.plus(maxLoan);
    }

    return {
      rates: ratesUsed,
      totalFineWeight,
      totalMetalValue,
      eligibilityPercent: eligibilityPercentDisplay,
      currentEligibleValue: totalEligibleValue,
      currentMaxLoanAmount: totalMaxLoan,
    };
  }

  async updatePledgeDate(
    ctx: RequestContext,
    girviId: string,
    dto: UpdatePledgeDateDto,
  ) {
    const transaction = await this.prisma.girviTransaction.findFirst({
      where: {
        id: girviId,
        tenantId: ctx.tenantId,
      },
    });

    if (!transaction) {
      throw new NotFoundException('Girvi transaction not found');
    }

    const newPledgeDate = new Date(dto.pledgeDate);

    if (Number.isNaN(newPledgeDate.getTime())) {
      throw new BadRequestException('pledgeDate is not a valid date');
    }

    const now = new Date();

    if (newPledgeDate.getTime() > now.getTime()) {
      throw new BadRequestException('Pledge date cannot be in the future');
    }

    const oldPledgeDate = transaction.pledgeDate;

    if (oldPledgeDate.getTime() === newPledgeDate.getTime()) {
      return transaction;
    }

    // Keep the existing loan-term duration intact while moving the
    // dependent due date by the same number of days.
    let newDueDate: Date | null = transaction.dueDate;

    if (transaction.dueDate) {
      const dateDifference =
        newPledgeDate.getTime() - oldPledgeDate.getTime();

      newDueDate = new Date(
        transaction.dueDate.getTime() + dateDifference,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updatedTransaction = await tx.girviTransaction.update({
        where: {
          id: transaction.id,
        },
        data: {
          pledgeDate: newPledgeDate,
          dueDate: newDueDate,
          updatedBy: ctx.userId,
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.userId,
          action: 'GIRVI_PLEDGE_DATE_UPDATE',
          entityType: 'GirviTransaction',
          entityId: transaction.id,
          oldValue: {
            pledgeDate: oldPledgeDate.toISOString(),
            dueDate: transaction.dueDate?.toISOString() ?? null,
          },
          newValue: {
            pledgeDate: newPledgeDate.toISOString(),
            dueDate: newDueDate?.toISOString() ?? null,
          },
        },
      });

      return updatedTransaction;
    });
  }

  async findOne(ctx: RequestContext, girviId: string) {
    const transaction = await this.prisma.girviTransaction.findFirst({
      where: { id: girviId, tenantId: ctx.tenantId },
      include: {
        customer: true,
        items: { include: { photos: true } },
        valuation: true,
        payments: { orderBy: { paymentDate: 'asc' } },
        topUps: { orderBy: { topUpDate: 'asc' } },
        packet: true,
      },
    });
    if (!transaction) throw new NotFoundException('Girvi transaction not found');
    return transaction;
  }

  /**
   * Server-side search + filter + sort + pagination, all applied in a
   * single Postgres query via Prisma. `search` matches against the FULL
   * dataset (girviNumber, customer name, customer mobile) — never just the
   * rows on the current page. `total` reflects the count of rows matching
   * the current search/filters, not the whole table.
   *
   * The list only selects the fields the Girvi list screen actually
   * displays (girviNumber, status, loan amount, customer name) rather than
   * the full transaction graph (items/payments/topUps/etc.) that
   * findOne() returns — keeping list-page payloads small regardless of how
   * many items/payments a given Girvi has accumulated.
   */
  async list(ctx: RequestContext, query: ListGirviDto) {
    const { status, search, fromDate, toDate } = query;

    const dateFilter: Record<string, Date> = {};

    if (fromDate) {
      const d = new Date(`${fromDate}T00:00:00`);
      if (!Number.isNaN(d.getTime())) {
        dateFilter.gte = d;
      }
    }

    if (toDate) {
      const d = new Date(`${toDate}T23:59:59.999`);
      if (!Number.isNaN(d.getTime())) {
        dateFilter.lte = d;
      }
    }

    const where = {
      tenantId: ctx.tenantId,
      ...(status ? { status: status as any } : {}),
      ...(Object.keys(dateFilter).length
        ? { pledgeDate: dateFilter }
        : {}),
      ...(search
        ? {
          OR: [
            {
              girviNumber: {
                contains: search,
                mode: 'insensitive' as const,
              },
            },
            {
              customer: {
                fullName: {
                  contains: search,
                  mode: 'insensitive' as const,
                },
              },
            },
            {
              customer: {
                mobile: {
                  contains: search,
                },
              },
            },
          ],
        }
        : {}),
    };

    const { page, pageSize, skip, take } = parsePagination(
      query.page,
      query.pageSize,
      25,
    );

    const field = resolveSortField<GirviSortField>(
      query.sortBy,
      GIRVI_SORT_FIELDS,
      'createdAt',
    );

    const order = resolveSortOrder(query.sortOrder);

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.girviTransaction.findMany({
        where,
        select: {
          id: true,
          girviNumber: true,
          status: true,
          pledgeDate: true,
          dueDate: true,
          createdAt: true,

          customer: {
            select: {
              id: true,
              fullName: true,
              mobile: true,
              customerCode: true,
            },
          },

          valuation: {
            select: {
              actualLoanAmount: true,
              interestPercent: true,
            },
          },

          topUps: {
            select: {
              amount: true,
              topUpDate: true,
            },
          },

          payments: {
            where: {
              isReversed: false,
            },
            select: {
              allocations: {
                select: {
                  category: true,
                  amount: true,
                },
              },
            },
          },

          items: {
            select: {
              metalCode: true,
            },
          },
        },

        orderBy: [{ [field]: order }, { id: 'desc' }],
        skip,
        take,
      }),

      this.prisma.girviTransaction.count({
        where,
      }),
    ]);

    const outstandingMap =
      await this.outstandingService.computeOutstandingForPreloaded(
        ctx.tenantId,
        rows as TransactionForOutstanding[],
      );

    const results = rows.map((row) => {
      const totalPledgeMonths = row.pledgeDate
        ? this.engine.calculateCalendarMonthsElapsed(
          row.pledgeDate,
          new Date(),
        )
        : 0;

      const originalLoanAmount = row.valuation?.actualLoanAmount
        ? new Decimal(row.valuation.actualLoanAmount.toString())
        : new Decimal(0);

      const totalTopUpAmount = row.topUps.reduce(
        (sum, topUp) => sum.plus(topUp.amount.toString()),
        new Decimal(0),
      );

      const outstanding = outstandingMap.get(row.id);

      return {
        ...row,

        loanAmount: originalLoanAmount
          .plus(totalTopUpAmount)
          .toString(),

        totalPledgeMonths,

        interestPercent:
          row.valuation?.interestPercent?.toString() ?? null,

        interestAccrued:
          outstanding?.interestAccrued?.toString() ?? '0',
      };
    });

    return {
      results,
      total,
      page,
      pageSize,
    };
  }
}