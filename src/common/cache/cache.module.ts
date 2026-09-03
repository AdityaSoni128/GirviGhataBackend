import { Global, Module } from '@nestjs/common';
import { CacheService } from './cache.service';

// NOTE on Redis: docker-compose.yml provisions a Redis container and passes
// REDIS_URL to the app for local dev, but nothing in the NestJS app
// currently connects to it, and there's no render.yaml or other IaC in this
// repo confirming a Redis add-on exists in the actual Render production
// environment. Rather than wiring up an ioredis client against an
// unconfirmed production dependency, CacheService currently uses a safe
// in-memory store — correct for Render's default single-instance
// deployment. If a Redis instance is confirmed reachable in production,
// this module is the only place that needs to change (swap CacheService's
// internals for an ioredis-backed implementation of the same interface).
@Global()
@Module({
  providers: [CacheService],
  exports: [CacheService],
})
export class CacheModule {}
