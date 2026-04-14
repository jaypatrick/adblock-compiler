-- Migration: multi_tenant_shared_schema
-- Purpose: Implement multi-tenant shared-schema architecture.
--          All organisations share the same tables, discriminated by organizationId + visibility enum.
--          Adds SubscriptionPlan, Configuration, FilterListAst, DataRetentionConsent tables.
--          Extends User, Organization, Member, FilterSource, and CompiledOutput models.
--
-- NOTE: The `organization` and `member` tables were defined in Prisma schema but never created
--       by a previous migration. This migration creates them with all required columns.
--       ALTER TABLE ... ADD COLUMN IF NOT EXISTS guards are included for idempotency in
--       environments where the tables may already exist (e.g. manual creation or future re-runs).
--
-- Run: deno task db:migrate

-- ============================================================================
-- 1. Create subscription_plans table
-- ============================================================================
CREATE TABLE IF NOT EXISTS "subscription_plans" (
    "id"                     UUID        NOT NULL DEFAULT gen_random_uuid(),
    "name"                   TEXT        NOT NULL,
    "display_name"           TEXT        NOT NULL,
    "is_org_only"            BOOLEAN     NOT NULL DEFAULT false,
    "max_api_keys_per_user"  INTEGER     NOT NULL DEFAULT 3,
    "rate_limit_per_minute"  INTEGER     NOT NULL DEFAULT 60,
    "rate_limit_per_day"     INTEGER     NOT NULL DEFAULT 1000,
    "max_filter_sources"     INTEGER     NOT NULL DEFAULT 10,
    "max_compiled_outputs"   INTEGER     NOT NULL DEFAULT 50,
    "max_org_members"        INTEGER,
    "ast_storage_enabled"    BOOLEAN     NOT NULL DEFAULT false,
    "translation_enabled"    BOOLEAN     NOT NULL DEFAULT false,
    "global_sharing_enabled" BOOLEAN     NOT NULL DEFAULT false,
    "batch_api_enabled"      BOOLEAN     NOT NULL DEFAULT false,
    "retention_days"         INTEGER     NOT NULL DEFAULT 90,
    "created_at"             TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"             TIMESTAMPTZ NOT NULL,

    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "subscription_plans_name_key" ON "subscription_plans"("name");

-- ============================================================================
-- 2. Create organization table (Better Auth org plugin — never previously migrated)
--    Includes all base columns AND the new multi-tenancy columns in one statement
--    so fresh databases get the full schema without requiring a separate ALTER pass.
-- ============================================================================
CREATE TABLE IF NOT EXISTS "organization" (
    "id"                           UUID        NOT NULL DEFAULT gen_random_uuid(),
    "name"                         TEXT        NOT NULL,
    "slug"                         TEXT        NOT NULL,
    "logo"                         TEXT,
    "metadata"                     JSONB,
    -- multi-tenancy columns (new in this migration)
    "tier"                         TEXT        NOT NULL DEFAULT 'free',
    "plan_id"                      UUID        REFERENCES "subscription_plans"("id") ON DELETE SET NULL,
    "retention_days"               INTEGER     NOT NULL DEFAULT 90,
    "retention_policy_accepted_at" TIMESTAMPTZ,
    "created_at"                   TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"                   TIMESTAMPTZ NOT NULL,

    CONSTRAINT "organization_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "organization_slug_key" ON "organization"("slug");

-- Idempotent guards for environments where the table existed without the new columns
ALTER TABLE "organization"
    ADD COLUMN IF NOT EXISTS "tier"                          TEXT        NOT NULL DEFAULT 'free',
    ADD COLUMN IF NOT EXISTS "plan_id"                       UUID        REFERENCES "subscription_plans"("id") ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS "retention_days"                INTEGER     NOT NULL DEFAULT 90,
    ADD COLUMN IF NOT EXISTS "retention_policy_accepted_at"  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS "organization_plan_id_idx" ON "organization"("plan_id");

-- ============================================================================
-- 3. Create member table (Better Auth org membership — never previously migrated)
--    Includes all base columns AND the new tier_override column.
-- ============================================================================
CREATE TABLE IF NOT EXISTS "member" (
    "id"              UUID        NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID        NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
    "user_id"         UUID        NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "role"            TEXT        NOT NULL,
    -- multi-tenancy column (new in this migration)
    "tier_override"   TEXT,
    "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"      TIMESTAMPTZ NOT NULL,

    CONSTRAINT "member_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "member_organization_id_user_id_key" ON "member"("organization_id", "user_id");
CREATE INDEX IF NOT EXISTS "member_user_id_idx"         ON "member"("user_id");
CREATE INDEX IF NOT EXISTS "member_organization_id_idx" ON "member"("organization_id");

-- Idempotent guard for environments where member table existed without tier_override
ALTER TABLE "member"
    ADD COLUMN IF NOT EXISTS "tier_override" TEXT;

-- ============================================================================
-- 4. Add plan_id to users
-- ============================================================================
ALTER TABLE "users"
    ADD COLUMN IF NOT EXISTS "plan_id" UUID REFERENCES "subscription_plans"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "users_plan_id_idx" ON "users"("plan_id");

-- ============================================================================
-- 5. Modify filter_sources:
--    a) Drop old global @unique on url
--    b) Add organization_id, visibility columns
--       (visibility='featured' is the single source of truth for featured/pinned sources)
--    c) Add composite unique (url, owner_user_id, organization_id)
--    d) Add partial unique index for global/system-managed rows (both FKs NULL)
--    e) Add FK constraint + index for owner_user_id
-- ============================================================================

-- Drop the old global unique constraint on url (name from Prisma init migration)
DROP INDEX IF EXISTS "filter_sources_url_key";

-- Add new columns (visibility added nullable first so we can backfill before setting NOT NULL)
ALTER TABLE "filter_sources"
    ADD COLUMN IF NOT EXISTS "organization_id" UUID REFERENCES "organization"("id") ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS "visibility"      TEXT;

-- Backfill visibility from the previous is_public boolean:
--   is_public = TRUE  → 'public'
--   is_public = FALSE → 'private'
-- This preserves the semantics of existing rows instead of blindly defaulting to 'private'.
UPDATE "filter_sources"
SET "visibility" = CASE WHEN "is_public" THEN 'public' ELSE 'private' END
WHERE "visibility" IS NULL;

-- Now enforce NOT NULL with default for future inserts, and add a CHECK to guard the closed set.
ALTER TABLE "filter_sources"
    ALTER COLUMN "visibility" SET NOT NULL,
    ALTER COLUMN "visibility" SET DEFAULT 'private';

-- Enforce that visibility is a member of the closed set (idempotent via DO block).
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'filter_sources_visibility_check'
          AND table_name = 'filter_sources'
    ) THEN
        ALTER TABLE "filter_sources"
            ADD CONSTRAINT "filter_sources_visibility_check"
            CHECK ("visibility" IN ('private', 'org', 'public', 'featured'));
    END IF;
END $$;

-- Composite unique: a URL must be unique per owner context.
-- Migration note: existing rows have owner_user_id either set or NULL and organization_id = NULL
-- (organization_id was not present before this migration). Because the new column defaults to NULL,
-- all pre-existing rows effectively map to (url, owner_user_id, NULL), which preserves the same
-- per-user uniqueness contract as the former global unique on url.
-- If your existing data has duplicate (url, owner_user_id) combinations (e.g. multiple rows with
-- the same url AND the same (or both null) owner_user_id) you must deduplicate those rows before
-- applying this constraint or the CREATE UNIQUE INDEX will fail.
CREATE UNIQUE INDEX IF NOT EXISTS "filter_sources_url_owner_unique"
    ON "filter_sources"("url", "owner_user_id", "organization_id");

-- Partial unique index: global/system-managed sources (both FK columns NULL) must be unique per URL.
-- The composite index above does NOT enforce this because PostgreSQL UNIQUE allows multiple NULL values.
CREATE UNIQUE INDEX IF NOT EXISTS "filter_sources_url_global_unique"
    ON "filter_sources"("url")
    WHERE "owner_user_id" IS NULL AND "organization_id" IS NULL;

-- FK constraint + index for owner_user_id (required for ON DELETE CASCADE to work at the DB level
-- and for efficient tenant-scoped queries on owner_user_id).
-- Uses CASCADE (not SET NULL) to avoid a conflict with the partial unique index
-- filter_sources_url_global_unique: nulling owner_user_id on delete would promote the row to
-- "global" scope, potentially violating UNIQUE(url) WHERE both FK columns are NULL.
-- Uses DO block for idempotency — ADD CONSTRAINT IF NOT EXISTS is not supported in PostgreSQL.
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'filter_sources_owner_user_id_fkey'
          AND table_name = 'filter_sources'
          AND constraint_type = 'FOREIGN KEY'
    ) THEN
        ALTER TABLE "filter_sources"
            ADD CONSTRAINT "filter_sources_owner_user_id_fkey"
            FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "filter_sources_owner_user_id_idx"    ON "filter_sources"("owner_user_id");
CREATE INDEX IF NOT EXISTS "filter_sources_organization_id_idx" ON "filter_sources"("organization_id");
CREATE INDEX IF NOT EXISTS "filter_sources_visibility_idx"       ON "filter_sources"("visibility");

-- ============================================================================
-- 6. Add organization_id and visibility to compiled_outputs
-- ============================================================================
ALTER TABLE "compiled_outputs"
    ADD COLUMN IF NOT EXISTS "organization_id" UUID REFERENCES "organization"("id") ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS "visibility"      TEXT NOT NULL DEFAULT 'private';

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'compiled_outputs_visibility_check'
          AND table_name = 'compiled_outputs'
    ) THEN
        ALTER TABLE "compiled_outputs"
            ADD CONSTRAINT "compiled_outputs_visibility_check"
            CHECK ("visibility" IN ('private', 'org', 'public', 'featured'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "compiled_outputs_organization_id_idx" ON "compiled_outputs"("organization_id");
CREATE INDEX IF NOT EXISTS "compiled_outputs_visibility_idx"       ON "compiled_outputs"("visibility");

-- ============================================================================
-- 7. Create configurations table
-- ============================================================================
CREATE TABLE IF NOT EXISTS "configurations" (
    "id"              UUID        NOT NULL DEFAULT gen_random_uuid(),
    "owner_user_id"   UUID        REFERENCES "users"("id") ON DELETE CASCADE,
    "organization_id" UUID        REFERENCES "organization"("id") ON DELETE CASCADE,
    "name"            TEXT        NOT NULL,
    "description"     TEXT,
    "config"          JSONB       NOT NULL,
    "visibility"      TEXT        NOT NULL DEFAULT 'private',
    "star_count"      INTEGER     NOT NULL DEFAULT 0,
    "fork_count"      INTEGER     NOT NULL DEFAULT 0,
    "forked_from_id"  UUID,
    "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"      TIMESTAMPTZ NOT NULL,

    CONSTRAINT "configurations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "configurations_forked_from_id_fkey"
        FOREIGN KEY ("forked_from_id") REFERENCES "configurations"("id") ON DELETE SET NULL,
    CONSTRAINT "configurations_visibility_check"
        CHECK ("visibility" IN ('private', 'org', 'public', 'featured'))
);

CREATE INDEX IF NOT EXISTS "configurations_owner_user_id_idx"   ON "configurations"("owner_user_id");
CREATE INDEX IF NOT EXISTS "configurations_organization_id_idx" ON "configurations"("organization_id");
CREATE INDEX IF NOT EXISTS "configurations_visibility_idx"       ON "configurations"("visibility");
CREATE INDEX IF NOT EXISTS "configurations_star_count_idx"       ON "configurations"("star_count" DESC);

-- ============================================================================
-- 8. Create filter_list_asts table
-- ============================================================================
CREATE TABLE IF NOT EXISTS "filter_list_asts" (
    "id"              UUID        NOT NULL DEFAULT gen_random_uuid(),
    "owner_user_id"   UUID        REFERENCES "users"("id")          ON DELETE CASCADE,
    "organization_id" UUID        REFERENCES "organization"("id")   ON DELETE CASCADE,
    "source_id"       UUID        REFERENCES "filter_sources"("id") ON DELETE SET NULL,
    "name"            TEXT        NOT NULL,
    "ast"             JSONB       NOT NULL,
    "rule_count"      INTEGER     NOT NULL,
    "parser_version"  TEXT        NOT NULL,
    "visibility"      TEXT        NOT NULL DEFAULT 'private',
    "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"      TIMESTAMPTZ NOT NULL,

    CONSTRAINT "filter_list_asts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "filter_list_asts_visibility_check"
        CHECK ("visibility" IN ('private', 'org', 'public', 'featured'))
);

CREATE INDEX IF NOT EXISTS "filter_list_asts_owner_user_id_idx"   ON "filter_list_asts"("owner_user_id");
CREATE INDEX IF NOT EXISTS "filter_list_asts_organization_id_idx" ON "filter_list_asts"("organization_id");
CREATE INDEX IF NOT EXISTS "filter_list_asts_source_id_idx"       ON "filter_list_asts"("source_id");
CREATE INDEX IF NOT EXISTS "filter_list_asts_visibility_idx"       ON "filter_list_asts"("visibility");

-- ============================================================================
-- 9. Create data_retention_consents table (append-only audit log)
-- ============================================================================
-- user_id and organization_id are plain UUID columns with NO FK constraints.
-- This is intentional: consent rows must survive hard-deletes of the referenced
-- user/org to preserve the compliance audit trail. The XOR CHECK constraint still
-- enforces that exactly one of the two columns is set per row.
-- An idempotent block below drops any pre-existing RESTRICT FKs if they were
-- created by an earlier version of this migration.
CREATE TABLE IF NOT EXISTS "data_retention_consents" (
    "id"              UUID        NOT NULL DEFAULT gen_random_uuid(),
    "user_id"         UUID,
    "organization_id" UUID,
    "policy_version"  TEXT        NOT NULL,
    "retention_days"  INTEGER     NOT NULL,
    "data_categories" TEXT[]      NOT NULL,
    "accepted_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
    "ip_address"      TEXT,
    "user_agent"      TEXT,

    CONSTRAINT "data_retention_consents_pkey" PRIMARY KEY ("id"),
    -- Exactly one of user_id / organization_id must be set per row.
    -- XOR: one is NOT NULL and the other IS NULL.
    CONSTRAINT "data_retention_consents_owner_xor_check"
        CHECK ((user_id IS NOT NULL) <> (organization_id IS NOT NULL))
);

-- Drop pre-existing RESTRICT FKs if they were created by an earlier run of this migration.
-- These FKs conflict with hard-deletes of users/orgs (see note above).
DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'data_retention_consents_user_id_fkey'
          AND table_name = 'data_retention_consents'
          AND constraint_type = 'FOREIGN KEY'
    ) THEN
        ALTER TABLE "data_retention_consents" DROP CONSTRAINT "data_retention_consents_user_id_fkey";
    END IF;
END $$;

DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'data_retention_consents_organization_id_fkey'
          AND table_name = 'data_retention_consents'
          AND constraint_type = 'FOREIGN KEY'
    ) THEN
        ALTER TABLE "data_retention_consents" DROP CONSTRAINT "data_retention_consents_organization_id_fkey";
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "data_retention_consents_user_id_idx"         ON "data_retention_consents"("user_id");
CREATE INDEX IF NOT EXISTS "data_retention_consents_organization_id_idx" ON "data_retention_consents"("organization_id");
CREATE INDEX IF NOT EXISTS "data_retention_consents_accepted_at_idx"     ON "data_retention_consents"("accepted_at" DESC);

-- ============================================================================
-- 10. Seed subscription_plans with the four base plans
-- ============================================================================
INSERT INTO "subscription_plans" (
    "id", "name", "display_name", "is_org_only",
    "max_api_keys_per_user", "rate_limit_per_minute", "rate_limit_per_day",
    "max_filter_sources", "max_compiled_outputs", "max_org_members",
    "ast_storage_enabled", "translation_enabled", "global_sharing_enabled",
    "batch_api_enabled", "retention_days",
    "created_at", "updated_at"
) VALUES
-- free plan: conservative defaults
(
    gen_random_uuid(), 'free', 'Free', false,
    3, 60, 1000,
    10, 50, NULL,
    false, false, false,
    false, 90,
    now(), now()
),
-- pro plan: individual power users
(
    gen_random_uuid(), 'pro', 'Pro', false,
    10, 300, 10000,
    100, 500, NULL,
    true, true, true,
    false, 180,
    now(), now()
),
-- vendor plan: org-only, high-volume list makers
(
    gen_random_uuid(), 'vendor', 'Vendor', true,
    25, 1000, 100000,
    -1, -1, NULL,
    true, true, true,
    true, 365,
    now(), now()
),
-- enterprise plan: org-only, maximum retention, same features as vendor
(
    gen_random_uuid(), 'enterprise', 'Enterprise', true,
    25, 1000, 100000,
    -1, -1, NULL,
    true, true, true,
    true, 730,
    now(), now()
)
ON CONFLICT ("name") DO NOTHING;
