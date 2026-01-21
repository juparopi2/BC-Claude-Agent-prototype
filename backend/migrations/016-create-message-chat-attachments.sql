-- Migration: 016-create-message-chat-attachments.sql
-- Date: 2026-01-21
-- Purpose: Create junction table for message-to-chat-attachment relationships
--
-- Context: When users send messages with chat attachments, this table
-- persists the relationship so attachments are visible in message history.
-- Unlike message_file_attachments (for KB files), this tracks ephemeral
-- chat attachments that go directly to Anthropic API.

-- Required for Azure SQL DDL operations
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

USE [sqldb-bcagent-dev];
GO

-- =============================================
-- Step 1: Create message_chat_attachments table
-- =============================================
IF NOT EXISTS (
    SELECT * FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME = 'message_chat_attachments'
)
BEGIN
    CREATE TABLE message_chat_attachments (
        -- Primary key (UPPERCASE UUID per project conventions)
        id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),

        -- Message ID - can be Anthropic format (msg_*) or UUID
        -- Using NVARCHAR to accommodate both formats
        message_id NVARCHAR(255) NOT NULL,

        -- Foreign key to chat_attachments table
        chat_attachment_id UNIQUEIDENTIFIER NOT NULL,

        -- Timestamps
        created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),

        -- Constraints
        CONSTRAINT PK_message_chat_attachments PRIMARY KEY (id),
        CONSTRAINT FK_mca_attachment FOREIGN KEY (chat_attachment_id)
            REFERENCES chat_attachments(id) ON DELETE CASCADE,
        -- Prevent duplicate linkages
        CONSTRAINT UQ_message_attachment UNIQUE (message_id, chat_attachment_id)
    );

    PRINT 'Created table: message_chat_attachments';
END
ELSE
BEGIN
    PRINT 'Table already exists: message_chat_attachments';
END
GO

-- =============================================
-- Step 2: Create indexes for common queries
-- =============================================

-- Index for fetching attachments by message ID (primary access pattern)
IF NOT EXISTS (
    SELECT * FROM sys.indexes
    WHERE name = 'IX_mca_message' AND object_id = OBJECT_ID('message_chat_attachments')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_mca_message
    ON message_chat_attachments(message_id)
    INCLUDE (chat_attachment_id, created_at);
    PRINT 'Created index: IX_mca_message';
END
ELSE
BEGIN
    PRINT 'Index already exists: IX_mca_message';
END
GO

-- Index for cascade operations when attachment is deleted
IF NOT EXISTS (
    SELECT * FROM sys.indexes
    WHERE name = 'IX_mca_attachment' AND object_id = OBJECT_ID('message_chat_attachments')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_mca_attachment
    ON message_chat_attachments(chat_attachment_id);
    PRINT 'Created index: IX_mca_attachment';
END
ELSE
BEGIN
    PRINT 'Index already exists: IX_mca_attachment';
END
GO

-- =============================================
-- Verification
-- =============================================
PRINT '';
PRINT '=== Verifying message_chat_attachments table schema ===';

SELECT
    COLUMN_NAME,
    DATA_TYPE,
    CHARACTER_MAXIMUM_LENGTH,
    IS_NULLABLE,
    COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'message_chat_attachments'
ORDER BY ORDINAL_POSITION;

PRINT '';
PRINT '=== Verifying indexes ===';

SELECT
    i.name AS IndexName,
    i.type_desc AS IndexType,
    i.is_unique AS IsUnique
FROM sys.indexes i
WHERE i.object_id = OBJECT_ID('message_chat_attachments')
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
WHERE fk.parent_object_id = OBJECT_ID('message_chat_attachments')
ORDER BY fk.name;

GO

PRINT '';
PRINT 'Migration 016-create-message-chat-attachments.sql completed successfully';
PRINT '';
PRINT 'Summary:';
PRINT '  - Created message_chat_attachments junction table';
PRINT '  - Links messages to ephemeral chat attachments';
PRINT '  - CASCADE delete when chat_attachment is deleted';
PRINT '  - Unique constraint prevents duplicate linkages';
PRINT '  - Optimized indexes for message-based queries';
GO
