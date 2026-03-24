-- Migration: add_agent_invocations_and_audit_logs
-- Depends on: 20260324000000_add_agent_sessions (which creates the agent_sessions table)
--
-- Purpose: Add agent_invocations (per-tool-call tracking) and agent_audit_logs
--          (append-only security event log) that reference the agent_sessions table.

-- CreateTable: agent_invocations -- tracks individual tool calls within a session
CREATE TABLE "agent_invocations" (
    "id"             UUID        NOT NULL DEFAULT gen_random_uuid(),
    "session_id"     UUID        NOT NULL,
    "tool_name"      TEXT        NOT NULL,
    "input_summary"  TEXT,
    "output_summary" TEXT,
    "duration_ms"    INTEGER,
    "success"        BOOLEAN     NOT NULL DEFAULT true,
    "error_message"  TEXT,
    "invoked_at"     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata"       JSONB,

    CONSTRAINT "agent_invocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable: agent_audit_logs -- append-only audit log for agent security events
CREATE TABLE "agent_audit_logs" (
    "id"            UUID        NOT NULL DEFAULT gen_random_uuid(),
    "actor_user_id" UUID,
    "agent_slug"    TEXT,
    "instance_id"   TEXT,
    "action"        TEXT        NOT NULL,
    "status"        TEXT        NOT NULL DEFAULT 'success',
    "ip_address"    TEXT,
    "user_agent"    TEXT,
    "reason"        TEXT,
    "metadata"      JSONB,
    "created_at"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: agent_invocations
CREATE INDEX "agent_invocations_session_id_idx"  ON "agent_invocations"("session_id");
CREATE INDEX "agent_invocations_tool_name_idx"   ON "agent_invocations"("tool_name");
CREATE INDEX "agent_invocations_invoked_at_idx"  ON "agent_invocations"("invoked_at");

-- CreateIndex: agent_audit_logs
CREATE INDEX "agent_audit_logs_actor_user_id_idx" ON "agent_audit_logs"("actor_user_id");
CREATE INDEX "agent_audit_logs_agent_slug_idx"    ON "agent_audit_logs"("agent_slug");
CREATE INDEX "agent_audit_logs_action_idx"        ON "agent_audit_logs"("action");
CREATE INDEX "agent_audit_logs_created_at_idx"    ON "agent_audit_logs"("created_at");

-- AddForeignKey: agent_invocations --> agent_sessions (cascade delete)
ALTER TABLE "agent_invocations"
    ADD CONSTRAINT "agent_invocations_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "agent_sessions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
