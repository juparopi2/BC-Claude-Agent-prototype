-- ============================================
-- BC Claude Agent - Rollback Migration 002
-- ============================================
-- Rolls back changes from migration 002:
--   - Drops agent_executions table
--   - Drops mcp_tool_calls table
--   - Drops session_files table
--   - Drops performance_metrics table
--   - Drops error_logs table
--   - Drops related views and procedures
--
-- ⚠️  WARNING: This will delete all observability data!
-- ⚠️  Backup your database before running this script!
-- ============================================

-- Safety check
PRINT '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
PRINT '⚠️  ROLLBACK SCRIPT - Migration 002';
PRINT '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
PRINT '';
PRINT '⚠️  WARNING: This will delete the following:';
PRINT '   - agent_executions table and all execution logs';
PRINT '   - mcp_tool_calls table and all tool call logs';
PRINT '   - session_files table and all file references';
PRINT '   - performance_metrics table and all metrics';
PRINT '   - error_logs table and all error logs';
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
-- Drop Views (Migration 002)
-- ============================================
IF EXISTS (SELECT * FROM sys.views WHERE name = 'vw_session_activity')
BEGIN
    DROP VIEW vw_session_activity;
    PRINT '✅ Dropped view: vw_session_activity';
END

IF EXISTS (SELECT * FROM sys.views WHERE name = 'vw_recent_errors')
BEGIN
    DROP VIEW vw_recent_errors;
    PRINT '✅ Dropped view: vw_recent_errors';
END

IF EXISTS (SELECT * FROM sys.views WHERE name = 'vw_mcp_tool_usage')
BEGIN
    DROP VIEW vw_mcp_tool_usage;
    PRINT '✅ Dropped view: vw_mcp_tool_usage';
END

IF EXISTS (SELECT * FROM sys.views WHERE name = 'vw_agent_performance')
BEGIN
    DROP VIEW vw_agent_performance;
    PRINT '✅ Dropped view: vw_agent_performance';
END

PRINT '';

-- ============================================
-- Drop Stored Procedures (Migration 002)
-- ============================================
IF EXISTS (SELECT * FROM sys.procedures WHERE name = 'sp_archive_observability_data')
BEGIN
    DROP PROCEDURE sp_archive_observability_data;
    PRINT '✅ Dropped procedure: sp_archive_observability_data';
END

IF EXISTS (SELECT * FROM sys.procedures WHERE name = 'sp_get_error_summary')
BEGIN
    DROP PROCEDURE sp_get_error_summary;
    PRINT '✅ Dropped procedure: sp_get_error_summary';
END

IF EXISTS (SELECT * FROM sys.procedures WHERE name = 'sp_get_agent_timeline')
BEGIN
    DROP PROCEDURE sp_get_agent_timeline;
    PRINT '✅ Dropped procedure: sp_get_agent_timeline';
END

PRINT '';

-- ============================================
-- Drop Tables (Migration 002)
-- ============================================
-- Drop mcp_tool_calls first (has FK to agent_executions)
IF EXISTS (SELECT * FROM sys.tables WHERE name = 'mcp_tool_calls')
BEGIN
    DROP TABLE mcp_tool_calls;
    PRINT '✅ Dropped table: mcp_tool_calls';
END

-- Drop agent_executions
IF EXISTS (SELECT * FROM sys.tables WHERE name = 'agent_executions')
BEGIN
    DROP TABLE agent_executions;
    PRINT '✅ Dropped table: agent_executions';
END

-- Drop session_files
IF EXISTS (SELECT * FROM sys.tables WHERE name = 'session_files')
BEGIN
    DROP TABLE session_files;
    PRINT '✅ Dropped table: session_files';
END

-- Drop performance_metrics
IF EXISTS (SELECT * FROM sys.tables WHERE name = 'performance_metrics')
BEGIN
    DROP TABLE performance_metrics;
    PRINT '✅ Dropped table: performance_metrics';
END

-- Drop error_logs
IF EXISTS (SELECT * FROM sys.tables WHERE name = 'error_logs')
BEGIN
    DROP TABLE error_logs;
    PRINT '✅ Dropped table: error_logs';
END

PRINT '';

-- ============================================
-- Final Summary
-- ============================================
PRINT '';
PRINT '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
PRINT '✅ Rollback of Migration 002 completed';
PRINT '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
PRINT '';
PRINT 'The following have been removed:';
PRINT '  - 5 tables (agent_executions, mcp_tool_calls, session_files, performance_metrics, error_logs)';
PRINT '  - 4 views (vw_agent_performance, vw_mcp_tool_usage, vw_recent_errors, vw_session_activity)';
PRINT '  - 3 stored procedures';
PRINT '';
PRINT 'Database is now in pre-migration 002 state';
PRINT 'Observability features are disabled';
PRINT '';

GO
