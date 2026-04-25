-- Migration: email_tracking
-- Purpose: Add email system tables for templates, delivery audit log, and
--          per-user notification preferences.
--
-- Run: deno task db:migrate

-- ============================================================================
-- 1. Create email_templates table
-- ============================================================================

CREATE TABLE IF NOT EXISTS "email_templates" (
    "id"               UUID        NOT NULL DEFAULT gen_random_uuid(),
    "name"             TEXT        NOT NULL,
    "display_name"     TEXT        NOT NULL,
    "subject_template" TEXT        NOT NULL,
    "html_template"    TEXT        NOT NULL,
    "text_template"    TEXT        NOT NULL,
    "variables"        JSONB,
    "is_active"        BOOLEAN     NOT NULL DEFAULT TRUE,
    "created_by"       TEXT,
    "created_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "email_templates_name_key"
    ON "email_templates"("name");

CREATE INDEX IF NOT EXISTS "email_templates_name_idx"
    ON "email_templates"("name");

CREATE INDEX IF NOT EXISTS "email_templates_is_active_idx"
    ON "email_templates"("is_active");

-- ============================================================================
-- 2. Create email_log table (append-only audit log — never delete rows)
-- ============================================================================

CREATE TABLE IF NOT EXISTS "email_log" (
    "id"               UUID        NOT NULL DEFAULT gen_random_uuid(),
    "idempotency_key"  TEXT        NOT NULL,
    "provider"         TEXT        NOT NULL,
    "to_address"       TEXT        NOT NULL,
    "subject"          TEXT        NOT NULL,
    "status"           TEXT        NOT NULL DEFAULT 'sent',
    "reason"           TEXT,
    "error"            TEXT,
    "user_id"          UUID,
    "created_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
    "completed_at"     TIMESTAMPTZ,
    "duration_ms"      INTEGER,

    CONSTRAINT "email_log_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "email_log_idempotency_key_key"
    ON "email_log"("idempotency_key");

CREATE INDEX IF NOT EXISTS "email_log_idempotency_key_idx"
    ON "email_log"("idempotency_key");

CREATE INDEX IF NOT EXISTS "email_log_to_address_idx"
    ON "email_log"("to_address");

CREATE INDEX IF NOT EXISTS "email_log_status_idx"
    ON "email_log"("status");

CREATE INDEX IF NOT EXISTS "email_log_reason_idx"
    ON "email_log"("reason");

CREATE INDEX IF NOT EXISTS "email_log_user_id_idx"
    ON "email_log"("user_id");

CREATE INDEX IF NOT EXISTS "email_log_created_at_idx"
    ON "email_log"("created_at" DESC);

-- ============================================================================
-- 3. Create email_notification_preferences table
-- ============================================================================

CREATE TABLE IF NOT EXISTS "email_notification_preferences" (
    "id"                UUID        NOT NULL DEFAULT gen_random_uuid(),
    "user_id"           UUID        NOT NULL,
    "notification_type" TEXT        NOT NULL,
    "enabled"           BOOLEAN     NOT NULL DEFAULT TRUE,
    "created_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "email_notification_preferences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "email_notification_preference_unique"
    ON "email_notification_preferences"("user_id", "notification_type");

CREATE INDEX IF NOT EXISTS "email_notification_preferences_user_id_idx"
    ON "email_notification_preferences"("user_id");

CREATE INDEX IF NOT EXISTS "email_notification_preferences_notification_type_idx"
    ON "email_notification_preferences"("notification_type");
