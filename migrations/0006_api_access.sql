-- Migration: 0006_api_access.sql
-- Adds api_disabled flag to local_auth_users for per-user API access control.
-- When api_disabled = 1, the user receives 403 on all API calls.
-- Admins can toggle this via PATCH /admin/local-users/:id.

ALTER TABLE local_auth_users ADD COLUMN IF NOT EXISTS api_disabled INTEGER NOT NULL DEFAULT 0;
