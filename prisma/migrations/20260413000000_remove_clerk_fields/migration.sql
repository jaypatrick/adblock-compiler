-- Migration: remove_clerk_fields
-- Purpose: Remove legacy Clerk integration fields from the PostgreSQL schema.
--          These columns were populated by the Clerk authentication provider
--          which has been replaced by Better Auth. All active sessions are
--          now Better Auth sessions; no Clerk sessions remain.

-- DropIndex: remove unique constraint on users.clerk_user_id
-- (column is now a legacy historical field, and uniqueness is no longer
--  required for retained rows that may share the same non-NULL Clerk ID)
DROP INDEX IF EXISTS "users_clerk_user_id_key";

-- DropColumn: sessions.token_hash (legacy Clerk session token hash)
-- Better Auth sessions use the `token` column only; token_hash is never set.
ALTER TABLE "sessions" DROP COLUMN IF EXISTS "token_hash";

-- CreateIndex: sessions.expires_at (enables efficient expired-session cleanup)
CREATE INDEX IF NOT EXISTS "sessions_expires_at_idx" ON "sessions"("expires_at");

-- DropIndex + DropColumn: agent_sessions.clerk_user_id
DROP INDEX IF EXISTS "agent_sessions_clerk_user_id_idx";
ALTER TABLE "agent_sessions" DROP COLUMN IF EXISTS "clerk_user_id";

-- CreateIndex: api_keys composite index for active-key lookups
-- "list active keys for user" queries filter by (user_id, revoked_at IS NULL)
CREATE INDEX IF NOT EXISTS "api_keys_user_id_revoked_at_idx" ON "api_keys"("user_id", "revoked_at");
