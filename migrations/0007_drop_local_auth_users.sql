-- Migration: Drop the local_auth_users table
-- The homegrown local JWT auth system is replaced by Better Auth,
-- which manages its own tables (user, session, account, verification)
-- via programmatic migration on first use.
DROP TABLE IF EXISTS local_auth_users;
