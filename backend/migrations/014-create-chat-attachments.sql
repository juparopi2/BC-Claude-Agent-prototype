-- Migration: 014-create-chat-attachments.sql
-- Date: 2026-01-20
-- Purpose: Ephemeral chat attachments (direct-to-Anthropic, no RAG processing)

-- Required for Azure SQL DDL operations
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

USE [sqldb-bcagent-dev];
GO

-- =============================================
-- Step 1: Create chat_attachments table
-- =============================================
IF NOT EXISTS (
    SELECT * FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME = 'chat_attachments'
)
BEGIN
    CREATE TABLE chat_attachments (
        -- Primary key (UPPERCASE UUID per project conventions)
        id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),

        -- Multi-tenant isolation: Owner user ID
        user_id UNIQUEIDENTIFIER NOT NULL,

        -- Associated chat session
        session_id UNIQUEIDENTIFIER NOT NULL,

        -- File metadata
        name NVARCHAR(512) NOT NULL,
        mime_type VARCHAR(100) NOT NULL,
        size_bytes BIGINT NOT NULL,

        -- Azure Blob Storage path
        blob_path VARCHAR(2048) NOT NULL,

        -- Optional content hash for deduplication
        content_hash VARCHAR(64) NULL,

        -- TTL-based expiration
        expires_at DATETIME2 NOT NULL,

        -- Timestamps
        created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),

        -- Soft delete support
        is_deleted BIT NOT NULL DEFAULT 0,
        deleted_at DATETIME2 NULL,

        -- Constraints
        CONSTRAINT PK_chat_attachments PRIMARY KEY (id),
        CONSTRAINT FK_chat_attachments_user FOREIGN KEY (user_id)
            REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT FK_chat_attachments_session FOREIGN KEY (session_id)
            REFERENCES sessions(id) ON DELETE CASCADE
    );

    PRINT 'Created table: chat_attachments';
END
ELSE
BEGIN
    PRINT 'Table already exists: chat_attachments';
END
GO

-- =============================================
-- Step 2: Create indexes for multi-tenant queries
-- =============================================

-- Index for user + session queries (most common access pattern)
IF NOT EXISTS (
    SELECT * FROM sys.indexes
    WHERE name = 'IX_chat_attachments_user_session' AND object_id = OBJECT_ID('chat_attachments')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_chat_attachments_user_session
    ON chat_attachments(user_id, session_id)
    INCLUDE (name, mime_type, size_bytes, expires_at, is_deleted);
    PRINT 'Created index: IX_chat_attachments_user_session';
END
ELSE
BEGIN
    PRINT 'Index already exists: IX_chat_attachments_user_session';
END
GO

-- Index for cleanup job: find expired attachments
IF NOT EXISTS (
    SELECT * FROM sys.indexes
    WHERE name = 'IX_chat_attachments_expires' AND object_id = OBJECT_ID('chat_attachments')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_chat_attachments_expires
    ON chat_attachments(expires_at)
    WHERE is_deleted = 0;
    PRINT 'Created index: IX_chat_attachments_expires (filtered)';
END
ELSE
BEGIN
    PRINT 'Index already exists: IX_chat_attachments_expires';
END
GO

-- Index for blob cleanup: find soft-deleted attachments
IF NOT EXISTS (
    SELECT * FROM sys.indexes
    WHERE name = 'IX_chat_attachments_deleted' AND object_id = OBJECT_ID('chat_attachments')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_chat_attachments_deleted
    ON chat_attachments(deleted_at)
    WHERE is_deleted = 1;
    PRINT 'Created index: IX_chat_attachments_deleted (filtered)';
END
ELSE
BEGIN
    PRINT 'Index already exists: IX_chat_attachments_deleted';
END
GO

-- =============================================
-- Verification
-- =============================================
PRINT '';
PRINT '=== Verifying chat_attachments table schema ===';

SELECT
    COLUMN_NAME,
    DATA_TYPE,
    CHARACTER_MAXIMUM_LENGTH,
    IS_NULLABLE,
    COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'chat_attachments'
ORDER BY ORDINAL_POSITION;

PRINT '';
PRINT '=== Verifying indexes ===';

SELECT
    i.name AS IndexName,
    i.type_desc AS IndexType,
    i.filter_definition AS FilterDefinition
FROM sys.indexes i
WHERE i.object_id = OBJECT_ID('chat_attachments')
    AND i.name IS NOT NULL
ORDER BY i.name;

PRINT '';
PRINT '=== Verifying foreign keys ===';

SELECT
    fk.name AS ForeignKeyName,
    OBJECT_NAME(fk.parent_object_id) AS TableName,
    COL_NAME(fkc.parent_object_id, fkc.parent_column_id) AS ColumnName,
    OBJECT_NAME(fk.referenced_object_id) AS ReferencedTable,
    COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id) AS ReferencedColumn,
    fk.delete_referential_action_desc AS DeleteAction
FROM sys.foreign_keys fk
INNER JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
WHERE fk.parent_object_id = OBJECT_ID('chat_attachments')
ORDER BY fk.name;

GO

PRINT '';
PRINT 'Migration 014-create-chat-attachments.sql completed successfully';
PRINT '';
PRINT 'Summary:';
PRINT '  - Created chat_attachments table for ephemeral chat file attachments';
PRINT '  - TTL-based expiration via expires_at column';
PRINT '  - Soft delete support for cleanup coordination';
PRINT '  - Multi-tenant isolation via user_id foreign key';
PRINT '  - Session association via session_id foreign key (CASCADE delete)';
PRINT '  - Optimized indexes for user/session queries and cleanup jobs';
GO
