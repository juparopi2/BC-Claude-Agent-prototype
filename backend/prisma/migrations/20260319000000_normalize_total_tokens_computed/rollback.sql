-- ============================================================
-- ROLLBACK: 20260319000000_normalize_total_tokens_computed
-- ============================================================
-- Date created: 2026-03-19
-- Original migration: prisma/migrations/20260319000000_normalize_total_tokens_computed/migration.sql
--
-- PURPOSE: Reverts the computed PERSISTED column back to a plain INT.
-- The original migration converted total_tokens from INT to
-- a computed column (input_tokens + output_tokens). This rollback
-- reverses that change.
--
-- INSTRUCTIONS:
--   1. Run against the target database via sqlcmd or Azure Data Studio
--   2. After execution, remove the migration record:
--      DELETE FROM _prisma_migrations
--        WHERE migration_name = '20260319000000_normalize_total_tokens_computed';
--   3. Verify: SELECT name, definition FROM sys.computed_columns
--        WHERE object_id = OBJECT_ID('[dbo].[messages]');
--      (should return no rows for total_tokens)
--   4. Run: npx prisma migrate deploy (to confirm clean state)
-- ============================================================

-- Only revert if total_tokens is currently a computed column
IF EXISTS (
  SELECT 1 FROM sys.computed_columns
  WHERE name = 'total_tokens'
    AND object_id = OBJECT_ID('[dbo].[messages]')
)
BEGIN
  -- Drop the computed column
  ALTER TABLE [dbo].[messages] DROP COLUMN [total_tokens];

  -- Re-add as plain INT (matches Prisma schema definition)
  ALTER TABLE [dbo].[messages] ADD [total_tokens] INT NULL;

  -- Backfill from existing input/output tokens
  UPDATE [dbo].[messages]
    SET [total_tokens] = ISNULL([input_tokens], 0) + ISNULL([output_tokens], 0)
    WHERE [input_tokens] IS NOT NULL OR [output_tokens] IS NOT NULL;
END
