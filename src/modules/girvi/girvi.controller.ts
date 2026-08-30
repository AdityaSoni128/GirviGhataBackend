import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { GirviService } from './girvi.service';
import { CreateGirviDto } from './dto/create-girvi.dto';
import { CreateTopUpDto } from './dto/create-topup.dto';
import { CurrentContext, RequestContext } from '../../common/decorators/current-context.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@Controller('girvi')
export class GirviController {
  constructor(private readonly girviService: GirviService) {}

  @Post()
  @RequirePermissions('girvi:create')
  create(@CurrentContext() ctx: RequestContext, @Body() dto: CreateGirviDto) {
    return this.girviService.create(ctx, dto);
  }

  @Get()
  @RequirePermissions('girvi:create')
  list(
    @CurrentContext() ctx: RequestContext,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.girviService.list(
      ctx,
      status,
      page ? parseInt(page, 10) : undefined,
      pageSize ? parseInt(pageSize, 10) : undefined,
    );
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
}