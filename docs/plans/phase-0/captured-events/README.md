# WebSocket Event Captures

This directory contains captured WebSocket events from the BC Claude Agent backend.

## Purpose

These captures help diagnose and compare:
- Raw Claude API events (from Anthropic SDK)
- WebSocket events emitted by the backend
- Event transformation and ordering

## Capture Script

Use the capture script to record WebSocket events during a chat session:

```bash
# From project root
npx tsx backend/scripts/capture-websocket-events.ts \
  --message "What is 2+2?" \
  --output "docs/plans/phase-0/captured-events/"
```

## Capture Format

Each capture file contains:

```typescript
{
  startTime: number;         // Unix timestamp (ms)
  endTime: number;           // Unix timestamp (ms)
  serverUrl: string;         // WebSocket server URL
  sessionId: string;         // Session ID
  userId: string;            // User ID
  message: string;           // Message sent to agent
  events: WebSocketCapture[]; // All captured events
  metadata: {
    totalEvents: number;
    durationMs: number;
    eventTypeCounts: Record<string, number>;
  };
}
```

### Event Structure

Each captured event:

```typescript
{
  timestamp: number;   // Unix timestamp (ms)
  eventName: string;   // Event name (e.g., 'agent:event')
  payload: unknown;    // Event payload
}
```

## Event Types

The backend emits events via a single `agent:event` with type discrimination:

### Persisted Events (have sequence numbers)
- `thinking` - Complete thinking block
- `message` - Complete message
- `tool_use` - Tool execution request
- `tool_result` - Tool execution result
- `user_message_confirmed` - User message persisted

### Transient Events (no sequence numbers)
- `thinking_chunk` - Streaming thinking content
- `thinking_complete` - Thinking block finalized
- `message_chunk` - Streaming message content
- `complete` - Agent session complete
- `error` - Error occurred

### Special Events
- `approval_requested` - User approval needed (write operation)
- `approval_resolved` - User responded to approval
- `turn_paused` - Long turn paused
- `content_refused` - Policy violation

## Authentication Note

**IMPORTANT**: The backend requires a valid session cookie for WebSocket connections.

Current workaround options:
1. Use an existing session (copy `connect.sid` cookie from browser)
2. Modify backend to add a test endpoint without auth
3. Use Microsoft OAuth flow to create a session first

For now, the script will fail with authentication errors unless:
- Backend is running (`npm run dev`)
- A valid session exists for the sessionId/userId pair

## Usage Examples

### Basic capture
```bash
npx tsx backend/scripts/capture-websocket-events.ts
```

### Custom message
```bash
npx tsx backend/scripts/capture-websocket-events.ts \
  --message "Explain quantum computing"
```

### Custom timeout (for long responses)
```bash
npx tsx backend/scripts/capture-websocket-events.ts \
  --message "Write a detailed explanation of relativity" \
  --timeout 120000
```

### Custom session/user IDs
```bash
npx tsx backend/scripts/capture-websocket-events.ts \
  --session-id "my-session-123" \
  --user-id "my-user-456" \
  --message "Hello Claude"
```

## Analysis

To analyze captured events:

1. Compare event ordering (sequence numbers vs timestamps)
2. Verify persistence states (transient vs persisted)
3. Check for missing or duplicate events
4. Compare with raw Claude API events (from separate capture)

## Troubleshooting

### Connection fails
- Ensure backend is running: `cd backend && npm run dev`
- Check backend URL (default: `http://localhost:3002`)
- Verify CORS settings allow connections

### Authentication errors
- Backend requires valid session
- See "Authentication Note" above for workarounds

### Timeout errors
- Increase timeout: `--timeout 120000` (120 seconds)
- Check backend logs for errors
- Verify message isn't triggering infinite loops

### No events captured
- Check backend logs for errors
- Verify message is sent correctly
- Try a simpler message: `--message "Hello"`
