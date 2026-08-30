import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RequestContext } from '../../common/decorators/current-context.decorator';
import { CreateBranchDto } from './dto/create-branch.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { CreateRoleDto } from './dto/create-role.dto';

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) { }

  // --- Branches ---------------------------------------------------------

  async createBranch(ctx: RequestContext, dto: CreateBranchDto) {
    // Enforce the tenant's subscription plan limit (Section 59) rather than
    // letting a Starter-plan tenant silently exceed what they're paying for.
    const subscription = await this.prisma.tenantSubscription.findUnique({
      where: { tenantId: ctx.tenantId },
      include: { plan: true },
    });
    if (subscription?.plan.maxBranches != null) {
      const currentCount = await this.prisma.branch.count({
        where: { tenantId: ctx.tenantId, deletedAt: null },
      });
      if (currentCount >= subscription.plan.maxBranches) {
        throw new BadRequestException(
          `Your ${subscription.plan.name} plan allows up to ${subscription.plan.maxBranches} branch(es). Upgrade to add more.`,
        );
      }
    }

    return this.prisma.branch.create({
      data: {
        tenantId: ctx.tenantId,
        code: dto.code,
        name: dto.name,
        addressLine1: dto.addressLine1,
        city: dto.city,
        state: dto.state,
        pincode: dto.pincode,
        phone: dto.phone,
      },
    });
  }

  async listBranches(ctx: RequestContext) {
    return this.prisma.branch.findMany({ where: { tenantId: ctx.tenantId, deletedAt: null } });
  }

  // --- Roles --------------------------------------------------------------

  async createRole(ctx: RequestContext, dto: CreateRoleDto) {
    const permissions = await this.prisma.permission.findMany({
      where: { code: { in: dto.permissionCodes } },
    });
    if (permissions.length !== dto.permissionCodes.length) {
      const found = new Set(permissions.map((p: { code: any; }) => p.code));
      const missing = dto.permissionCodes.filter((c) => !found.has(c));
      throw new BadRequestException(`Unknown permission code(s): ${missing.join(', ')}`);
    }

    return this.prisma.role.create({
      data: {
        tenantId: ctx.tenantId,
        name: dto.name,
        permissions: { create: permissions.map((p: { id: any; }) => ({ permissionId: p.id })) },
      },
      include: { permissions: { include: { permission: true } } },
    });
  }

  async listRoles(ctx: RequestContext) {
    return this.prisma.role.findMany({
      where: { tenantId: ctx.tenantId },
      include: { permissions: { include: { permission: true } } },
    });
  }

  async listPermissions() {
    // Global catalogue — not tenant-scoped, so any authenticated user can
    // see what's available when building a custom role.
    return this.prisma.permission.findMany();
  }

  // --- Users ---------------------------------------------------------------

  async createUser(ctx: RequestContext, dto: CreateUserDto) {
    const subscription = await this.prisma.tenantSubscription.findUnique({
      where: { tenantId: ctx.tenantId },
      include: { plan: true },
    });
    if (subscription?.plan.maxUsers != null) {
      const currentCount = await this.prisma.user.count({
        where: { tenantId: ctx.tenantId, deletedAt: null },
      });
      if (currentCount >= subscription.plan.maxUsers) {
        throw new BadRequestException(
          `Your ${subscription.plan.name} plan allows up to ${subscription.plan.maxUsers} user(s). Upgrade to add more.`,
        );
      }
    }

    const roles = await this.prisma.role.findMany({
      where: { id: { in: dto.roleIds }, tenantId: ctx.tenantId },
    });
    if (roles.length !== dto.roleIds.length) {
      throw new BadRequestException('One or more roleIds are invalid for this tenant');
    }
    const branches = await this.prisma.branch.findMany({
      where: { id: { in: dto.branchIds }, tenantId: ctx.tenantId },
    });
    if (branches.length !== dto.branchIds.length) {
      throw new BadRequestException('One or more branchIds are invalid for this tenant');
    }

    const passwordHash = await argon2.hash(dto.password);

    const user = await this.prisma.user.create({
      data: {
        tenantId: ctx.tenantId,
        fullName: dto.fullName,
        email: dto.email,
        phone: dto.phone,
        passwordHash,
        roles: { create: dto.roleIds.map((roleId) => ({ roleId })) },
        branches: { create: dto.branchIds.map((branchId) => ({ branchId })) },
      },
      include: { roles: { include: { role: true } }, branches: { include: { branch: true } } },
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: 'USER_CREATE',
        entityType: 'User',
        entityId: user.id,
        newValue: { email: dto.email, roleIds: dto.roleIds, branchIds: dto.branchIds },
      },
    });

    const { passwordHash: _omit, ...safeUser } = user;
    return safeUser;
  }

  async listUsers(ctx: RequestContext) {
    const users = await this.prisma.user.findMany({
      where: { tenantId: ctx.tenantId, deletedAt: null },
      include: { roles: { include: { role: true } }, branches: { include: { branch: true } } },
    });
    // return users.map(({ passwordHash, ...rest }) => rest);
    return users.map(
      (user: typeof users[number]) => {
        const { passwordHash, ...rest } = user;
        return rest;
      },
    );
  }

  async deactivateUser(ctx: RequestContext, userId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, tenantId: ctx.tenantId } });
    if (!user) throw new NotFoundException('User not found');

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { isActive: false, tokenVersion: { increment: 1 } }, // also kills any live sessions
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: 'USER_DEACTIVATE',
        entityType: 'User',
        entityId: userId,
      },
    });

    const { passwordHash, ...safe } = updated;
    return safe;
  }
}
