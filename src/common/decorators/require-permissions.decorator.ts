import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Usage: @RequirePermissions('girvi:create', 'girvi:approve')
 * Checked by PermissionsGuard (Phase 3) against ctx.permissions, which is
 * resolved from the user's roles at authentication time. Permission codes
 * are free-form strings stored in the `permissions` table — not hardcoded
 * enums — so tenants can be granted custom roles without a code change.
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
