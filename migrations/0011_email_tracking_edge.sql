-- D1 Migration: email_tracking_edge
-- Purpose: Add lightweight email tracking tables for edge-local idempotency
--          checks and delivery status lookups.
--
-- Applied via: wrangler d1 migrations apply adblock-compiler-d1-database
--
-- These tables complement the full audit trail in Neon (email_log,
-- email_templates). They provide fast D1 edge-local lookups so the Worker
-- does not need a Neon round-trip to check idempotency.

-- ============================================================================
-- 1. Create email_log_edge table
-- ============================================================================

CREATE TABLE IF NOT EXISTS "email_log_edge" (
    "id"               TEXT    NOT NULL,
    "idempotency_key"  TEXT    NOT NULL,
    "provider"         TEXT    NOT NULL,
    "to_address"       TEXT    NOT NULL,
    "subject"          TEXT    NOT NULL,
    "status"           TEXT    NOT NULL DEFAULT 'sent',
    "reason"           TEXT,
    "error"            TEXT,
    "created_at"       INTEGER NOT NULL, -- Unix epoch seconds

    PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "email_log_edge_idempotency_key_idx"
    ON "email_log_edge"("idempotency_key");

CREATE INDEX IF NOT EXISTS "email_log_edge_to_address_idx"
    ON "email_log_edge"("to_address");

CREATE INDEX IF NOT EXISTS "email_log_edge_status_idx"
    ON "email_log_edge"("status");

CREATE INDEX IF NOT EXISTS "email_log_edge_created_at_idx"
    ON "email_log_edge"("created_at");

-- ============================================================================
-- 2. Create email_idempotency_keys table
-- ============================================================================

CREATE TABLE IF NOT EXISTS "email_idempotency_keys" (
    "key"          TEXT    NOT NULL,
    "workflow_id"  TEXT    NOT NULL,
    "processed_at" INTEGER NOT NULL, -- Unix epoch seconds
    "expires_at"   INTEGER NOT NULL, -- Unix epoch seconds (7-day TTL)

    PRIMARY KEY ("key")
);

CREATE INDEX IF NOT EXISTS "email_idempotency_keys_expires_at_idx"
    ON "email_idempotency_keys"("expires_at");
