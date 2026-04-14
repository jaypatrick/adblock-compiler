-- =============================================================================
-- Migration: 0009_remove_clerk_fields.sql
-- Purpose: Drop legacy Clerk-specific columns from users and agent_sessions.
--          Better Auth is the sole auth provider; these columns are no longer
--          written to and are safe to remove.
-- =============================================================================

PRAGMA foreign_keys = OFF;

-- Drop the clerk_user_id unique index and column from users.
-- SQLite requires a table-recreation to drop a column (no DROP COLUMN in older SQLite).
-- Use a uniquely prefixed temp table (no IF NOT EXISTS) so a partial run fails loudly.
CREATE TABLE _users_new (
    id            TEXT    PRIMARY KEY,
    email         TEXT    UNIQUE,
    display_name  TEXT,
    role          TEXT    NOT NULL DEFAULT 'user',
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    tier          TEXT    NOT NULL DEFAULT 'free',
    first_name    TEXT,
    last_name     TEXT,
    image_url     TEXT,
    email_verified INTEGER NOT NULL DEFAULT 0,
    last_sign_in_at TEXT
);

INSERT INTO _users_new
    SELECT id, email, display_name, role, created_at, updated_at,
           tier, first_name, last_name, image_url, email_verified, last_sign_in_at
    FROM users;

DROP TABLE users;
ALTER TABLE _users_new RENAME TO users;

-- Recreate indexes that existed before (excluding the clerk_user_id index).
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_tier  ON users(tier);

-- Drop the clerk_user_id column and its index from agent_sessions.
-- Use a uniquely prefixed temp table (no IF NOT EXISTS) so a partial run fails loudly.
CREATE TABLE _agent_sessions_new (
    id              TEXT    PRIMARY KEY,
    agent_slug      TEXT    NOT NULL,
    instance_id     TEXT    NOT NULL,
    user_id         TEXT,
    started_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    ended_at        TEXT,
    end_reason      TEXT,
    message_count   INTEGER NOT NULL DEFAULT 0,
    transport       TEXT    NOT NULL DEFAULT 'websocket',
    client_ip       TEXT,
    user_agent      TEXT,
    metadata        TEXT
);

INSERT INTO _agent_sessions_new
    SELECT id, agent_slug, instance_id, user_id, started_at, ended_at,
           end_reason, message_count, transport, client_ip, user_agent, metadata
    FROM agent_sessions;

DROP TABLE agent_sessions;
ALTER TABLE _agent_sessions_new RENAME TO agent_sessions;

-- Recreate indexes (excluding the clerk_user_id index).
CREATE INDEX IF NOT EXISTS idx_agent_sessions_user_id      ON agent_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_agent_slug   ON agent_sessions(agent_slug);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_started_at   ON agent_sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_ended_at     ON agent_sessions(ended_at);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_user_active  ON agent_sessions(user_id, ended_at);

PRAGMA foreign_keys = ON;
