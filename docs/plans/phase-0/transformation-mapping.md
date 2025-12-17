# Claude API Event Transformation Mapping

## Document Version
- Date: 2025-12-17
- Source: Phase 0 Event Capture & StreamAdapter Analysis
- Model: claude-sonnet-4-20250514

## Overview

This document maps how Claude API streaming events transform as they flow through our system architecture, from the raw Anthropic SDK events to the final WebSocket events consumed by the frontend.

## Transformation Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│                  CLAUDE API (Anthropic SDK)                      │
│                  Raw Streaming Events                            │
├─────────────────────────────────────────────────────────────────┤
│ message_start                                                    │
│ content_block_start (thinking | text | tool_use)                │
│ content_block_delta (thinking_delta | text_delta |              │
│                      signature_delta | input_json_delta |        │
│                      citations_delta)                            │
│ content_block_stop                                               │
│ message_delta                                                    │
│ message_stop                                                     │
└─────────────────────────────────────────────────────────────────┘
                              ↓
                    LangChain Integration
                  streamEvents() Wrapper API
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                  LANGCHAIN STREAM EVENTS                         │
│            Wrapped in StreamEvent Interface                      │
├─────────────────────────────────────────────────────────────────┤
│ on_chat_model_stream                                             │
│   └─ data.chunk (AIMessageChunk)                                │
│        └─ content: Array<ContentBlock>                          │
│                                                                  │
│ on_chat_model_end                                                │
│   └─ data.output.llmOutput.usage                                │
│                                                                  │
│ on_tool_start (SKIPPED by StreamAdapter)                        │
│ on_tool_end (SKIPPED by StreamAdapter)                          │
│ on_tool_error (SKIPPED by StreamAdapter)                        │
└─────────────────────────────────────────────────────────────────┘
                              ↓
              StreamAdapter.processChunk()
           (backend/src/core/langchain/StreamAdapter.ts)
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    STREAMADAPTER OUTPUT                          │
│        Normalized to Internal Event Format                       │
├─────────────────────────────────────────────────────────────────┤
│ thinking_chunk                                                   │
│   └─ content, blockIndex, messageId, persistenceState           │
│                                                                  │
│ message_chunk                                                    │
│   └─ content, citations?, blockIndex, messageId,                │
│       persistenceState                                           │
│                                                                  │
│ usage (UsageEvent)                                               │
│   └─ usage: { input_tokens, output_tokens, ... }                │
│                                                                  │
│ null (filtered/skipped events)                                   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
                  DirectAgentService
        Accumulation, Deduplication, Enrichment
      (backend/src/services/agent/DirectAgentService.ts)
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    DIRECTAGENTSERVICE PROCESSING                 │
│           Adds Metadata & Business Logic                         │
├─────────────────────────────────────────────────────────────────┤
│ Accumulates:                                                     │
│   - thinkingChunks → final 'thinking' event                     │
│   - finalResponseChunks → final 'message' event                 │
│                                                                  │
│ Enriches with:                                                   │
│   - eventIndex (incremental within session)                     │
│   - sequenceNumber (from EventStore after persistence)          │
│   - persistenceState: transient → pending → persisted           │
│                                                                  │
│ Deduplicates:                                                    │
│   - Tool events via emittedToolUseIds Set                       │
│   - Prevents duplicate tool_use emissions                       │
│                                                                  │
│ Generates:                                                       │
│   - session_start (at beginning)                                │
│   - tool_use (from toolExecutions, not LangChain events)        │
│   - tool_result (after tool execution)                          │
│   - complete (at end with stop_reason)                          │
│   - error (on failure)                                           │
└─────────────────────────────────────────────────────────────────┘
                              ↓
                  MessageEmitter.emitEvent()
             (backend/src/services/agent/messages/MessageEmitter.ts)
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                   WEBSOCKET (agent:event)                        │
│               Final AgentEvent Types                             │
├─────────────────────────────────────────────────────────────────┤
│ session_start                                                    │
│   └─ sessionId, userId, modelConfig                             │
│                                                                  │
│ thinking_chunk                                                   │
│   └─ content, blockIndex, timestamp, eventId,                   │
│       persistenceState                                           │
│                                                                  │
│ thinking                                                         │
│   └─ content (accumulated), eventIndex, sequenceNumber,         │
│       persistenceState                                           │
│                                                                  │
│ message_chunk                                                    │
│   └─ content, citations?, blockIndex, timestamp, eventId,       │
│       persistenceState                                           │
│                                                                  │
│ message                                                          │
│   └─ content (accumulated), eventIndex, sequenceNumber,         │
│       persistenceState                                           │
│                                                                  │
│ tool_use                                                         │
│   └─ tool_name, tool_input, tool_call_id, eventIndex,           │
│       sequenceNumber, persistenceState                           │
│                                                                  │
│ tool_result                                                      │
│   └─ tool_name, result, tool_call_id, eventIndex,               │
│       sequenceNumber, persistenceState, isError?                │
│                                                                  │
│ complete                                                         │
│   └─ stop_reason, usage, eventIndex, sequenceNumber,            │
│       persistenceState                                           │
│                                                                  │
│ error                                                            │
│   └─ error, code, timestamp                                     │
└─────────────────────────────────────────────────────────────────┘
                              ↓
                    Frontend (Socket.IO Client)
                  Renders in UI with optimistic updates
```

## Event Type Mapping Table

| Claude API Event | LangChain Event | StreamAdapter Output | DirectAgent Output | WebSocket Event | Notes |
|-----------------|-----------------|---------------------|-------------------|----------------|-------|
| message_start | on_chat_model_stream (first) | null | session_start | session_start | Generated by DirectAgent, not from streaming |
| content_block_start (thinking) | on_chat_model_stream | null | null | null | Block initialization, no content yet |
| content_block_delta (thinking_delta) | on_chat_model_stream | thinking_chunk | thinking_chunk | thinking_chunk | Streamed thinking content |
| content_block_delta (signature_delta) | on_chat_model_stream | null | null | null | Cryptographic signature, not user-visible |
| content_block_stop (thinking) | on_chat_model_stream | null | thinking (accumulated) | thinking | Final accumulated thinking block |
| content_block_start (text) | on_chat_model_stream | null | null | null | Block initialization, no content yet |
| content_block_delta (text_delta) | on_chat_model_stream | message_chunk | message_chunk | message_chunk | Streamed response text |
| content_block_delta (citations_delta) | on_chat_model_stream | message_chunk (with citations) | message_chunk (with citations) | message_chunk (with citations) | RAG source attribution |
| content_block_stop (text) | on_chat_model_stream | null | message (accumulated) | message | Final accumulated message block |
| content_block_start (tool_use) | on_chat_model_stream | null | null | null | Block initialization for tool |
| content_block_delta (input_json_delta) | on_chat_model_stream | null | null | null | Tool input streaming (not displayed) |
| content_block_stop (tool_use) | on_chat_model_stream | null | null | null | Tool block complete |
| on_tool_start | on_tool_start | null (SKIPPED) | null | null | Skipped due to ID mismatch with Anthropic |
| on_tool_end | on_tool_end | null (SKIPPED) | null | null | Skipped due to ID mismatch with Anthropic |
| (toolExecutions array) | (from final output) | null | tool_use | tool_use | Generated from agent output, not stream |
| (after tool execution) | null | null | tool_result | tool_result | Generated by DirectAgent after execution |
| message_delta | on_chat_model_end | usage | null | null | Usage accumulated in DirectAgent |
| message_stop | on_chat_model_end | null | complete | complete | Final event with stop_reason & usage |

## Field Transformations

### Fields Added During Transformation

| Field | Added By | Purpose | Example Value |
|-------|----------|---------|---------------|
| blockIndex | StreamAdapter | Ordering of streaming events before persistence | 0, 1, 2, ... |
| eventIndex | DirectAgentService | Incremental event counter within session | 0, 1, 2, ... |
| sequenceNumber | DirectAgentService (from EventStore) | Database sequence for ordering | 1001, 1002, 1003, ... |
| persistenceState | DirectAgentService | Lifecycle state of event | 'transient', 'pending', 'persisted' |
| eventId | StreamAdapter | Unique identifier for transient events | uuid v4 |
| timestamp | StreamAdapter | Event creation time | Date object |
| messageId | StreamAdapter | Links chunks to source message | 'msg_01EaZkLgbCEBL76f826VjHZH' |
| tool_call_id | DirectAgentService | Links tool_result to tool_use | 'toolu_01Ao2QxVajRW868Yy9TFR33N' |

### Fields Lost During Transformation

| Field | Lost At | Reason | Impact |
|-------|---------|--------|--------|
| message.content (full array from message_start) | StreamAdapter | Already available in final message | None - redundant with streaming |
| signature | StreamAdapter | Not user-visible, verification only | Low - could add for audit |
| content_block.type | StreamAdapter | Implicit in event type | None - event type conveys this |
| cache_creation_input_tokens | StreamAdapter | Not exposed in usage event | Medium - could add for cost analysis |
| cache_read_input_tokens | StreamAdapter | Not exposed in usage event | Medium - could add for cost analysis |
| service_tier | StreamAdapter | Not tracked | Low - constant in deployment |
| LangChain run_id | StreamAdapter | Replaced with Anthropic IDs | None - Anthropic IDs more accurate |

### Fields Accumulated

| Field | Source | Accumulation Point | Purpose |
|-------|--------|-------------------|---------|
| thinking | thinking_delta events | DirectAgentService.thinkingChunks | Complete thinking block for persistence |
| content (message) | text_delta events | DirectAgentService.finalResponseChunks | Complete message text for persistence |
| citations | citations_delta events | StreamAdapter (per chunk) | Attached to message_chunk, preserved in accumulation |
| usage.input_tokens | message_delta | DirectAgentService.usage | Token count for billing/monitoring |
| usage.output_tokens | message_delta | DirectAgentService.usage | Token count for billing/monitoring |

## Special Cases & Edge Cases

### 1. Tool Event Deduplication

**Problem**: LangChain's `on_tool_start`/`on_tool_end` use LangGraph run IDs that don't match Anthropic's tool call IDs.

**Solution**:
- StreamAdapter **skips** `on_tool_start`, `on_tool_end`, `on_tool_error`
- DirectAgentService reads `toolExecutions` array from final agent output
- DirectAgentService uses `emittedToolUseIds` Set to prevent duplicate emissions

**Code Reference**:
```typescript
// StreamAdapter.ts (lines 193-217)
if (eventType === 'on_tool_start') {
    logger.debug('Skipping tool_start (will be handled by agent toolExecutions)');
    return null;
}

// DirectAgentService.ts (during agent execution)
const emittedToolUseIds = new Set<string>();
for (const toolExecution of toolExecutions) {
    if (!emittedToolUseIds.has(toolExecution.toolCall.id)) {
        // Emit tool_use event
        emittedToolUseIds.add(toolExecution.toolCall.id);
    }
}
```

### 2. Thinking Block Signature Handling

**Pattern**: Thinking blocks always end with `signature_delta` before `content_block_stop`.

**Processing**:
- StreamAdapter ignores `signature_delta` (not emitted)
- Signature is available in `message_start.content` for verification if needed
- Frontend never sees signature

**Reason**: Signatures are for cryptographic verification, not user display.

### 3. Citations Create Multiple Text Blocks

**Pattern**: When citations are present, a single logical response becomes multiple content blocks.

**Example Flow**:
1. `content_block_start` (text, no citations)
2. `content_block_delta` (text_delta: "Based on the document...")
3. `content_block_stop`
4. `content_block_start` (text, with citations array)
5. `content_block_delta` (citations_delta)
6. `content_block_delta` (text_delta: "- Financial Management...")
7. `content_block_stop`
8. `content_block_start` (text, no citations)
9. `content_block_delta` (text_delta: "The document also notes...")
10. `content_block_stop`

**Processing**:
- Each text block gets separate `message_chunk` events
- Citations attach to the chunk they precede
- Frontend must concatenate chunks while preserving citation metadata

### 4. Empty Content Arrays

**Pattern**: LangChain sometimes emits `on_chat_model_stream` with empty `chunk.content` arrays.

**Handling**:
```typescript
// StreamAdapter.ts (lines 70-73)
if (Array.isArray(chunk.content) && chunk.content.length === 0) {
    logger.debug('Empty content array, skipping');
    return null;
}
```

**Impact**: Prevents null/empty events from reaching DirectAgentService.

### 5. Block Index vs Event Index vs Sequence Number

**Three Ordering Systems**:

1. **blockIndex** (StreamAdapter):
   - Increments for each content block during streaming
   - Used by frontend for optimistic ordering before persistence
   - Resets per message/turn

2. **eventIndex** (DirectAgentService):
   - Increments for each event emitted in session
   - Includes non-streaming events (session_start, tool_use, complete)
   - Never resets during session lifetime

3. **sequenceNumber** (EventStore):
   - Global atomic counter from Redis INCR
   - Guaranteed unique and ordered across all sessions
   - Used for database persistence and final ordering

**Frontend Logic**:
```typescript
// Sort transient events by blockIndex
transientEvents.sort((a, b) => a.blockIndex - b.blockIndex);

// Sort persisted events by sequenceNumber
persistedEvents.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
```

## Persistence State Lifecycle

```
┌─────────────┐
│  transient  │  StreamAdapter creates event
└─────┬───────┘
      │
      │  DirectAgentService emits via MessageEmitter
      ↓
┌─────────────┐
│   pending   │  EventStore.logEvent() called
└─────┬───────┘
      │
      │  Event written to message_events table
      │  Sequence number assigned
      ↓
┌─────────────┐
│  persisted  │  EventStore confirms write
└─────────────┘  Frontend updates event with sequenceNumber
```

**State Transitions**:
- `transient`: Event exists only in memory/WebSocket
- `pending`: Event queued for persistence
- `persisted`: Event confirmed in database with sequenceNumber

## Usage Data Flow

```
Claude API message_delta
    └─ usage: { input_tokens, output_tokens, cache_* }
         ↓
LangChain on_chat_model_end
    └─ data.output.llmOutput.usage
         ↓
StreamAdapter
    └─ Returns UsageEvent { type: 'usage', usage: {...} }
         ↓
DirectAgentService
    └─ Accumulates in this.usage
         ↓
DirectAgentService complete event
    └─ Includes usage in final 'complete' event
         ↓
WebSocket agent:event (type: complete)
    └─ Frontend displays token usage
```

## Key Insights

### 1. StreamAdapter is a Filter, Not a Transformer

StreamAdapter primarily **filters** LangChain events rather than transforming them. It:
- Extracts content from nested structures
- Skips irrelevant events (tool events, empty content)
- Normalizes to internal format
- Does NOT add business logic or accumulation

### 2. DirectAgentService is the Orchestrator

DirectAgentService handles:
- Event accumulation (chunks → complete messages)
- Metadata enrichment (eventIndex, persistence state)
- Deduplication (tool events)
- Lifecycle management (session_start, complete)

### 3. Two Parallel Paths

**Streaming Path**:
- Claude API → LangChain → StreamAdapter → DirectAgent → WebSocket
- Real-time, transient events
- Optimistic UI updates

**Persistence Path**:
- DirectAgent → EventStore → Database → MessageQueue
- Async, durable storage
- Sequence numbers for ordering

### 4. Intentional Information Loss

Some fields are deliberately not propagated:
- **Signatures**: Verification only, not user-facing
- **Cache tokens**: Could be added for analytics, currently not needed
- **LangChain run IDs**: Replaced with Anthropic IDs for consistency
- **Input JSON deltas**: Tool inputs accumulated in tool_use event

### 5. Citations Complicate Streaming

Citations cause:
- Multiple content blocks for one logical message
- Interleaved citation_delta and text_delta events
- Complex frontend concatenation logic

This is the most complex streaming pattern to handle correctly.

## Testing Implications

### 1. Mock at the Right Layer

**For Agent Logic Tests**: Mock at StreamAdapter output level
```typescript
const fakeAdapter = {
    processChunk: vi.fn().mockReturnValue({
        type: 'message_chunk',
        content: 'test'
    })
};
```

**For StreamAdapter Tests**: Mock LangChain StreamEvent objects
```typescript
const mockStreamEvent: StreamEvent = {
    event: 'on_chat_model_stream',
    data: { chunk: { content: [{ type: 'text', text: 'test' }] } }
};
```

### 2. Test Accumulation Logic

Critical test: Ensure chunks accumulate into complete messages
```typescript
expect(thinkingChunks.join('')).toBe(finalThinkingEvent.content);
expect(messageChunks.join('')).toBe(finalMessageEvent.content);
```

### 3. Test Deduplication

Critical test: Tool events should not duplicate
```typescript
const toolEvents = events.filter(e => e.type === 'tool_use');
const uniqueIds = new Set(toolEvents.map(e => e.tool_call_id));
expect(toolEvents.length).toBe(uniqueIds.size);
```

### 4. Test Ordering

Critical test: Events should maintain order despite async operations
```typescript
const sortedBySequence = [...events].sort((a, b) =>
    a.sequenceNumber - b.sequenceNumber
);
expect(sortedBySequence).toEqual(events);
```

## Future Considerations

### 1. Add Cache Token Tracking

Currently lost: `cache_creation_input_tokens`, `cache_read_input_tokens`

**Benefit**: Cost analysis, cache effectiveness monitoring

**Change**: Add to UsageEvent and usage tracking

### 2. Preserve Thinking Signatures

Currently lost: Cryptographic signatures from thinking blocks

**Benefit**: Audit trail, verification of thinking authenticity

**Change**: Add optional `signature` field to `thinking` event

### 3. Expose Service Tier

Currently lost: `service_tier` from usage data

**Benefit**: Track which tier (standard/batch) was used

**Change**: Add to usage metadata

### 4. Enhanced Citation Metadata

Current: Basic citation with text and location

**Future**: Add relevance scores, confidence levels

**Change**: Extend Citation type, update StreamAdapter

## References

- **Source Files**:
  - `backend/src/core/langchain/StreamAdapter.ts`
  - `backend/src/services/agent/DirectAgentService.ts`
  - `backend/src/services/agent/messages/MessageEmitter.ts`
  - `backend/src/types/agent.types.ts`

- **Captured Events**:
  - `docs/plans/phase-0/captured-events/2025-12-17T00-08-48-thinking-diagnostic.json`
  - `docs/plans/phase-0/captured-events/2025-12-17T00-09-05-tools-diagnostic.json`
  - `docs/plans/phase-0/captured-events/2025-12-17T00-14-04-citations-diagnostic.json`
  - `docs/plans/phase-0/captured-events/2025-12-17T00-15-23-thinking-tools-interleaved-diagnostic.json`

- **Related Documentation**:
  - `docs/backend/websocket-contract.md` - Final WebSocket event schemas
  - `docs/plans/phase-0/claude-response-structure.json` - Raw Claude API event reference
