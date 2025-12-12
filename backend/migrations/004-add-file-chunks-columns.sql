-- Migration: 004-add-file-chunks-columns.sql
-- Date: 2025-12-12
-- Purpose: Add user_id and metadata columns to file_chunks table
-- Reason:
--   - user_id: Multi-tenant security - allows direct filtering without JOIN to files table
--   - metadata: Debugging and traceability - stores chunking strategy info, position, etc.

-- Required for Azure SQL DDL operations
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

USE [sqldb-bcagent-dev];
GO

-- =============================================
-- Step 1: Add user_id column (initially NULL for backfill)
-- =============================================
IF NOT EXISTS (
    SELECT * FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'file_chunks' AND COLUMN_NAME = 'user_id'
)
BEGIN
    ALTER TABLE file_chunks
    ADD user_id UNIQUEIDENTIFIER NULL;
    PRINT 'Added column: user_id (NULL initially for backfill)';
END
ELSE
BEGIN
    PRINT 'Column already exists: user_id';
END
GO

-- =============================================
-- Step 2: Backfill user_id from files table
-- =============================================
UPDATE fc
SET fc.user_id = f.user_id
FROM file_chunks fc
INNER JOIN files f ON fc.file_id = f.id
WHERE fc.user_id IS NULL;

PRINT 'Backfilled user_id from files table';
GO

-- =============================================
-- Step 3: Make user_id NOT NULL (after backfill)
-- =============================================
-- Only alter if there are no NULL values remaining
IF NOT EXISTS (
    SELECT 1 FROM file_chunks WHERE user_id IS NULL
)
BEGIN
    -- Check if column is already NOT NULL
    IF EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'file_chunks'
        AND COLUMN_NAME = 'user_id'
        AND IS_NULLABLE = 'YES'
    )
    BEGIN
        ALTER TABLE file_chunks
        ALTER COLUMN user_id UNIQUEIDENTIFIER NOT NULL;
        PRINT 'Made user_id NOT NULL';
    END
    ELSE
    BEGIN
        PRINT 'Column user_id is already NOT NULL';
    END
END
ELSE
BEGIN
    PRINT 'WARNING: Cannot make user_id NOT NULL - there are NULL values. Check for orphaned chunks.';
END
GO

-- =============================================
-- Step 4: Add metadata column
-- =============================================
IF NOT EXISTS (
    SELECT * FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'file_chunks' AND COLUMN_NAME = 'metadata'
)
BEGIN
    ALTER TABLE file_chunks
    ADD metadata NVARCHAR(MAX) NULL;
    PRINT 'Added column: metadata';
END
ELSE
BEGIN
    PRINT 'Column already exists: metadata';
END
GO

-- =============================================
-- Step 5: Add index for user_id queries
-- =============================================
IF NOT EXISTS (
    SELECT * FROM sys.indexes
    WHERE name = 'IX_file_chunks_user_id' AND object_id = OBJECT_ID('file_chunks')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_file_chunks_user_id
    ON file_chunks(user_id);
    PRINT 'Created index: IX_file_chunks_user_id';
END
ELSE
BEGIN
    PRINT 'Index already exists: IX_file_chunks_user_id';
END
GO

-- =============================================
-- Step 6: Add composite index for semantic search
-- =============================================
IF NOT EXISTS (
    SELECT * FROM sys.indexes
    WHERE name = 'IX_file_chunks_user_file' AND object_id = OBJECT_ID('file_chunks')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_file_chunks_user_file
    ON file_chunks(user_id, file_id);
    PRINT 'Created index: IX_file_chunks_user_file';
END
ELSE
BEGIN
    PRINT 'Index already exists: IX_file_chunks_user_file';
END
GO

-- =============================================
-- Verification
-- =============================================
PRINT '';
PRINT '=== Verifying file_chunks table schema ===';

SELECT
    COLUMN_NAME,
    DATA_TYPE,
    CHARACTER_MAXIMUM_LENGTH,
    IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'file_chunks'
ORDER BY ORDINAL_POSITION;

PRINT '';
PRINT '=== Verifying indexes ===';

SELECT
    i.name AS IndexName,
    i.type_desc AS IndexType,
    STUFF((
        SELECT ', ' + c.name
        FROM sys.index_columns ic
        INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
        WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id
        ORDER BY ic.key_ordinal
        FOR XML PATH('')
    ), 1, 2, '') AS IndexColumns
FROM sys.indexes i
WHERE i.object_id = OBJECT_ID('file_chunks')
    AND i.name IS NOT NULL
ORDER BY i.name;

GO

PRINT '';
PRINT 'Migration 004-add-file-chunks-columns.sql completed successfully';
PRINT '';
PRINT 'Summary:';
PRINT '  - Added user_id column (UNIQUEIDENTIFIER NOT NULL)';
PRINT '  - Backfilled user_id from files table';
PRINT '  - Added metadata column (NVARCHAR(MAX) NULL)';
PRINT '  - Created index IX_file_chunks_user_id';
PRINT '  - Created index IX_file_chunks_user_file';
GO
