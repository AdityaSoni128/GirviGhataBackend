import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RequestContext } from '../../common/decorators/current-context.decorator';
import { SetRateDto } from './dto/set-rate.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class RatesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Returns the currently effective rate for a metal (Section 12). */
  async getCurrent(ctx: RequestContext, metalCode: string) {
    const metal = await this.prisma.metal.findFirst({
      where: { tenantId: ctx.tenantId, code: metalCode },
    });
    if (!metal) throw new NotFoundException(`Metal ${metalCode} not configured for this tenant`);

    const rate = await this.prisma.metalRate.findFirst({
      where: { tenantId: ctx.tenantId, metalId: metal.id, effectiveTo: null },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!rate) throw new NotFoundException(`No current rate set for ${metalCode}`);
    return rate;
  }

  /**
   * Sets a new rate. Closes out the previous "current" rate (effectiveTo)
   * rather than deleting it, and writes an append-only history row —
   * Section 13. Every existing Girvi transaction already has its own frozen
   * GirviValuationSnapshot, so this never retroactively changes past loans
   * (Section 12's "VERY IMPORTANT" requirement).
   */
  async setRate(ctx: RequestContext, dto: SetRateDto) {
    const metal = await this.prisma.metal.findFirst({
      where: { tenantId: ctx.tenantId, code: dto.metalCode },
    });
    if (!metal) throw new NotFoundException(`Metal ${dto.metalCode} not configured for this tenant`);

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const previous = await tx.metalRate.findFirst({
        where: { tenantId: ctx.tenantId, metalId: metal.id, effectiveTo: null },
      });

      if (previous) {
        await tx.metalRate.update({
          where: { id: previous.id },
          data: { effectiveTo: new Date() },
        });
      }

      const newRate = await tx.metalRate.create({
        data: {
          tenantId: ctx.tenantId,
          branchId: dto.branchId,
          metalId: metal.id,
          ratePerGram: dto.ratePerGram,
          createdBy: ctx.userId,
        },
      });

      await tx.metalRateHistory.create({
        data: {
          tenantId: ctx.tenantId,
          metalId: metal.id,
          oldRate: previous?.ratePerGram,
          newRate: dto.ratePerGram,
          changedBy: ctx.userId,
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.userId,
          action: 'RATE_CHANGE',
          entityType: 'MetalRate',
          entityId: newRate.id,
          oldValue: previous ? { ratePerGram: previous.ratePerGram.toString() } : "",
          newValue: { ratePerGram: dto.ratePerGram },
        },
      });

      return newRate;
    });
  }

  async history(ctx: RequestContext, metalCode: string, limit = 50) {
    const metal = await this.prisma.metal.findFirst({
      where: { tenantId: ctx.tenantId, code: metalCode },
    });
    if (!metal) throw new NotFoundException(`Metal ${metalCode} not configured for this tenant`);

    return this.prisma.metalRateHistory.findMany({
      where: { tenantId: ctx.tenantId, metalId: metal.id },
      orderBy: { changedAt: 'desc' },
      take: limit,
    });
  }
}
