-- Drop valid types constraint
ALTER TABLE message_events DROP CONSTRAINT CK_message_events_valid_type;
GO

-- Recreate constraint with complete allowed types including agent_thinking_block
ALTER TABLE message_events ADD CONSTRAINT CK_message_events_valid_type CHECK (
    event_type IN (
        'session_started',
        'session_ended',
        'user_message_sent',
        'agent_message_sent',
        'agent_message_chunk',
        'agent_thinking_started',
        'agent_thinking_block', -- Added this
        'agent_thinking_completed',
        'tool_use_requested',
        'tool_use_completed',
        'error_occurred',
        'todo_created',
        'todo_updated',
        'approval_requested',
        'approval_completed'
    )
);
GO
