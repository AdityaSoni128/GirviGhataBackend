import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { RatesService } from './rates.service';
import { SetRateDto } from './dto/set-rate.dto';
import { CurrentContext, RequestContext } from '../../common/decorators/current-context.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@Controller('rates')
export class RatesController {
  constructor(private readonly ratesService: RatesService) {}

  @Get('current/:metalCode')
  @RequirePermissions('reports:view')
  getCurrent(@CurrentContext() ctx: RequestContext, @Param('metalCode') metalCode: string) {
    return this.ratesService.getCurrent(ctx, metalCode);
  }

  @Post()
  @RequirePermissions('rate:change')
  setRate(@CurrentContext() ctx: RequestContext, @Body() dto: SetRateDto) {
    return this.ratesService.setRate(ctx, dto);
  }

  @Get('history/:metalCode')
  @RequirePermissions('reports:view')
  history(
    @CurrentContext() ctx: RequestContext,
    @Param('metalCode') metalCode: string,
    @Query('limit') limit?: string,
  ) {
    return this.ratesService.history(ctx, metalCode, limit ? parseInt(limit, 10) : undefined);
  }
}
