-- Migration: Add file retry tracking columns for robust file processing
-- Date: 2026-01-14
-- Description: Adds retry count, error tracking, and failure timestamp columns
--              to support automatic retries and cleanup of failed file processing
-- Safety: All changes are additive with defaults (non-breaking)
-- Related PRD: Sistema Robusto de Procesamiento de Archivos (Phase 5)

-- ============================================================================
-- PHASE 1: Add retry count columns
-- ============================================================================

-- Add processing_retry_count column (tracks text extraction retries)
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('files') AND name = 'processing_retry_count')
BEGIN
    ALTER TABLE files ADD processing_retry_count INT NOT NULL DEFAULT 0;
    PRINT 'Added processing_retry_count column to files table';
END
ELSE
    PRINT 'processing_retry_count column already exists in files table';
GO

-- Add embedding_retry_count column (tracks embedding generation retries)
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('files') AND name = 'embedding_retry_count')
BEGIN
    ALTER TABLE files ADD embedding_retry_count INT NOT NULL DEFAULT 0;
    PRINT 'Added embedding_retry_count column to files table';
END
ELSE
    PRINT 'embedding_retry_count column already exists in files table';
GO

-- ============================================================================
-- PHASE 2: Add error storage columns
-- ============================================================================

-- Add last_processing_error column (stores last processing error message)
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('files') AND name = 'last_processing_error')
BEGIN
    ALTER TABLE files ADD last_processing_error NVARCHAR(1000) NULL;
    PRINT 'Added last_processing_error column to files table';
END
ELSE
    PRINT 'last_processing_error column already exists in files table';
GO

-- Add last_embedding_error column (stores last embedding error message)
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('files') AND name = 'last_embedding_error')
BEGIN
    ALTER TABLE files ADD last_embedding_error NVARCHAR(1000) NULL;
    PRINT 'Added last_embedding_error column to files table';
END
ELSE
    PRINT 'last_embedding_error column already exists in files table';
GO

-- ============================================================================
-- PHASE 3: Add failure timestamp for cleanup scheduling
-- ============================================================================

-- Add failed_at column (timestamp when file permanently failed)
-- Used by cleanup job to identify files that failed > N days ago
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('files') AND name = 'failed_at')
BEGIN
    ALTER TABLE files ADD failed_at DATETIME2 NULL;
    PRINT 'Added failed_at column to files table';
END
ELSE
    PRINT 'failed_at column already exists in files table';
GO

-- ============================================================================
-- PHASE 4: Create indexes for performance
-- ============================================================================

-- Index for cleanup job (find files that failed > N days ago)
-- Filtered index to only include rows where failed_at IS NOT NULL
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('files') AND name = 'IX_files_failed_at')
BEGIN
    CREATE INDEX IX_files_failed_at
    ON files(failed_at)
    WHERE failed_at IS NOT NULL;
    PRINT 'Created IX_files_failed_at filtered index';
END
ELSE
    PRINT 'IX_files_failed_at index already exists';
GO

-- Index for finding files in processing state (monitoring/dashboard)
-- Filtered index for common monitoring query
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('files') AND name = 'IX_files_processing_status_pending')
BEGIN
    CREATE INDEX IX_files_processing_status_pending
    ON files(user_id, processing_status, created_at)
    WHERE processing_status IN ('pending', 'processing');
    PRINT 'Created IX_files_processing_status_pending filtered index';
END
ELSE
    PRINT 'IX_files_processing_status_pending index already exists';
GO

-- Index for finding files with failed embedding (monitoring/retry)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('files') AND name = 'IX_files_embedding_status_failed')
BEGIN
    CREATE INDEX IX_files_embedding_status_failed
    ON files(user_id, embedding_status)
    WHERE embedding_status = 'failed';
    PRINT 'Created IX_files_embedding_status_failed filtered index';
END
ELSE
    PRINT 'IX_files_embedding_status_failed index already exists';
GO

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Verify all new columns exist
SELECT
    'files' as table_name,
    c.name as column_name,
    t.name as data_type,
    c.is_nullable,
    CASE
        WHEN dc.definition IS NOT NULL THEN dc.definition
        ELSE 'NO DEFAULT'
    END as default_value
FROM sys.columns c
JOIN sys.types t ON c.user_type_id = t.user_type_id
LEFT JOIN sys.default_constraints dc ON c.default_object_id = dc.object_id
WHERE c.object_id = OBJECT_ID('files')
AND c.name IN (
    'processing_retry_count',
    'embedding_retry_count',
    'last_processing_error',
    'last_embedding_error',
    'failed_at'
)
ORDER BY c.name;

-- Verify all new indexes exist
SELECT
    i.name as index_name,
    i.type_desc as index_type,
    i.has_filter as is_filtered,
    i.filter_definition as filter
FROM sys.indexes i
WHERE i.object_id = OBJECT_ID('files')
AND i.name IN (
    'IX_files_failed_at',
    'IX_files_processing_status_pending',
    'IX_files_embedding_status_failed'
)
ORDER BY i.name;

PRINT 'Migration 20260114_add_file_retry_tracking completed successfully';
GO
