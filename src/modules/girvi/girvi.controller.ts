import { Body, Controller, Get, Param, Post, Query, Put } from '@nestjs/common';
import { GirviService } from './girvi.service';
import { CreateGirviDto } from './dto/create-girvi.dto';
import { CreateTopUpDto } from './dto/create-topup.dto';
import { ListGirviDto } from './dto/list-girvi.dto';
import { CurrentContext, RequestContext } from '../../common/decorators/current-context.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { UpdatePledgeDateDto } from './dto/update-pledge-date.dto';

@Controller('girvi')
export class GirviController {
  constructor(private readonly girviService: GirviService) { }

  @Post()
  @RequirePermissions('girvi:create')
  create(@CurrentContext() ctx: RequestContext, @Body() dto: CreateGirviDto) {
    return this.girviService.create(ctx, dto);
  }

  @Get()
  @RequirePermissions('girvi:create')
  list(@CurrentContext() ctx: RequestContext, @Query() query: ListGirviDto) {
    return this.girviService.list(ctx, query);
  }

  @Get(':id')
  @RequirePermissions('girvi:create')
  findOne(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    return this.girviService.findOne(ctx, id);
  }

  @Post(':id/topup')
  @RequirePermissions('girvi:modify')
  topUp(
    @CurrentContext() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: CreateTopUpDto,
  ) {
    return this.girviService.topUp(ctx, id, dto);
  }

  @Get(':id/current-valuation')
  @RequirePermissions('girvi:create')
  getCurrentValuation(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    return this.girviService.getCurrentValuation(ctx, id);
  }

  @Put(':id/pledge-date')
  @RequirePermissions('girvi:modify')
  updatePledgeDate(
    @CurrentContext() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdatePledgeDateDto,
  ) {
    return this.girviService.updatePledgeDate(ctx, id, dto);
  }
}