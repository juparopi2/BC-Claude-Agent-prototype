-- ============================================
-- Migration 001b: Fix Column Naming Mismatches
-- ============================================
-- Date: 2025-11-10
-- Purpose: Align database column names with TypeScript types
--
-- This migration fixes naming mismatches between:
-- - SQL schema (snake_case, descriptive names)
-- - TypeScript types (camelCase, short names)
--
-- Affected tables:
-- - todos (content, activeForm, order)
-- - approvals (tool_name, tool_args, expires_at)
-- - audit_log (event_type, event_data)
-- ============================================

SET NOCOUNT ON;
PRINT '';
PRINT '============================================';
PRINT 'Migration 001b: Fix Column Naming Mismatches';
PRINT '============================================';
PRINT '';
GO

-- ============================================
-- TABLE: todos
-- ============================================
PRINT 'Fixing todos table...';
PRINT '';

-- Add 'content' column (maps to existing 'description')
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('todos') AND name = 'content')
BEGIN
    PRINT '  Adding column: content';
    ALTER TABLE todos ADD content NVARCHAR(500) NULL;

    -- Copy data from description
    UPDATE todos SET content = description WHERE content IS NULL;
    PRINT '  Data copied from description to content';

    -- Set NOT NULL constraint
    ALTER TABLE todos ALTER COLUMN content NVARCHAR(500) NOT NULL;
    PRINT '  Column content set to NOT NULL';
END
ELSE
BEGIN
    PRINT '  Column content already exists';
END
GO

-- Add 'activeForm' column (new - for present continuous form)
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('todos') AND name = 'activeForm')
BEGIN
    PRINT '  Adding column: activeForm';
    ALTER TABLE todos ADD activeForm NVARCHAR(500) NULL;

    -- Set default value based on description
    -- Example: "Create customer" -> "Creating customer"
    UPDATE todos
    SET activeForm = CASE
        WHEN description LIKE 'Create %' THEN REPLACE(description, 'Create', 'Creating')
        WHEN description LIKE 'Update %' THEN REPLACE(description, 'Update', 'Updating')
        WHEN description LIKE 'Delete %' THEN REPLACE(description, 'Delete', 'Deleting')
        WHEN description LIKE 'Query %' THEN REPLACE(description, 'Query', 'Querying')
        WHEN description LIKE 'Validate %' THEN REPLACE(description, 'Validate', 'Validating')
        WHEN description LIKE 'Generate %' THEN REPLACE(description, 'Generate', 'Generating')
        WHEN description LIKE 'Process %' THEN REPLACE(description, 'Process', 'Processing')
        ELSE description + '...'
    END
    WHERE activeForm IS NULL;
    PRINT '  Default activeForm values generated';

    -- Set NOT NULL constraint
    ALTER TABLE todos ALTER COLUMN activeForm NVARCHAR(500) NOT NULL;
    PRINT '  Column activeForm set to NOT NULL';
END
ELSE
BEGIN
    PRINT '  Column activeForm already exists';
END
GO

-- Add 'order' column (maps to existing 'order_index')
-- Note: [order] is a reserved word in SQL, so we use brackets
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('todos') AND name = 'order')
BEGIN
    PRINT '  Adding column: order';
    ALTER TABLE todos ADD [order] INT NULL;

    -- Copy data from order_index
    UPDATE todos SET [order] = order_index WHERE [order] IS NULL;
    PRINT '  Data copied from order_index to order';

    -- Set NOT NULL constraint
    ALTER TABLE todos ALTER COLUMN [order] INT NOT NULL;
    PRINT '  Column order set to NOT NULL';

    -- Recreate index with new column name
    IF EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('todos') AND name = 'idx_todos_order')
    BEGIN
        DROP INDEX idx_todos_order ON todos;
        PRINT '  Dropped old index: idx_todos_order';
    END

    CREATE INDEX idx_todos_order ON todos(session_id, [order]);
    PRINT '  Created new index: idx_todos_order (session_id, order)';
END
ELSE
BEGIN
    PRINT '  Column order already exists';
END
GO

PRINT '';
PRINT '✅ todos table fixed';
PRINT '';
GO

-- ============================================
-- TABLE: approvals
-- ============================================
PRINT 'Fixing approvals table...';
PRINT '';

-- Add 'tool_name' column (maps to existing 'action_type')
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('approvals') AND name = 'tool_name')
BEGIN
    PRINT '  Adding column: tool_name';
    ALTER TABLE approvals ADD tool_name NVARCHAR(100) NULL;

    -- Copy data from action_type
    UPDATE approvals SET tool_name = action_type WHERE tool_name IS NULL;
    PRINT '  Data copied from action_type to tool_name';

    -- Set NOT NULL constraint
    ALTER TABLE approvals ALTER COLUMN tool_name NVARCHAR(100) NOT NULL;
    PRINT '  Column tool_name set to NOT NULL';
END
ELSE
BEGIN
    PRINT '  Column tool_name already exists';
END
GO

-- Add 'tool_args' column (maps to existing 'action_data')
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('approvals') AND name = 'tool_args')
BEGIN
    PRINT '  Adding column: tool_args';
    ALTER TABLE approvals ADD tool_args NVARCHAR(MAX) NULL;

    -- Copy data from action_data
    UPDATE approvals SET tool_args = action_data WHERE tool_args IS NULL;
    PRINT '  Data copied from action_data to tool_args';

    -- Note: tool_args can be NULL (optional field)
END
ELSE
BEGIN
    PRINT '  Column tool_args already exists';
END
GO

-- Verify 'expires_at' column exists (should have been added in migration 001)
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('approvals') AND name = 'expires_at')
BEGIN
    PRINT '  ⚠️  WARNING: expires_at column missing! Adding now...';
    ALTER TABLE approvals ADD expires_at DATETIME2(7) NULL;

    -- Set default expiration to 30 minutes from creation
    UPDATE approvals
    SET expires_at = DATEADD(MINUTE, 30, created_at)
    WHERE expires_at IS NULL;
    PRINT '  Column expires_at added with default values';
END
ELSE
BEGIN
    PRINT '  Column expires_at already exists ✓';
END
GO

PRINT '';
PRINT '✅ approvals table fixed';
PRINT '';
GO

-- ============================================
-- TABLE: audit_log
-- ============================================
PRINT 'Fixing audit_log table...';
PRINT '';

-- Add 'event_type' column (maps to existing 'action')
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('audit_log') AND name = 'event_type')
BEGIN
    PRINT '  Adding column: event_type';
    ALTER TABLE audit_log ADD event_type NVARCHAR(100) NULL;

    -- Copy data from action
    UPDATE audit_log SET event_type = action WHERE event_type IS NULL;
    PRINT '  Data copied from action to event_type';

    -- Set NOT NULL constraint
    ALTER TABLE audit_log ALTER COLUMN event_type NVARCHAR(100) NOT NULL;
    PRINT '  Column event_type set to NOT NULL';
END
ELSE
BEGIN
    PRINT '  Column event_type already exists';
END
GO

-- Add 'event_data' column (maps to existing 'details')
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('audit_log') AND name = 'event_data')
BEGIN
    PRINT '  Adding column: event_data';
    ALTER TABLE audit_log ADD event_data NVARCHAR(MAX) NULL;

    -- Copy data from details
    UPDATE audit_log SET event_data = details WHERE event_data IS NULL;
    PRINT '  Data copied from details to event_data';

    -- Note: event_data can be NULL (optional field)
END
ELSE
BEGIN
    PRINT '  Column event_data already exists';
END
GO

PRINT '';
PRINT '✅ audit_log table fixed';
PRINT '';
GO

-- ============================================
-- VERIFICATION
-- ============================================
PRINT '============================================';
PRINT 'Verification';
PRINT '============================================';
PRINT '';

-- Check todos table
PRINT 'Checking todos table columns:';
SELECT
    'todos' AS [Table],
    COUNT(CASE WHEN COLUMN_NAME = 'content' THEN 1 END) AS has_content,
    COUNT(CASE WHEN COLUMN_NAME = 'activeForm' THEN 1 END) AS has_activeForm,
    COUNT(CASE WHEN COLUMN_NAME = 'order' THEN 1 END) AS has_order
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'todos';

-- Check approvals table
PRINT '';
PRINT 'Checking approvals table columns:';
SELECT
    'approvals' AS [Table],
    COUNT(CASE WHEN COLUMN_NAME = 'tool_name' THEN 1 END) AS has_tool_name,
    COUNT(CASE WHEN COLUMN_NAME = 'tool_args' THEN 1 END) AS has_tool_args,
    COUNT(CASE WHEN COLUMN_NAME = 'expires_at' THEN 1 END) AS has_expires_at
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'approvals';

-- Check audit_log table
PRINT '';
PRINT 'Checking audit_log table columns:';
SELECT
    'audit_log' AS [Table],
    COUNT(CASE WHEN COLUMN_NAME = 'event_type' THEN 1 END) AS has_event_type,
    COUNT(CASE WHEN COLUMN_NAME = 'event_data' THEN 1 END) AS has_event_data
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'audit_log';

PRINT '';
PRINT '============================================';
PRINT '✅ Migration 001b completed successfully';
PRINT '============================================';
PRINT '';
PRINT 'Next steps:';
PRINT '1. Verify application code works with new columns';
PRINT '2. Consider removing old columns after validation:';
PRINT '   - todos: description, order_index';
PRINT '   - approvals: action_type, action_data';
PRINT '   - audit_log: action, details';
PRINT '';
GO
