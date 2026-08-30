import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { ReversePaymentDto } from './dto/reverse-payment.dto';
import { CurrentContext, RequestContext } from '../../common/decorators/current-context.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  @RequirePermissions('payment:receive')
  receive(@CurrentContext() ctx: RequestContext, @Body() dto: CreatePaymentDto) {
    return this.paymentsService.receive(ctx, dto);
  }

  @Post(':id/reverse')
  @RequirePermissions('payment:cancel')
  reverse(
    @CurrentContext() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: ReversePaymentDto,
  ) {
    return this.paymentsService.reverse(ctx, id, dto);
  }

  @Get('outstanding/:girviTransactionId')
  @RequirePermissions('payment:receive')
  outstanding(@CurrentContext() ctx: RequestContext, @Param('girviTransactionId') id: string) {
    return this.paymentsService.getOutstandingSummary(ctx, id);
  }
}
