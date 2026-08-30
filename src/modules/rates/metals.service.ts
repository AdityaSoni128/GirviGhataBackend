import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RequestContext } from '../../common/decorators/current-context.decorator';

@Injectable()
export class MetalsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lists every configured metal with its purities, for populating
   * frontend dropdowns correctly instead of a hardcoded list. */
  async list(ctx: RequestContext) {
    return this.prisma.metal.findMany({
      where: { tenantId: ctx.tenantId },
      include: { purities: { where: { isActive: true } } },
    });
  }
}
