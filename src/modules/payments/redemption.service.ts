import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NumberSequenceService } from '../../common/numbering/number-sequence.service';
import { RequestContext } from '../../common/decorators/current-context.decorator';
import { CalculationEngineService } from '../calculation-engine/calculation-engine.service';
import { OutstandingService } from './outstanding.service';
import { RedeemGirviDto } from './dto/redeem-girvi.dto';

@Injectable()
export class RedemptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: NumberSequenceService,
    private readonly engine: CalculationEngineService,
    private readonly outstanding: OutstandingService,
  ) { }

  /**
   * Redeems (closes) a Girvi transaction. Requires outstanding to already
   * be zero — i.e. the final payment must be recorded via PaymentsService
   * first. This keeps "money received" and "item released" as two
   * explicit, separately-audited actions (Section 19), rather than
   * silently accepting a payment amount here and skipping proper
   * payment/ledger records.
   *
   * On success: marks the transaction REDEEMED, releases its packet/vault
   * slot, and writes the Redemption + audit records atomically (Section 56
   * — "redemption marked complete but pledged inventory remains active is
   * unacceptable").
   */
  async redeem(ctx: RequestContext, dto: RedeemGirviDto) {
    const transaction = await this.prisma.girviTransaction.findFirst({
      where: { id: dto.girviTransactionId, tenantId: ctx.tenantId },
      include: { payments: { where: { isReversed: false } }, packet: true },
    });
    if (!transaction) throw new NotFoundException('Girvi transaction not found');
    if (['REDEEMED', 'AUCTIONED', 'CANCELLED'].includes(transaction.status)) {
      throw new BadRequestException(`Transaction is already ${transaction.status}`);
    }

    const breakdown = await this.outstanding.getOutstanding(ctx.tenantId, transaction.id);
    const totalOutstanding = this.engine.calculateOutstanding(breakdown);
    if (totalOutstanding.greaterThan(0)) {
      throw new BadRequestException(
        `Cannot redeem: outstanding balance is ₹${totalOutstanding.toString()}. ` +
        `Record the remaining payment first.`,
      );
    }

    const totalPaid = transaction.payments
      .filter((p) => !p.isReversed)
      .reduce((sum, p) => sum + Number(p.amount), 0);

    return this.prisma.$transaction(async (tx) => {
      const redemptionNumber = await this.sequences.next(tx, ctx.tenantId, 'REDEMPTION');

      const redemption = await tx.redemption.create({
        data: {
          girviTransactionId: transaction.id,
          redemptionNumber,
          amountPaid: totalPaid.toString(),
          releasedBy: ctx.userId,
          customerAckUrl: dto.customerAckUrl,
        },
      });

      await tx.girviTransaction.update({
        where: { id: transaction.id },
        data: { status: 'REDEEMED', updatedBy: ctx.userId },
      });

      // Free the vault slot — item is no longer active pledged inventory (Section 19/20).
      if (transaction.packet) {
        await tx.packet.update({
          where: { id: transaction.packet.id },
          data: { storageLocationId: null },
        });
      }

      await tx.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.userId,
          action: 'ITEM_REDEEM',
          entityType: 'GirviTransaction',
          entityId: transaction.id,
          newValue: { redemptionNumber, totalPaid: totalPaid.toString() },
        },
      });

      return redemption;
    });
  }
}
