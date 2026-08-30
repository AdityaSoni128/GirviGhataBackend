import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';

/**
 * Runs after JwtAuthGuard (see app.module.ts guard order), which populates
 * request.context from a verified access token. Compares the route's
 * required permissions (via @RequirePermissions()) against
 * request.context.permissions, resolved at login time from the user's roles.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const userPermissions: string[] | undefined = request.context?.permissions;

    if (!userPermissions) {
      // JwtAuthGuard runs before this guard (see app.module.ts) and throws on
      // any non-@Public route without a valid token, so reaching here with no
      // context on a route that requires permissions is a wiring bug, not a
      // legitimate anonymous request — fail closed.
      throw new ForbiddenException('No authenticated context available');
    }

    const hasAll = required.every((p) => userPermissions.includes(p));
    if (!hasAll) {
      throw new ForbiddenException('Missing required permission(s): ' + required.join(', '));
    }
    return true;
  }
}
