/**
 * Migration 005: Add Event Sourcing Fields to messages Table
 *
 * Adds sequence_number and event_id columns to support enhanced Event Sourcing architecture.
 * These fields enable:
 * - Guaranteed message ordering via sequence_number (replaces timestamp-based ordering)
 * - Event correlation via event_id (links messages to message_events)
 * - Enhanced frontend rendering with richer metadata
 *
 * Part of FASE 0 in the Event Sourcing refactor (Task 3).
 *
 * @date 2025-11-19
 */

-- Set required options for filtered indexes
SET QUOTED_IDENTIFIER ON;
GO

-- Add sequence_number column (nullable initially for existing rows)
ALTER TABLE messages
ADD sequence_number INT NULL;
GO

-- Add event_id column (nullable, references message_events table)
ALTER TABLE messages
ADD event_id UNIQUEIDENTIFIER NULL;
GO

-- Create index for ordering by sequence_number (replaces created_at ordering)
CREATE INDEX IX_messages_session_sequence
ON messages(session_id, sequence_number)
WHERE sequence_number IS NOT NULL;
GO

-- Create index for event_id lookup (for correlation with message_events)
CREATE INDEX IX_messages_event_id
ON messages(event_id)
WHERE event_id IS NOT NULL;
GO

-- Add foreign key constraint to message_events (if event_id is populated)
-- Note: This is optional and can be skipped if not all messages have corresponding events
ALTER TABLE messages
ADD CONSTRAINT FK_messages_event_id
FOREIGN KEY (event_id) REFERENCES message_events(id)
ON DELETE SET NULL;
GO

-- Add comment to sequence_number column
EXEC sp_addextendedproperty
    @name = N'MS_Description',
    @value = N'Event Sourcing sequence number for guaranteed ordering. Replaces timestamp-based ordering to prevent race conditions.',
    @level0type = N'SCHEMA', @level0name = N'dbo',
    @level1type = N'TABLE', @level1name = N'messages',
    @level2type = N'COLUMN', @level2name = N'sequence_number';

-- Add comment to event_id column
EXEC sp_addextendedproperty
    @name = N'MS_Description',
    @value = N'References the message_events table for event correlation. Links messages to their originating event.',
    @level0type = N'SCHEMA', @level0name = N'dbo',
    @level1type = N'TABLE', @level1name = N'messages',
    @level2type = N'COLUMN', @level2name = N'event_id';

PRINT 'Migration 005: Event Sourcing fields added to messages table successfully';
PRINT '  - Added sequence_number (INT NULL)';
PRINT '  - Added event_id (UNIQUEIDENTIFIER NULL)';
PRINT '  - Created IX_messages_session_sequence index';
PRINT '  - Created IX_messages_event_id index';
PRINT '  - Added FK_messages_event_id foreign key constraint';
