import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RequestContext } from '../../common/decorators/current-context.decorator';
import { QueryAuditDto } from './dto/query-audit.dto';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Read-only query surface over audit_logs (Section 42). No write/delete
   * endpoints exist for this table anywhere in the app — every row is
   * created internally by the service that performed the audited action.
   */
  async query(ctx: RequestContext, dto: QueryAuditDto) {
    const page = dto.page ? parseInt(dto.page, 10) : 1;
    const pageSize = dto.pageSize ? parseInt(dto.pageSize, 10) : 50;

    const where = {
      tenantId: ctx.tenantId,
      ...(dto.entityType ? { entityType: dto.entityType } : {}),
      ...(dto.entityId ? { entityId: dto.entityId } : {}),
      ...(dto.actorId ? { actorId: dto.actorId } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { results: rows, total, page, pageSize };
  }
}
