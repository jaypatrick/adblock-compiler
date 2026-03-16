-- Migration: 0005_local_auth_users.sql
--
-- Creates the local_auth_users table used by LocalJwtAuthProvider.
-- This is a temporary bridge until Clerk is production-ready.
--
-- MIGRATION PATH TO CLERK:
--   1. Set CLERK_JWKS_URL in wrangler.toml [vars] (or .dev.vars locally).
--   2. The provider auto-switches to ClerkAuthProvider — zero code changes.
--   3. Migrate users: email/phone → Clerk email_addresses/phone_numbers,
--      role/tier → Clerk publicMetadata.role / publicMetadata.tier.
--   4. Drop this table after migration is confirmed.
--
-- Schema mirrors Clerk's user model:
--   identifier      → Clerk's primary email_address or phone_number
--   identifier_type → Clerk's "identifier strategy" ('email' | 'phone')
--   role            → Clerk publicMetadata.role  ('user' | 'admin' | ...)
--   tier            → Clerk publicMetadata.tier  ('free' | 'admin' | ...)
--
-- Password hashing: PBKDF2 via Web Crypto API (SubtleCrypto).
--   Format: "<base64url-salt>:<base64url-derived-bits>"
--   Parameters: 100,000 iterations, SHA-256, 16-byte salt, 256-bit output.
--   Rationale: Argon2id is unavailable in the Cloudflare Workers runtime.

CREATE TABLE IF NOT EXISTS local_auth_users (
    id              TEXT PRIMARY KEY,                            -- UUID v4 (crypto.randomUUID())
    identifier      TEXT NOT NULL UNIQUE,                        -- email address or phone number
    identifier_type TEXT NOT NULL DEFAULT 'email',               -- 'email' | 'phone'
    password_hash   TEXT NOT NULL,                               -- "<base64url-salt>:<base64url-hash>"
    role            TEXT NOT NULL DEFAULT 'user',               -- mirrors Clerk publicMetadata.role
    tier            TEXT NOT NULL DEFAULT 'free',                -- mirrors Clerk publicMetadata.tier
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_local_auth_users_identifier ON local_auth_users (identifier);
