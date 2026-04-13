-- Rename clerk_user_id to user_id in admin_role_assignments
ALTER TABLE admin_role_assignments RENAME COLUMN clerk_user_id TO user_id;
-- Update the unique index
DROP INDEX IF EXISTS idx_admin_role_assignments_clerk_user_id;
CREATE UNIQUE INDEX idx_admin_role_assignments_user_id ON admin_role_assignments(user_id);
-- Partial index for active (non-expired) role assignments
CREATE INDEX IF NOT EXISTS idx_admin_role_assignments_active
    ON admin_role_assignments(user_id)
    WHERE expires_at IS NULL OR expires_at > datetime('now');
