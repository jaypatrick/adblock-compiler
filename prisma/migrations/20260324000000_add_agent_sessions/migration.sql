-- Migration: add_agent_sessions
-- Mirrors D1 migration 0008_agent_sessions.sql for Neon PostgreSQL
--
-- Purpose: Track active and historical agent sessions for audit, billing,
--          and admin visibility.

-- CreateTable
CREATE TABLE "agent_sessions" (
    "id"            UUID        NOT NULL DEFAULT gen_random_uuid(),
    "agent_slug"    TEXT        NOT NULL,
    "instance_id"   TEXT        NOT NULL,
    "user_id"       UUID,
    "clerk_user_id" TEXT,
    "started_at"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at"      TIMESTAMPTZ,
    "end_reason"    TEXT,
    "message_count" INTEGER     NOT NULL DEFAULT 0,
    "transport"     TEXT        NOT NULL DEFAULT 'websocket',
    "client_ip"     TEXT,
    "user_agent"    TEXT,
    "metadata"      JSONB,

    CONSTRAINT "agent_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_sessions_user_id_idx"       ON "agent_sessions"("user_id");
CREATE INDEX "agent_sessions_clerk_user_id_idx" ON "agent_sessions"("clerk_user_id");
CREATE INDEX "agent_sessions_agent_slug_idx"    ON "agent_sessions"("agent_slug");
CREATE INDEX "agent_sessions_started_at_idx"    ON "agent_sessions"("started_at");
-- Composite index for "active sessions per user" query pattern
CREATE INDEX "agent_sessions_user_active_idx"   ON "agent_sessions"("user_id", "ended_at");

-- AddForeignKey
ALTER TABLE "agent_sessions"
    ADD CONSTRAINT "agent_sessions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
