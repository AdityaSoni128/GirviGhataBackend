import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import { CurrentContext, RequestContext } from '../../common/decorators/current-context.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Post('branches')
  @RequirePermissions('tenant:manage')
  createBranch(@CurrentContext() ctx: RequestContext, @Body() dto: CreateBranchDto) {
    return this.tenantsService.createBranch(ctx, dto);
  }

  @Get('branches')
  listBranches(@CurrentContext() ctx: RequestContext) {
    return this.tenantsService.listBranches(ctx);
  }

  @Post('roles')
  @RequirePermissions('tenant:manage')
  createRole(@CurrentContext() ctx: RequestContext, @Body() dto: CreateRoleDto) {
    return this.tenantsService.createRole(ctx, dto);
  }

  @Get('roles')
  listRoles(@CurrentContext() ctx: RequestContext) {
    return this.tenantsService.listRoles(ctx);
  }

  @Get('permissions')
  listPermissions() {
    return this.tenantsService.listPermissions();
  }

  @Post('users')
  @RequirePermissions('tenant:manage')
  createUser(@CurrentContext() ctx: RequestContext, @Body() dto: CreateUserDto) {
    return this.tenantsService.createUser(ctx, dto);
  }

  @Get('users')
  listUsers(@CurrentContext() ctx: RequestContext) {
    return this.tenantsService.listUsers(ctx);
  }

  @Patch('users/:id/deactivate')
  @RequirePermissions('tenant:manage')
  deactivateUser(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    return this.tenantsService.deactivateUser(ctx, id);
  }
}
