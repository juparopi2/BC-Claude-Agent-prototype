-- ============================================
-- BC Claude Agent - Rollback Migration 001
-- ============================================
-- Rolls back changes from migration 001:
--   - Drops todos table
--   - Drops tool_permissions table
--   - Drops permission_presets table
--   - Removes added columns from existing tables
--   - Drops related views, triggers, and procedures
--
-- ⚠️  WARNING: This will delete all data in these tables!
-- ⚠️  Backup your database before running this script!
-- ============================================

-- Safety check
PRINT '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
PRINT '⚠️  ROLLBACK SCRIPT - Migration 001';
PRINT '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
PRINT '';
PRINT '⚠️  WARNING: This will delete the following:';
PRINT '   - todos table and all todo data';
PRINT '   - tool_permissions table and all permission data';
PRINT '   - permission_presets table and all preset data';
PRINT '   - Enhanced columns from existing tables';
PRINT '';
PRINT 'Make sure you have backed up your database!';
PRINT '';
PRINT 'To proceed, uncomment the RETURN statement below:';
PRINT '';

-- Uncomment the next line to prevent accidental execution
RETURN;

GO

PRINT 'Starting rollback...';
PRINT '';

-- ============================================
-- Drop Views (Migration 001)
-- ============================================
IF EXISTS (SELECT * FROM sys.views WHERE name = 'vw_active_todos')
BEGIN
    DROP VIEW vw_active_todos;
    PRINT '✅ Dropped view: vw_active_todos';
END

IF EXISTS (SELECT * FROM sys.views WHERE name = 'vw_user_permissions')
BEGIN
    DROP VIEW vw_user_permissions;
    PRINT '✅ Dropped view: vw_user_permissions';
END

PRINT '';

-- ============================================
-- Drop Stored Procedures (Migration 001)
-- ============================================
IF EXISTS (SELECT * FROM sys.procedures WHERE name = 'sp_apply_permission_preset')
BEGIN
    DROP PROCEDURE sp_apply_permission_preset;
    PRINT '✅ Dropped procedure: sp_apply_permission_preset';
END

PRINT '';

-- ============================================
-- Drop Triggers (Migration 001)
-- ============================================
IF EXISTS (SELECT * FROM sys.triggers WHERE name = 'trg_permission_presets_updated_at')
BEGIN
    DROP TRIGGER trg_permission_presets_updated_at;
    PRINT '✅ Dropped trigger: trg_permission_presets_updated_at';
END

IF EXISTS (SELECT * FROM sys.triggers WHERE name = 'trg_tool_permissions_updated_at')
BEGIN
    DROP TRIGGER trg_tool_permissions_updated_at;
    PRINT '✅ Dropped trigger: trg_tool_permissions_updated_at';
END

PRINT '';

-- ============================================
-- Drop Tables (Migration 001)
-- ============================================
-- Drop todos table
IF EXISTS (SELECT * FROM sys.tables WHERE name = 'todos')
BEGIN
    -- First drop foreign key to parent_todo_id (self-reference)
    DECLARE @fk_name NVARCHAR(255);
    SELECT @fk_name = name
    FROM sys.foreign_keys
    WHERE parent_object_id = OBJECT_ID('todos')
    AND referenced_object_id = OBJECT_ID('todos');

    IF @fk_name IS NOT NULL
    BEGIN
        EXEC('ALTER TABLE todos DROP CONSTRAINT ' + @fk_name);
        PRINT '✅ Dropped self-referencing FK on todos';
    END

    DROP TABLE todos;
    PRINT '✅ Dropped table: todos';
END

-- Drop tool_permissions table
IF EXISTS (SELECT * FROM sys.tables WHERE name = 'tool_permissions')
BEGIN
    DROP TABLE tool_permissions;
    PRINT '✅ Dropped table: tool_permissions';
END

-- Drop permission_presets table
IF EXISTS (SELECT * FROM sys.tables WHERE name = 'permission_presets')
BEGIN
    DROP TABLE permission_presets;
    PRINT '✅ Dropped table: permission_presets';
END

PRINT '';

-- ============================================
-- Remove Enhanced Columns
-- ============================================

-- Remove columns from audit_log
IF EXISTS (
    SELECT * FROM sys.columns
    WHERE object_id = OBJECT_ID('audit_log')
    AND name = 'correlation_id'
)
BEGIN
    -- Drop index first
    IF EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_audit_correlation' AND object_id = OBJECT_ID('audit_log'))
    BEGIN
        DROP INDEX idx_audit_correlation ON audit_log;
    END

    ALTER TABLE audit_log DROP COLUMN correlation_id, duration_ms;
    PRINT '✅ Removed columns: audit_log.correlation_id, audit_log.duration_ms';
END

-- Remove columns from approvals
IF EXISTS (
    SELECT * FROM sys.columns
    WHERE object_id = OBJECT_ID('approvals')
    AND name = 'expires_at'
)
BEGIN
    -- Drop index and constraint first
    IF EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_approvals_priority' AND object_id = OBJECT_ID('approvals'))
    BEGIN
        DROP INDEX idx_approvals_priority ON approvals;
    END

    IF EXISTS (SELECT * FROM sys.check_constraints WHERE name = 'chk_approvals_priority')
    BEGIN
        ALTER TABLE approvals DROP CONSTRAINT chk_approvals_priority;
    END

    ALTER TABLE approvals DROP COLUMN priority, expires_at;
    PRINT '✅ Removed columns: approvals.priority, approvals.expires_at';
END

-- Remove columns from messages
IF EXISTS (
    SELECT * FROM sys.columns
    WHERE object_id = OBJECT_ID('messages')
    AND name = 'is_thinking'
)
BEGIN
    -- Drop index first
    IF EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_messages_is_thinking' AND object_id = OBJECT_ID('messages'))
    BEGIN
        DROP INDEX idx_messages_is_thinking ON messages;
    END

    ALTER TABLE messages DROP COLUMN thinking_tokens, is_thinking;
    PRINT '✅ Removed columns: messages.thinking_tokens, messages.is_thinking';
END

-- Remove columns from sessions
IF EXISTS (
    SELECT * FROM sys.columns
    WHERE object_id = OBJECT_ID('sessions')
    AND name = 'token_count'
)
BEGIN
    -- Drop indexes and constraints first
    IF EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_sessions_status' AND object_id = OBJECT_ID('sessions'))
    BEGIN
        DROP INDEX idx_sessions_status ON sessions;
    END

    IF EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_sessions_last_activity' AND object_id = OBJECT_ID('sessions'))
    BEGIN
        DROP INDEX idx_sessions_last_activity ON sessions;
    END

    IF EXISTS (SELECT * FROM sys.check_constraints WHERE name = 'chk_sessions_status')
    BEGIN
        ALTER TABLE sessions DROP CONSTRAINT chk_sessions_status;
    END

    ALTER TABLE sessions DROP COLUMN goal, status, last_activity_at, token_count;
    PRINT '✅ Removed columns: sessions.goal, sessions.status, sessions.last_activity_at, sessions.token_count';
END

-- Remove role column from users
IF EXISTS (
    SELECT * FROM sys.columns
    WHERE object_id = OBJECT_ID('users')
    AND name = 'role'
)
BEGIN
    -- Drop index and constraint first
    IF EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_users_role' AND object_id = OBJECT_ID('users'))
    BEGIN
        DROP INDEX idx_users_role ON users;
    END

    IF EXISTS (SELECT * FROM sys.check_constraints WHERE name = 'chk_users_role')
    BEGIN
        ALTER TABLE users DROP CONSTRAINT chk_users_role;
    END

    ALTER TABLE users DROP COLUMN role;
    PRINT '✅ Removed column: users.role';
END

PRINT '';

-- ============================================
-- Final Summary
-- ============================================
PRINT '';
PRINT '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
PRINT '✅ Rollback of Migration 001 completed';
PRINT '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
PRINT '';
PRINT 'The following have been removed:';
PRINT '  - 3 tables (todos, tool_permissions, permission_presets)';
PRINT '  - 2 views (vw_active_todos, vw_user_permissions)';
PRINT '  - 1 stored procedure (sp_apply_permission_preset)';
PRINT '  - 2 triggers';
PRINT '  - Enhanced columns from existing tables';
PRINT '';
PRINT 'Database is now in pre-migration 001 state';
PRINT '';

GO
