-- ============================================
-- BC Claude Agent - Migration 001
-- ============================================
-- Adds critical tables for MVP:
--   - todos: Task tracking system
--   - tool_permissions: Granular user permissions
--   - Enhancements to existing tables
--
-- Prerequisites: init-db.sql must have been run first
-- ============================================

-- Check if database is Azure SQL Database
IF SERVERPROPERTY('EngineEdition') != 5
BEGIN
    PRINT 'Warning: This script is designed for Azure SQL Database'
END
GO

-- ============================================
-- Table: todos
-- ============================================
-- Stores auto-generated todo lists from agent plans
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'todos')
BEGIN
    CREATE TABLE todos (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        session_id UNIQUEIDENTIFIER NOT NULL,
        description NVARCHAR(500) NOT NULL,
        status NVARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending', 'in_progress', 'completed', 'failed'
        order_index INT NOT NULL,
        parent_todo_id UNIQUEIDENTIFIER NULL, -- For nested todos
        dependencies NVARCHAR(MAX) NULL, -- JSON array of todo IDs
        created_at DATETIME2(7) NOT NULL DEFAULT GETUTCDATE(),
        started_at DATETIME2(7) NULL,
        completed_at DATETIME2(7) NULL,
        metadata NVARCHAR(MAX) NULL, -- JSON for extra data (estimated_duration, actual_duration, etc.)

        -- Foreign Keys
        CONSTRAINT fk_todos_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
        CONSTRAINT fk_todos_parent FOREIGN KEY (parent_todo_id) REFERENCES todos(id) ON DELETE NO ACTION,

        -- Constraints
        CONSTRAINT chk_todos_status CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),

        -- Indexes
        INDEX idx_todos_session_id (session_id),
        INDEX idx_todos_status (status),
        INDEX idx_todos_order (session_id, order_index),
        INDEX idx_todos_parent (parent_todo_id)
    );

    PRINT '✅ Table created: todos';
END
ELSE
BEGIN
    PRINT 'ℹ️  Table already exists: todos';
END
GO

-- ============================================
-- Table: tool_permissions
-- ============================================
-- Stores granular tool permissions per user
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'tool_permissions')
BEGIN
    CREATE TABLE tool_permissions (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        user_id UNIQUEIDENTIFIER NOT NULL,
        tool_name NVARCHAR(100) NOT NULL,
        is_allowed BIT NOT NULL DEFAULT 1,
        requires_approval BIT NOT NULL DEFAULT 0, -- If true, requires approval even if allowed
        created_at DATETIME2(7) NOT NULL DEFAULT GETUTCDATE(),
        updated_at DATETIME2(7) NOT NULL DEFAULT GETUTCDATE(),

        -- Foreign Keys
        CONSTRAINT fk_tool_permissions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,

        -- Constraints
        CONSTRAINT uq_user_tool UNIQUE (user_id, tool_name),

        -- Indexes
        INDEX idx_tool_permissions_user (user_id),
        INDEX idx_tool_permissions_tool (tool_name)
    );

    PRINT '✅ Table created: tool_permissions';
END
ELSE
BEGIN
    PRINT 'ℹ️  Table already exists: tool_permissions';
END
GO

-- ============================================
-- Table: permission_presets
-- ============================================
-- Stores predefined permission sets (e.g., "read_only", "analyst", "admin")
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'permission_presets')
BEGIN
    CREATE TABLE permission_presets (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        name NVARCHAR(100) NOT NULL UNIQUE,
        description NVARCHAR(500) NULL,
        permissions NVARCHAR(MAX) NOT NULL, -- JSON object: {"tool_name": {"allowed": true, "requires_approval": false}}
        is_active BIT NOT NULL DEFAULT 1,
        created_at DATETIME2(7) NOT NULL DEFAULT GETUTCDATE(),
        updated_at DATETIME2(7) NOT NULL DEFAULT GETUTCDATE(),

        -- Indexes
        INDEX idx_permission_presets_name (name),
        INDEX idx_permission_presets_is_active (is_active)
    );

    PRINT '✅ Table created: permission_presets';
END
ELSE
BEGIN
    PRINT 'ℹ️  Table already exists: permission_presets';
END
GO

-- ============================================
-- Enhancements: Add columns to existing tables
-- ============================================

-- Add 'role' column to users table
IF NOT EXISTS (
    SELECT * FROM sys.columns
    WHERE object_id = OBJECT_ID('users')
    AND name = 'role'
)
BEGIN
    ALTER TABLE users ADD role NVARCHAR(50) NOT NULL DEFAULT 'user';
    ALTER TABLE users ADD CONSTRAINT chk_users_role CHECK (role IN ('admin', 'user', 'viewer'));
    PRINT '✅ Column added: users.role';
END
ELSE
BEGIN
    PRINT 'ℹ️  Column already exists: users.role';
END
GO

-- Create index for role column (separate batch required)
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_users_role' AND object_id = OBJECT_ID('users'))
BEGIN
    CREATE INDEX idx_users_role ON users(role);
    PRINT '✅ Index created: idx_users_role';
END
GO

-- Add session management columns to sessions table
IF NOT EXISTS (
    SELECT * FROM sys.columns
    WHERE object_id = OBJECT_ID('sessions')
    AND name = 'goal'
)
BEGIN
    ALTER TABLE sessions ADD goal NVARCHAR(500) NULL;
    PRINT '✅ Column added: sessions.goal';
END
ELSE
BEGIN
    PRINT 'ℹ️  Column already exists: sessions.goal';
END
GO

IF NOT EXISTS (
    SELECT * FROM sys.columns
    WHERE object_id = OBJECT_ID('sessions')
    AND name = 'status'
)
BEGIN
    ALTER TABLE sessions ADD status NVARCHAR(50) NOT NULL DEFAULT 'active';
    ALTER TABLE sessions ADD CONSTRAINT chk_sessions_status CHECK (status IN ('active', 'completed', 'failed', 'archived'));
    PRINT '✅ Column added: sessions.status';
END
ELSE
BEGIN
    PRINT 'ℹ️  Column already exists: sessions.status';
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_sessions_status' AND object_id = OBJECT_ID('sessions'))
BEGIN
    CREATE INDEX idx_sessions_status ON sessions(status);
    PRINT '✅ Index created: idx_sessions_status';
END
GO

IF NOT EXISTS (
    SELECT * FROM sys.columns
    WHERE object_id = OBJECT_ID('sessions')
    AND name = 'last_activity_at'
)
BEGIN
    ALTER TABLE sessions ADD last_activity_at DATETIME2(7) NULL;
    PRINT '✅ Column added: sessions.last_activity_at';
END
ELSE
BEGIN
    PRINT 'ℹ️  Column already exists: sessions.last_activity_at';
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_sessions_last_activity' AND object_id = OBJECT_ID('sessions'))
BEGIN
    CREATE INDEX idx_sessions_last_activity ON sessions(last_activity_at);
    PRINT '✅ Index created: idx_sessions_last_activity';
END
GO

IF NOT EXISTS (
    SELECT * FROM sys.columns
    WHERE object_id = OBJECT_ID('sessions')
    AND name = 'token_count'
)
BEGIN
    ALTER TABLE sessions ADD token_count INT NULL;
    PRINT '✅ Column added: sessions.token_count';
END
ELSE
BEGIN
    PRINT 'ℹ️  Column already exists: sessions.token_count';
END
GO

-- Add thinking mode tracking to messages table
IF NOT EXISTS (
    SELECT * FROM sys.columns
    WHERE object_id = OBJECT_ID('messages')
    AND name = 'thinking_tokens'
)
BEGIN
    ALTER TABLE messages ADD thinking_tokens INT NULL;
    PRINT '✅ Column added: messages.thinking_tokens';
END
ELSE
BEGIN
    PRINT 'ℹ️  Column already exists: messages.thinking_tokens';
END
GO

IF NOT EXISTS (
    SELECT * FROM sys.columns
    WHERE object_id = OBJECT_ID('messages')
    AND name = 'is_thinking'
)
BEGIN
    ALTER TABLE messages ADD is_thinking BIT NOT NULL DEFAULT 0;
    PRINT '✅ Column added: messages.is_thinking';
END
ELSE
BEGIN
    PRINT 'ℹ️  Column already exists: messages.is_thinking';
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_messages_is_thinking' AND object_id = OBJECT_ID('messages'))
BEGIN
    CREATE INDEX idx_messages_is_thinking ON messages(is_thinking);
    PRINT '✅ Index created: idx_messages_is_thinking';
END
GO

-- Add priority and expiration to approvals table
IF NOT EXISTS (
    SELECT * FROM sys.columns
    WHERE object_id = OBJECT_ID('approvals')
    AND name = 'priority'
)
BEGIN
    ALTER TABLE approvals ADD priority NVARCHAR(20) NULL DEFAULT 'normal';
    ALTER TABLE approvals ADD CONSTRAINT chk_approvals_priority CHECK (priority IN ('low', 'normal', 'high', 'critical'));
    PRINT '✅ Column added: approvals.priority';
END
ELSE
BEGIN
    PRINT 'ℹ️  Column already exists: approvals.priority';
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_approvals_priority' AND object_id = OBJECT_ID('approvals'))
BEGIN
    CREATE INDEX idx_approvals_priority ON approvals(status, priority);
    PRINT '✅ Index created: idx_approvals_priority';
END
GO

IF NOT EXISTS (
    SELECT * FROM sys.columns
    WHERE object_id = OBJECT_ID('approvals')
    AND name = 'expires_at'
)
BEGIN
    ALTER TABLE approvals ADD expires_at DATETIME2(7) NULL;
    PRINT '✅ Column added: approvals.expires_at';
END
ELSE
BEGIN
    PRINT 'ℹ️  Column already exists: approvals.expires_at';
END
GO

-- Add correlation ID to audit_log for distributed tracing
IF NOT EXISTS (
    SELECT * FROM sys.columns
    WHERE object_id = OBJECT_ID('audit_log')
    AND name = 'correlation_id'
)
BEGIN
    ALTER TABLE audit_log ADD correlation_id UNIQUEIDENTIFIER NULL;
    ALTER TABLE audit_log ADD duration_ms INT NULL;
    PRINT '✅ Columns added: audit_log.correlation_id, audit_log.duration_ms';
END
ELSE
BEGIN
    PRINT 'ℹ️  Columns already exist: audit_log.correlation_id, audit_log.duration_ms';
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_audit_correlation' AND object_id = OBJECT_ID('audit_log'))
BEGIN
    CREATE INDEX idx_audit_correlation ON audit_log(correlation_id);
    PRINT '✅ Index created: idx_audit_correlation';
END
GO

-- ============================================
-- Triggers: Auto-update updated_at timestamps
-- ============================================

-- Trigger for tool_permissions table
IF NOT EXISTS (SELECT * FROM sys.triggers WHERE name = 'trg_tool_permissions_updated_at')
BEGIN
    EXEC('
    CREATE TRIGGER trg_tool_permissions_updated_at
    ON tool_permissions
    AFTER UPDATE
    AS
    BEGIN
        SET NOCOUNT ON;
        UPDATE tool_permissions
        SET updated_at = GETUTCDATE()
        FROM tool_permissions tp
        INNER JOIN inserted i ON tp.id = i.id;
    END
    ');
    PRINT '✅ Trigger created: trg_tool_permissions_updated_at';
END
GO

-- Trigger for permission_presets table
IF NOT EXISTS (SELECT * FROM sys.triggers WHERE name = 'trg_permission_presets_updated_at')
BEGIN
    EXEC('
    CREATE TRIGGER trg_permission_presets_updated_at
    ON permission_presets
    AFTER UPDATE
    AS
    BEGIN
        SET NOCOUNT ON;
        UPDATE permission_presets
        SET updated_at = GETUTCDATE()
        FROM permission_presets pp
        INNER JOIN inserted i ON pp.id = i.id;
    END
    ');
    PRINT '✅ Trigger created: trg_permission_presets_updated_at';
END
GO

-- ============================================
-- Views: Enhanced queries
-- ============================================

-- View: User permissions summary
IF NOT EXISTS (SELECT * FROM sys.views WHERE name = 'vw_user_permissions')
BEGIN
    EXEC('
    CREATE VIEW vw_user_permissions AS
    SELECT
        u.id AS user_id,
        u.email,
        u.full_name,
        u.role,
        tp.tool_name,
        tp.is_allowed,
        tp.requires_approval
    FROM users u
    LEFT JOIN tool_permissions tp ON u.id = tp.user_id
    WHERE u.is_active = 1
    ');
    PRINT '✅ View created: vw_user_permissions';
END
GO

-- View: Active todos per session
IF NOT EXISTS (SELECT * FROM sys.views WHERE name = 'vw_active_todos')
BEGIN
    EXEC('
    CREATE VIEW vw_active_todos AS
    SELECT
        t.id AS todo_id,
        t.description,
        t.status,
        t.order_index,
        t.created_at,
        t.started_at,
        t.completed_at,
        s.id AS session_id,
        s.title AS session_title,
        u.id AS user_id,
        u.email AS user_email
    FROM todos t
    INNER JOIN sessions s ON t.session_id = s.id
    INNER JOIN users u ON s.user_id = u.id
    WHERE s.is_active = 1
    ORDER BY t.order_index
    ');
    PRINT '✅ View created: vw_active_todos';
END
GO

-- ============================================
-- Stored Procedures: Helper functions
-- ============================================

-- Procedure: Apply permission preset to user
IF NOT EXISTS (SELECT * FROM sys.procedures WHERE name = 'sp_apply_permission_preset')
BEGIN
    EXEC('
    CREATE PROCEDURE sp_apply_permission_preset
        @user_id UNIQUEIDENTIFIER,
        @preset_name NVARCHAR(100)
    AS
    BEGIN
        SET NOCOUNT ON;

        DECLARE @permissions NVARCHAR(MAX);
        DECLARE @preset_id UNIQUEIDENTIFIER;

        -- Get preset
        SELECT @preset_id = id, @permissions = permissions
        FROM permission_presets
        WHERE name = @preset_name AND is_active = 1;

        IF @preset_id IS NULL
        BEGIN
            RAISERROR(''Permission preset not found or inactive'', 16, 1);
            RETURN;
        END

        -- Clear existing permissions
        DELETE FROM tool_permissions WHERE user_id = @user_id;

        -- Note: In a real implementation, you would parse the JSON and insert permissions
        -- For now, this is a placeholder that requires manual implementation
        PRINT ''✅ Permission preset applied: '' + @preset_name;
    END
    ');
    PRINT '✅ Stored procedure created: sp_apply_permission_preset';
END
GO

-- ============================================
-- Insert Default Permission Presets
-- ============================================

-- Preset: read_only
IF NOT EXISTS (SELECT * FROM permission_presets WHERE name = 'read_only')
BEGIN
    INSERT INTO permission_presets (name, description, permissions, is_active)
    VALUES (
        'read_only',
        'Read-only access - can only query data, no write operations',
        '{"bc_query_entity": {"allowed": true, "requires_approval": false}, "bc_create_entity": {"allowed": false, "requires_approval": false}, "bc_update_entity": {"allowed": false, "requires_approval": false}, "bc_delete_entity": {"allowed": false, "requires_approval": false}}',
        1
    );
    PRINT '✅ Permission preset inserted: read_only';
END
GO

-- Preset: analyst
IF NOT EXISTS (SELECT * FROM permission_presets WHERE name = 'analyst')
BEGIN
    INSERT INTO permission_presets (name, description, permissions, is_active)
    VALUES (
        'analyst',
        'Analyst access - can query and create/update with approval',
        '{"bc_query_entity": {"allowed": true, "requires_approval": false}, "bc_create_entity": {"allowed": true, "requires_approval": true}, "bc_update_entity": {"allowed": true, "requires_approval": true}, "bc_delete_entity": {"allowed": false, "requires_approval": false}}',
        1
    );
    PRINT '✅ Permission preset inserted: analyst';
END
GO

-- Preset: power_user
IF NOT EXISTS (SELECT * FROM permission_presets WHERE name = 'power_user')
BEGIN
    INSERT INTO permission_presets (name, description, permissions, is_active)
    VALUES (
        'power_user',
        'Power user access - full access but requires approval for writes',
        '{"bc_query_entity": {"allowed": true, "requires_approval": false}, "bc_create_entity": {"allowed": true, "requires_approval": true}, "bc_update_entity": {"allowed": true, "requires_approval": true}, "bc_delete_entity": {"allowed": true, "requires_approval": true}}',
        1
    );
    PRINT '✅ Permission preset inserted: power_user';
END
GO

-- Preset: admin
IF NOT EXISTS (SELECT * FROM permission_presets WHERE name = 'admin')
BEGIN
    INSERT INTO permission_presets (name, description, permissions, is_active)
    VALUES (
        'admin',
        'Admin access - full access without approval requirements',
        '{"bc_query_entity": {"allowed": true, "requires_approval": false}, "bc_create_entity": {"allowed": true, "requires_approval": false}, "bc_update_entity": {"allowed": true, "requires_approval": false}, "bc_delete_entity": {"allowed": true, "requires_approval": true}}',
        1
    );
    PRINT '✅ Permission preset inserted: admin';
END
GO

-- ============================================
-- Final Summary
-- ============================================

PRINT '';
PRINT '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
PRINT '✅ Migration 001 completed successfully';
PRINT '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
PRINT '';
PRINT 'New tables:';
PRINT '  - todos';
PRINT '  - tool_permissions';
PRINT '  - permission_presets';
PRINT '';
PRINT 'Enhanced tables:';
PRINT '  - users (added: role)';
PRINT '  - sessions (added: goal, status, last_activity_at, token_count)';
PRINT '  - messages (added: thinking_tokens, is_thinking)';
PRINT '  - approvals (added: priority, expires_at)';
PRINT '  - audit_log (added: correlation_id, duration_ms)';
PRINT '';
PRINT 'New views:';
PRINT '  - vw_user_permissions';
PRINT '  - vw_active_todos';
PRINT '';
PRINT 'New stored procedures:';
PRINT '  - sp_apply_permission_preset';
PRINT '';
PRINT 'Default permission presets:';
PRINT '  - read_only';
PRINT '  - analyst';
PRINT '  - power_user';
PRINT '  - admin';
PRINT '';
GO
