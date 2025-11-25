-- Migration 004: Remove thinking_tokens column from messages table
-- Date: 2025-11-24
-- Purpose: Implements Option A - Eliminate thinking_tokens column
-- Decision: User approved during CUA audit (2025-11-24)
--
-- Rationale:
-- 1. Anthropic SDK does NOT provide thinking_tokens separately
-- 2. Thinking tokens are included in output_tokens
-- 3. Current implementation used estimation which is unreliable
-- 4. Column adds complexity without providing real value
--
-- Note: WebSocket still shows estimated thinking tokens in real-time UI
-- (agent.types.ts:MessageEvent.tokenUsage.thinkingTokens)
-- This migration only removes database persistence.

-- ============================================================================
-- Step 1: Drop index if exists
-- ============================================================================
IF EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_messages_thinking_tokens' AND object_id = OBJECT_ID('messages')
)
BEGIN
    DROP INDEX IX_messages_thinking_tokens ON messages;
    PRINT 'Dropped index IX_messages_thinking_tokens';
END
ELSE
BEGIN
    PRINT 'Index IX_messages_thinking_tokens does not exist - skipping';
END
GO

-- ============================================================================
-- Step 2: Drop thinking_tokens column if exists
-- ============================================================================
IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'messages' AND COLUMN_NAME = 'thinking_tokens'
)
BEGIN
    ALTER TABLE messages DROP COLUMN thinking_tokens;
    PRINT 'Removed thinking_tokens column from messages table';
END
ELSE
BEGIN
    PRINT 'Column thinking_tokens does not exist in messages table - skipping';
END
GO

-- ============================================================================
-- Step 3: Verify migration success
-- ============================================================================
-- Confirm column no longer exists
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'messages' AND COLUMN_NAME = 'thinking_tokens'
)
BEGIN
    PRINT '';
    PRINT '============================================================================';
    PRINT 'Migration 004: Remove thinking_tokens COMPLETE';
    PRINT '';
    PRINT 'The thinking_tokens column has been removed from messages table.';
    PRINT '';
    PRINT 'Remaining token columns:';
    PRINT '  - model: Claude model name';
    PRINT '  - input_tokens: Input tokens from Anthropic API';
    PRINT '  - output_tokens: Output tokens (includes thinking tokens)';
    PRINT '  - total_tokens: Computed column (input + output)';
    PRINT '';
    PRINT 'Note: Real-time thinking token estimation is still available';
    PRINT 'via WebSocket (MessageEvent.tokenUsage.thinkingTokens)';
    PRINT '============================================================================';
END
ELSE
BEGIN
    PRINT 'ERROR: thinking_tokens column still exists!';
    RAISERROR('Migration 004 failed - column not removed', 16, 1);
END
GO

-- ============================================================================
-- Step 4: Show current token-related columns for verification
-- ============================================================================
SELECT
    c.COLUMN_NAME,
    c.DATA_TYPE,
    c.IS_NULLABLE,
    c.COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS c
WHERE c.TABLE_NAME = 'messages'
AND c.COLUMN_NAME IN ('model', 'input_tokens', 'output_tokens', 'total_tokens', 'thinking_tokens')
ORDER BY c.ORDINAL_POSITION;
GO
