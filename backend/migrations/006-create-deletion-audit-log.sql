-- Migration: 006-create-deletion-audit-log.sql
-- Date: 2025-12-12
-- Purpose: Create deletion_audit_log table for GDPR compliance
-- Reason:
--   - GDPR Article 17: Right to Erasure - track all deletion requests
--   - GDPR Article 30: Records of Processing Activities - maintain audit trail
--   - Multi-storage cascade tracking: DB, Blob, AI Search, Cache

-- Required for Azure SQL DDL operations
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

USE [sqldb-bcagent-dev];
GO

-- =============================================
-- Step 1: Create deletion_audit_log table
-- =============================================
IF NOT EXISTS (
    SELECT * FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME = 'deletion_audit_log'
)
BEGIN
    CREATE TABLE deletion_audit_log (
        -- Primary key
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),

        -- User who owns the deleted resource
        user_id UNIQUEIDENTIFIER NOT NULL,

        -- Resource identification
        resource_type NVARCHAR(50) NOT NULL,       -- 'file', 'folder', 'user_account', 'session'
        resource_id UNIQUEIDENTIFIER NOT NULL,     -- ID of deleted resource
        resource_name NVARCHAR(500) NULL,          -- Original name (for audit readability)

        -- Deletion context
        deletion_reason NVARCHAR(255) NULL,        -- 'user_request', 'gdpr_erasure', 'retention_policy', 'admin_action'
        requested_by NVARCHAR(255) NULL,           -- Who initiated (user_id or 'system' or 'admin')

        -- Multi-storage cascade tracking
        deleted_from_db BIT DEFAULT 0,             -- Database record deleted
        deleted_from_blob BIT DEFAULT 0,           -- Azure Blob Storage file deleted
        deleted_from_search BIT DEFAULT 0,         -- Azure AI Search embeddings deleted
        deleted_from_cache BIT DEFAULT 0,          -- Redis cache cleared

        -- Child resource tracking (for folder deletion)
        child_files_deleted INT DEFAULT 0,         -- Number of child files deleted
        child_chunks_deleted INT DEFAULT 0,        -- Number of chunks deleted (CASCADE)

        -- Timing
        requested_at DATETIME2 DEFAULT GETUTCDATE(),
        completed_at DATETIME2 NULL,

        -- Status tracking
        status NVARCHAR(50) DEFAULT 'pending',     -- 'pending', 'in_progress', 'completed', 'partial', 'failed'
        error_details NVARCHAR(MAX) NULL,          -- JSON with error info if failed

        -- Metadata
        metadata NVARCHAR(MAX) NULL                -- JSON for additional context (e.g., original file size, mime_type)
    );

    PRINT 'Created table: deletion_audit_log';
END
ELSE
BEGIN
    PRINT 'Table already exists: deletion_audit_log';
END
GO

-- =============================================
-- Step 2: Create indexes for common queries
-- =============================================

-- Index for querying by user (GDPR data subject requests)
IF NOT EXISTS (
    SELECT * FROM sys.indexes
    WHERE name = 'IX_deletion_audit_user_id' AND object_id = OBJECT_ID('deletion_audit_log')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_deletion_audit_user_id
    ON deletion_audit_log(user_id, requested_at DESC);
    PRINT 'Created index: IX_deletion_audit_user_id';
END
ELSE
BEGIN
    PRINT 'Index already exists: IX_deletion_audit_user_id';
END
GO

-- Index for querying by status (for monitoring/cleanup)
IF NOT EXISTS (
    SELECT * FROM sys.indexes
    WHERE name = 'IX_deletion_audit_status' AND object_id = OBJECT_ID('deletion_audit_log')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_deletion_audit_status
    ON deletion_audit_log(status, requested_at DESC);
    PRINT 'Created index: IX_deletion_audit_status';
END
ELSE
BEGIN
    PRINT 'Index already exists: IX_deletion_audit_status';
END
GO

-- Index for querying by resource type (for compliance reports)
IF NOT EXISTS (
    SELECT * FROM sys.indexes
    WHERE name = 'IX_deletion_audit_resource_type' AND object_id = OBJECT_ID('deletion_audit_log')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_deletion_audit_resource_type
    ON deletion_audit_log(resource_type, requested_at DESC);
    PRINT 'Created index: IX_deletion_audit_resource_type';
END
ELSE
BEGIN
    PRINT 'Index already exists: IX_deletion_audit_resource_type';
END
GO

-- =============================================
-- Step 3: Add foreign key to users table (optional)
-- Note: We don't add FK because user might be deleted too
-- =============================================
-- No FK constraint - user_id is for audit only, may reference deleted users

-- =============================================
-- Verification
-- =============================================
PRINT '';
PRINT '=== Verifying deletion_audit_log table schema ===';

SELECT
    COLUMN_NAME,
    DATA_TYPE,
    CHARACTER_MAXIMUM_LENGTH,
    IS_NULLABLE,
    COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'deletion_audit_log'
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
WHERE i.object_id = OBJECT_ID('deletion_audit_log')
    AND i.name IS NOT NULL
ORDER BY i.name;

GO

PRINT '';
PRINT 'Migration 006-create-deletion-audit-log.sql completed successfully';
PRINT '';
PRINT 'Summary:';
PRINT '  - Created deletion_audit_log table for GDPR compliance';
PRINT '  - Tracks multi-storage cascade deletion (DB, Blob, AI Search, Cache)';
PRINT '  - Indexes for user, status, and resource_type queries';
PRINT '  - No FK constraint on user_id (allows tracking deleted user data)';
GO
