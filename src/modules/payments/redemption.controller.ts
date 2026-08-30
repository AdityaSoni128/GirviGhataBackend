import { Body, Controller, Post } from '@nestjs/common';
import { RedemptionService } from './redemption.service';
import { RedeemGirviDto } from './dto/redeem-girvi.dto';
import { CurrentContext, RequestContext } from '../../common/decorators/current-context.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@Controller('redemptions')
export class RedemptionController {
  constructor(private readonly redemptionService: RedemptionService) {}

  @Post()
  @RequirePermissions('item:redeem')
  redeem(@CurrentContext() ctx: RequestContext, @Body() dto: RedeemGirviDto) {
    return this.redemptionService.redeem(ctx, dto);
  }
}
