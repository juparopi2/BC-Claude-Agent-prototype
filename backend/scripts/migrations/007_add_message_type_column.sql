-- Migration 007: Add message_type discriminator to messages table
-- Date: 2025-11-14
-- Purpose: Persist thinking and tool use messages for complete audit trail
-- NOTE: Uses temporary DEFAULT to allow adding NOT NULL column, then drops DEFAULT

-- Step 1: Add message_type column with temporary DEFAULT for existing rows
ALTER TABLE messages
ADD message_type NVARCHAR(20) NOT NULL DEFAULT 'standard';
PRINT 'Added message_type column with temporary DEFAULT';
GO

-- Step 2: Drop the DEFAULT constraint (future inserts must specify message_type)
DECLARE @ConstraintName NVARCHAR(200);
SELECT @ConstraintName = name
FROM sys.default_constraints
WHERE parent_object_id = OBJECT_ID('messages')
AND parent_column_id = (SELECT column_id FROM sys.columns
                        WHERE object_id = OBJECT_ID('messages')
                        AND name = 'message_type');

IF @ConstraintName IS NOT NULL
BEGIN
    EXEC('ALTER TABLE messages DROP CONSTRAINT ' + @ConstraintName);
    PRINT 'Dropped DEFAULT constraint - future inserts must specify message_type';
END
GO

-- Step 3: Add CHECK constraint to enforce valid message types
ALTER TABLE messages
ADD CONSTRAINT chk_messages_type
CHECK (message_type IN ('standard', 'thinking', 'tool_use'));
GO

-- Step 4: Create index for filtering by message type
CREATE NONCLUSTERED INDEX idx_messages_type
ON messages(message_type);
GO

-- Step 5: Create composite index for common query pattern (session + type)
CREATE NONCLUSTERED INDEX idx_messages_session_type
ON messages(session_id, message_type);
GO

-- Step 6: Verify migration
SELECT
  COUNT(*) AS total_messages,
  COUNT(CASE WHEN message_type = 'standard' THEN 1 END) AS standard_messages,
  COUNT(CASE WHEN message_type = 'thinking' THEN 1 END) AS thinking_messages,
  COUNT(CASE WHEN message_type = 'tool_use' THEN 1 END) AS tool_use_messages
FROM messages;
GO

-- Expected result: total_messages = 0 (fresh start)

PRINT 'Migration 007 completed successfully - Fresh start with message_type support';
GO
