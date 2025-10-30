/**
 * Migration 003: Add User Roles
 *
 * Adds 'role' column to users table with CHECK constraint and default value.
 * Updates existing users with appropriate roles based on is_admin flag.
 *
 * Run this migration after initial database setup (001 and 002).
 */

-- Check if role column already exists
IF NOT EXISTS (
  SELECT * FROM sys.columns
  WHERE object_id = OBJECT_ID('users') AND name = 'role'
)
BEGIN
  PRINT 'Adding role column to users table...';

  -- Add role column with default value
  ALTER TABLE users
  ADD role NVARCHAR(50) NOT NULL DEFAULT 'viewer'
  CONSTRAINT chk_users_role CHECK (role IN ('admin', 'editor', 'viewer'));

  PRINT 'Role column added successfully';

  -- Update existing users: set admins to 'admin', others to 'editor'
  PRINT 'Updating existing users with roles...';

  UPDATE users
  SET role = 'admin'
  WHERE is_admin = 1;

  UPDATE users
  SET role = 'editor'
  WHERE is_admin = 0;

  PRINT 'Existing users updated with roles';
END
ELSE
BEGIN
  PRINT 'Role column already exists, skipping migration';
END

-- Verify migration
PRINT 'Verifying migration...';

SELECT
  COUNT(*) as total_users,
  SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) as admins,
  SUM(CASE WHEN role = 'editor' THEN 1 ELSE 0 END) as editors,
  SUM(CASE WHEN role = 'viewer' THEN 1 ELSE 0 END) as viewers
FROM users;

PRINT 'Migration 003 completed successfully';
