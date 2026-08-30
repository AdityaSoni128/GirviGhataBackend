import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AccessTokenPayload } from '../auth.types';
import { RequestContext } from '../../../common/decorators/current-context.decorator';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_ACCESS_SECRET || 'insecure-dev-secret',
    });
  }

  // Return value here becomes `request.user`; our JwtAuthGuard also copies
  // it to `request.context` in the RequestContext shape used everywhere else.
  async validate(payload: AccessTokenPayload): Promise<RequestContext> {
    if (payload.type !== 'access') {
      throw new Error('Invalid token type');
    }
    return {
      userId: payload.sub,
      tenantId: payload.tenantId,
      branchIds: payload.branchIds,
      permissions: payload.permissions,
    };
  }
}
