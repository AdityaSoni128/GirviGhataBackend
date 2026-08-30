import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { SearchCustomersDto } from './dto/search-customers.dto';
import { CurrentContext, RequestContext } from '../../common/decorators/current-context.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Post()
  @RequirePermissions('customer:create')
  create(@CurrentContext() ctx: RequestContext, @Body() dto: CreateCustomerDto) {
    return this.customersService.create(ctx, dto);
  }

  @Get()
  @RequirePermissions('customer:view')
  search(@CurrentContext() ctx: RequestContext, @Query() query: SearchCustomersDto) {
    const page = query.page ? parseInt(query.page, 10) : 1;
    const pageSize = query.pageSize ? parseInt(query.pageSize, 10) : 25;
    return this.customersService.search(ctx, query.q, page, pageSize);
  }

  @Get(':id')
  @RequirePermissions('customer:view')
  findOne(
    @CurrentContext() ctx: RequestContext,
    @Param('id') id: string,
    @Query('unmaskKyc') unmaskKyc?: string,
  ) {
    return this.customersService.findOne(ctx, id, unmaskKyc === 'true');
  }

  @Patch(':id')
  @RequirePermissions('customer:edit')
  update(
    @CurrentContext() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customersService.update(ctx, id, dto);
  }
}
