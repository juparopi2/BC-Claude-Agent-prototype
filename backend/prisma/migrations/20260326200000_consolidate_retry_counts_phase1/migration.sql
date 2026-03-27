-- Phase 1: Additive migration — consolidate retry counts (backwards-compatible)
--
-- Adds `last_error` column and backfills `pipeline_retry_count` with
-- MAX(processing_retry_count, embedding_retry_count, pipeline_retry_count).
-- Backfills `last_error` with COALESCE(last_processing_error, last_embedding_error).
--
-- Safe to deploy while old code is still running. Old columns are NOT dropped here.
-- See Phase 2 migration for destructive changes.

-- 1. Add last_error column (coexists with last_processing_error and last_embedding_error)
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE name = 'last_error' AND object_id = OBJECT_ID('[dbo].[files]')
)
ALTER TABLE [dbo].[files] ADD [last_error] NVARCHAR(1000) NULL;

-- 2. Backfill pipeline_retry_count = MAX(processing_retry_count, embedding_retry_count, pipeline_retry_count)
-- Wrapped in EXEC to defer compilation (column must exist before SQL Server parses references)
EXEC sp_executesql N'
DECLARE @batch INT = 1000;
WHILE EXISTS (
  SELECT TOP 1 1 FROM [dbo].[files]
  WHERE [pipeline_retry_count] < [processing_retry_count]
     OR [pipeline_retry_count] < [embedding_retry_count]
)
BEGIN
  UPDATE TOP(@batch) [dbo].[files]
  SET [pipeline_retry_count] = (
    SELECT MAX(v) FROM (VALUES
      ([processing_retry_count]),
      ([embedding_retry_count]),
      ([pipeline_retry_count])
    ) AS T(v)
  )
  WHERE [pipeline_retry_count] < [processing_retry_count]
     OR [pipeline_retry_count] < [embedding_retry_count];
  WAITFOR DELAY ''00:00:01'';
END
';

-- 3. Backfill last_error = COALESCE(last_processing_error, last_embedding_error)
EXEC sp_executesql N'
WHILE EXISTS (
  SELECT TOP 1 1 FROM [dbo].[files]
  WHERE [last_error] IS NULL
    AND ([last_processing_error] IS NOT NULL OR [last_embedding_error] IS NOT NULL)
)
BEGIN
  UPDATE TOP(1000) [dbo].[files]
  SET [last_error] = COALESCE([last_processing_error], [last_embedding_error])
  WHERE [last_error] IS NULL
    AND ([last_processing_error] IS NOT NULL OR [last_embedding_error] IS NOT NULL);
  WAITFOR DELAY ''00:00:01'';
END
';
