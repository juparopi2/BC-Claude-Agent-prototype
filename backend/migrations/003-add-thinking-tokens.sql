-- Migration 003: Add thinking_tokens column to messages table
-- Phase 1F: Extended Thinking Token Tracking
-- Date: 2025-11-24
-- Purpose: Track extended thinking token usage per message for billing and cost analysis
--
-- This migration adds the thinking_tokens column to the messages table to support
-- Anthropic's Extended Thinking feature. When enabled, Claude uses "thinking tokens"
-- for internal reasoning before generating the response.
--
-- Usage Flow:
-- 1. DirectAgentService enables extended thinking via thinking config
-- 2. Anthropic SDK returns thinking_tokens in message_delta events
-- 3. MessageQueue.processMessagePersistence stores thinking_tokens per message
-- 4. Admin can query total thinking tokens for billing/cost analysis
--
-- Note: The agent_executions table already has a thinking_tokens column for
-- tracking total thinking tokens per execution. This migration adds per-message
-- tracking for more granular analysis.

-- ============================================================================
-- Step 1: Add thinking_tokens column to messages table
-- ============================================================================
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'messages' AND COLUMN_NAME = 'thinking_tokens'
)
BEGIN
    ALTER TABLE messages
    ADD thinking_tokens INT NULL;

    PRINT 'Added thinking_tokens column to messages table';
END
ELSE
BEGIN
    PRINT 'Column thinking_tokens already exists in messages table - skipping';
END
GO

-- ============================================================================
-- Step 2: Create index for efficient thinking token queries
-- ============================================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_messages_thinking_tokens' AND object_id = OBJECT_ID('messages')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_messages_thinking_tokens
    ON messages(session_id, created_at)
    INCLUDE (thinking_tokens)
    WHERE thinking_tokens IS NOT NULL;

    PRINT 'Created index IX_messages_thinking_tokens for efficient queries';
END
ELSE
BEGIN
    PRINT 'Index IX_messages_thinking_tokens already exists - skipping';
END
GO

-- ============================================================================
-- Step 3: Verify migration success
-- ============================================================================
SELECT
    c.COLUMN_NAME,
    c.DATA_TYPE,
    c.IS_NULLABLE,
    c.COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS c
WHERE c.TABLE_NAME = 'messages'
AND c.COLUMN_NAME IN ('model', 'input_tokens', 'output_tokens', 'thinking_tokens')
ORDER BY c.ORDINAL_POSITION;

PRINT '';
PRINT '============================================================================';
PRINT 'Migration 003: Add thinking_tokens COMPLETE';
PRINT 'The messages table now supports Extended Thinking token tracking.';
PRINT '';
PRINT 'Token columns in messages table:';
PRINT '  - model: Claude model name (e.g., "claude-sonnet-4-5-20250929")';
PRINT '  - input_tokens: Input tokens from Anthropic API';
PRINT '  - output_tokens: Output tokens from Anthropic API';
PRINT '  - total_tokens: Computed column (input_tokens + output_tokens)';
PRINT '  - thinking_tokens: Extended Thinking tokens (NEW)';
PRINT '============================================================================';
GO
