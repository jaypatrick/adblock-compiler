-- Migration: billing_foundation
-- Purpose: Add Pay-As-You-Go billing infrastructure.
--          Adds PaygCustomer, PaygPaymentEvent, PaygSession tables.
--          Extends User and Organization with Stripe customer/subscription ID fields.
--
-- Run: deno task db:migrate

-- ============================================================================
-- 1. Add stripe_customer_id to users table
-- ============================================================================
ALTER TABLE "users"
    ADD COLUMN IF NOT EXISTS "stripe_customer_id" TEXT UNIQUE;

-- ============================================================================
-- 2. Add Stripe fields to organization table
-- ============================================================================
ALTER TABLE "organization"
    ADD COLUMN IF NOT EXISTS "stripe_customer_id" TEXT UNIQUE,
    ADD COLUMN IF NOT EXISTS "stripe_subscription_id" TEXT UNIQUE,
    ADD COLUMN IF NOT EXISTS "stripe_subscription_status" TEXT;

-- ============================================================================
-- 3. Create payg_customers table
-- ============================================================================
CREATE TABLE IF NOT EXISTS "payg_customers" (
    "id"                    UUID        NOT NULL DEFAULT gen_random_uuid(),
    "stripe_customer_id"    TEXT        NOT NULL,
    "total_spend_usd_cents" INTEGER     NOT NULL DEFAULT 0,
    "total_requests"        INTEGER     NOT NULL DEFAULT 0,
    "first_seen_at"         TIMESTAMPTZ NOT NULL DEFAULT now(),
    "last_seen_at"          TIMESTAMPTZ NOT NULL,
    "converted_at"          TIMESTAMPTZ,
    "converted_user_id"     UUID,

    CONSTRAINT "payg_customers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "payg_customers_stripe_customer_id_key" ON "payg_customers"("stripe_customer_id");
CREATE INDEX IF NOT EXISTS "payg_customers_total_spend_usd_cents_idx" ON "payg_customers"("total_spend_usd_cents" DESC);

-- ============================================================================
-- 4. Create payg_payment_events table (append-only audit log)
-- ============================================================================
CREATE TABLE IF NOT EXISTS "payg_payment_events" (
    "id"                        UUID        NOT NULL DEFAULT gen_random_uuid(),
    "payg_customer_id"          UUID        NOT NULL,
    "stripe_payment_intent_id"  TEXT        NOT NULL,
    "amount_usd_cents"          INTEGER     NOT NULL,
    "endpoint"                  TEXT        NOT NULL,
    "request_id"                TEXT,
    "worker_region"             TEXT,
    "created_at"                TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "payg_payment_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payg_payment_events_payg_customer_id_fkey"
        FOREIGN KEY ("payg_customer_id") REFERENCES "payg_customers"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "payg_payment_events_stripe_payment_intent_id_key" ON "payg_payment_events"("stripe_payment_intent_id");
CREATE INDEX IF NOT EXISTS "payg_payment_events_payg_customer_id_idx" ON "payg_payment_events"("payg_customer_id");
CREATE INDEX IF NOT EXISTS "payg_payment_events_created_at_idx" ON "payg_payment_events"("created_at" DESC);

-- ============================================================================
-- 5. Create payg_sessions table (x402-style session tokens)
-- ============================================================================
CREATE TABLE IF NOT EXISTS "payg_sessions" (
    "id"               UUID        NOT NULL DEFAULT gen_random_uuid(),
    "payg_customer_id" UUID        NOT NULL,
    "session_token"    TEXT        NOT NULL,
    "requests_granted" INTEGER     NOT NULL,
    "requests_used"    INTEGER     NOT NULL DEFAULT 0,
    "expires_at"       TIMESTAMPTZ NOT NULL,
    "created_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
    "revoked_at"       TIMESTAMPTZ,

    CONSTRAINT "payg_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payg_sessions_payg_customer_id_fkey"
        FOREIGN KEY ("payg_customer_id") REFERENCES "payg_customers"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "payg_sessions_session_token_key" ON "payg_sessions"("session_token");
CREATE INDEX IF NOT EXISTS "payg_sessions_payg_customer_id_idx" ON "payg_sessions"("payg_customer_id");
CREATE INDEX IF NOT EXISTS "payg_sessions_expires_at_idx" ON "payg_sessions"("expires_at");
