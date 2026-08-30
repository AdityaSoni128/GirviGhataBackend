import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RequestContext } from '../../common/decorators/current-context.decorator';
import { OutstandingService } from '../payments/outstanding.service';
import { RecordDailyClosingDto } from './dto/record-daily-closing.dto';

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outstanding: OutstandingService,
  ) {}

  /**
   * Dashboard summary cards (Section 26/27). Principal/interest outstanding
   * are computed live via OutstandingService for every ACTIVE/PARTIALLY_PAID/
   * OVERDUE transaction — fine at moderate scale; at high transaction volume
   * (Section 70, 100k+ transactions) this should move to a scheduled job that
   * writes daily interest_accruals rows instead of recomputing on request.
   */
  async dashboardSummary(ctx: RequestContext) {
    const openTransactions = await this.prisma.girviTransaction.findMany({
      where: {
        tenantId: ctx.tenantId,
        status: { in: ['ACTIVE', 'PARTIALLY_PAID', 'OVERDUE', 'RENEWED'] },
      },
      include: { items: true, valuation: true },
    });

    let principalOutstanding = new Decimal(0);
    let interestOutstanding = new Decimal(0);
    let goldWeight = new Decimal(0);
    let silverWeight = new Decimal(0);
    let overdueCount = 0;
    let dueSoonCount = 0;

    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    for (const tx of openTransactions) {
      const breakdown = await this.outstanding.getOutstanding(ctx.tenantId, tx.id);
      principalOutstanding = principalOutstanding.plus(breakdown.principal);
      interestOutstanding = interestOutstanding.plus(breakdown.interestAccrued);

      for (const item of tx.items) {
        if (item.metalCode === 'GOLD') goldWeight = goldWeight.plus(item.netWeight.toString());
        if (item.metalCode === 'SILVER') silverWeight = silverWeight.plus(item.netWeight.toString());
      }

      if (tx.status === 'OVERDUE') overdueCount += 1;
      if (tx.dueDate && tx.dueDate.getTime() - now <= sevenDaysMs && tx.dueDate.getTime() >= now) {
        dueSoonCount += 1;
      }
    }

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todaysCollections = await this.prisma.payment.aggregate({
      where: { tenantId: ctx.tenantId, isReversed: false, paymentDate: { gte: startOfToday } },
      _sum: { amount: true },
    });

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const monthCollections = await this.prisma.payment.aggregate({
      where: { tenantId: ctx.tenantId, isReversed: false, paymentDate: { gte: startOfMonth } },
      _sum: { amount: true },
    });

    return {
      activeGirviCount: openTransactions.length,
      principalOutstanding: principalOutstanding.toString(),
      interestOutstanding: interestOutstanding.toString(),
      todaysCollections: (todaysCollections._sum.amount ?? 0).toString(),
      monthCollections: (monthCollections._sum.amount ?? 0).toString(),
      overdueCount,
      dueSoonCount,
      goldPledgedGrams: goldWeight.toString(),
      silverPledgedGrams: silverWeight.toString(),
      totalCashDeployed: principalOutstanding.toString(),
    };
  }

  /** Bank-statement-style running balance per Section 68. Payments are
   * ordered and dated by paymentDate (the actual date money was received),
   * not createdAt, so a backdated payment appears in its correct
   * chronological position rather than at the moment it was typed in. */
  async customerStatement(ctx: RequestContext, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId: ctx.tenantId },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const transactions = await this.prisma.girviTransaction.findMany({
      where: { tenantId: ctx.tenantId, customerId },
      include: {
        valuation: true,
        payments: {
          where: { isReversed: false },
          include: { allocations: true },
          orderBy: { paymentDate: 'asc' },
        },
      },
      orderBy: { pledgeDate: 'asc' },
    });

    const rows: Array<{
      date: Date;
      description: string;
      principal: string;
      interest: string;
      charges: string;
      payment: string;
      balance: string;
    }> = [];
    let runningBalance = new Decimal(0);

    for (const tx of transactions) {
      if (!tx.valuation) continue;
      const loanAmount = new Decimal(tx.valuation.actualLoanAmount.toString());
      runningBalance = runningBalance.plus(loanAmount);
      rows.push({
        date: tx.pledgeDate,
        description: `Girvi Created (${tx.girviNumber})`,
        principal: loanAmount.toString(),
        interest: '0',
        charges: '0',
        payment: '0',
        balance: runningBalance.toString(),
      });

      for (const payment of tx.payments) {
        const interestPaid = payment.allocations
          .filter((a) => a.category === 'INTEREST')
          .reduce((sum, a) => sum.plus(a.amount.toString()), new Decimal(0));
        const principalPaid = payment.allocations
          .filter((a) => a.category === 'PRINCIPAL')
          .reduce((sum, a) => sum.plus(a.amount.toString()), new Decimal(0));

        runningBalance = runningBalance.minus(principalPaid);
        rows.push({
          date: payment.paymentDate,
          description: `Payment (${payment.receiptNumber})`,
          principal: '0',
          interest: interestPaid.toString(),
          charges: '0',
          payment: payment.amount.toString(),
          balance: runningBalance.toString(),
        });
      }
    }

    return { customer: { fullName: customer.fullName, customerCode: customer.customerCode }, rows };
  }

  /**
   * Day Book (Section 28): opening cash + every ledger movement for the
   * given date -> expected closing cash. Unaffected by paymentDate — cash
   * ledger entries remain tied to createdAt (the moment money was
   * recorded as received into the till), since a backdated payment
   * entered today still affects today's actual cash drawer, not the
   * historical date it's dated for. This is a deliberate distinction
   * from the customer statement above.
   */
  async dailyCashBook(ctx: RequestContext, branchId: string, date: Date) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);

    const entries = await this.prisma.cashLedgerEntry.findMany({
      where: {
        tenantId: ctx.tenantId,
        branchId,
        createdAt: { gte: startOfDay, lt: endOfDay },
      },
      orderBy: { createdAt: 'asc' },
    });

    const openingBalanceEntries = await this.prisma.cashLedgerEntry.findMany({
      where: { tenantId: ctx.tenantId, branchId, createdAt: { lt: startOfDay } },
    });
    let openingCash = new Decimal(0);
    for (const e of openingBalanceEntries) {
      openingCash = e.direction === 'IN' ? openingCash.plus(e.amount.toString()) : openingCash.minus(e.amount.toString());
    }

    let inflow = new Decimal(0);
    let outflow = new Decimal(0);
    for (const e of entries) {
      if (e.direction === 'IN') inflow = inflow.plus(e.amount.toString());
      else outflow = outflow.plus(e.amount.toString());
    }

    return {
      date: startOfDay,
      openingCash: openingCash.toString(),
      totalInflow: inflow.toString(),
      totalOutflow: outflow.toString(),
      expectedClosingCash: openingCash.plus(inflow).minus(outflow).toString(),
      entries,
    };
  }

  /**
   * Records the staff's physical cash count for the day against the
   * system-expected figure (Section 28).
   */
  async recordDailyClosing(ctx: RequestContext, dto: RecordDailyClosingDto) {
    const date = dto.date ? new Date(dto.date) : new Date();
    date.setHours(0, 0, 0, 0);

    const { expectedClosingCash } = await this.dailyCashBook(ctx, dto.branchId, date);
    const expected = new Decimal(expectedClosingCash);
    const actual = new Decimal(dto.actualCash);
    const discrepancy = actual.minus(expected);

    if (!discrepancy.isZero() && !dto.discrepancyReason) {
      throw new BadRequestException(
        `Actual cash (₹${actual.toString()}) differs from expected (₹${expected.toString()}) ` +
          `by ₹${discrepancy.toString()} — a discrepancyReason is required.`,
      );
    }

    const closing = await this.prisma.dailyClosing.upsert({
      where: { tenantId_branchId_closingDate: { tenantId: ctx.tenantId, branchId: dto.branchId, closingDate: date } },
      update: {
        expectedCash: expected.toString(),
        actualCash: actual.toString(),
        discrepancy: discrepancy.toString(),
        discrepancyReason: dto.discrepancyReason,
        closedBy: ctx.userId,
      },
      create: {
        tenantId: ctx.tenantId,
        branchId: dto.branchId,
        closingDate: date,
        expectedCash: expected.toString(),
        actualCash: actual.toString(),
        discrepancy: discrepancy.toString(),
        discrepancyReason: dto.discrepancyReason,
        closedBy: ctx.userId,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: 'DAILY_CLOSING_RECORDED',
        entityType: 'DailyClosing',
        entityId: closing.id,
        newValue: {
          expected: expected.toString(),
          actual: actual.toString(),
          discrepancy: discrepancy.toString(),
        },
      },
    });

    return closing;
  }

  /** Section 35 metal report: pledged weight/value broken down by purity. */
  async metalByPurity(ctx: RequestContext) {
    const items = await this.prisma.pledgedItem.findMany({
      where: {
        girviTransaction: {
          tenantId: ctx.tenantId,
          status: { in: ['ACTIVE', 'PARTIALLY_PAID', 'OVERDUE', 'RENEWED'] },
        },
        deletedAt: null,
      },
      select: { metalCode: true, purityCode: true, netWeight: true },
    });

    const grouped = new Map<string, Decimal>();
    for (const item of items) {
      const key = `${item.metalCode}:${item.purityCode}`;
      grouped.set(key, (grouped.get(key) ?? new Decimal(0)).plus(item.netWeight.toString()));
    }

    return Array.from(grouped.entries()).map(([key, weight]) => {
      const [metalCode, purityCode] = key.split(':');
      return { metalCode, purityCode, totalNetWeightGrams: weight.toString() };
    });
  }

  /** Section 35 staff report: collections by employee. */
  async collectionsByStaff(ctx: RequestContext, from?: Date, to?: Date) {
    const payments = await this.prisma.payment.groupBy({
      by: ['receivedBy'],
      where: {
        tenantId: ctx.tenantId,
        isReversed: false,
        ...(from || to
          ? { paymentDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
          : {}),
      },
      _sum: { amount: true },
      _count: { _all: true },
    });

    const userIds = payments.map((p) => p.receivedBy);
    const users = await this.prisma.user.findMany({ where: { id: { in: userIds } } });
    const nameById = new Map(users.map((u) => [u.id, u.fullName]));

    return payments.map((p) => ({
      staffId: p.receivedBy,
      staffName: nameById.get(p.receivedBy) ?? 'Unknown',
      totalCollected: (p._sum.amount ?? 0).toString(),
      paymentCount: p._count._all,
    }));
  }
}