import { Body, Controller, Param, Post } from '@nestjs/common';
import { AuctionService } from './auction.service';
import { RecordSaleDto, ScheduleAuctionDto, MarkEligibleDto } from './dto/auction-actions.dto';
import { CurrentContext, RequestContext } from '../../common/decorators/current-context.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@Controller('auctions')
export class AuctionController {
  constructor(private readonly auctionService: AuctionService) {}

  @Post(':girviTransactionId/notice')
  @RequirePermissions('auction:manage')
  sendNotice(@CurrentContext() ctx: RequestContext, @Param('girviTransactionId') id: string) {
    return this.auctionService.sendNotice(ctx, id);
  }

  @Post(':girviTransactionId/eligible')
  @RequirePermissions('auction:manage')
  markEligible(
    @CurrentContext() ctx: RequestContext,
    @Param('girviTransactionId') id: string,
    @Body() dto: MarkEligibleDto,
  ) {
    return this.auctionService.markEligible(ctx, id, dto);
  }

  @Post(':girviTransactionId/schedule')
  @RequirePermissions('auction:manage')
  schedule(
    @CurrentContext() ctx: RequestContext,
    @Param('girviTransactionId') id: string,
    @Body() dto: ScheduleAuctionDto,
  ) {
    return this.auctionService.schedule(ctx, id, dto);
  }

  @Post(':girviTransactionId/sale')
  @RequirePermissions('auction:manage')
  recordSale(
    @CurrentContext() ctx: RequestContext,
    @Param('girviTransactionId') id: string,
    @Body() dto: RecordSaleDto,
  ) {
    return this.auctionService.recordSale(ctx, id, dto);
  }

  @Post(':girviTransactionId/close')
  @RequirePermissions('auction:manage')
  close(@CurrentContext() ctx: RequestContext, @Param('girviTransactionId') id: string) {
    return this.auctionService.close(ctx, id);
  }
}
