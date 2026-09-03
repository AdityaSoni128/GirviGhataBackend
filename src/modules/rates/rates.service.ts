import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';
import { RequestContext } from '../../common/decorators/current-context.decorator';
import { SetRateDto } from './dto/set-rate.dto';
import { Prisma } from '@prisma/client';
import { getIstBusinessDate } from '../../common/utils/ist-date.util';

export interface RateStatusResult {
  upToDate: boolean;
  asOfDate: string;
  staleMetals: { code: string; name: string }[];
}

const CURRENT_RATE_TTL_SECONDS = 60;

@Injectable()
export class RatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  /** Returns the currently effective rate for a metal (Section 12).
   * Cached briefly — this is read on essentially every girvi valuation and
   * dashboard load, and rates only change when someone explicitly calls
   * setRate(), which invalidates this same key immediately. */
  async getCurrent(ctx: RequestContext, metalCode: string) {
    const cacheKey = `rates:current:${ctx.tenantId}:${metalCode}`;
    const cached = await this.cache.get<ReturnType<typeof this.serializeRate>>(cacheKey);
    if (cached) return cached;

    const metal = await this.prisma.metal.findFirst({
      where: { tenantId: ctx.tenantId, code: metalCode },
    });
    if (!metal) throw new NotFoundException(`Metal ${metalCode} not configured for this tenant`);

    const rate = await this.prisma.metalRate.findFirst({
      where: { tenantId: ctx.tenantId, metalId: metal.id, effectiveTo: null },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!rate) throw new NotFoundException(`No current rate set for ${metalCode}`);

    const result = this.serializeRate(rate);
    await this.cache.set(cacheKey, result, CURRENT_RATE_TTL_SECONDS);
    return result;
  }

  // Plain pass-through today, but keeps the cached shape decoupled from
  // whatever Prisma returns so caching doesn't silently start returning
  // stale-shaped data if the query above ever changes its select/include.
  private serializeRate(rate: unknown) {
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

    const result = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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

    // Invalidate AFTER the transaction commits — never before, since an
    // invalidation ahead of a commit that then rolls back would just cause
    // the next read to repopulate the cache with the stale rate anyway,
    // while an invalidation after a successful commit guarantees the next
    // read sees the new rate.
    await this.invalidateCurrentRateCache(ctx.tenantId, dto.metalCode);

    return result;
  }

  /** Called right after setRate() commits — separate from the transaction
   * since cache invalidation isn't a DB operation and shouldn't be able to
   * roll back the write if it (implausibly) threw. */
  private async invalidateCurrentRateCache(tenantId: string, metalCode: string) {
    await this.cache.delete(`rates:current:${tenantId}:${metalCode}`);
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

  /**
   * Determines whether today's (IST business date) rates have been set for
   * every metal configured for this tenant. Backend/database is the source
   * of truth — a metal "counts" as updated for today only if its currently
   * effective rate (effectiveTo: null) has an effectiveFrom timestamp that
   * falls within today's IST calendar day. A metal with no rate at all is
   * always stale (Section 12 initial setup case).
   *
   * Deliberately does not persist any new "last checked" state — this is a
   * read derived entirely from existing metal_rates rows, so it needs no
   * schema change/migration and can't drift out of sync with reality.
   */
  async getStatus(ctx: RequestContext): Promise<RateStatusResult> {
    const { dateString, startUtc, endUtc } = getIstBusinessDate();

    const metals = await this.prisma.metal.findMany({
      where: { tenantId: ctx.tenantId },
    });

    // No metals configured for this tenant yet — nothing to nag about.
    if (metals.length === 0) {
      return { upToDate: true, asOfDate: dateString, staleMetals: [] };
    }

    const currentRates = await this.prisma.metalRate.findMany({
      where: {
        tenantId: ctx.tenantId,
        metalId: { in: metals.map((m: { id: string }) => m.id) },
        effectiveTo: null,
      },
    });

    const currentByMetalId = new Map(currentRates.map((r: { metalId: string }) => [r.metalId, r]));

    const staleMetals = metals
      .filter((metal: { id: string }) => {
        const rate = currentByMetalId.get(metal.id) as { effectiveFrom: Date } | undefined;
        if (!rate) return true;
        return !(rate.effectiveFrom >= startUtc && rate.effectiveFrom <= endUtc);
      })
      .map((m: { code: string; name: string }) => ({ code: m.code, name: m.name }));

    return {
      upToDate: staleMetals.length === 0,
      asOfDate: dateString,
      staleMetals,
    };
  }
}