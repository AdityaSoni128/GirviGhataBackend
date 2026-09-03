import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';
import { RequestContext } from '../../common/decorators/current-context.decorator';

const METALS_LIST_TTL_SECONDS = 300;

@Injectable()
export class MetalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  /** Lists every configured metal with its purities, for populating
   * frontend dropdowns correctly instead of a hardcoded list. This is
   * read-heavy, effectively-static reference data (metals/purities are
   * configured rarely, not part of day-to-day operation), so it's cached
   * for 5 minutes per tenant. There's currently no create/update/delete
   * endpoint for metals or purities in this module — if one is added
   * later, it must call `cache.delete('metals:list:' + tenantId)` after
   * writing, the same way rates.service.ts does for rate changes. */
  async list(ctx: RequestContext) {
    const cacheKey = `metals:list:${ctx.tenantId}`;
    const cached = await this.cache.get(cacheKey);
    if (cached) return cached;

    const metals = await this.prisma.metal.findMany({
      where: { tenantId: ctx.tenantId },
      include: { purities: { where: { isActive: true } } },
    });

    await this.cache.set(cacheKey, metals, METALS_LIST_TTL_SECONDS);
    return metals;
  }
}
