-- Migration: 0005_local_auth_users.sql
--
-- Creates the local_auth_users table used by LocalJwtAuthProvider.
-- This is a temporary bridge until Clerk is production-ready.
--
-- MIGRATION PATH: When Clerk goes live:
--   1. Set CLERK_JWKS_URL in wrangler.toml [vars] (or .dev.vars locally).
--   2. The provider auto-switches — no code changes required.
--   3. Optionally drop this table once all users are migrated to Clerk.
--
-- Password hashing: PBKDF2 via Web Crypto API (SubtleCrypto).
--   Format: "<base64url-salt>:<base64url-derived-bits>"
--   Parameters: 100,000 iterations, SHA-256, 16-byte salt, 256-bit output.
--   Rationale: Argon2id is unavailable in the Cloudflare Workers runtime.

CREATE TABLE IF NOT EXISTS local_auth_users (
    id            TEXT PRIMARY KEY,                             -- UUID v4 (crypto.randomUUID())
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,                               -- "<base64url-salt>:<base64url-hash>"
    tier          TEXT NOT NULL DEFAULT 'free',
    role          TEXT NOT NULL DEFAULT 'user',
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_local_auth_users_email ON local_auth_users (email);
