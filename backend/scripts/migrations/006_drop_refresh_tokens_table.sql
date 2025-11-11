/**
 * Migration 006: Drop refresh_tokens table
 *
 * With Microsoft OAuth 2.0, refresh tokens are managed by Microsoft Entra ID
 * and stored in express-session. The refresh_tokens table is no longer needed.
 *
 * NOTE: This migration is DESTRUCTIVE and will delete all existing refresh tokens.
 * Existing JWT-authenticated users will need to log in again with Microsoft OAuth.
 */

-- Step 1: Drop refresh_tokens table
IF OBJECT_ID('dbo.refresh_tokens', 'U') IS NOT NULL
BEGIN
  PRINT 'Dropping refresh_tokens table...';
  DROP TABLE refresh_tokens;
  PRINT 'Table refresh_tokens dropped successfully';
END
ELSE
BEGIN
  PRINT 'Table refresh_tokens does not exist, skipping...';
END;

PRINT 'Migration 006 completed: refresh_tokens table removed';
