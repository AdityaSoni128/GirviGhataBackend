-- Step 1: add as nullable first — existing rows get NULL, nothing is destroyed.
ALTER TABLE "girvi_valuation_snapshots" ADD COLUMN "interestPercent" DECIMAL(6,3);

-- Step 2: backfill every existing row from the BusinessRuleSet version
-- that was ALREADY recorded on that snapshot at creation time (ruleSetId).
-- This is not "today's active rule" — it's the exact historical rule
-- version each transaction actually used, per the "populate sensibly
-- from the existing stored rule/snapshot" requirement.
UPDATE "girvi_valuation_snapshots" AS gvs
SET "interestPercent" = brs."interestPercent"
FROM "business_rule_sets" AS brs
WHERE brs.id = gvs."ruleSetId"
  AND gvs."interestPercent" IS NULL;

-- Step 3: safety check — if any row STILL has NULL (its ruleSetId no
-- longer resolves to a business_rule_sets row, which should not happen
-- since that table is append-only/never deleted), do NOT guess a
-- fallback value silently. Surface it instead:
DO $$
DECLARE
  unresolved_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO unresolved_count
  FROM "girvi_valuation_snapshots"
  WHERE "interestPercent" IS NULL;

  IF unresolved_count > 0 THEN
    RAISE EXCEPTION
      'Migration halted: % girvi_valuation_snapshots row(s) could not be backfilled '
      '(their ruleSetId does not resolve to any business_rule_sets row). '
      'Resolve these manually before re-running this migration.', unresolved_count;
  END IF;
END $$;

-- Step 4: only now enforce NOT NULL, matching the convention of every
-- other Decimal field on this model.
ALTER TABLE "girvi_valuation_snapshots" ALTER COLUMN "interestPercent" SET NOT NULL;