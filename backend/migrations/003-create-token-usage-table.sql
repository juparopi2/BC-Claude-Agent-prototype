-- Migration 003: Create token_usage table for billing analytics
-- Date: 2025-11-24
-- Purpose: Track token usage per request for billing, analytics, and usage patterns
--
-- Design decisions:
-- 1. Denormalized user_id - persists even if session is deleted
-- 2. No CASCADE DELETE on session FK - preserves billing data
-- 3. Captures cache tokens and service tier for cost analysis
-- 4. thinking_enabled tracks Extended Thinking usage patterns

SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

USE [sqldb-bcagent-dev];
GO

-- Check if table already exists
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'token_usage')
BEGIN
    PRINT 'Creating token_usage table...';

    CREATE TABLE token_usage (
        -- Primary key
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),

        -- Identifiers (denormalized for billing persistence)
        user_id UNIQUEIDENTIFIER NOT NULL,
        session_id UNIQUEIDENTIFIER NOT NULL,
        message_id NVARCHAR(255) NOT NULL,  -- Anthropic message ID (msg_01...)

        -- Request metadata
        model NVARCHAR(100) NOT NULL,
        request_timestamp DATETIME2 NOT NULL DEFAULT GETUTCDATE(),

        -- Token counts (from SDK Usage)
        input_tokens INT NOT NULL,
        output_tokens INT NOT NULL,

        -- Cache tokens (from SDK - reduces costs)
        cache_creation_input_tokens INT NULL,
        cache_read_input_tokens INT NULL,

        -- Extended Thinking metadata
        thinking_enabled BIT NOT NULL DEFAULT 0,
        thinking_budget INT NULL,  -- Budget configured for request

        -- Service tier (affects pricing)
        service_tier NVARCHAR(20) NULL,  -- 'standard', 'priority', 'batch'

        -- Audit
        created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
    );

    PRINT 'token_usage table created successfully';
END
ELSE
BEGIN
    PRINT 'token_usage table already exists - skipping creation';
END
GO

-- Create indexes for billing queries
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_token_usage_user' AND object_id = OBJECT_ID('token_usage'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_token_usage_user
    ON token_usage(user_id, request_timestamp);
    PRINT 'Created index IX_token_usage_user';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_token_usage_session' AND object_id = OBJECT_ID('token_usage'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_token_usage_session
    ON token_usage(session_id, request_timestamp);
    PRINT 'Created index IX_token_usage_session';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_token_usage_model' AND object_id = OBJECT_ID('token_usage'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_token_usage_model
    ON token_usage(model, request_timestamp);
    PRINT 'Created index IX_token_usage_model';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_token_usage_message' AND object_id = OBJECT_ID('token_usage'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_token_usage_message
    ON token_usage(message_id);
    PRINT 'Created index IX_token_usage_message';
END
GO

-- Create view for user totals
IF EXISTS (SELECT 1 FROM sys.views WHERE name = 'vw_user_token_totals')
BEGIN
    DROP VIEW vw_user_token_totals;
END
GO

CREATE VIEW vw_user_token_totals AS
SELECT
    user_id,
    COUNT(*) as total_requests,
    SUM(input_tokens) as total_input_tokens,
    SUM(output_tokens) as total_output_tokens,
    SUM(input_tokens + output_tokens) as total_tokens,
    SUM(ISNULL(cache_creation_input_tokens, 0)) as total_cache_creation_tokens,
    SUM(ISNULL(cache_read_input_tokens, 0)) as total_cache_read_tokens,
    SUM(CASE WHEN thinking_enabled = 1 THEN 1 ELSE 0 END) as thinking_requests,
    MIN(request_timestamp) as first_request,
    MAX(request_timestamp) as last_request
FROM token_usage
GROUP BY user_id;
GO

PRINT 'Created view vw_user_token_totals';
GO

-- Create view for session totals
IF EXISTS (SELECT 1 FROM sys.views WHERE name = 'vw_session_token_totals')
BEGIN
    DROP VIEW vw_session_token_totals;
END
GO

CREATE VIEW vw_session_token_totals AS
SELECT
    session_id,
    user_id,
    COUNT(*) as total_requests,
    SUM(input_tokens) as total_input_tokens,
    SUM(output_tokens) as total_output_tokens,
    SUM(input_tokens + output_tokens) as total_tokens,
    SUM(ISNULL(cache_creation_input_tokens, 0)) as total_cache_creation_tokens,
    SUM(ISNULL(cache_read_input_tokens, 0)) as total_cache_read_tokens,
    MIN(request_timestamp) as session_start,
    MAX(request_timestamp) as session_last_activity
FROM token_usage
GROUP BY session_id, user_id;
GO

PRINT 'Created view vw_session_token_totals';
GO

-- Verify table structure
SELECT
    COLUMN_NAME,
    DATA_TYPE,
    IS_NULLABLE,
    COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'token_usage'
ORDER BY ORDINAL_POSITION;
GO

PRINT 'Migration 003-create-token-usage-table.sql completed successfully';
GO
