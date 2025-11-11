/**
 * Migration 005: Add Microsoft OAuth columns to users table
 *
 * Adds support for Microsoft Entra ID OAuth 2.0 authentication.
 * New columns:
 * - microsoft_id: Unique Microsoft user ID
 * - microsoft_email: User's Microsoft email
 * - microsoft_tenant_id: Microsoft tenant ID (for multi-tenant support)
 * - last_microsoft_login: Last login timestamp via Microsoft
 * - bc_access_token_encrypted: Encrypted Business Central API token (per-user)
 * - bc_refresh_token_encrypted: Encrypted BC refresh token (per-user)
 * - bc_token_expires_at: BC token expiration timestamp
 */

-- Step 1: Add Microsoft OAuth columns
ALTER TABLE users ADD
  microsoft_id NVARCHAR(255) NULL,
  microsoft_email NVARCHAR(255) NULL,
  microsoft_tenant_id NVARCHAR(255) NULL,
  last_microsoft_login DATETIME2(7) NULL;
GO

-- Step 2: Add Business Central per-user token columns
ALTER TABLE users ADD
  bc_access_token_encrypted NVARCHAR(MAX) NULL,
  bc_refresh_token_encrypted NVARCHAR(MAX) NULL,
  bc_token_expires_at DATETIME2(7) NULL;
GO

-- Step 3: Create unique constraint on microsoft_id
CREATE UNIQUE INDEX IX_users_microsoft_id
  ON users (microsoft_id)
  WHERE microsoft_id IS NOT NULL;
GO

-- Step 4: Make password_hash nullable (optional for OAuth users)
ALTER TABLE users ALTER COLUMN password_hash NVARCHAR(255) NULL;
GO

PRINT 'Migration 005 completed: Microsoft OAuth columns added';
GO
