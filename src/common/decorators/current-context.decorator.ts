import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Shape attached to every authenticated request by JwtAuthGuard (Phase 3).
 * Every service method that touches tenant data should take this as its
 * first parameter and use ctx.tenantId explicitly in its Prisma `where`
 * clause — never rely solely on a global middleware filter (defense in
 * depth, see Phase 1 Step 6).
 */
export interface RequestContext {
  userId: string;
  tenantId: string;
  branchIds: string[];
  permissions: string[];
}

export const CurrentContext = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestContext => {
    const request = ctx.switchToHttp().getRequest();
    return request.context as RequestContext;
  },
);
