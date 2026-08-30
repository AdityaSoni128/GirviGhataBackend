import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Thin wrapper around PrismaClient so it can be injected across modules
 * and its lifecycle managed by Nest. Tenant scoping is NOT done here —
 * see TenantContextInterceptor + per-repository query helpers, so that
 * every query path is forced to pass tenantId explicitly rather than
 * relying on a single global filter that's easy to bypass by accident.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
