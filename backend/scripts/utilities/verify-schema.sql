-- ============================================
-- BC Claude Agent - Schema Verification
-- ============================================
-- Verifies that all required database objects exist
-- Run this script to check database health
-- ============================================

SET NOCOUNT ON;
GO

PRINT '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
PRINT 'BC Claude Agent - Schema Verification';
PRINT '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
PRINT '';

-- ============================================
-- Check Database Engine
-- ============================================
DECLARE @engine_edition INT = SERVERPROPERTY('EngineEdition');
DECLARE @product_version NVARCHAR(50) = CAST(SERVERPROPERTY('ProductVersion') AS NVARCHAR(50));

PRINT '📊 Database Information:';
PRINT '   Engine: ' + CASE @engine_edition
    WHEN 5 THEN 'Azure SQL Database'
    WHEN 8 THEN 'Azure SQL Managed Instance'
    ELSE 'SQL Server (On-premise)'
END;
PRINT '   Version: ' + @product_version;
PRINT '   Database: ' + DB_NAME();
PRINT '';

-- ============================================
-- Check Tables
-- ============================================
PRINT '📋 Checking Tables...';
PRINT '';

DECLARE @missing_tables TABLE (table_name NVARCHAR(128));
DECLARE @expected_tables TABLE (table_name NVARCHAR(128));

INSERT INTO @expected_tables VALUES
-- Core tables (init-db.sql)
('users'),
('sessions'),
('messages'),
('approvals'),
('checkpoints'),
('audit_log'),
('refresh_tokens'),
-- Migration 001
('todos'),
('tool_permissions'),
('permission_presets'),
-- Migration 002
('agent_executions'),
('mcp_tool_calls'),
('session_files'),
('performance_metrics'),
('error_logs');

INSERT INTO @missing_tables
SELECT table_name
FROM @expected_tables
WHERE table_name NOT IN (
    SELECT TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_TYPE = 'BASE TABLE'
);

IF EXISTS (SELECT * FROM @missing_tables)
BEGIN
    PRINT '❌ Missing Tables:';
    SELECT '   - ' + table_name AS missing_table FROM @missing_tables;
    PRINT '';
END
ELSE
BEGIN
    PRINT '✅ All 15 required tables exist';
    PRINT '';
END

-- ============================================
-- Check Views
-- ============================================
PRINT '👁️  Checking Views...';
PRINT '';

DECLARE @missing_views TABLE (view_name NVARCHAR(128));
DECLARE @expected_views TABLE (view_name NVARCHAR(128));

INSERT INTO @expected_views VALUES
-- Core views
('vw_active_sessions'),
('vw_pending_approvals'),
-- Migration 001 views
('vw_user_permissions'),
('vw_active_todos'),
-- Migration 002 views
('vw_agent_performance'),
('vw_mcp_tool_usage'),
('vw_recent_errors'),
('vw_session_activity');

INSERT INTO @missing_views
SELECT view_name
FROM @expected_views
WHERE view_name NOT IN (
    SELECT TABLE_NAME
    FROM INFORMATION_SCHEMA.VIEWS
);

IF EXISTS (SELECT * FROM @missing_views)
BEGIN
    PRINT '❌ Missing Views:';
    SELECT '   - ' + view_name AS missing_view FROM @missing_views;
    PRINT '';
END
ELSE
BEGIN
    PRINT '✅ All 8 required views exist';
    PRINT '';
END

-- ============================================
-- Check Stored Procedures
-- ============================================
PRINT '⚙️  Checking Stored Procedures...';
PRINT '';

DECLARE @missing_procs TABLE (proc_name NVARCHAR(128));
DECLARE @expected_procs TABLE (proc_name NVARCHAR(128));

INSERT INTO @expected_procs VALUES
-- Core procedures
('sp_cleanup_old_data'),
-- Migration 001 procedures
('sp_apply_permission_preset'),
-- Migration 002 procedures
('sp_get_agent_timeline'),
('sp_get_error_summary'),
('sp_archive_observability_data');

INSERT INTO @missing_procs
SELECT proc_name
FROM @expected_procs
WHERE proc_name NOT IN (
    SELECT ROUTINE_NAME
    FROM INFORMATION_SCHEMA.ROUTINES
    WHERE ROUTINE_TYPE = 'PROCEDURE'
);

IF EXISTS (SELECT * FROM @missing_procs)
BEGIN
    PRINT '❌ Missing Stored Procedures:';
    SELECT '   - ' + proc_name AS missing_proc FROM @missing_procs;
    PRINT '';
END
ELSE
BEGIN
    PRINT '✅ All 5 required stored procedures exist';
    PRINT '';
END

-- ============================================
-- Check Triggers
-- ============================================
PRINT '⚡ Checking Triggers...';
PRINT '';

DECLARE @missing_triggers TABLE (trigger_name NVARCHAR(128));
DECLARE @expected_triggers TABLE (trigger_name NVARCHAR(128));

INSERT INTO @expected_triggers VALUES
('trg_users_updated_at'),
('trg_sessions_updated_at'),
('trg_tool_permissions_updated_at'),
('trg_permission_presets_updated_at');

INSERT INTO @missing_triggers
SELECT trigger_name
FROM @expected_triggers
WHERE trigger_name NOT IN (
    SELECT name
    FROM sys.triggers
);

IF EXISTS (SELECT * FROM @missing_triggers)
BEGIN
    PRINT '❌ Missing Triggers:';
    SELECT '   - ' + trigger_name AS missing_trigger FROM @missing_triggers;
    PRINT '';
END
ELSE
BEGIN
    PRINT '✅ All 4 required triggers exist';
    PRINT '';
END

-- ============================================
-- Check Foreign Keys
-- ============================================
PRINT '🔗 Checking Foreign Key Constraints...';
PRINT '';

DECLARE @fk_count INT = (
    SELECT COUNT(*)
    FROM sys.foreign_keys
);

IF @fk_count >= 15
BEGIN
    PRINT '✅ Foreign key constraints: ' + CAST(@fk_count AS VARCHAR) + ' (expected ≥15)';
END
ELSE
BEGIN
    PRINT '⚠️  Foreign key constraints: ' + CAST(@fk_count AS VARCHAR) + ' (expected ≥15)';
END
PRINT '';

-- ============================================
-- Check Indexes
-- ============================================
PRINT '📇 Checking Indexes...';
PRINT '';

DECLARE @index_count INT = (
    SELECT COUNT(*)
    FROM sys.indexes
    WHERE type IN (1, 2) -- Clustered and Non-clustered
    AND is_primary_key = 0 -- Exclude PK
    AND object_id IN (
        SELECT object_id
        FROM sys.tables
    )
);

IF @index_count >= 40
BEGIN
    PRINT '✅ Non-PK indexes: ' + CAST(@index_count AS VARCHAR) + ' (expected ≥40)';
END
ELSE
BEGIN
    PRINT '⚠️  Non-PK indexes: ' + CAST(@index_count AS VARCHAR) + ' (expected ≥40)';
    PRINT '   Consider running missing index recommendations';
END
PRINT '';

-- ============================================
-- Check Check Constraints
-- ============================================
PRINT '✔️  Checking CHECK Constraints...';
PRINT '';

DECLARE @check_count INT = (
    SELECT COUNT(*)
    FROM sys.check_constraints
);

IF @check_count >= 10
BEGIN
    PRINT '✅ Check constraints: ' + CAST(@check_count AS VARCHAR) + ' (expected ≥10)';
END
ELSE
BEGIN
    PRINT '⚠️  Check constraints: ' + CAST(@check_count AS VARCHAR) + ' (expected ≥10)';
END
PRINT '';

-- ============================================
-- Check Data
-- ============================================
PRINT '💾 Checking Data...';
PRINT '';

DECLARE @user_count INT = (SELECT COUNT(*) FROM users WHERE 1=1);
DECLARE @session_count INT = (SELECT COUNT(*) FROM sessions WHERE 1=1);
DECLARE @message_count INT = (SELECT COUNT(*) FROM messages WHERE 1=1);

PRINT '   Users: ' + CAST(@user_count AS VARCHAR);
PRINT '   Sessions: ' + CAST(@session_count AS VARCHAR);
PRINT '   Messages: ' + CAST(@message_count AS VARCHAR);

IF @user_count = 0
BEGIN
    PRINT '   ⚠️  No users found - consider running seed-data.sql';
END

PRINT '';

-- ============================================
-- Check Column Enhancements (Migration 001)
-- ============================================
PRINT '🔧 Checking Column Enhancements...';
PRINT '';

DECLARE @missing_columns TABLE (table_name NVARCHAR(128), column_name NVARCHAR(128));

-- Check users.role
IF NOT EXISTS (
    SELECT * FROM sys.columns
    WHERE object_id = OBJECT_ID('users')
    AND name = 'role'
)
    INSERT INTO @missing_columns VALUES ('users', 'role');

-- Check sessions.goal
IF NOT EXISTS (
    SELECT * FROM sys.columns
    WHERE object_id = OBJECT_ID('sessions')
    AND name = 'goal'
)
    INSERT INTO @missing_columns VALUES ('sessions', 'goal');

-- Check sessions.status
IF NOT EXISTS (
    SELECT * FROM sys.columns
    WHERE object_id = OBJECT_ID('sessions')
    AND name = 'status'
)
    INSERT INTO @missing_columns VALUES ('sessions', 'status');

-- Check messages.thinking_tokens
IF NOT EXISTS (
    SELECT * FROM sys.columns
    WHERE object_id = OBJECT_ID('messages')
    AND name = 'thinking_tokens'
)
    INSERT INTO @missing_columns VALUES ('messages', 'thinking_tokens');

-- Check approvals.priority
IF NOT EXISTS (
    SELECT * FROM sys.columns
    WHERE object_id = OBJECT_ID('approvals')
    AND name = 'priority'
)
    INSERT INTO @missing_columns VALUES ('approvals', 'priority');

IF EXISTS (SELECT * FROM @missing_columns)
BEGIN
    PRINT '❌ Missing Enhanced Columns:';
    SELECT '   - ' + table_name + '.' + column_name AS missing_column FROM @missing_columns;
    PRINT '   Run migration 001_add_todos_and_permissions.sql';
    PRINT '';
END
ELSE
BEGIN
    PRINT '✅ All column enhancements present';
    PRINT '';
END

-- ============================================
-- Final Summary
-- ============================================
PRINT '';
PRINT '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';

DECLARE @total_issues INT = 0;

IF EXISTS (SELECT * FROM @missing_tables) SET @total_issues = @total_issues + 1;
IF EXISTS (SELECT * FROM @missing_views) SET @total_issues = @total_issues + 1;
IF EXISTS (SELECT * FROM @missing_procs) SET @total_issues = @total_issues + 1;
IF EXISTS (SELECT * FROM @missing_triggers) SET @total_issues = @total_issues + 1;
IF EXISTS (SELECT * FROM @missing_columns) SET @total_issues = @total_issues + 1;
IF @fk_count < 15 SET @total_issues = @total_issues + 1;
IF @index_count < 40 SET @total_issues = @total_issues + 1;
IF @check_count < 10 SET @total_issues = @total_issues + 1;

IF @total_issues = 0
BEGIN
    PRINT '✅ Schema verification PASSED';
    PRINT '   All database objects are present and valid';
END
ELSE
BEGIN
    PRINT '⚠️  Schema verification found ' + CAST(@total_issues AS VARCHAR) + ' issue(s)';
    PRINT '   Review the output above for details';
    PRINT '';
    PRINT '   Next steps:';
    PRINT '   1. Run init-db.sql (if tables are missing)';
    PRINT '   2. Run 001_add_todos_and_permissions.sql';
    PRINT '   3. Run 002_add_observability_tables.sql';
    PRINT '   4. Run seed-data.sql (optional, for test data)';
END

PRINT '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
PRINT '';

GO
