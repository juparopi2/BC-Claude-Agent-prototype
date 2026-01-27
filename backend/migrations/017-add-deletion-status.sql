-- Migration: 017-add-deletion-status.sql
-- Date: 2025-01-27
-- Purpose: Add soft delete support with deletion_status column for two-phase deletion workflow
-- Phase: File Deletion Optimization

-- Required for Azure SQL DDL operations
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

USE [sqldb-bcagent-dev];
GO

-- =============================================
-- Add deletion_status column to files table
-- Values: NULL (active), 'pending', 'deleting', 'failed'
-- =============================================
IF NOT EXISTS (
    SELECT * FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'files' AND COLUMN_NAME = 'deletion_status'
)
BEGIN
    ALTER TABLE files ADD deletion_status NVARCHAR(20) NULL DEFAULT NULL;
    PRINT 'Added column: files.deletion_status';
END
ELSE
BEGIN
    PRINT 'Column already exists: files.deletion_status';
END
GO

-- =============================================
-- Add deleted_at timestamp column
-- =============================================
IF NOT EXISTS (
    SELECT * FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'files' AND COLUMN_NAME = 'deleted_at'
)
BEGIN
    ALTER TABLE files ADD deleted_at DATETIME2 NULL;
    PRINT 'Added column: files.deleted_at';
END
ELSE
BEGIN
    PRINT 'Column already exists: files.deleted_at';
END
GO

-- =============================================
-- Create filtered index for active files (most common query pattern)
-- This index covers files that are NOT marked for deletion
-- =============================================
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_files_deletion_status_active' AND object_id = OBJECT_ID('files'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_files_deletion_status_active
    ON files(user_id, parent_folder_id)
    INCLUDE (name, mime_type, size_bytes, is_folder, is_favorite, processing_status, embedding_status, created_at, updated_at)
    WHERE deletion_status IS NULL;
    PRINT 'Created index: IX_files_deletion_status_active (filtered)';
END
ELSE
BEGIN
    PRINT 'Index already exists: IX_files_deletion_status_active';
END
GO

-- =============================================
-- Create index for finding stuck deletions (cleanup job)
-- =============================================
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_files_deletion_pending' AND object_id = OBJECT_ID('files'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_files_deletion_pending
    ON files(deletion_status, deleted_at)
    INCLUDE (id, user_id, blob_path)
    WHERE deletion_status IS NOT NULL;
    PRINT 'Created index: IX_files_deletion_pending (filtered)';
END
ELSE
BEGIN
    PRINT 'Index already exists: IX_files_deletion_pending';
END
GO

-- =============================================
-- Verification
-- =============================================
PRINT '';
PRINT '=== Verifying new columns ===';

SELECT
    COLUMN_NAME,
    DATA_TYPE,
    CHARACTER_MAXIMUM_LENGTH,
    IS_NULLABLE,
    COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'files'
    AND COLUMN_NAME IN ('deletion_status', 'deleted_at')
ORDER BY ORDINAL_POSITION;
GO

PRINT '';
PRINT '=== Verifying new indexes ===';

SELECT
    i.name AS IndexName,
    i.type_desc AS IndexType,
    i.filter_definition AS FilterDefinition
FROM sys.indexes i
WHERE i.object_id = OBJECT_ID('files')
    AND i.name IN ('IX_files_deletion_status_active', 'IX_files_deletion_pending');
GO

PRINT '';
PRINT 'Migration 017-add-deletion-status.sql completed successfully';
PRINT '';
PRINT 'Summary:';
PRINT '  - Added deletion_status column (NULL=active, pending, deleting, failed)';
PRINT '  - Added deleted_at timestamp column';
PRINT '  - Created filtered index for active files (most common queries)';
PRINT '  - Created index for cleanup job (stuck deletions)';
GO
