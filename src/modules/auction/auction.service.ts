import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RequestContext } from '../../common/decorators/current-context.decorator';
import { CalculationEngineService } from '../calculation-engine/calculation-engine.service';
import { OutstandingService } from '../payments/outstanding.service';
import { RecordSaleDto, ScheduleAuctionDto, MarkEligibleDto } from './dto/auction-actions.dto';

/**
 * Status pipeline (Section 33): NOTICE -> AUCTION_ELIGIBLE -> SCHEDULED ->
 * AUCTIONED -> CLOSED. Every transition here is an explicit staff action —
 * nothing in this service (or anywhere else) advances a case automatically
 * just because time has passed. The OverdueSchedulerService only ever sets
 * GirviTransaction.status to OVERDUE; it never touches AuctionCase.
 *
 * This intentionally does NOT implement a live bidding/auction-sale engine
 * (Phase 1 Step 2, Q10) — only status tracking + settlement recording, on
 * the assumption the actual sale happens offline/manually. Revisit if you
 * want in-app bidding.
 */
@Injectable()
export class AuctionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: CalculationEngineService,
    private readonly outstanding: OutstandingService,
  ) {}

  /** Step 1: send/record a default notice. Requires the loan to already be OVERDUE. */
  async sendNotice(ctx: RequestContext, girviTransactionId: string) {
    const transaction = await this.getOwnedOrThrow(ctx.tenantId, girviTransactionId);
    if (transaction.status !== 'OVERDUE') {
      throw new BadRequestException(
        `Transaction must be OVERDUE before an auction notice can be sent (current: ${transaction.status})`,
      );
    }

    const existing = await this.prisma.auctionCase.findUnique({ where: { girviTransactionId } });
    if (existing) throw new BadRequestException('An auction case already exists for this transaction');

    return this.prisma.$transaction(async (tx) => {
      const auctionCase = await tx.auctionCase.create({
        data: {
          girviTransactionId,
          status: 'NOTICE',
          noticeSentAt: new Date(),
          createdBy: ctx.userId,
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.userId,
          action: 'AUCTION_NOTICE_SENT',
          entityType: 'AuctionCase',
          entityId: auctionCase.id,
          newValue: { girviTransactionId },
        },
      });

      return auctionCase;
    });
  }

  /** Step 2: mark eligible for auction, capturing the outstanding + reserve at this moment. */
  async markEligible(ctx: RequestContext, girviTransactionId: string, dto: MarkEligibleDto) {
    const auctionCase = await this.getCaseOrThrow(ctx.tenantId, girviTransactionId);
    this.assertTransition(auctionCase.status, 'NOTICE', 'AUCTION_ELIGIBLE');

    const breakdown = await this.outstanding.getOutstanding(ctx.tenantId, girviTransactionId);
    const totalOutstanding = this.engine.calculateOutstanding(breakdown);
    const reservePrice = dto.reservePrice ? new Decimal(dto.reservePrice) : totalOutstanding;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.auctionCase.update({
        where: { id: auctionCase.id },
        data: { status: 'AUCTION_ELIGIBLE', eligibleAt: new Date() },
      });

      await tx.girviTransaction.update({
        where: { id: girviTransactionId },
        data: { status: 'AUCTION_ELIGIBLE', updatedBy: ctx.userId },
      });

      await tx.auctionSettlement.upsert({
        where: { auctionCaseId: auctionCase.id },
        update: {
          outstandingPrincipal: breakdown.principal.toString(),
          outstandingInterest: breakdown.interestAccrued.toString(),
          otherCharges: breakdown.charges.plus(breakdown.penalty).toString(),
          reservePrice: reservePrice.toString(),
        },
        create: {
          auctionCaseId: auctionCase.id,
          outstandingPrincipal: breakdown.principal.toString(),
          outstandingInterest: breakdown.interestAccrued.toString(),
          otherCharges: breakdown.charges.plus(breakdown.penalty).toString(),
          reservePrice: reservePrice.toString(),
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.userId,
          action: 'AUCTION_MARK_ELIGIBLE',
          entityType: 'AuctionCase',
          entityId: auctionCase.id,
          newValue: { reservePrice: reservePrice.toString(), totalOutstanding: totalOutstanding.toString() },
        },
      });

      return updated;
    });
  }

  /** Step 3: schedule a date. */
  async schedule(ctx: RequestContext, girviTransactionId: string, dto: ScheduleAuctionDto) {
    const auctionCase = await this.getCaseOrThrow(ctx.tenantId, girviTransactionId);
    this.assertTransition(auctionCase.status, 'AUCTION_ELIGIBLE', 'SCHEDULED');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.auctionCase.update({
        where: { id: auctionCase.id },
        data: { status: 'SCHEDULED', scheduledAt: new Date(dto.scheduledAt) },
      });

      await tx.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.userId,
          action: 'AUCTION_SCHEDULED',
          entityType: 'AuctionCase',
          entityId: auctionCase.id,
          newValue: { scheduledAt: dto.scheduledAt },
        },
      });

      return updated;
    });
  }

  /** Step 4: record the actual sale outcome and profit/loss. */
  async recordSale(ctx: RequestContext, girviTransactionId: string, dto: RecordSaleDto) {
    const auctionCase = await this.getCaseOrThrow(ctx.tenantId, girviTransactionId);
    this.assertTransition(auctionCase.status, 'SCHEDULED', 'AUCTIONED');

    const settlement = await this.prisma.auctionSettlement.findUnique({
      where: { auctionCaseId: auctionCase.id },
    });
    if (!settlement) throw new BadRequestException('No settlement record found — call markEligible first');

    const finalSale = new Decimal(dto.finalSaleAmount);
    const totalOwed = new Decimal(settlement.outstandingPrincipal.toString())
      .plus(settlement.outstandingInterest.toString())
      .plus(settlement.otherCharges.toString());
    const profitOrLoss = finalSale.minus(totalOwed);

    return this.prisma.$transaction(async (tx) => {
      const updatedCase = await tx.auctionCase.update({
        where: { id: auctionCase.id },
        data: { status: 'AUCTIONED' },
      });

      await tx.auctionSettlement.update({
        where: { auctionCaseId: auctionCase.id },
        data: {
          finalSaleAmount: finalSale.toString(),
          buyerName: dto.buyerName,
          soldAt: new Date(),
          profitOrLoss: profitOrLoss.toString(),
        },
      });

      await tx.girviTransaction.update({
        where: { id: girviTransactionId },
        data: { status: 'AUCTIONED', updatedBy: ctx.userId },
      });

      await tx.cashLedgerEntry.create({
        data: {
          tenantId: ctx.tenantId,
          branchId: auctionCase.girviTransaction.branchId,
          entryType: 'AUCTION_SALE',
          direction: 'IN',
          amount: finalSale.toString(),
          accountType: 'CASH',
          createdBy: ctx.userId,
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.userId,
          action: 'AUCTION_SALE_RECORDED',
          entityType: 'AuctionCase',
          entityId: auctionCase.id,
          newValue: {
            finalSaleAmount: finalSale.toString(),
            buyerName: dto.buyerName,
            profitOrLoss: profitOrLoss.toString(),
          },
        },
      });

      return updatedCase;
    });
  }

  /** Step 5: close the case out (e.g. after settlement/paperwork is finalized). */
  async close(ctx: RequestContext, girviTransactionId: string) {
    const auctionCase = await this.getCaseOrThrow(ctx.tenantId, girviTransactionId);
    this.assertTransition(auctionCase.status, 'AUCTIONED', 'CLOSED');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.auctionCase.update({
        where: { id: auctionCase.id },
        data: { status: 'CLOSED' },
      });

      await tx.girviTransaction.update({
        where: { id: girviTransactionId },
        data: { status: 'CLOSED', updatedBy: ctx.userId },
      });

      await tx.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.userId,
          action: 'AUCTION_CASE_CLOSED',
          entityType: 'AuctionCase',
          entityId: auctionCase.id,
        },
      });

      return updated;
    });
  }

  private async getOwnedOrThrow(tenantId: string, girviTransactionId: string) {
    const transaction = await this.prisma.girviTransaction.findFirst({
      where: { id: girviTransactionId, tenantId },
    });
    if (!transaction) throw new NotFoundException('Girvi transaction not found');
    return transaction;
  }

  private async getCaseOrThrow(tenantId: string, girviTransactionId: string) {
    const auctionCase = await this.prisma.auctionCase.findFirst({
      where: { girviTransactionId, girviTransaction: { tenantId } },
      include: { girviTransaction: true },
    });
    if (!auctionCase) throw new NotFoundException('No auction case found for this transaction');
    return auctionCase;
  }

  private assertTransition(current: string, expectedFrom: string, to: string) {
    if (current !== expectedFrom) {
      throw new BadRequestException(
        `Cannot move auction case to ${to}: it must currently be ${expectedFrom} (is ${current})`,
      );
    }
  }
}
