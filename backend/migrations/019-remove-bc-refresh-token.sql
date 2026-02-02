-- Migration: 019-remove-bc-refresh-token.sql
-- Description: Remove unused bc_refresh_token_encrypted column from users table
--
-- Context: The system now uses MSAL cache-based token management.
-- Refresh tokens are stored in Redis by MSAL, not in SQL.
-- This column has been NULL for all users and is no longer needed.

-- Check if column exists before dropping (idempotent)
IF EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'users'
    AND COLUMN_NAME = 'bc_refresh_token_encrypted'
)
BEGIN
    ALTER TABLE users DROP COLUMN bc_refresh_token_encrypted;
    PRINT 'Column bc_refresh_token_encrypted dropped from users table';
END
ELSE
BEGIN
    PRINT 'Column bc_refresh_token_encrypted does not exist - skipping';
END
GO
