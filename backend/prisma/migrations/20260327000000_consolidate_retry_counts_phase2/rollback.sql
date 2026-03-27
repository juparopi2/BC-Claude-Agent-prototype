-- ROLLBACK: Re-add deprecated retry count columns
-- Run this if Phase 2 needs to be reverted.
--
-- After executing:
-- 1. DELETE FROM _prisma_migrations WHERE migration_name = '20260327000000_consolidate_retry_counts_phase2';
-- 2. Run: npx prisma migrate deploy  (to confirm clean state)
-- 3. Backfill the re-added columns from pipeline_retry_count/last_error:
--    UPDATE files SET processing_retry_count = pipeline_retry_count;
--    UPDATE files SET embedding_retry_count = 0;
--    UPDATE files SET last_processing_error = last_error;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE name = 'processing_retry_count' AND object_id = OBJECT_ID('[dbo].[files]'))
  ALTER TABLE [dbo].[files] ADD [processing_retry_count] INT NOT NULL CONSTRAINT [DF__files__processin__3335971A] DEFAULT 0;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE name = 'embedding_retry_count' AND object_id = OBJECT_ID('[dbo].[files]'))
  ALTER TABLE [dbo].[files] ADD [embedding_retry_count] INT NOT NULL CONSTRAINT [DF__files__embedding__3429BB53] DEFAULT 0;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE name = 'last_processing_error' AND object_id = OBJECT_ID('[dbo].[files]'))
  ALTER TABLE [dbo].[files] ADD [last_processing_error] NVARCHAR(MAX) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE name = 'last_embedding_error' AND object_id = OBJECT_ID('[dbo].[files]'))
  ALTER TABLE [dbo].[files] ADD [last_embedding_error] NVARCHAR(MAX) NULL;
