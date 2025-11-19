/**
 * Migration: Create message_events table for Event Sourcing
 *
 * This table implements an append-only event log for all message-related events.
 * Events are ordered by sequence_number and timestamp for reliable replay.
 *
 * @date 2025-11-19
 */

-- Set required options for filtered indexes
SET QUOTED_IDENTIFIER ON;
GO

-- Create message_events table
CREATE TABLE message_events (
    -- Primary key
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),

    -- Foreign keys
    session_id UNIQUEIDENTIFIER NOT NULL,

    -- Event metadata
    event_type NVARCHAR(50) NOT NULL, -- 'user_message_sent', 'agent_message_sent', etc.
    sequence_number INT NOT NULL, -- Auto-incremented per session for ordering
    timestamp DATETIME2(7) NOT NULL DEFAULT GETUTCDATE(),

    -- Event payload (JSON)
    data NVARCHAR(MAX) NOT NULL, -- JSON serialized event data

    -- Processing status
    processed BIT NOT NULL DEFAULT 0,

    -- Indexes
    INDEX IX_message_events_session_sequence (session_id, sequence_number),
    INDEX IX_message_events_timestamp (timestamp DESC),
    INDEX IX_message_events_unprocessed (processed, timestamp) WHERE processed = 0,

    -- Constraints
    CONSTRAINT FK_message_events_sessions FOREIGN KEY (session_id)
        REFERENCES sessions(id) ON DELETE CASCADE,
    CONSTRAINT CK_message_events_sequence_positive CHECK (sequence_number >= 0),
    CONSTRAINT CK_message_events_valid_type CHECK (
        event_type IN (
            'user_message_sent',
            'agent_thinking_started',
            'agent_thinking_completed',
            'agent_message_sent',
            'agent_message_chunk',
            'tool_use_requested',
            'tool_use_completed',
            'approval_requested',
            'approval_completed',
            'todo_created',
            'todo_updated',
            'session_started',
            'session_ended',
            'error_occurred'
        )
    )
);

-- Create unique constraint on (session_id, sequence_number) to prevent duplicates
CREATE UNIQUE INDEX UQ_message_events_session_sequence
    ON message_events(session_id, sequence_number);

-- Add comment to table
EXEC sp_addextendedproperty
    @name = N'MS_Description',
    @value = N'Event Sourcing table for message events. Append-only, ordered by sequence_number.',
    @level0type = N'SCHEMA', @level0name = N'dbo',
    @level1type = N'TABLE', @level1name = N'message_events';

PRINT 'Migration 004: message_events table created successfully';
