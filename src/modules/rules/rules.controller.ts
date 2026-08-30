import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { RulesService } from './rules.service';
import { CreateRuleSetDto } from './dto/create-rule-set.dto';
import { CurrentContext, RequestContext } from '../../common/decorators/current-context.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@Controller('rules')
export class RulesController {
  constructor(private readonly rulesService: RulesService) {}

  @Get(':metalCode')
  @RequirePermissions('reports:view')
  listVersions(@CurrentContext() ctx: RequestContext, @Param('metalCode') metalCode: string) {
    return this.rulesService.listVersions(ctx, metalCode);
  }

  @Post()
  @RequirePermissions('rules:change')
  createNewVersion(@CurrentContext() ctx: RequestContext, @Body() dto: CreateRuleSetDto) {
    return this.rulesService.createNewVersion(ctx, dto);
  }
}
