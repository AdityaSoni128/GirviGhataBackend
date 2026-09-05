-- Performance indexes only. No data is modified, no columns are added or
-- dropped, and CONCURRENTLY is intentionally NOT used here because Prisma
-- migrations already run inside a transaction (CONCURRENTLY cannot run
-- inside one) — for a large production table, run the two busiest ones
-- (payments, girvi_transactions) manually with CREATE INDEX CONCURRENTLY
-- during a low-traffic window instead of via `prisma migrate deploy` if
-- table size makes a locking index build a concern.

-- Girvi list screen's default sort (createdAt desc) + pagination.
CREATE INDEX "girvi_transactions_tenantId_createdAt_idx" ON "girvi_transactions"("tenantId", "createdAt");

-- Postgres does not auto-index foreign key columns. pledged_items is
-- joined by girviTransactionId on every Girvi detail load and every
-- outstanding-balance calculation (OutstandingService).
CREATE INDEX "pledged_items_girviTransactionId_idx" ON "pledged_items"("girviTransactionId");

-- Same reasoning for payments: joined by girviTransactionId for every open
-- Girvi's outstanding calculation, and filtered by tenantId + paymentDate
-- for the dashboard's today's/this-month's collections aggregates.
CREATE INDEX "payments_tenantId_girviTransactionId_idx" ON "payments"("tenantId", "girviTransactionId");
CREATE INDEX "payments_tenantId_paymentDate_idx" ON "payments"("tenantId", "paymentDate");

-- getActiveRules() (pledge creation, top-ups, every outstanding-balance
-- calculation) filters by tenantId + metalCode + isActive. The existing
-- unique index on (tenantId, metalCode, version) covers the first two
-- columns as a prefix but not isActive.
CREATE INDEX "business_rule_sets_tenantId_metalCode_isActive_idx" ON "business_rule_sets"("tenantId", "metalCode", "isActive");
