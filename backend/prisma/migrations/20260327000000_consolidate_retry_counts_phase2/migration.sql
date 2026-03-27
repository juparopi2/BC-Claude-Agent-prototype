-- Phase 2: Destructive migration — drop deprecated retry count columns
--
-- Prerequisites:
--   1. Phase 1 migration (20260326200000) MUST be applied first
--   2. Application code MUST be running on the consolidated version
--      (all reads from pipeline_retry_count/last_error, no reads from old columns)
--   3. Verify Phase 1 backfill completed:
--      SELECT COUNT(*) FROM files WHERE pipeline_retry_count < processing_retry_count
--         OR pipeline_retry_count < embedding_retry_count;  -- must be 0
--      SELECT COUNT(*) FROM files WHERE last_error IS NULL
--         AND (last_processing_error IS NOT NULL OR last_embedding_error IS NOT NULL);  -- must be 0
--
-- Drops: processing_retry_count, embedding_retry_count, last_processing_error, last_embedding_error
--
-- IMPORTANT: This migration is blocked by CI destructive scanner.
-- Requires PR label: migration:destructive-approved
-- Or commit message containing: [destructive-migration]

-- 1. Drop processing_retry_count column + default constraint
IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF__files__processin__3335971A')
  ALTER TABLE [dbo].[files] DROP CONSTRAINT [DF__files__processin__3335971A];
IF EXISTS (SELECT 1 FROM sys.columns WHERE name = 'processing_retry_count' AND object_id = OBJECT_ID('[dbo].[files]'))
  ALTER TABLE [dbo].[files] DROP COLUMN [processing_retry_count];

-- 2. Drop embedding_retry_count column + default constraint
IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF__files__embedding__3429BB53')
  ALTER TABLE [dbo].[files] DROP CONSTRAINT [DF__files__embedding__3429BB53];
IF EXISTS (SELECT 1 FROM sys.columns WHERE name = 'embedding_retry_count' AND object_id = OBJECT_ID('[dbo].[files]'))
  ALTER TABLE [dbo].[files] DROP COLUMN [embedding_retry_count];

-- 3. Drop last_processing_error column
IF EXISTS (SELECT 1 FROM sys.columns WHERE name = 'last_processing_error' AND object_id = OBJECT_ID('[dbo].[files]'))
  ALTER TABLE [dbo].[files] DROP COLUMN [last_processing_error];

-- 4. Drop last_embedding_error column
IF EXISTS (SELECT 1 FROM sys.columns WHERE name = 'last_embedding_error' AND object_id = OBJECT_ID('[dbo].[files]'))
  ALTER TABLE [dbo].[files] DROP COLUMN [last_embedding_error];
