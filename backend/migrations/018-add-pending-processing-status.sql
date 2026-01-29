-- ============================================================================
-- Migration 018: Add pending_processing status index
-- ============================================================================
--
-- Purpose:
-- Adds the 'pending_processing' status to the processing_status filtered index.
-- This status is used by the FileProcessingScheduler for flow control/backpressure.
--
-- Flow Control Architecture:
-- - Files are uploaded with status 'pending_processing' (not queued yet)
-- - FileProcessingScheduler periodically checks queue depth
-- - When capacity available, files are moved from 'pending_processing' -> 'pending'
-- - This prevents Redis OOM from bulk uploads flooding the queue
--
-- Changes:
-- 1. Recreates IX_files_processing_status_pending to include 'pending_processing'
--
-- Rollback:
-- DROP INDEX IF EXISTS IX_files_processing_status_pending ON files;
-- CREATE INDEX IX_files_processing_status_pending
--     ON files(user_id, processing_status, created_at)
--     WHERE processing_status IN ('pending', 'processing');
-- ============================================================================

-- Note: USE statement removed - database is selected via connection config

PRINT 'Starting migration 018: Add pending_processing status support';
PRINT '';

-- ============================================================================
-- Step 1: Drop existing filtered index
-- ============================================================================

PRINT 'Dropping existing IX_files_processing_status_pending index...';

IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('files') AND name = 'IX_files_processing_status_pending')
BEGIN
    DROP INDEX IX_files_processing_status_pending ON files;
    PRINT 'Dropped IX_files_processing_status_pending index';
END
ELSE
BEGIN
    PRINT 'IX_files_processing_status_pending index does not exist - skipping drop';
END

PRINT '';

-- ============================================================================
-- Step 2: Create new filtered index including pending_processing
-- ============================================================================

PRINT 'Creating new IX_files_processing_status_pending index with pending_processing...';

CREATE INDEX IX_files_processing_status_pending
ON files(user_id, processing_status, created_at)
WHERE processing_status IN ('pending_processing', 'pending', 'processing');

PRINT 'Created IX_files_processing_status_pending filtered index';
PRINT '';

-- ============================================================================
-- Migration Complete
-- ============================================================================

PRINT 'Migration 018 completed successfully';
PRINT 'New status supported: pending_processing';
PRINT '';
GO
