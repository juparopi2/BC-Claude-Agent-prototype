-- Migration: Add citations_created event type
-- Purpose: Support citation persistence in message_events table

-- Drop existing constraint
ALTER TABLE message_events DROP CONSTRAINT CK_message_events_valid_type;
GO

-- Recreate constraint with citations_created event type
ALTER TABLE message_events ADD CONSTRAINT CK_message_events_valid_type CHECK (
    event_type IN (
        'session_started',
        'session_ended',
        'user_message_sent',
        'agent_message_sent',
        'agent_message_chunk',
        'agent_thinking_started',
        'agent_thinking_block',
        'agent_thinking_completed',
        'tool_use_requested',
        'tool_use_completed',
        'error_occurred',
        'todo_created',
        'todo_updated',
        'approval_requested',
        'approval_completed',
        'citations_created'  -- NEW: For citation persistence
    )
);
GO
