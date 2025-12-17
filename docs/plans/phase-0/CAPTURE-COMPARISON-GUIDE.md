# Event Capture Comparison Guide

This guide explains how to capture and compare events from two sources:
1. **WebSocket events** - Events emitted by our backend to the frontend
2. **Raw Claude API events** - Events from Anthropic's streaming API

## Why Compare?

The backend transforms raw Claude API events into our WebSocket contract. By comparing both captures, we can:
- Verify event transformation is correct
- Debug ordering issues
- Identify missing or duplicate events
- Validate persistence states
- Compare timing and performance

## Step 1: Capture WebSocket Events

### Prerequisites
- Backend must be running: `cd backend && npm run dev`
- Valid session (or modify backend for test endpoint)

### Run Capture
```bash
# From project root
cd backend
npm run capture:websocket -- --message "What is 2+2?"

# Or with custom options
npm run capture:websocket -- \
  --message "Explain quantum computing" \
  --timeout 60000 \
  --output "../docs/plans/phase-0/captured-events/"
```

### Output
- File: `docs/plans/phase-0/captured-events/websocket-capture-{timestamp}.json`
- Contains: All WebSocket events emitted via `agent:event`

## Step 2: Capture Raw Claude API Events

### Prerequisites
- Claude API key in `.env`: `ANTHROPIC_API_KEY=sk-...`
- Script: `backend/scripts/capture-claude-api-events.ts` (TO BE CREATED)

### Run Capture
```bash
# From project root
cd backend
npm run capture:claude-api -- --message "What is 2+2?"

# Or with custom options
npm run capture:claude-api -- \
  --message "Explain quantum computing" \
  --model "claude-sonnet-4-5-20250929" \
  --output "../docs/plans/phase-0/captured-events/"
```

### Output
- File: `docs/plans/phase-0/captured-events/claude-api-capture-{timestamp}.json`
- Contains: All raw Anthropic SDK streaming events

## Step 3: Compare Captures

### Manual Comparison

Open both JSON files and compare:

1. **Event ordering**
   - WebSocket: Check `sequenceNumber` field (persisted events)
   - Claude API: Check event order in array

2. **Event types**
   - WebSocket: `agent:event` with `type` field
   - Claude API: Various event types (content_block_start, content_block_delta, etc.)

3. **Persistence states**
   - WebSocket: `persistenceState` field (transient/persisted)
   - Claude API: No persistence concept (all events are raw)

4. **Content**
   - WebSocket: Transformed/aggregated content
   - Claude API: Raw deltas and chunks

### Automated Comparison (Future)

A comparison script will be created to automate this:

```bash
npm run compare:captures -- \
  --websocket "captured-events/websocket-capture-2024-01-15T10-30-00-000Z.json" \
  --claude-api "captured-events/claude-api-capture-2024-01-15T10-30-00-000Z.json"
```

## Event Type Mapping

### Claude API → WebSocket

| Claude API Event | WebSocket Event | Persistence |
|-----------------|----------------|-------------|
| `message_start` | *(internal only)* | N/A |
| `content_block_start` (type: text) | *(accumulate)* | N/A |
| `content_block_delta` (type: text_delta) | `message_chunk` | Transient |
| `content_block_stop` (type: text) | `message` | Persisted |
| `content_block_start` (type: thinking) | *(accumulate)* | N/A |
| `content_block_delta` (type: thinking_delta) | `thinking_chunk` | Transient |
| `content_block_stop` (type: thinking) | `thinking` + `thinking_complete` | Persisted + Transient |
| `content_block_start` (type: tool_use) | *(accumulate)* | N/A |
| `content_block_delta` (type: input_json_delta) | *(accumulate)* | N/A |
| `content_block_stop` (type: tool_use) | `tool_use` | Persisted |
| `message_delta` (usage) | *(accumulate)* | N/A |
| `message_stop` | `complete` | Transient |

### Notes

- **Accumulation**: Backend accumulates raw deltas into complete blocks
- **Persistence**: Only complete blocks are persisted with sequence numbers
- **Chunks**: Real-time streaming chunks are transient (no sequence numbers)

## Common Issues

### WebSocket Capture Fails

**Problem**: Connection error or authentication failure

**Solutions**:
1. Ensure backend is running: `cd backend && npm run dev`
2. Check backend logs for errors
3. Verify session/user IDs are valid
4. Consider adding test endpoint without auth

### Claude API Capture Fails

**Problem**: API key invalid or rate limit

**Solutions**:
1. Check `.env` has valid `ANTHROPIC_API_KEY`
2. Verify API key has sufficient credits
3. Check Anthropic status page for outages
4. Reduce request rate (add delays between captures)

### Events Don't Match

**Problem**: Different event counts or content

**Expected**:
- Claude API has MORE events (raw deltas)
- WebSocket has FEWER events (aggregated)
- Content should match after accumulation
- Ordering should be consistent (with sequence numbers)

**Investigate**:
- Check backend transformation logic
- Verify no events are dropped
- Compare content after accumulation
- Look for timing/race conditions

## File Naming Convention

Use timestamps for easy matching:

```
websocket-capture-2024-01-15T10-30-00-000Z.json
claude-api-capture-2024-01-15T10-30-00-000Z.json
```

This makes it clear which files should be compared together.

## Analysis Checklist

When comparing captures, verify:

- [ ] All Claude API deltas are accumulated correctly
- [ ] WebSocket events have correct persistence states
- [ ] Sequence numbers are monotonically increasing
- [ ] No duplicate events in WebSocket capture
- [ ] Timestamps are reasonable (no huge gaps)
- [ ] Tool use events have matching tool results
- [ ] Complete event marks end of stream
- [ ] Error events (if any) have proper error messages
- [ ] Token usage matches (if available)
- [ ] Message IDs are consistent

## Next Steps

1. Create `capture-claude-api-events.ts` script
2. Add comparison script for automated analysis
3. Document common discrepancies and their causes
4. Create test suite for event transformation
