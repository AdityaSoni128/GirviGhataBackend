import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { RecordDailyClosingDto } from './dto/record-daily-closing.dto';
import { CurrentContext, RequestContext } from '../../common/decorators/current-context.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('dashboard')
  @RequirePermissions('reports:view')
  dashboard(@CurrentContext() ctx: RequestContext) {
    return this.reportsService.dashboardSummary(ctx);
  }

  @Get('customer-statement/:customerId')
  @RequirePermissions('reports:view')
  customerStatement(@CurrentContext() ctx: RequestContext, @Param('customerId') customerId: string) {
    return this.reportsService.customerStatement(ctx, customerId);
  }

  @Get('cash-book/:branchId')
  @RequirePermissions('reports:view')
  cashBook(
    @CurrentContext() ctx: RequestContext,
    @Param('branchId') branchId: string,
    @Query('date') date?: string,
  ) {
    return this.reportsService.dailyCashBook(ctx, branchId, date ? new Date(date) : new Date());
  }

  @Post('daily-closing')
  @RequirePermissions('reports:view')
  recordDailyClosing(@CurrentContext() ctx: RequestContext, @Body() dto: RecordDailyClosingDto) {
    return this.reportsService.recordDailyClosing(ctx, dto);
  }

  @Get('metal-by-purity')
  @RequirePermissions('reports:view')
  metalByPurity(@CurrentContext() ctx: RequestContext) {
    return this.reportsService.metalByPurity(ctx);
  }

  @Get('collections-by-staff')
  @RequirePermissions('reports:view')
  collectionsByStaff(
    @CurrentContext() ctx: RequestContext,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reportsService.collectionsByStaff(ctx, from ? new Date(from) : undefined, to ? new Date(to) : undefined);
  }
}
