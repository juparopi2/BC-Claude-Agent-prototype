-- Migration: Add stop_reason field to messages table
-- Date: 2025-11-17
-- Purpose: Store native Anthropic SDK stop_reason to differentiate intermediate vs final messages
--
-- stop_reason values from SDK:
--   - 'end_turn': Natural completion - final message
--   - 'tool_use': Model wants to use a tool - intermediate message
--   - 'max_tokens': Truncated due to token limit
--   - 'stop_sequence': Hit custom stop sequence
--   - 'pause_turn': Long turn paused
--   - 'refusal': Policy violation

-- Add stop_reason column (nullable for backward compatibility)
ALTER TABLE messages
ADD stop_reason NVARCHAR(20) NULL;

-- Add constraint to validate stop_reason values
ALTER TABLE messages
ADD CONSTRAINT chk_messages_stop_reason
CHECK (stop_reason IN ('end_turn', 'tool_use', 'max_tokens', 'stop_sequence', 'pause_turn', 'refusal'));

-- Create index for filtering by stop_reason (performance optimization)
CREATE INDEX idx_messages_stop_reason ON messages(stop_reason)
WHERE stop_reason IS NOT NULL;

-- Optional: Add comment to document the field
EXEC sp_addextendedproperty
  @name = N'MS_Description',
  @value = N'Native Anthropic SDK stop_reason indicating message completion state. Used to differentiate intermediate (tool_use) vs final (end_turn) messages.',
  @level0type = N'SCHEMA', @level0name = N'dbo',
  @level1type = N'TABLE',  @level1name = N'messages',
  @level2type = N'COLUMN', @level2name = N'stop_reason';
