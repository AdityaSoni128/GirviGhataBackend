import { Controller, Get, Query } from '@nestjs/common';
import { AuditService } from './audit.service';
import { QueryAuditDto } from './dto/query-audit.dto';
import { CurrentContext, RequestContext } from '../../common/decorators/current-context.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@Controller('audit-logs')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @RequirePermissions('audit:view')
  query(@CurrentContext() ctx: RequestContext, @Query() dto: QueryAuditDto) {
    return this.auditService.query(ctx, dto);
  }
}
