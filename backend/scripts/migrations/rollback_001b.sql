-- ============================================
-- Rollback Migration 001b: Fix Column Naming Mismatches
-- ============================================
-- Date: 2025-11-10
-- Purpose: Rollback column additions from migration 001b
--
-- WARNING: This will drop the new columns added in 001b.
-- Data in old columns (description, order_index, action_type, etc.)
-- will be preserved.
-- ============================================

SET NOCOUNT ON;
PRINT '';
PRINT '============================================';
PRINT 'Rollback Migration 001b';
PRINT '============================================';
PRINT '';
PRINT '⚠️  WARNING: This will drop columns added in migration 001b';
PRINT '⚠️  Original columns (description, action_type, etc.) will remain';
PRINT '';
GO

-- ============================================
-- TABLE: todos
-- ============================================
PRINT 'Rolling back todos table changes...';
PRINT '';

-- Drop index on [order] column if exists
IF EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('todos') AND name = 'idx_todos_order')
BEGIN
    DROP INDEX idx_todos_order ON todos;
    PRINT '  Dropped index: idx_todos_order';
END
GO

-- Drop 'content' column
IF EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('todos') AND name = 'content')
BEGIN
    ALTER TABLE todos DROP COLUMN content;
    PRINT '  Dropped column: content';
END
ELSE
BEGIN
    PRINT '  Column content does not exist (already rolled back)';
END
GO

-- Drop 'activeForm' column
IF EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('todos') AND name = 'activeForm')
BEGIN
    ALTER TABLE todos DROP COLUMN activeForm;
    PRINT '  Dropped column: activeForm';
END
ELSE
BEGIN
    PRINT '  Column activeForm does not exist (already rolled back)';
END
GO

-- Drop 'order' column
IF EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('todos') AND name = 'order')
BEGIN
    ALTER TABLE todos DROP COLUMN [order];
    PRINT '  Dropped column: order';
END
ELSE
BEGIN
    PRINT '  Column order does not exist (already rolled back)';
END
GO

-- Recreate index on order_index (original column)
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('todos') AND name = 'idx_todos_order_index')
BEGIN
    CREATE INDEX idx_todos_order_index ON todos(session_id, order_index);
    PRINT '  Recreated index: idx_todos_order_index (session_id, order_index)';
END
GO

PRINT '';
PRINT '✅ todos table rolled back';
PRINT '';
GO

-- ============================================
-- TABLE: approvals
-- ============================================
PRINT 'Rolling back approvals table changes...';
PRINT '';

-- Drop 'tool_name' column
IF EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('approvals') AND name = 'tool_name')
BEGIN
    ALTER TABLE approvals DROP COLUMN tool_name;
    PRINT '  Dropped column: tool_name';
END
ELSE
BEGIN
    PRINT '  Column tool_name does not exist (already rolled back)';
END
GO

-- Drop 'tool_args' column
IF EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('approvals') AND name = 'tool_args')
BEGIN
    ALTER TABLE approvals DROP COLUMN tool_args;
    PRINT '  Dropped column: tool_args';
END
ELSE
BEGIN
    PRINT '  Column tool_args does not exist (already rolled back)';
END
GO

-- Note: We do NOT drop expires_at as it was added in migration 001 (not 001b)
-- If you need to remove expires_at, use rollback_001.sql

PRINT '';
PRINT '✅ approvals table rolled back';
PRINT '';
GO

-- ============================================
-- TABLE: audit_log
-- ============================================
PRINT 'Rolling back audit_log table changes...';
PRINT '';

-- Drop 'event_type' column
IF EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('audit_log') AND name = 'event_type')
BEGIN
    ALTER TABLE audit_log DROP COLUMN event_type;
    PRINT '  Dropped column: event_type';
END
ELSE
BEGIN
    PRINT '  Column event_type does not exist (already rolled back)';
END
GO

-- Drop 'event_data' column
IF EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('audit_log') AND name = 'event_data')
BEGIN
    ALTER TABLE audit_log DROP COLUMN event_data;
    PRINT '  Dropped column: event_data';
END
ELSE
BEGIN
    PRINT '  Column event_data does not exist (already rolled back)';
END
GO

PRINT '';
PRINT '✅ audit_log table rolled back';
PRINT '';
GO

-- ============================================
-- VERIFICATION
-- ============================================
PRINT '============================================';
PRINT 'Verification';
PRINT '============================================';
PRINT '';

PRINT 'Remaining columns in todos:';
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'todos'
ORDER BY ORDINAL_POSITION;

PRINT '';
PRINT 'Remaining columns in approvals:';
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'approvals'
ORDER BY ORDINAL_POSITION;

PRINT '';
PRINT 'Remaining columns in audit_log:';
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'audit_log'
ORDER BY ORDINAL_POSITION;

PRINT '';
PRINT '============================================';
PRINT '✅ Rollback 001b completed successfully';
PRINT '============================================';
PRINT '';
PRINT 'Original columns have been preserved.';
PRINT 'Application code must now use the original column names:';
PRINT '  - todos: description, order_index';
PRINT '  - approvals: action_type, action_data';
PRINT '  - audit_log: action, details';
PRINT '';
GO
