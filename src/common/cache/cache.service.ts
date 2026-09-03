import { Injectable, Logger } from '@nestjs/common';

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

/**
 * Minimal TTL cache behind a small interface (get/set/delete/deleteByPrefix).
 *
 * Deliberately in-memory for now — see the module-level note in
 * cache.module.ts for why. Every cache key used against this service is
 * tenant-scoped (see rates.service.ts / metals.service.ts) so there is no
 * cross-tenant leakage risk even though the store itself is process-wide.
 *
 * If REDIS_URL is confirmed reachable from Render in production, swap this
 * implementation for an ioredis-backed one — CacheService's public API
 * (get/set/delete/deleteByPrefix) is intentionally the only surface callers
 * depend on, so that swap needs no changes anywhere else.
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger('Cache');
  private readonly store = new Map<string, CacheEntry>();

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }

    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  /** Invalidates every key starting with `prefix` — used after a mutation
   * (e.g. a rate change) to drop every cached variant for a tenant/metal
   * without needing to know each exact key. */
  async deleteByPrefix(prefix: string): Promise<void> {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  /** Periodic sweep so entries from tenants/metals that stop being
   * requested don't sit in memory forever. Not required for correctness
   * (get() already checks expiry) — just housekeeping. */
  onModuleDestroy(): void {
    this.store.clear();
  }
}
