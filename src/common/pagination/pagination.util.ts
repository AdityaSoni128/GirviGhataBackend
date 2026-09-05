/**
 * Shared pagination/sorting helpers so every list endpoint (customers,
 * girvi, etc.) validates page/pageSize/sortBy the same way instead of
 * duplicating ad-hoc parseInt/clamping logic per module.
 *
 * All pagination in this application happens at the PostgreSQL level via
 * Prisma `skip`/`take` — these helpers only compute the safe, validated
 * inputs to that query; they never fetch data themselves.
 */

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export interface ParsedPagination {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

/**
 * Parses and clamps page/pageSize coming from query params (always strings
 * over HTTP). Invalid, missing, or out-of-range values fall back to safe
 * defaults rather than erroring — e.g. `limit=999999` is silently capped at
 * MAX_PAGE_SIZE instead of allowing an unbounded query.
 */
export function parsePagination(
  page?: string,
  pageSize?: string,
  defaultPageSize = DEFAULT_PAGE_SIZE,
  maxPageSize = MAX_PAGE_SIZE,
): ParsedPagination {
  let p = page !== undefined ? parseInt(page, 10) : 1;
  let ps = pageSize !== undefined ? parseInt(pageSize, 10) : defaultPageSize;

  if (!Number.isFinite(p) || p < 1) p = 1;
  if (!Number.isFinite(ps) || ps < 1) ps = defaultPageSize;
  if (ps > maxPageSize) ps = maxPageSize;

  return { page: p, pageSize: ps, skip: (p - 1) * ps, take: ps };
}

/**
 * Validates a user-supplied sortBy against an allowlist of Prisma field
 * names. Never pass raw query input straight into `orderBy` — an
 * unrecognized field silently falls back to `fallback` instead of causing
 * a Prisma error or (in a differently-built query) a query-injection risk.
 */
export function resolveSortField<T extends string>(
  sortBy: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  return (allowed as readonly string[]).includes(sortBy ?? '') ? (sortBy as T) : fallback;
}

export function resolveSortOrder(sortOrder?: string): 'asc' | 'desc' {
  return sortOrder === 'asc' ? 'asc' : 'desc';
}

export interface PaginatedResult<T> {
  results: T[];
  total: number;
  page: number;
  pageSize: number;
}
