-- Migration: multi_tenant_shared_schema
-- Purpose: Implement multi-tenant shared-schema architecture.
--          All organisations share the same tables, discriminated by organizationId + visibility enum.
--          Adds SubscriptionPlan, Configuration, FilterListAst, DataRetentionConsent tables.
--          Extends User, Organization, Member, FilterSource, and CompiledOutput models.
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
-- 2. Add plan_id to users
-- ============================================================================
ALTER TABLE "users"
    ADD COLUMN IF NOT EXISTS "plan_id" UUID REFERENCES "subscription_plans"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "users_plan_id_idx" ON "users"("plan_id");

-- ============================================================================
-- 3. Add new columns to organization
-- ============================================================================
ALTER TABLE "organization"
    ADD COLUMN IF NOT EXISTS "tier"                          TEXT        NOT NULL DEFAULT 'free',
    ADD COLUMN IF NOT EXISTS "plan_id"                       UUID        REFERENCES "subscription_plans"("id") ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS "retention_days"                INTEGER     NOT NULL DEFAULT 90,
    ADD COLUMN IF NOT EXISTS "retention_policy_accepted_at"  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS "organization_plan_id_idx" ON "organization"("plan_id");

-- ============================================================================
-- 4. Add tier_override to member
-- ============================================================================
ALTER TABLE "member"
    ADD COLUMN IF NOT EXISTS "tier_override" TEXT;

-- ============================================================================
-- 5. Modify filter_sources:
--    a) Drop old global @unique on url
--    b) Add organization_id, visibility, is_featured columns
--    c) Add composite unique (url, owner_user_id, organization_id)
-- ============================================================================

-- Drop the old global unique constraint on url (name from Prisma migration)
DROP INDEX IF EXISTS "filter_sources_url_key";

-- Add new columns
ALTER TABLE "filter_sources"
    ADD COLUMN IF NOT EXISTS "organization_id" UUID        REFERENCES "organization"("id") ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS "visibility"      TEXT        NOT NULL DEFAULT 'private',
    ADD COLUMN IF NOT EXISTS "is_featured"     BOOLEAN     NOT NULL DEFAULT false;

-- Composite unique: a URL must be unique per owner context
CREATE UNIQUE INDEX IF NOT EXISTS "filter_sources_url_owner_unique"
    ON "filter_sources"("url", "owner_user_id", "organization_id");

CREATE INDEX IF NOT EXISTS "filter_sources_organization_id_idx" ON "filter_sources"("organization_id");
CREATE INDEX IF NOT EXISTS "filter_sources_visibility_idx"       ON "filter_sources"("visibility");

-- ============================================================================
-- 6. Add organization_id and visibility to compiled_outputs
-- ============================================================================
ALTER TABLE "compiled_outputs"
    ADD COLUMN IF NOT EXISTS "organization_id" UUID REFERENCES "organization"("id") ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS "visibility"      TEXT NOT NULL DEFAULT 'private';

CREATE INDEX IF NOT EXISTS "compiled_outputs_organization_id_idx" ON "compiled_outputs"("organization_id");
CREATE INDEX IF NOT EXISTS "compiled_outputs_visibility_idx"       ON "compiled_outputs"("visibility");

-- ============================================================================
-- 7. Create configurations table
-- ============================================================================
CREATE TABLE IF NOT EXISTS "configurations" (
    "id"              UUID        NOT NULL DEFAULT gen_random_uuid(),
    "owner_user_id"   UUID,
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
    CONSTRAINT "configurations_owner_user_id_fkey"
        FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE,
    CONSTRAINT "configurations_forked_from_id_fkey"
        FOREIGN KEY ("forked_from_id") REFERENCES "configurations"("id") ON DELETE SET NULL
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
    "owner_user_id"   UUID        REFERENCES "users"("id")         ON DELETE CASCADE,
    "organization_id" UUID        REFERENCES "organization"("id")  ON DELETE CASCADE,
    "source_id"       UUID        REFERENCES "filter_sources"("id") ON DELETE SET NULL,
    "name"            TEXT        NOT NULL,
    "ast"             JSONB       NOT NULL,
    "rule_count"      INTEGER     NOT NULL,
    "parser_version"  TEXT        NOT NULL,
    "visibility"      TEXT        NOT NULL DEFAULT 'private',
    "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"      TIMESTAMPTZ NOT NULL,

    CONSTRAINT "filter_list_asts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "filter_list_asts_owner_user_id_idx"   ON "filter_list_asts"("owner_user_id");
CREATE INDEX IF NOT EXISTS "filter_list_asts_organization_id_idx" ON "filter_list_asts"("organization_id");
CREATE INDEX IF NOT EXISTS "filter_list_asts_source_id_idx"       ON "filter_list_asts"("source_id");
CREATE INDEX IF NOT EXISTS "filter_list_asts_visibility_idx"       ON "filter_list_asts"("visibility");

-- ============================================================================
-- 9. Create data_retention_consents table (append-only audit log)
-- ============================================================================
CREATE TABLE IF NOT EXISTS "data_retention_consents" (
    "id"              UUID        NOT NULL DEFAULT gen_random_uuid(),
    "user_id"         UUID        REFERENCES "users"("id")        ON DELETE SET NULL,
    "organization_id" UUID        REFERENCES "organization"("id") ON DELETE SET NULL,
    "policy_version"  TEXT        NOT NULL,
    "retention_days"  INTEGER     NOT NULL,
    "data_categories" TEXT[]      NOT NULL,
    "accepted_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
    "ip_address"      TEXT,
    "user_agent"      TEXT,

    CONSTRAINT "data_retention_consents_pkey" PRIMARY KEY ("id")
);

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
