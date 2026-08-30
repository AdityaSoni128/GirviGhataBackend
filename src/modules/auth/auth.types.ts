export interface AccessTokenPayload {
  sub: string; // userId
  tenantId: string;
  branchIds: string[];
  permissions: string[];
  type: 'access';
}

export interface RefreshTokenPayload {
  sub: string; // userId
  tenantId: string;
  tokenVersion: number;
  type: 'refresh';
}
