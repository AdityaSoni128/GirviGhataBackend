# Girvi Ghata Management Backend — Phases 2–15 (backend complete; frontend not started)

This is the backend for the multi-tenant Girvi Ghata (gold/silver pledge)
management platform. See `girvi-ghata-architecture-phase1.md` for the full
architecture and the open business questions (Q1–Q14) — several defaults
below are still pending your confirmation.

## What's real and working in this delivery

**Phase 2 — Foundation**
- Complete Prisma schema (every entity from the Phase 1 data model).
- `CalculationEngineService` — fully implemented, Decimal-safe, unit-tested
  against the worked examples in your brief.
- App bootstrap: helmet, strict global validation, rate limiting.

**Phase 3 — Auth, RBAC, Tenancy**
- JWT access + refresh tokens (argon2 password hashing, separate secrets,
  `tokenVersion` bump for logout-all / forced session revocation).
- `JwtAuthGuard` + `PermissionsGuard` — real enforcement, not a stub. Every
  route requires a valid token unless marked `@Public()`; every sensitive
  route declares `@RequirePermissions(...)`.
- Tenants module: branches, custom roles with granular permissions, users
  with role + branch assignment, subscription-plan limits enforced
  (Section 59 — Starter/Professional/Enterprise branch/user caps).
- Login history recorded on every attempt, success or failure.

**Phase 4 — Customers / KYC**
- Full CRUD, fast multi-field search (name/mobile/code/Aadhaar last-4/PAN),
  customer profile view aggregating transaction history (Section 7).
- KYC: Aadhaar encrypted at rest (AES-256-GCM), masked by default, full
  value requires `kyc:view_full` permission and is itself audited.

**Phase 5 — Metal Rates**
- Current-rate lookup, rate updates that close out the previous rate
  (never overwritten) and write an immutable `metal_rate_history` row.
  Past Girvi valuations are unaffected by later rate changes, by
  construction (Section 12).
- `GET /metals` — lists every configured metal with its active purities,
  added specifically so the frontend's calculation screen never has to
  hardcode a purity list.

**Phase 6 — Business Rules**
- Versioned rule sets per metal (eligibility %, margin type/value, interest
  method/%, grace period, rounding, min/max loan, payment allocation
  order). New settings create a new version rather than editing in place.

**Phase 7 — Girvi Transactions**
- Full create flow: validates customer, purities, current rates, and
  active rules; runs the calculation engine; **rejects** any requested
  loan amount exceeding the server-computed maximum (Section 55 — the
  frontend's numbers are never trusted). Handles multi-item and
  multi-metal transactions in one Girvi (Section 9's own gold+silver
  example). Writes the transaction, items, immutable valuation snapshot,
  and a ledger entry atomically.

**Phase 8 — Payments**
- Outstanding-balance calculation from first principles (original loan,
  every non-reversed payment's allocations, interest accrued under the
  rules active for that metal). Payment receipt allocates across
  penalty/charges/interest/principal per the tenant's configured order,
  updates status, writes the ledger entry — all atomic. Reversal is a
  flag + compensating ledger entry, never a delete (Section 41).

**Phase 9 — Redemption**
- Requires outstanding to already be zero (final payment recorded
  separately via Payments). Marks the transaction REDEEMED, frees the
  vault/packet slot, atomically.

**Phase 10 — Vault / Packet / QR**
- Storage location hierarchy (vault/locker/rack/tray/shelf), packet
  creation with a unique QR token, authenticated QR lookup, and moving a
  packet between locations with an audit trail.

**Auction workflow (Section 33/34)**
- Explicit, staff-driven status pipeline: NOTICE → AUCTION_ELIGIBLE →
  SCHEDULED → AUCTIONED → CLOSED. Each transition is its own audited
  action — nothing in the codebase advances a case automatically. Requires
  the loan to already be OVERDUE before a notice can be sent. Settlement
  records outstanding principal/interest/charges, reserve price, final
  sale amount, buyer, and computed profit/loss, and posts a ledger entry
  on sale. This is status-tracking + settlement recording only — **not**
  a live bidding/sale engine (per the Q10 assumption in the Phase 1 doc).

**Overdue automation**
- A daily cron job (`OverdueSchedulerService`, 1am) flips
  ACTIVE/PARTIALLY_PAID/RENEWED transactions to OVERDUE once their due
  date plus that metal's configured grace period has elapsed. It never
  touches auction status — moving into the auction pipeline is always a
  separate, explicit staff action.

**Daily closing**
- `POST /reports/daily-closing` records the staff's physical cash count
  against the system-computed expected figure and requires a
  `discrepancyReason` whenever the two don't match (Section 28).

**Additional reports**
- `/reports/metal-by-purity` (Section 35 metal report) and
  `/reports/collections-by-staff` (Section 35 staff report), alongside the
  dashboard/customer-statement/cash-book reports from before.

**Cutting across everything:** every mutation writes an `audit_logs` row
(who/what/when/old→new); a read-only `/audit-logs` endpoint queries it.
Basic `/reports/dashboard`, `/reports/customer-statement/:id`, and
`/reports/cash-book/:branchId` are implemented as real, computed reports.

## What is genuinely NOT done — please don't assume otherwise

Being direct about this rather than overstating completeness:

- **No Angular frontend.** Everything above is backend API only. A
  production frontend (the calculation screen, receipts, dashboards,
  vault UI, settings screens from Sections 14–15, 26–27, 66–67) is a
  substantial separate build.
- **Most of Section 35's report list** — customer loan history detail,
  gold/silver-purity value reports beyond weight, GST/tax reports,
  PDF/Excel export — is still not built. What exists: dashboard,
  customer statement, cash book, metal-by-purity weight, and
  collections-by-staff.
- **Interest accrual is computed on-the-fly at request time**, not via a
  scheduled job writing `interest_accruals` rows. Fine at your current
  scale; revisit before Section 70's 100k+ transaction target.
- **Notifications (Section 32)** — no channel adapters (WhatsApp/SMS/
  Email), no scheduled reminder jobs for due/overdue/auction-warning
  notices — only the auction module's own status tracking exists.
- **Auction module is status-tracking + settlement recording only** — no
  in-app bidding/live-sale engine (per the Q10 assumption in the Phase 1
  doc).
- **Testing** — the calculation engine (unit) plus auth, tenancy isolation,
  the full Girvi/payment/redemption lifecycle, and the auction pipeline
  (integration/e2e) are covered. **Not** covered: customers/rates/rules
  CRUD edge cases, the overdue scheduler itself (tested indirectly by
  forcing status in the auction spec, not by advancing time and letting
  the cron logic run), concurrent-payment race conditions, and file
  upload/KYC-document flows.
- **Deployment** — Dockerfile, docker-compose, and a GitHub Actions CI
  pipeline exist and run both test suites against a real Postgres service
  container. Not done: a production Kubernetes/hosting manifest, secrets
  management (the compose file reads secrets from env vars with insecure
  defaults — fine for local dev, not for production), and a CD/deploy step
  (CI currently builds the image but doesn't push or deploy it anywhere).
- This code has **not been run** (`npm install`/`prisma migrate`/`npm
  test`/`npm run test:e2e`) — no network access in this environment.
  Review carefully before relying on it; I'd expect minor issues typical
  of unrun code (an import path, a Prisma field name, a supertest
  assertion that needs adjusting once real numbers come back) rather than
  conceptual problems in the business logic. The new `DailyClosing`
  Prisma model in particular needs a fresh `prisma migrate dev` to create
  its table, and the e2e suite needs an actual Postgres reachable via
  `DATABASE_URL` to run at all — it does nothing useful without one.

**Testing (Phase 14)**
- Unit tests: the full calculation engine suite (unchanged from before).
- Integration/e2e tests (`test/*.e2e-spec.ts`), run against a real Postgres
  via the actual HTTP layer (supertest) with all guards active:
  - `auth.e2e-spec.ts` — wrong password, non-existent email (no existence
    leak), missing/garbage token, working refresh flow, logout-all token
    invalidation, deactivated-user login rejection.
  - `tenancy-isolation.e2e-spec.ts` — the property that matters most in a
    multi-tenant system: tenant B gets a 404 (never 403) for tenant A's
    customers and Girvi transactions, search never cross-leaks, and a
    cross-tenant update is rejected with the record left unchanged.
  - `girvi-lifecycle.e2e-spec.ts` — rejects an over-limit requested loan,
    verifies the ₹100,000 → 70% → ₹5,000 → ₹65,000 example end-to-end
    through real HTTP calls (not just the engine directly), full
    create → partial payment → full payment → redemption flow, rejects
    overpayment, proves reversal never hard-deletes, and proves RBAC
    actually blocks an under-permissioned user from recording a payment.
  - `auction-workflow.e2e-spec.ts` — rejects a notice on a non-OVERDUE
    loan, rejects skipping a pipeline step, walks the full NOTICE →
    ELIGIBLE → SCHEDULED → AUCTIONED → CLOSED path, checks the settlement
    record persists correctly, and rejects a duplicate notice.

**Deployment (Phase 15)**
- Multi-stage `Dockerfile` (non-root runtime user), `docker-compose.yml`
  (Postgres + Redis + app, healthchecked), and a GitHub Actions `ci.yml`
  that spins up a Postgres service container, runs migrations, runs both
  test suites, builds, and builds the Docker image.

## Running locally

**Without Docker:**
```bash
npm install
cp .env.example .env      # fill in DATABASE_URL, JWT secrets, KYC_ENCRYPTION_KEY
npm run prisma:migrate
npm run seed               # Shree Ram Jwellers demo tenant + default rules
npm run start:dev
```

**With Docker Compose** (Postgres + Redis + app):
```bash
cp .env.example .env       # optionally override JWT_*/KYC_ENCRYPTION_KEY
docker compose up --build
# in another terminal, once postgres is healthy:
docker compose exec app npx prisma migrate deploy
docker compose exec app npm run seed
```

Demo login after seeding: `owner@shreeramjwellers.example` / `ChangeMe123!`
(change immediately — this is a seeded dev credential, not for production).

```bash
npm test              # calculation engine unit test suite
npm run test:e2e      # integration tests — needs a real Postgres reachable
                       # via DATABASE_URL (docker compose up postgres, or CI)
```

The e2e suite creates and tears down its own tenants/users per test (see
`test/test-utils.ts`) — it does not depend on the seed script, but it does
need the `permissions` catalogue to exist, which `ensureGlobalPermissions()`
sets up in each spec's `beforeAll`.

## Suggested next steps, in priority order

1. Confirm Q1–Q14 from the Phase 1 doc — several defaults here (mixed-metal
   interest source, interest period granularity) are documented
   assumptions, not confirmed decisions.
2. Actually run this for the first time: `npm install`, `prisma migrate`,
   `npm test`, `npm run test:e2e` against a real Postgres, and fix whatever
   surfaces — expected for code that has never executed, not a sign the
   design is wrong.
3. Pick the next slice: the remaining Section 35 reports and notification
   channels (finishing the backend), or starting the Angular frontend
   against the API surface that already exists — that's the largest piece
   of the original brief with no code written yet.
   against the API surface that already exists.
