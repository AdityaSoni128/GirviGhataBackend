import { Controller, Get } from '@nestjs/common';
import { MetalsService } from './metals.service';
import { CurrentContext, RequestContext } from '../../common/decorators/current-context.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@Controller('metals')
export class MetalsController {
  constructor(private readonly metalsService: MetalsService) {}

  @Get()
  @RequirePermissions('girvi:create')
  list(@CurrentContext() ctx: RequestContext) {
    return this.metalsService.list(ctx);
  }
}
