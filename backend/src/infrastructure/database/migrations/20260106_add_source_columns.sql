-- Migration: Add source abstraction columns for Visual Representation
-- Date: 2026-01-06
-- Description: Adds source type system to files table and creates message_citations table
-- Safety: All changes are additive with defaults (non-breaking)

-- ============================================================================
-- PHASE 1: Files table extension
-- ============================================================================

-- Add source_type column (default to blob_storage for existing rows)
-- This indicates where the file originates from (Azure Blob, SharePoint, etc.)
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('files') AND name = 'source_type')
BEGIN
    ALTER TABLE files ADD source_type VARCHAR(50) NOT NULL DEFAULT 'blob_storage';
    PRINT 'Added source_type column to files table';
END
ELSE
    PRINT 'source_type column already exists in files table';
GO

-- Add external_id for future SharePoint/OneDrive integration
-- Stores the external system's ID for this file
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('files') AND name = 'external_id')
BEGIN
    ALTER TABLE files ADD external_id VARCHAR(512) NULL;
    PRINT 'Added external_id column to files table';
END
ELSE
    PRINT 'external_id column already exists in files table';
GO

-- Add external_metadata as JSON for provider-specific data
-- Stores additional metadata from external systems (e.g., SharePoint permissions)
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('files') AND name = 'external_metadata')
BEGIN
    ALTER TABLE files ADD external_metadata NVARCHAR(MAX) NULL;
    PRINT 'Added external_metadata column to files table';
END
ELSE
    PRINT 'external_metadata column already exists in files table';
GO

-- Add last_synced_at for cache invalidation
-- Tracks when the file was last synchronized with external source
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('files') AND name = 'last_synced_at')
BEGIN
    ALTER TABLE files ADD last_synced_at DATETIME2 NULL;
    PRINT 'Added last_synced_at column to files table';
END
ELSE
    PRINT 'last_synced_at column already exists in files table';
GO

-- Create index for filtering by source type (multi-tenant aware)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('files') AND name = 'IX_files_source_type')
BEGIN
    CREATE INDEX IX_files_source_type ON files(user_id, source_type);
    PRINT 'Created IX_files_source_type index';
END
ELSE
    PRINT 'IX_files_source_type index already exists';
GO

-- ============================================================================
-- PHASE 2: Message citations table (analytics + tombstone pattern)
-- ============================================================================

-- Create message_citations table if it doesn't exist
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'message_citations')
BEGIN
    CREATE TABLE message_citations (
        -- Primary key
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),

        -- Foreign keys
        message_id UNIQUEIDENTIFIER NOT NULL,
        -- file_id is nullable for tombstone pattern (ON DELETE SET NULL)
        file_id UNIQUEIDENTIFIER NULL,

        -- Snapshotted metadata (preserved even if file is deleted)
        file_name NVARCHAR(512) NOT NULL,
        source_type VARCHAR(50) NOT NULL,
        mime_type VARCHAR(100) NOT NULL,
        relevance_score DECIMAL(5,4) NOT NULL,
        is_image BIT NOT NULL DEFAULT 0,
        excerpt_count INT NOT NULL DEFAULT 0,

        -- Timestamps
        created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
    );
    PRINT 'Created message_citations table';

    -- Add foreign key constraint for file_id with ON DELETE SET NULL
    ALTER TABLE message_citations
    ADD CONSTRAINT FK_message_citations_files
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE SET NULL;
    PRINT 'Added FK_message_citations_files constraint';

    -- Create indexes
    CREATE INDEX IX_message_citations_message ON message_citations(message_id);
    PRINT 'Created IX_message_citations_message index';

    CREATE INDEX IX_message_citations_file ON message_citations(file_id);
    PRINT 'Created IX_message_citations_file index';

    CREATE INDEX IX_message_citations_created ON message_citations(created_at);
    PRINT 'Created IX_message_citations_created index';
END
ELSE
    PRINT 'message_citations table already exists';
GO

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Verify files table columns
SELECT
    'files' as table_name,
    c.name as column_name,
    t.name as data_type,
    c.is_nullable
FROM sys.columns c
JOIN sys.types t ON c.user_type_id = t.user_type_id
WHERE c.object_id = OBJECT_ID('files')
AND c.name IN ('source_type', 'external_id', 'external_metadata', 'last_synced_at')
ORDER BY c.name;

-- Verify message_citations table exists and has correct structure
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'message_citations')
BEGIN
    SELECT
        'message_citations' as table_name,
        c.name as column_name,
        t.name as data_type,
        c.is_nullable
    FROM sys.columns c
    JOIN sys.types t ON c.user_type_id = t.user_type_id
    WHERE c.object_id = OBJECT_ID('message_citations')
    ORDER BY c.column_id;
END

PRINT 'Migration completed successfully';
GO
