-- docker-init-db.sql
-- Runs once when the pgdata volume is first created.
-- Creates the extensions Prisma / Better Auth need.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";    -- case-insensitive email columns
