-- =============================================================================
-- Migration: 0008_agent_sessions.sql
-- Purpose: Track active and historical agent sessions for audit, billing,
--          and admin visibility.
--
-- Mirrors: prisma/migrations/20260324000000_add_agent_sessions/migration.sql
--          (Neon PostgreSQL equivalent)
-- =============================================================================

CREATE TABLE IF NOT EXISTS agent_sessions (
    id              TEXT    PRIMARY KEY,                          -- UUID v4
    agent_slug      TEXT    NOT NULL,                            -- from AGENT_REGISTRY slug
    instance_id     TEXT    NOT NULL,                            -- DO instance name
    user_id         TEXT,                                        -- FK to users.id (nullable for future API key auth)
    clerk_user_id   TEXT,                                        -- Clerk user ID for fast lookup
    started_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    ended_at        TEXT,                                        -- NULL = still active
    end_reason      TEXT,                                        -- 'client_disconnect' | 'server_error' | 'admin_terminate' | 'timeout'
    message_count   INTEGER NOT NULL DEFAULT 0,                  -- incremented on each WS message
    transport       TEXT    NOT NULL DEFAULT 'websocket',        -- 'websocket' | 'sse'
    client_ip       TEXT,
    user_agent      TEXT,
    metadata        TEXT                                         -- JSON blob for future extensibility
);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_user_id        ON agent_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_clerk_user_id  ON agent_sessions(clerk_user_id);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_agent_slug     ON agent_sessions(agent_slug);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_started_at     ON agent_sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_ended_at       ON agent_sessions(ended_at);
-- Composite index for "active sessions per user" query pattern
CREATE INDEX IF NOT EXISTS idx_agent_sessions_user_active    ON agent_sessions(user_id, ended_at);
