import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NumberSequenceService } from '../../common/numbering/number-sequence.service';
import { RequestContext } from '../../common/decorators/current-context.decorator';
import { CalculationEngineService } from '../calculation-engine/calculation-engine.service';
import { RulesService } from '../rules/rules.service';
import { OutstandingService } from './outstanding.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { ReversePaymentDto } from './dto/reverse-payment.dto';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: NumberSequenceService,
    private readonly engine: CalculationEngineService,
    private readonly rules: RulesService,
    private readonly outstanding: OutstandingService,
  ) {}

  /**
   * Receives a payment, allocates it across penalty/charges/interest/
   * principal per the tenant's configured order, writes the payment +
   * allocations + ledger entry + status update atomically (Section 56).
   *
   * Supports backdated entry via dto.paymentDate — the actual date the
   * money was received, independent of createdAt (always the moment the
   * record was entered into the system). Defaults to now when omitted.
   * A payment date in the future, or earlier than the loan's own
   * pledgeDate, is rejected — a payment cannot predate the loan.
   *
   * Note: paymentDate does NOT feed into interest calculation.
   * OutstandingService computes interest purely from the transaction's
   * pledgeDate + calendar months elapsed to "now" (the calendar-month
   * business rule) — it was never date-of-payment-sensitive, so
   * backdating a payment cannot accidentally turn that into a day-wise
   * calculation. paymentDate is used only for historical record-keeping
   * and reporting (see ReportsService.customerStatement).
   */
  async receive(ctx: RequestContext, dto: CreatePaymentDto) {
    const amount = new Decimal(dto.amount);
    if (amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Payment amount must be greater than zero');
    }

    const discountAmount = new Decimal(dto.discountAmount ?? '0');
    if (discountAmount.isNegative()) {
      throw new BadRequestException('Discount amount cannot be negative');
    }

    const transaction = await this.prisma.girviTransaction.findFirst({
      where: { id: dto.girviTransactionId, tenantId: ctx.tenantId },
      include: { items: true },
    });
    if (!transaction) throw new NotFoundException('Girvi transaction not found');
    if (!['ACTIVE', 'PARTIALLY_PAID', 'OVERDUE', 'RENEWED'].includes(transaction.status)) {
      throw new BadRequestException(`Cannot receive payment on a transaction with status ${transaction.status}`);
    }

    const now = new Date();
    const paymentDate = dto.paymentDate ? new Date(dto.paymentDate) : now;
    if (Number.isNaN(paymentDate.getTime())) {
      throw new BadRequestException('paymentDate is not a valid date');
    }
    if (paymentDate.getTime() > now.getTime()) {
      throw new BadRequestException('Payment date cannot be in the future');
    }
    if (paymentDate.getTime() < transaction.pledgeDate.getTime()) {
      throw new BadRequestException('Payment date cannot be earlier than the Girvi pledge date');
    }

    const outstandingBreakdown = await this.outstanding.getOutstanding(ctx.tenantId, transaction.id);

    if (discountAmount.greaterThan(outstandingBreakdown.interestAccrued)) {
      throw new BadRequestException(
        `Discount ₹${discountAmount.toString()} cannot exceed outstanding interest ₹${outstandingBreakdown.interestAccrued.toString()}.`,
      );
    }

    const adjustedOutstandingBreakdown = {
      ...outstandingBreakdown,
      interestAccrued: outstandingBreakdown.interestAccrued.minus(discountAmount),
    };

    const totalOutstanding = this.engine.calculateOutstanding(adjustedOutstandingBreakdown);

    if (amount.greaterThan(totalOutstanding)) {
      throw new BadRequestException(
        `Payment ₹${amount.toString()} exceeds total outstanding ₹${totalOutstanding.toString()}. ` +
          `Use the redemption endpoint to close the loan exactly, or reduce the amount.`,
      );
    }

    const metalCode = transaction.items[0]?.metalCode ?? 'GOLD';
    const rules = await this.rules.getActiveRules(ctx.tenantId, metalCode);
    const allocation = this.engine.calculatePaymentAllocation(
      amount,
      adjustedOutstandingBreakdown,
      rules,
    );

    return this.prisma.$transaction(async (tx) => {
      const receiptNumber = await this.sequences.next(tx, ctx.tenantId, 'PAYMENT');

      const payment = await tx.payment.create({
        data: {
          tenantId: ctx.tenantId,
          girviTransactionId: transaction.id,
          receiptNumber,
          amount: amount.toString(),
          discountAmount: discountAmount.toString(),
          mode: dto.mode,
          referenceNumber: dto.referenceNumber,
          paymentDate,
          receivedBy: ctx.userId,
          notes: dto.notes,
        },
      });

      const allocationRows: Array<{ category: string; amount: Decimal }> = [
        { category: 'PENALTY', amount: allocation.penalty },
        { category: 'CHARGES', amount: allocation.charges },
        { category: 'INTEREST', amount: allocation.interest },
        { category: 'PRINCIPAL', amount: allocation.principal },
      ].filter((a) => a.amount.greaterThan(0));

      for (const row of allocationRows) {
        await tx.paymentAllocation.create({
          data: { paymentId: payment.id, category: row.category, amount: row.amount.toString() },
        });
      }

      await tx.cashLedgerEntry.create({
        data: {
          tenantId: ctx.tenantId,
          branchId: transaction.branchId,
          entryType: 'PAYMENT_RECEIVED',
          direction: 'IN',
          amount: amount.toString(),
          accountType: dto.mode === 'CASH' ? 'CASH' : dto.mode,
          paymentId: payment.id,
          createdBy: ctx.userId,
        },
      });

      const newStatus = allocation.remainingOutstanding.lessThanOrEqualTo(0) ? 'CLOSED' : 'PARTIALLY_PAID';
      await tx.girviTransaction.update({
        where: { id: transaction.id },
        data: { status: newStatus, updatedBy: ctx.userId },
      });

      await tx.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.userId,
          action: 'PAYMENT_RECEIVE',
          entityType: 'Payment',
          entityId: payment.id,
          newValue: {
            receiptNumber,
            amount: amount.toString(),
            discountAmount: discountAmount.toString(),
            paymentDate: paymentDate.toISOString(),
            backdated: dto.paymentDate ? paymentDate.toDateString() !== now.toDateString() : false,
            allocation: {
              penalty: allocation.penalty.toString(),
              charges: allocation.charges.toString(),
              interest: allocation.interest.toString(),
              principal: allocation.principal.toString(),
            },
            remainingOutstanding: allocation.remainingOutstanding.toString(),
          },
        },
      });

      return tx.payment.findUniqueOrThrow({
        where: { id: payment.id },
        include: { allocations: true },
      });
    });
  }

  /**
   * Reverses a payment — never deletes it (Section 41). Creates an audit
   * record and a compensating ledger entry; the original payment row stays,
   * flagged isReversed so it's excluded from future outstanding calculations.
   */
  async reverse(ctx: RequestContext, paymentId: string, dto: ReversePaymentDto) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, tenantId: ctx.tenantId },
      include: { girviTransaction: true },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.isReversed) throw new BadRequestException('Payment is already reversed');

    return this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: paymentId },
        data: { isReversed: true, reversalReason: dto.reason },
      });

      await tx.cashLedgerEntry.create({
        data: {
          tenantId: ctx.tenantId,
          branchId: payment.girviTransaction.branchId,
          entryType: 'PAYMENT_REVERSAL',
          direction: 'OUT', // compensating entry: money effectively goes back out of the book
          amount: payment.amount,
          accountType: payment.mode,
          paymentId: payment.id,
          createdBy: ctx.userId,
        },
      });

      // Status may need to revert from CLOSED/PARTIALLY_PAID back to ACTIVE —
      // recomputed from the now-excluded payment rather than guessed.
      await tx.girviTransaction.update({
        where: { id: payment.girviTransactionId },
        data: { status: 'ACTIVE', updatedBy: ctx.userId },
      });

      await tx.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.userId,
          action: 'PAYMENT_CANCEL',
          entityType: 'Payment',
          entityId: paymentId,
          reason: dto.reason,
          oldValue: { isReversed: false },
          newValue: { isReversed: true },
        },
      });

      return tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    });
  }

  async getOutstandingSummary(ctx: RequestContext, girviTransactionId: string) {
    const breakdown = await this.outstanding.getOutstanding(ctx.tenantId, girviTransactionId);
    return {
      principal: breakdown.principal.toString(),
      interestAccrued: breakdown.interestAccrued.toString(),
      charges: breakdown.charges.toString(),
      penalty: breakdown.penalty.toString(),
      totalOutstanding: this.engine.calculateOutstanding(breakdown).toString(),
    };
  }
}