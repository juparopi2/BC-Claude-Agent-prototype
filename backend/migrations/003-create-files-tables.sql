-- Migration: 003-create-files-tables.sql
-- Date: 2025-12-08
-- Purpose: Create file management system tables (files, file_chunks, message_file_attachments)
-- Phase: Fase 1 (File Management - Database Schema)

-- Required for Azure SQL DDL operations (computed columns, indexed views)
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

USE [sqldb-bcagent-dev];
GO

-- =============================================
-- Create files table (main file/folder metadata)
-- =============================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'files')
BEGIN
    CREATE TABLE files (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        user_id UNIQUEIDENTIFIER NOT NULL,
        parent_folder_id UNIQUEIDENTIFIER NULL,

        name NVARCHAR(500) NOT NULL,
        mime_type NVARCHAR(255) NOT NULL,
        size_bytes BIGINT NOT NULL,
        blob_path NVARCHAR(1000) NOT NULL,

        is_folder BIT NOT NULL DEFAULT 0,
        is_favorite BIT NOT NULL DEFAULT 0,

        processing_status NVARCHAR(50) DEFAULT 'pending',
        embedding_status NVARCHAR(50) DEFAULT 'pending',
        extracted_text NVARCHAR(MAX) NULL,

        created_at DATETIME2 DEFAULT GETUTCDATE(),
        updated_at DATETIME2 DEFAULT GETUTCDATE(),

        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (parent_folder_id) REFERENCES files(id) ON DELETE NO ACTION
    );
    PRINT 'Created table: files';
END
ELSE
BEGIN
    PRINT 'Table already exists: files';
END
GO

-- =============================================
-- Create file_chunks table (text chunks for search)
-- =============================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'file_chunks')
BEGIN
    CREATE TABLE file_chunks (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        file_id UNIQUEIDENTIFIER NOT NULL,
        chunk_index INT NOT NULL,
        chunk_text NVARCHAR(MAX) NOT NULL,
        chunk_tokens INT NOT NULL,
        search_document_id NVARCHAR(255) NULL,
        created_at DATETIME2 DEFAULT GETUTCDATE(),

        FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
    );
    PRINT 'Created table: file_chunks';
END
ELSE
BEGIN
    PRINT 'Table already exists: file_chunks';
END
GO

-- =============================================
-- Create message_file_attachments table (links files to messages)
-- =============================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'message_file_attachments')
BEGIN
    CREATE TABLE message_file_attachments (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        message_id NVARCHAR(255) NOT NULL,
        file_id UNIQUEIDENTIFIER NOT NULL,
        usage_type NVARCHAR(50) NOT NULL,
        relevance_score FLOAT NULL,
        created_at DATETIME2 DEFAULT GETUTCDATE(),

        FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
    );
    PRINT 'Created table: message_file_attachments';
END
ELSE
BEGIN
    PRINT 'Table already exists: message_file_attachments';
END
GO

-- =============================================
-- Create indexes for files table
-- =============================================

-- Index for user folder navigation and file lookup
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_files_user_folder' AND object_id = OBJECT_ID('files'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_files_user_folder
    ON files(user_id, parent_folder_id, name);
    PRINT 'Created index: IX_files_user_folder';
END
ELSE
BEGIN
    PRINT 'Index already exists: IX_files_user_folder';
END
GO

-- Filtered index for favorites (performance optimization)
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_files_user_favorites' AND object_id = OBJECT_ID('files'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_files_user_favorites
    ON files(user_id, is_favorite)
    WHERE is_favorite = 1;
    PRINT 'Created index: IX_files_user_favorites (filtered)';
END
ELSE
BEGIN
    PRINT 'Index already exists: IX_files_user_favorites';
END
GO

-- Index for processing status queries
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_files_processing_status' AND object_id = OBJECT_ID('files'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_files_processing_status
    ON files(processing_status, created_at);
    PRINT 'Created index: IX_files_processing_status';
END
ELSE
BEGIN
    PRINT 'Index already exists: IX_files_processing_status';
END
GO

-- Index for embedding status queries
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_files_embedding_status' AND object_id = OBJECT_ID('files'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_files_embedding_status
    ON files(embedding_status, created_at);
    PRINT 'Created index: IX_files_embedding_status';
END
ELSE
BEGIN
    PRINT 'Index already exists: IX_files_embedding_status';
END
GO

-- =============================================
-- Create indexes for file_chunks table
-- =============================================

-- Index for chunk retrieval (ordered by chunk_index)
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_file_chunks_file_index' AND object_id = OBJECT_ID('file_chunks'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_file_chunks_file_index
    ON file_chunks(file_id, chunk_index ASC);
    PRINT 'Created index: IX_file_chunks_file_index';
END
ELSE
BEGIN
    PRINT 'Index already exists: IX_file_chunks_file_index';
END
GO

-- =============================================
-- Create indexes for message_file_attachments table
-- =============================================

-- Index for message attachments lookup
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_message_file_attachments_message' AND object_id = OBJECT_ID('message_file_attachments'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_message_file_attachments_message
    ON message_file_attachments(message_id, created_at);
    PRINT 'Created index: IX_message_file_attachments_message';
END
ELSE
BEGIN
    PRINT 'Index already exists: IX_message_file_attachments_message';
END
GO

-- Index for file usage lookup (which messages use this file)
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_message_file_attachments_file' AND object_id = OBJECT_ID('message_file_attachments'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_message_file_attachments_file
    ON message_file_attachments(file_id, created_at);
    PRINT 'Created index: IX_message_file_attachments_file';
END
ELSE
BEGIN
    PRINT 'Index already exists: IX_message_file_attachments_file';
END
GO

-- =============================================
-- Verification queries
-- =============================================
PRINT '';
PRINT '=== Verifying tables ===';

-- Verify files table
SELECT
    COLUMN_NAME,
    DATA_TYPE,
    CHARACTER_MAXIMUM_LENGTH,
    IS_NULLABLE,
    COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'files'
ORDER BY ORDINAL_POSITION;

-- Verify file_chunks table
SELECT
    COLUMN_NAME,
    DATA_TYPE,
    CHARACTER_MAXIMUM_LENGTH,
    IS_NULLABLE,
    COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'file_chunks'
ORDER BY ORDINAL_POSITION;

-- Verify message_file_attachments table
SELECT
    COLUMN_NAME,
    DATA_TYPE,
    CHARACTER_MAXIMUM_LENGTH,
    IS_NULLABLE,
    COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'message_file_attachments'
ORDER BY ORDINAL_POSITION;

PRINT '';
PRINT '=== Verifying indexes ===';

-- List all indexes
SELECT
    t.name AS TableName,
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
INNER JOIN sys.tables t ON i.object_id = t.object_id
WHERE t.name IN ('files', 'file_chunks', 'message_file_attachments')
    AND i.name IS NOT NULL
ORDER BY t.name, i.name;

GO

PRINT '';
PRINT 'Migration 003-create-files-tables.sql completed successfully';
PRINT '';
PRINT 'Summary:';
PRINT '  - Created 3 tables: files, file_chunks, message_file_attachments';
PRINT '  - Created 7 indexes for performance optimization';
PRINT '  - Configured foreign keys with appropriate CASCADE rules';
PRINT '  - Ready for Fase 1 (File Management) implementation';
GO
