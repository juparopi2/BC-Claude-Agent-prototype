-- ============================================
-- BC Claude Agent - Migration 002
-- ============================================
-- Adds observability and monitoring tables:
--   - agent_executions: Agent execution tracing
--   - mcp_tool_calls: MCP tool call logging
--   - session_files: File context tracking
--
-- Prerequisites: init-db.sql and 001_add_todos_and_permissions.sql
-- ============================================

-- Check if database is Azure SQL Database
IF SERVERPROPERTY('EngineEdition') != 5
BEGIN
    PRINT 'Warning: This script is designed for Azure SQL Database'
END
GO

-- ============================================
-- Table: agent_executions
-- ============================================
-- Stores detailed execution logs for agent operations
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'agent_executions')
BEGIN
    CREATE TABLE agent_executions (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        session_id UNIQUEIDENTIFIER NOT NULL,
        agent_type NVARCHAR(100) NOT NULL, -- 'MainOrchestrator', 'BCQueryAgent', 'BCWriteAgent', etc.
        action NVARCHAR(100) NOT NULL, -- 'query', 'create', 'update', 'delete', 'analyze', etc.
        input_data NVARCHAR(MAX) NULL, -- JSON input to the agent
        output_data NVARCHAR(MAX) NULL, -- JSON output from the agent
        status NVARCHAR(50) NOT NULL DEFAULT 'started', -- 'started', 'completed', 'failed'
        error_message NVARCHAR(MAX) NULL,
        error_stack NVARCHAR(MAX) NULL,
        duration_ms INT NULL,
        tokens_used INT NULL,
        thinking_tokens INT NULL,
        created_at DATETIME2(7) NOT NULL DEFAULT GETUTCDATE(),
        completed_at DATETIME2(7) NULL,

        -- Foreign Keys
        CONSTRAINT fk_agent_executions_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,

        -- Constraints
        CONSTRAINT chk_agent_executions_status CHECK (status IN ('started', 'completed', 'failed')),

        -- Indexes
        INDEX idx_agent_executions_session (session_id),
        INDEX idx_agent_executions_agent (agent_type),
        INDEX idx_agent_executions_status (status),
        INDEX idx_agent_executions_created (created_at),
        INDEX idx_agent_executions_agent_status (agent_type, status)
    );

    PRINT '✅ Table created: agent_executions';
END
ELSE
BEGIN
    PRINT 'ℹ️  Table already exists: agent_executions';
END
GO

-- ============================================
-- Table: mcp_tool_calls
-- ============================================
-- Stores all MCP tool invocations for debugging and analytics
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'mcp_tool_calls')
BEGIN
    CREATE TABLE mcp_tool_calls (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        session_id UNIQUEIDENTIFIER NOT NULL,
        execution_id UNIQUEIDENTIFIER NULL, -- Links to agent_executions
        tool_name NVARCHAR(100) NOT NULL, -- 'bc_query_entity', 'bc_create_entity', etc.
        arguments NVARCHAR(MAX) NULL, -- JSON arguments passed to tool
        result NVARCHAR(MAX) NULL, -- JSON result from tool
        status NVARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending', 'success', 'error'
        error_message NVARCHAR(MAX) NULL,
        error_code NVARCHAR(100) NULL,
        duration_ms INT NULL,
        created_at DATETIME2(7) NOT NULL DEFAULT GETUTCDATE(),
        completed_at DATETIME2(7) NULL,

        -- Foreign Keys
        CONSTRAINT fk_mcp_calls_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
        CONSTRAINT fk_mcp_calls_execution FOREIGN KEY (execution_id) REFERENCES agent_executions(id) ON DELETE CASCADE,

        -- Constraints
        CONSTRAINT chk_mcp_calls_status CHECK (status IN ('pending', 'success', 'error')),

        -- Indexes
        INDEX idx_mcp_calls_session (session_id),
        INDEX idx_mcp_calls_execution (execution_id),
        INDEX idx_mcp_calls_tool (tool_name),
        INDEX idx_mcp_calls_status (status),
        INDEX idx_mcp_calls_created (created_at),
        INDEX idx_mcp_calls_tool_status (tool_name, status)
    );

    PRINT '✅ Table created: mcp_tool_calls';
END
ELSE
BEGIN
    PRINT 'ℹ️  Table already exists: mcp_tool_calls';
END
GO

-- ============================================
-- Table: session_files
-- ============================================
-- Tracks files and context added to sessions
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'session_files')
BEGIN
    CREATE TABLE session_files (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        session_id UNIQUEIDENTIFIER NOT NULL,
        file_name NVARCHAR(255) NOT NULL,
        file_path NVARCHAR(500) NOT NULL,
        file_type NVARCHAR(100) NOT NULL, -- 'uploaded', 'cloudmd', 'generated', 'reference'
        file_size_bytes BIGINT NULL,
        mime_type NVARCHAR(100) NULL,
        content_hash NVARCHAR(255) NULL, -- SHA-256 hash for deduplication
        is_active BIT NOT NULL DEFAULT 1, -- Can be removed from context
        metadata NVARCHAR(MAX) NULL, -- JSON metadata (tags, description, etc.)
        created_at DATETIME2(7) NOT NULL DEFAULT GETUTCDATE(),
        removed_at DATETIME2(7) NULL,

        -- Foreign Keys
        CONSTRAINT fk_session_files_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,

        -- Constraints
        CONSTRAINT chk_session_files_type CHECK (file_type IN ('uploaded', 'cloudmd', 'generated', 'reference')),

        -- Indexes
        INDEX idx_session_files_session (session_id),
        INDEX idx_session_files_active (session_id, is_active),
        INDEX idx_session_files_type (file_type),
        INDEX idx_session_files_hash (content_hash)
    );

    PRINT '✅ Table created: session_files';
END
ELSE
BEGIN
    PRINT 'ℹ️  Table already exists: session_files';
END
GO

-- ============================================
-- Table: performance_metrics
-- ============================================
-- Stores performance metrics for monitoring
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'performance_metrics')
BEGIN
    CREATE TABLE performance_metrics (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        session_id UNIQUEIDENTIFIER NULL,
        metric_name NVARCHAR(100) NOT NULL, -- 'api_latency', 'token_usage', 'cache_hit_rate', etc.
        metric_value FLOAT NOT NULL,
        metric_unit NVARCHAR(50) NULL, -- 'ms', 'tokens', 'percent', etc.
        tags NVARCHAR(MAX) NULL, -- JSON tags for filtering
        created_at DATETIME2(7) NOT NULL DEFAULT GETUTCDATE(),

        -- Foreign Keys
        CONSTRAINT fk_metrics_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,

        -- Indexes
        INDEX idx_metrics_session (session_id),
        INDEX idx_metrics_name (metric_name),
        INDEX idx_metrics_created (created_at),
        INDEX idx_metrics_name_created (metric_name, created_at)
    );

    PRINT '✅ Table created: performance_metrics';
END
ELSE
BEGIN
    PRINT 'ℹ️  Table already exists: performance_metrics';
END
GO

-- ============================================
-- Table: error_logs
-- ============================================
-- Centralized error logging
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'error_logs')
BEGIN
    CREATE TABLE error_logs (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        session_id UNIQUEIDENTIFIER NULL,
        user_id UNIQUEIDENTIFIER NULL,
        error_type NVARCHAR(100) NOT NULL, -- 'api_error', 'database_error', 'mcp_error', etc.
        error_message NVARCHAR(MAX) NOT NULL,
        error_stack NVARCHAR(MAX) NULL,
        error_code NVARCHAR(100) NULL,
        severity NVARCHAR(20) NOT NULL DEFAULT 'error', -- 'info', 'warning', 'error', 'critical'
        context NVARCHAR(MAX) NULL, -- JSON context
        is_resolved BIT NOT NULL DEFAULT 0,
        resolved_at DATETIME2(7) NULL,
        created_at DATETIME2(7) NOT NULL DEFAULT GETUTCDATE(),

        -- Foreign Keys
        CONSTRAINT fk_error_logs_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL,
        CONSTRAINT fk_error_logs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,

        -- Constraints
        CONSTRAINT chk_error_logs_severity CHECK (severity IN ('info', 'warning', 'error', 'critical')),

        -- Indexes
        INDEX idx_error_logs_session (session_id),
        INDEX idx_error_logs_user (user_id),
        INDEX idx_error_logs_type (error_type),
        INDEX idx_error_logs_severity (severity),
        INDEX idx_error_logs_created (created_at),
        INDEX idx_error_logs_resolved (is_resolved)
    );

    PRINT '✅ Table created: error_logs';
END
ELSE
BEGIN
    PRINT 'ℹ️  Table already exists: error_logs';
END
GO

-- ============================================
-- Views: Observability queries
-- ============================================

-- View: Agent performance summary
IF NOT EXISTS (SELECT * FROM sys.views WHERE name = 'vw_agent_performance')
BEGIN
    EXEC('
    CREATE VIEW vw_agent_performance AS
    SELECT
        agent_type,
        action,
        COUNT(*) AS execution_count,
        AVG(duration_ms) AS avg_duration_ms,
        MAX(duration_ms) AS max_duration_ms,
        MIN(duration_ms) AS min_duration_ms,
        SUM(CASE WHEN status = ''completed'' THEN 1 ELSE 0 END) AS success_count,
        SUM(CASE WHEN status = ''failed'' THEN 1 ELSE 0 END) AS failure_count,
        SUM(tokens_used) AS total_tokens_used,
        AVG(tokens_used) AS avg_tokens_used
    FROM agent_executions
    WHERE created_at >= DATEADD(DAY, -7, GETUTCDATE())
    GROUP BY agent_type, action
    ');
    PRINT '✅ View created: vw_agent_performance';
END
GO

-- View: MCP tool usage stats
IF NOT EXISTS (SELECT * FROM sys.views WHERE name = 'vw_mcp_tool_usage')
BEGIN
    EXEC('
    CREATE VIEW vw_mcp_tool_usage AS
    SELECT
        tool_name,
        COUNT(*) AS call_count,
        SUM(CASE WHEN status = ''success'' THEN 1 ELSE 0 END) AS success_count,
        SUM(CASE WHEN status = ''error'' THEN 1 ELSE 0 END) AS error_count,
        AVG(duration_ms) AS avg_duration_ms,
        MAX(duration_ms) AS max_duration_ms,
        CAST(SUM(CASE WHEN status = ''success'' THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*) * 100 AS success_rate_percent
    FROM mcp_tool_calls
    WHERE created_at >= DATEADD(DAY, -7, GETUTCDATE())
    GROUP BY tool_name
    ');
    PRINT '✅ View created: vw_mcp_tool_usage';
END
GO

-- View: Recent errors summary
IF NOT EXISTS (SELECT * FROM sys.views WHERE name = 'vw_recent_errors')
BEGIN
    EXEC('
    CREATE VIEW vw_recent_errors AS
    SELECT TOP 100
        e.id,
        e.error_type,
        e.error_message,
        e.severity,
        e.created_at,
        e.is_resolved,
        s.id AS session_id,
        s.title AS session_title,
        u.id AS user_id,
        u.email AS user_email
    FROM error_logs e
    LEFT JOIN sessions s ON e.session_id = s.id
    LEFT JOIN users u ON e.user_id = u.id
    WHERE e.created_at >= DATEADD(DAY, -1, GETUTCDATE())
    ORDER BY e.created_at DESC
    ');
    PRINT '✅ View created: vw_recent_errors';
END
GO

-- View: Session activity summary
IF NOT EXISTS (SELECT * FROM sys.views WHERE name = 'vw_session_activity')
BEGIN
    EXEC('
    CREATE VIEW vw_session_activity AS
    SELECT
        s.id AS session_id,
        s.title,
        s.created_at,
        s.last_activity_at,
        u.email AS user_email,
        (SELECT COUNT(*) FROM messages WHERE session_id = s.id) AS message_count,
        (SELECT COUNT(*) FROM agent_executions WHERE session_id = s.id) AS execution_count,
        (SELECT COUNT(*) FROM mcp_tool_calls WHERE session_id = s.id) AS tool_call_count,
        (SELECT COUNT(*) FROM todos WHERE session_id = s.id AND status = ''completed'') AS completed_todos,
        (SELECT COUNT(*) FROM approvals WHERE session_id = s.id AND status = ''pending'') AS pending_approvals
    FROM sessions s
    INNER JOIN users u ON s.user_id = u.id
    WHERE s.is_active = 1
    ');
    PRINT '✅ View created: vw_session_activity';
END
GO

-- ============================================
-- Stored Procedures: Analytics helpers
-- ============================================

-- Procedure: Get agent execution timeline
IF NOT EXISTS (SELECT * FROM sys.procedures WHERE name = 'sp_get_agent_timeline')
BEGIN
    EXEC('
    CREATE PROCEDURE sp_get_agent_timeline
        @session_id UNIQUEIDENTIFIER
    AS
    BEGIN
        SET NOCOUNT ON;

        SELECT
            ae.id AS execution_id,
            ae.agent_type,
            ae.action,
            ae.status,
            ae.duration_ms,
            ae.tokens_used,
            ae.created_at,
            ae.completed_at,
            (
                SELECT COUNT(*)
                FROM mcp_tool_calls mtc
                WHERE mtc.execution_id = ae.id
            ) AS tool_calls_count
        FROM agent_executions ae
        WHERE ae.session_id = @session_id
        ORDER BY ae.created_at;
    END
    ');
    PRINT '✅ Stored procedure created: sp_get_agent_timeline';
END
GO

-- Procedure: Get error summary by type
IF NOT EXISTS (SELECT * FROM sys.procedures WHERE name = 'sp_get_error_summary')
BEGIN
    EXEC('
    CREATE PROCEDURE sp_get_error_summary
        @days INT = 7
    AS
    BEGIN
        SET NOCOUNT ON;

        DECLARE @cutoff_date DATETIME2(7) = DATEADD(DAY, -@days, GETUTCDATE());

        SELECT
            error_type,
            severity,
            COUNT(*) AS error_count,
            SUM(CASE WHEN is_resolved = 1 THEN 1 ELSE 0 END) AS resolved_count,
            MIN(created_at) AS first_occurrence,
            MAX(created_at) AS last_occurrence
        FROM error_logs
        WHERE created_at >= @cutoff_date
        GROUP BY error_type, severity
        ORDER BY error_count DESC;
    END
    ');
    PRINT '✅ Stored procedure created: sp_get_error_summary';
END
GO

-- Procedure: Archive old observability data
IF NOT EXISTS (SELECT * FROM sys.procedures WHERE name = 'sp_archive_observability_data')
BEGIN
    EXEC('
    CREATE PROCEDURE sp_archive_observability_data
        @days_to_keep INT = 30
    AS
    BEGIN
        SET NOCOUNT ON;

        DECLARE @cutoff_date DATETIME2(7) = DATEADD(DAY, -@days_to_keep, GETUTCDATE());
        DECLARE @archived_count INT = 0;

        -- Archive agent executions
        DELETE FROM agent_executions
        WHERE created_at < @cutoff_date
          AND status IN (''completed'', ''failed'');
        SET @archived_count = @archived_count + @@ROWCOUNT;

        -- Archive MCP tool calls
        DELETE FROM mcp_tool_calls
        WHERE created_at < @cutoff_date
          AND status IN (''success'', ''error'');
        SET @archived_count = @archived_count + @@ROWCOUNT;

        -- Archive performance metrics
        DELETE FROM performance_metrics
        WHERE created_at < @cutoff_date;
        SET @archived_count = @archived_count + @@ROWCOUNT;

        -- Archive resolved errors
        DELETE FROM error_logs
        WHERE created_at < @cutoff_date
          AND is_resolved = 1;
        SET @archived_count = @archived_count + @@ROWCOUNT;

        PRINT ''✅ Archived '' + CAST(@archived_count AS NVARCHAR) + '' observability records'';
    END
    ');
    PRINT '✅ Stored procedure created: sp_archive_observability_data';
END
GO

-- ============================================
-- Final Summary
-- ============================================

PRINT '';
PRINT '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
PRINT '✅ Migration 002 completed successfully';
PRINT '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
PRINT '';
PRINT 'New tables:';
PRINT '  - agent_executions';
PRINT '  - mcp_tool_calls';
PRINT '  - session_files';
PRINT '  - performance_metrics';
PRINT '  - error_logs';
PRINT '';
PRINT 'New views:';
PRINT '  - vw_agent_performance';
PRINT '  - vw_mcp_tool_usage';
PRINT '  - vw_recent_errors';
PRINT '  - vw_session_activity';
PRINT '';
PRINT 'New stored procedures:';
PRINT '  - sp_get_agent_timeline';
PRINT '  - sp_get_error_summary';
PRINT '  - sp_archive_observability_data';
PRINT '';
PRINT 'These tables provide comprehensive observability for:';
PRINT '  - Agent execution tracking and debugging';
PRINT '  - MCP tool call monitoring';
PRINT '  - Session context management';
PRINT '  - Performance metrics collection';
PRINT '  - Centralized error logging';
PRINT '';
GO
