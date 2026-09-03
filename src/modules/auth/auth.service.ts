import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AccessTokenPayload, RefreshTokenPayload } from './auth.types';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

// Masks an email for logs: "j***@example.com" instead of the full address.
// Never log passwords, tokens, or secrets — see the class-level note below.
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  return `${local[0] ?? ''}***@${domain}`;
}

@Injectable()
export class AuthService {
  // SECURITY: this logger must never be passed a password, a JWT (access or
  // refresh), the JWT signing secrets, or KYC data. Every log line below is
  // deliberately built from only: masked email, user id, tenant id, ip.
  private readonly logger = new Logger('Auth');

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string, ipAddress?: string): Promise<TokenPair> {
    this.logger.log(`Login attempt: ${maskEmail(email)} ip=${ipAddress ?? 'unknown'}`);

    // Email is unique per-tenant, not globally, so a bare email lookup could
    // match a user in the wrong tenant if two tenants reuse the same email.
    // In practice the login form should also collect a tenant/business
    // identifier (subdomain, tenant code) — flagged here rather than silently
    // picking the first match. Phase 3 note for the frontend team.
    const user = await this.prisma.user.findFirst({
      where: { email, deletedAt: null },
      include: {
        roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
        branches: true,
      },
    });

    const passwordValid = user ? await argon2.verify(user.passwordHash, password) : false;

    if (!user || !passwordValid || !user.isActive) {
      if (user) {
        await this.prisma.loginHistory.create({
          data: { userId: user.id, success: false, ipAddress },
        });
      }
      this.logger.warn(`Login failed: ${maskEmail(email)} ip=${ipAddress ?? 'unknown'}`);
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
      this.prisma.loginHistory.create({ data: { userId: user.id, success: true, ipAddress } }),
    ]);

    this.logger.log(`Login success: userId=${user.id} tenantId=${user.tenantId} ip=${ipAddress ?? 'unknown'}`);

    const permissions :string[] = Array.from(
      new Set(
        user.roles.flatMap((ur: { role: { permissions: any[]; }; }) => ur.role.permissions.map((rp) => rp.permission.code)),
      ),
    );
    const branchIds = user.branches.map((b: { branchId: any; }) => b.branchId);

    return this.issueTokenPair(user.id, user.tenantId, branchIds, permissions, user.tokenVersion);
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    this.logger.log('Refresh attempt');

    let payload: RefreshTokenPayload;
    try {
      payload = this.jwt.verify(refreshToken, { secret: process.env.JWT_REFRESH_SECRET });
    } catch {
      this.logger.warn('Refresh failed: invalid or expired refresh token');
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    if (payload.type !== 'refresh') {
      this.logger.warn(`Refresh failed: wrong token type userId=${payload.sub}`);
      throw new UnauthorizedException('Invalid token type');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
        branches: true,
      },
    });

    // tokenVersion mismatch means the user logged out everywhere or changed
    // password since this refresh token was issued — reject it (Section 43
    // session/device management).
    if (!user || !user.isActive || user.tokenVersion !== payload.tokenVersion) {
      this.logger.warn(`Refresh failed: token no longer valid userId=${payload.sub}`);
      throw new UnauthorizedException('Refresh token no longer valid');
    }

    this.logger.log(`Refresh success: userId=${user.id} tenantId=${user.tenantId}`);

    const permissions: string[] = Array.from(
      new Set(user.roles.flatMap((ur: { role: { permissions: any[]; }; }) => ur.role.permissions.map((rp) => rp.permission.code))),
    );
    const branchIds = user.branches.map((b: { branchId: any; }) => b.branchId);

    return this.issueTokenPair(user.id, user.tenantId, branchIds, permissions, user.tokenVersion);
  }

  /** Invalidates every outstanding refresh token for this user (Section 43). */
  async logoutAll(userId: string): Promise<void> {
    this.logger.log(`Logout: userId=${userId}`);
    await this.prisma.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    });
  }

  private issueTokenPair(
    userId: string,
    tenantId: string,
    branchIds: string[],
    permissions: string[],
    tokenVersion: number,
  ): TokenPair {
    const accessPayload: AccessTokenPayload = {
      sub: userId,
      tenantId,
      branchIds,
      permissions,
      type: 'access',
    };
    const refreshPayload: RefreshTokenPayload = {
      sub: userId,
      tenantId,
      tokenVersion,
      type: 'refresh',
    };

    const accessToken = this.jwt.sign(accessPayload, {
      secret: process.env.JWT_ACCESS_SECRET,
      expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    });
    const refreshToken = this.jwt.sign(refreshPayload, {
      secret: process.env.JWT_REFRESH_SECRET,
      expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    });

    return { accessToken, refreshToken };
  }
}
