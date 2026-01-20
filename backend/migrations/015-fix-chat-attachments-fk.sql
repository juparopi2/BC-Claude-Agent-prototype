-- Migration: 015-fix-chat-attachments-fk.sql
-- Date: 2026-01-20
-- Purpose: Fix foreign key cascade conflict in chat_attachments table
--
-- Problem: SQL Server rejected dual CASCADE paths to users table:
--   Path 1: users -> sessions -> chat_attachments
--   Path 2: users -> chat_attachments (direct)
--
-- Solution: Remove direct FK to users, keep FK to sessions only.
-- The cascade chain users -> sessions -> chat_attachments handles deletion correctly.
-- Column user_id remains for multi-tenant queries (denormalization for performance).

-- Required for Azure SQL DDL operations
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

USE [sqldb-bcagent-dev];
GO

-- =============================================
-- Step 1: Drop conflicting FK to users
-- =============================================
IF EXISTS (
    SELECT * FROM sys.foreign_keys
    WHERE name = 'FK_chat_attachments_user'
    AND parent_object_id = OBJECT_ID('chat_attachments')
)
BEGIN
    ALTER TABLE chat_attachments
    DROP CONSTRAINT FK_chat_attachments_user;

    PRINT 'Dropped constraint: FK_chat_attachments_user';
END
ELSE
BEGIN
    PRINT 'Constraint does not exist: FK_chat_attachments_user (already removed)';
END
GO

-- =============================================
-- Step 2: Add FK to sessions (clean cascade path)
-- =============================================
IF NOT EXISTS (
    SELECT * FROM sys.foreign_keys
    WHERE name = 'FK_chat_attachments_session'
    AND parent_object_id = OBJECT_ID('chat_attachments')
)
BEGIN
    ALTER TABLE chat_attachments
    ADD CONSTRAINT FK_chat_attachments_session
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;

    PRINT 'Created constraint: FK_chat_attachments_session';
END
ELSE
BEGIN
    PRINT 'Constraint already exists: FK_chat_attachments_session';
END
GO

-- =============================================
-- Verification
-- =============================================
PRINT '';
PRINT '=== Verifying foreign keys on chat_attachments ===';

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
PRINT 'Migration 015-fix-chat-attachments-fk.sql completed successfully';
PRINT '';
PRINT 'Summary:';
PRINT '  - Removed FK_chat_attachments_user (caused cascade conflict)';
PRINT '  - Added FK_chat_attachments_session (clean cascade path)';
PRINT '  - user_id column retained for multi-tenant query performance';
PRINT '  - Cascade chain: users -> sessions -> chat_attachments';
GO
