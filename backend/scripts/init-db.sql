-- ============================================
-- BC Claude Agent - Database Schema
-- ============================================
-- Database initialization script for Azure SQL Database
-- Creates all tables, indexes, and constraints
--
-- Run this script once to initialize the database
-- ============================================

-- Check if database is Azure SQL Database
IF SERVERPROPERTY('EngineEdition') != 5
BEGIN
    PRINT 'Warning: This script is designed for Azure SQL Database'
END
GO

-- ============================================
-- Table: users
-- ============================================
-- Stores user authentication and profile information
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'users')
BEGIN
    CREATE TABLE users (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        email NVARCHAR(255) NOT NULL UNIQUE,
        password_hash NVARCHAR(255) NOT NULL,
        full_name NVARCHAR(255) NULL,
        is_active BIT NOT NULL DEFAULT 1,
        is_admin BIT NOT NULL DEFAULT 0,
        created_at DATETIME2(7) NOT NULL DEFAULT GETUTCDATE(),
        updated_at DATETIME2(7) NOT NULL DEFAULT GETUTCDATE(),
        last_login_at DATETIME2(7) NULL,

        -- Indexes
        INDEX idx_users_email (email),
        INDEX idx_users_is_active (is_active),
        INDEX idx_users_created_at (created_at)
    );

    PRINT '✅ Table created: users';
END
ELSE
BEGIN
    PRINT 'ℹ️  Table already exists: users';
END
GO

-- ============================================
-- Table: sessions
-- ============================================
-- Stores chat sessions for each user
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'sessions')
BEGIN
    CREATE TABLE sessions (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        user_id UNIQUEIDENTIFIER NOT NULL,
        title NVARCHAR(500) NOT NULL DEFAULT 'New Chat',
        is_active BIT NOT NULL DEFAULT 1,
        created_at DATETIME2(7) NOT NULL DEFAULT GETUTCDATE(),
        updated_at DATETIME2(7) NOT NULL DEFAULT GETUTCDATE(),

        -- Foreign Keys
        CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,

        -- Indexes
        INDEX idx_sessions_user_id (user_id),
        INDEX idx_sessions_is_active (is_active),
        INDEX idx_sessions_created_at (created_at),
        INDEX idx_sessions_updated_at (updated_at)
    );

    PRINT '✅ Table created: sessions';
END
ELSE
BEGIN
    PRINT 'ℹ️  Table already exists: sessions';
END
GO

-- ============================================
-- Table: messages
-- ============================================
-- Stores all messages in chat sessions
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'messages')
BEGIN
    CREATE TABLE messages (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        session_id UNIQUEIDENTIFIER NOT NULL,
        role NVARCHAR(50) NOT NULL, -- 'user', 'assistant', 'system', 'tool'
        content NVARCHAR(MAX) NOT NULL,
        metadata NVARCHAR(MAX) NULL, -- JSON metadata (tool calls, thinking, etc.)
        token_count INT NULL,
        created_at DATETIME2(7) NOT NULL DEFAULT GETUTCDATE(),

        -- Foreign Keys
        CONSTRAINT fk_messages_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,

        -- Constraints
        CONSTRAINT chk_messages_role CHECK (role IN ('user', 'assistant', 'system', 'tool')),

        -- Indexes
        INDEX idx_messages_session_id (session_id),
        INDEX idx_messages_created_at (created_at),
        INDEX idx_messages_role (role)
    );

    PRINT '✅ Table created: messages';
END
ELSE
BEGIN
    PRINT 'ℹ️  Table already exists: messages';
END
GO

-- ============================================
-- Table: approvals
-- ============================================
-- Stores approval requests for write operations
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'approvals')
BEGIN
    CREATE TABLE approvals (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        session_id UNIQUEIDENTIFIER NOT NULL,
        message_id UNIQUEIDENTIFIER NULL,
        action_type NVARCHAR(100) NOT NULL, -- 'create', 'update', 'delete', 'custom'
        action_description NVARCHAR(MAX) NOT NULL, -- Human-readable description
        action_data NVARCHAR(MAX) NULL, -- JSON data for the action
        status NVARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
        decided_by_user_id UNIQUEIDENTIFIER NULL,
        decided_at DATETIME2(7) NULL,
        rejection_reason NVARCHAR(MAX) NULL,
        created_at DATETIME2(7) NOT NULL DEFAULT GETUTCDATE(),

        -- Foreign Keys
        CONSTRAINT fk_approvals_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
        CONSTRAINT fk_approvals_message FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE NO ACTION,
        CONSTRAINT fk_approvals_decided_by FOREIGN KEY (decided_by_user_id) REFERENCES users(id) ON DELETE NO ACTION,

        -- Constraints
        CONSTRAINT chk_approvals_status CHECK (status IN ('pending', 'approved', 'rejected')),
        CONSTRAINT chk_approvals_action_type CHECK (action_type IN ('create', 'update', 'delete', 'custom')),

        -- Indexes
        INDEX idx_approvals_session_id (session_id),
        INDEX idx_approvals_status (status),
        INDEX idx_approvals_created_at (created_at)
    );

    PRINT '✅ Table created: approvals';
END
ELSE
BEGIN
    PRINT 'ℹ️  Table already exists: approvals';
END
GO

-- ============================================
-- Table: checkpoints
-- ============================================
-- Stores agent state checkpoints for rollback
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'checkpoints')
BEGIN
    CREATE TABLE checkpoints (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        session_id UNIQUEIDENTIFIER NOT NULL,
        checkpoint_name NVARCHAR(255) NOT NULL,
        checkpoint_data NVARCHAR(MAX) NOT NULL, -- JSON serialized state
        created_at DATETIME2(7) NOT NULL DEFAULT GETUTCDATE(),

        -- Foreign Keys
        CONSTRAINT fk_checkpoints_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,

        -- Indexes
        INDEX idx_checkpoints_session_id (session_id),
        INDEX idx_checkpoints_created_at (created_at)
    );

    PRINT '✅ Table created: checkpoints';
END
ELSE
BEGIN
    PRINT 'ℹ️  Table already exists: checkpoints';
END
GO

-- ============================================
-- Table: audit_log
-- ============================================
-- Stores audit trail of all important actions
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'audit_log')
BEGIN
    CREATE TABLE audit_log (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        user_id UNIQUEIDENTIFIER NULL,
        session_id UNIQUEIDENTIFIER NULL,
        action NVARCHAR(100) NOT NULL, -- 'login', 'logout', 'create_session', 'delete_session', 'approve', 'reject', etc.
        entity_type NVARCHAR(100) NULL, -- 'user', 'session', 'message', 'approval', etc.
        entity_id UNIQUEIDENTIFIER NULL,
        details NVARCHAR(MAX) NULL, -- JSON details
        ip_address NVARCHAR(50) NULL,
        user_agent NVARCHAR(500) NULL,
        created_at DATETIME2(7) NOT NULL DEFAULT GETUTCDATE(),

        -- Foreign Keys
        CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT fk_audit_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL,

        -- Indexes
        INDEX idx_audit_user_id (user_id),
        INDEX idx_audit_session_id (session_id),
        INDEX idx_audit_action (action),
        INDEX idx_audit_created_at (created_at),
        INDEX idx_audit_entity (entity_type, entity_id)
    );

    PRINT '✅ Table created: audit_log';
END
ELSE
BEGIN
    PRINT 'ℹ️  Table already exists: audit_log';
END
GO

-- ============================================
-- Table: refresh_tokens
-- ============================================
-- Stores JWT refresh tokens
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'refresh_tokens')
BEGIN
    CREATE TABLE refresh_tokens (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        user_id UNIQUEIDENTIFIER NOT NULL,
        token_hash NVARCHAR(255) NOT NULL UNIQUE,
        expires_at DATETIME2(7) NOT NULL,
        is_revoked BIT NOT NULL DEFAULT 0,
        created_at DATETIME2(7) NOT NULL DEFAULT GETUTCDATE(),
        revoked_at DATETIME2(7) NULL,

        -- Foreign Keys
        CONSTRAINT fk_refresh_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,

        -- Indexes
        INDEX idx_refresh_tokens_user_id (user_id),
        INDEX idx_refresh_tokens_expires_at (expires_at),
        INDEX idx_refresh_tokens_is_revoked (is_revoked)
    );

    PRINT '✅ Table created: refresh_tokens';
END
ELSE
BEGIN
    PRINT 'ℹ️  Table already exists: refresh_tokens';
END
GO

-- ============================================
-- Triggers: Auto-update updated_at timestamps
-- ============================================

-- Trigger for users table
IF NOT EXISTS (SELECT * FROM sys.triggers WHERE name = 'trg_users_updated_at')
BEGIN
    EXEC('
    CREATE TRIGGER trg_users_updated_at
    ON users
    AFTER UPDATE
    AS
    BEGIN
        SET NOCOUNT ON;
        UPDATE users
        SET updated_at = GETUTCDATE()
        FROM users u
        INNER JOIN inserted i ON u.id = i.id;
    END
    ');
    PRINT '✅ Trigger created: trg_users_updated_at';
END
GO

-- Trigger for sessions table
IF NOT EXISTS (SELECT * FROM sys.triggers WHERE name = 'trg_sessions_updated_at')
BEGIN
    EXEC('
    CREATE TRIGGER trg_sessions_updated_at
    ON sessions
    AFTER UPDATE
    AS
    BEGIN
        SET NOCOUNT ON;
        UPDATE sessions
        SET updated_at = GETUTCDATE()
        FROM sessions s
        INNER JOIN inserted i ON s.id = i.id;
    END
    ');
    PRINT '✅ Trigger created: trg_sessions_updated_at';
END
GO

-- ============================================
-- Views: Useful queries
-- ============================================

-- View: Active sessions with user info
IF NOT EXISTS (SELECT * FROM sys.views WHERE name = 'vw_active_sessions')
BEGIN
    EXEC('
    CREATE VIEW vw_active_sessions AS
    SELECT
        s.id AS session_id,
        s.title AS session_title,
        s.created_at AS session_created_at,
        s.updated_at AS session_updated_at,
        u.id AS user_id,
        u.email AS user_email,
        u.full_name AS user_name,
        (SELECT COUNT(*) FROM messages WHERE session_id = s.id) AS message_count
    FROM sessions s
    INNER JOIN users u ON s.user_id = u.id
    WHERE s.is_active = 1
    ');
    PRINT '✅ View created: vw_active_sessions';
END
GO

-- View: Pending approvals
IF NOT EXISTS (SELECT * FROM sys.views WHERE name = 'vw_pending_approvals')
BEGIN
    EXEC('
    CREATE VIEW vw_pending_approvals AS
    SELECT
        a.id AS approval_id,
        a.action_type,
        a.action_description,
        a.created_at,
        s.id AS session_id,
        s.title AS session_title,
        u.id AS user_id,
        u.email AS user_email,
        u.full_name AS user_name
    FROM approvals a
    INNER JOIN sessions s ON a.session_id = s.id
    INNER JOIN users u ON s.user_id = u.id
    WHERE a.status = ''pending''
    ');
    PRINT '✅ View created: vw_pending_approvals';
END
GO

-- ============================================
-- Cleanup: Remove old data (optional stored procedure)
-- ============================================

IF NOT EXISTS (SELECT * FROM sys.procedures WHERE name = 'sp_cleanup_old_data')
BEGIN
    EXEC('
    CREATE PROCEDURE sp_cleanup_old_data
        @days_to_keep INT = 90
    AS
    BEGIN
        SET NOCOUNT ON;

        DECLARE @cutoff_date DATETIME2(7) = DATEADD(DAY, -@days_to_keep, GETUTCDATE());

        -- Delete old inactive sessions
        DELETE FROM sessions
        WHERE is_active = 0
          AND updated_at < @cutoff_date;

        -- Delete old audit logs
        DELETE FROM audit_log
        WHERE created_at < @cutoff_date;

        -- Delete expired refresh tokens
        DELETE FROM refresh_tokens
        WHERE expires_at < GETUTCDATE() OR is_revoked = 1;

        PRINT ''✅ Cleanup completed'';
    END
    ');
    PRINT '✅ Stored procedure created: sp_cleanup_old_data';
END
GO

-- ============================================
-- Final Summary
-- ============================================

PRINT '';
PRINT '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
PRINT '✅ Database schema initialization complete';
PRINT '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
PRINT '';
PRINT 'Tables created:';
PRINT '  - users';
PRINT '  - sessions';
PRINT '  - messages';
PRINT '  - approvals';
PRINT '  - checkpoints';
PRINT '  - audit_log';
PRINT '  - refresh_tokens';
PRINT '';
PRINT 'Views created:';
PRINT '  - vw_active_sessions';
PRINT '  - vw_pending_approvals';
PRINT '';
PRINT 'Stored procedures:';
PRINT '  - sp_cleanup_old_data';
PRINT '';
PRINT 'Next steps:';
PRINT '  1. Run seed-data.sql to populate with test data';
PRINT '  2. Create admin user';
PRINT '  3. Start the backend server';
PRINT '';
GO
