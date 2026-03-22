-- Migration: add_better_auth_tables
-- Description: Add Better Auth tables (Account, Verification) and update
--              the sessions table for Better Auth compatibility.
--
-- Changes:
--   1. CREATE TABLE "account"       – OAuth / credential accounts (Better Auth)
--   2. CREATE TABLE "verification"  – Email-verification tokens  (Better Auth)
--   3. ALTER TABLE  "sessions"      – Add "token" column, make "token_hash"
--                                     nullable, add "updated_at" column

-- ---------------------------------------------------------------------------
-- 1. Create "account" table
-- ---------------------------------------------------------------------------

CREATE TABLE "account" (
    "id"                        UUID         NOT NULL DEFAULT gen_random_uuid(),
    "user_id"                   UUID         NOT NULL,
    "account_id"                TEXT         NOT NULL,
    "provider_id"               TEXT         NOT NULL,
    "access_token"              TEXT,
    "refresh_token"             TEXT,
    "access_token_expires_at"   TIMESTAMPTZ,
    "refresh_token_expires_at"  TIMESTAMPTZ,
    "scope"                     TEXT,
    "id_token"                  TEXT,
    "password"                  TEXT,
    "created_at"                TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"                TIMESTAMPTZ  NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- Foreign key → users
ALTER TABLE "account"
    ADD CONSTRAINT "account_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 2. Create "verification" table
-- ---------------------------------------------------------------------------

CREATE TABLE "verification" (
    "id"          UUID         NOT NULL DEFAULT gen_random_uuid(),
    "identifier"  TEXT         NOT NULL,
    "value"       TEXT         NOT NULL,
    "expires_at"  TIMESTAMPTZ  NOT NULL,
    "created_at"  TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMPTZ  NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- 3. Alter "sessions" table for Better Auth
-- ---------------------------------------------------------------------------

-- 3a. Add "token" column.
--     Existing rows (Clerk-era sessions) get a generated placeholder so the
--     NOT NULL constraint can be applied immediately.
ALTER TABLE "sessions"
    ADD COLUMN "token" TEXT;

UPDATE "sessions"
    SET "token" = 'legacy_' || "id"::TEXT
    WHERE "token" IS NULL;

ALTER TABLE "sessions"
    ALTER COLUMN "token" SET NOT NULL;

-- Unique index on token (Prisma naming convention: {table}_{column}_key)
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- 3b. Make "token_hash" nullable (was NOT NULL for Clerk; optional for Better Auth).
ALTER TABLE "sessions"
    ALTER COLUMN "token_hash" DROP NOT NULL;

-- 3c. Add "updated_at" column.
ALTER TABLE "sessions"
    ADD COLUMN "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
