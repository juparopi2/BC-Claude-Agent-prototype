-- Migration: 011-add-content-hash.sql
-- Date: 2026-01-13
-- Purpose: Add content_hash column for duplicate file detection
--
-- This migration adds a SHA-256 content hash to the files table
-- to enable detection of duplicate files based on content.

SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

-- Add content_hash column to files table
-- SHA-256 produces a 64-character hexadecimal string
IF NOT EXISTS (
    SELECT * FROM sys.columns
    WHERE object_id = OBJECT_ID('files') AND name = 'content_hash'
)
BEGIN
    ALTER TABLE files
    ADD content_hash CHAR(64) NULL;
    PRINT 'Added column: content_hash';
END
GO

-- Create filtered index for fast duplicate lookups
-- Only indexes non-null hashes for non-folder files
IF NOT EXISTS (
    SELECT * FROM sys.indexes
    WHERE name = 'IX_files_user_content_hash' AND object_id = OBJECT_ID('files')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_files_user_content_hash
    ON files(user_id, content_hash)
    WHERE content_hash IS NOT NULL AND is_folder = 0;
    PRINT 'Created index: IX_files_user_content_hash';
END
GO

PRINT 'Migration 011-add-content-hash.sql completed successfully';
GO
