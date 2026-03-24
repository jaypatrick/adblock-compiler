-- =============================================================================
-- Admin Configuration Database Migration
-- Migration: 0002_agent_scope_seed.sql
-- Purpose: Seed the `scope_configs` table in ADMIN_DB with the new 'agents'
--          scope that was added to AuthScope in worker/types.ts.
-- =============================================================================

-- Insert the 'agents' scope if it does not already exist.
-- Uses INSERT OR IGNORE to be safe on repeated runs (e.g. wrangler migrate reset).
INSERT OR IGNORE INTO scope_configs (scope_name, display_name, description, required_tier)
VALUES (
    'agents',
    'Agents',
    'Access to AI agent endpoints (admin-only)',
    'admin'
);
