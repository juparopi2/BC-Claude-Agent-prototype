-- Migration: 013-create-user-settings.sql
-- Date: 2026-01-20
-- Purpose: User preferences and settings persistence

-- Required for Azure SQL DDL operations
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

USE [sqldb-bcagent-dev];
GO

-- =============================================
-- Step 1: Create user_settings table
-- =============================================
IF NOT EXISTS (
    SELECT * FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME = 'user_settings'
)
BEGIN
    CREATE TABLE user_settings (
        -- Primary key
        id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),

        -- User reference
        user_id UNIQUEIDENTIFIER NOT NULL,

        -- Theme preference (light, dark, system)
        -- CHECK constraint matches SETTINGS_THEME values in shared package
        theme NVARCHAR(20) NOT NULL DEFAULT 'system',

        -- Extensible JSON for future settings
        preferences NVARCHAR(MAX) NULL,

        -- Timestamps
        created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),

        -- Constraints
        CONSTRAINT PK_user_settings PRIMARY KEY (id),
        CONSTRAINT FK_user_settings_user FOREIGN KEY (user_id)
            REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT UQ_user_settings_user UNIQUE (user_id),
        CONSTRAINT CK_user_settings_theme CHECK (theme IN ('light', 'dark', 'system'))
    );

    PRINT 'Created table: user_settings';
END
ELSE
BEGIN
    PRINT 'Table already exists: user_settings';
END
GO

-- =============================================
-- Step 2: Create index for user lookup
-- =============================================
IF NOT EXISTS (
    SELECT * FROM sys.indexes
    WHERE name = 'IX_user_settings_user_id' AND object_id = OBJECT_ID('user_settings')
)
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX IX_user_settings_user_id
    ON user_settings(user_id);
    PRINT 'Created index: IX_user_settings_user_id';
END
ELSE
BEGIN
    PRINT 'Index already exists: IX_user_settings_user_id';
END
GO

-- =============================================
-- Verification
-- =============================================
PRINT '';
PRINT '=== Verifying user_settings table schema ===';

SELECT
    COLUMN_NAME,
    DATA_TYPE,
    CHARACTER_MAXIMUM_LENGTH,
    IS_NULLABLE,
    COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'user_settings'
ORDER BY ORDINAL_POSITION;

PRINT '';
PRINT '=== Verifying indexes ===';

SELECT
    i.name AS IndexName,
    i.type_desc AS IndexType
FROM sys.indexes i
WHERE i.object_id = OBJECT_ID('user_settings')
    AND i.name IS NOT NULL
ORDER BY i.name;

GO

PRINT '';
PRINT 'Migration 013-create-user-settings.sql completed successfully';
PRINT '';
PRINT 'Summary:';
PRINT '  - Created user_settings table for user preferences';
PRINT '  - Theme supports: light, dark, system (CHECK constraint)';
PRINT '  - One-to-one relationship with users table (CASCADE delete)';
PRINT '  - Extensible preferences JSON column for future settings';
GO
