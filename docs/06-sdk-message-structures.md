# SDK Message Structures & Event Types

**Date**: 2025-11-17
**SDK Version**: `@anthropic-ai/sdk@0.68.0`
**Purpose**: Document native Anthropic SDK message types and properties to avoid over-engineering custom solutions

---

## Executive Summary

The Anthropic SDK provides native properties to differentiate message types (thinking vs intermediate vs final). **The critical property is `stop_reason`**:

- **`stop_reason: 'tool_use'`** → Agent is NOT done, more messages coming (intermediate message)
- **`stop_reason: 'end_turn'`** → Agent IS done, this is the final response

---

## 1. Native Content Block Types

```typescript
// From @anthropic-ai/sdk/resources/messages/messages.d.ts
type ContentBlock =
  | TextBlock               // Regular text responses
  | ThinkingBlock           // Extended thinking (requires budget_tokens config)
  | RedactedThinkingBlock   // Thinking with redacted content
  | ToolUseBlock            // Tool invocations
  | ServerToolUseBlock      // Server-side tools (e.g., web search)
  | WebSearchToolResultBlock;

// TextBlock - Regular text responses
interface TextBlock {
  type: 'text';
  text: string;
  citations: Array<TextCitation> | null;
}

// ThinkingBlock - Extended thinking
interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
  signature: string;  // Integrity verification
}

// ToolUseBlock - Tool invocations
interface ToolUseBlock {
  type: 'tool_use';
  id: string;      // Unique tool use ID (e.g., "toolu_01D7FLrfh4GYq7yT1ULFeyMV")
  name: string;    // Tool name
  input: unknown;  // Tool arguments (JSON)
}
```

---

## 2. Stop Reason Values (CRITICAL)

```typescript
// From messages.d.ts line 468
type StopReason =
  | 'end_turn'       // ⭐ Natural completion - NO MORE MESSAGES EXPECTED
  | 'max_tokens'     // Truncated due to token limit
  | 'stop_sequence'  // Hit custom stop sequence
  | 'tool_use'       // ⭐ Model wants to use a tool - MORE TURNS COMING
  | 'pause_turn'     // Long turn paused (can resume with same response)
  | 'refusal';       // Policy violation (classifiers intervened)
```

**How to Use**:
- Messages with `stop_reason: 'tool_use'` → Intermediate (group in thinking collapsible)
- Messages with `stop_reason: 'end_turn'` → Final (display as main response)

---

## 3. Streaming Events

### Raw Stream Events

```typescript
// From @anthropic-ai/sdk/resources/messages/messages.d.ts
type RawMessageStreamEvent =
  | RawMessageStartEvent       // Start of message
  | RawMessageDeltaEvent       // Message-level updates (stop_reason, token usage)
  | RawMessageStopEvent        // End of message
  | RawContentBlockStartEvent  // Start of content block (text, thinking, tool_use)
  | RawContentBlockDeltaEvent  // Content updates (text_delta, thinking_delta, input_json_delta)
  | RawContentBlockStopEvent;  // End of content block
```

### MessageStream Helper Events (Convenience Layer)

```typescript
// From @anthropic-ai/sdk/lib/MessageStream.d.ts
interface MessageStreamEvents {
  connect: () => void;
  streamEvent: (event: MessageStreamEvent, snapshot: Message) => void;
  text: (textDelta: string, textSnapshot: string) => void;
  thinking: (thinkingDelta: string, thinkingSnapshot: string) => void;  // ⭐ NATIVE THINKING EVENT
  contentBlock: (content: ContentBlock) => void;
  finalMessage: (message: Message) => void;  // ⭐ NATIVE FINAL MESSAGE EVENT
  error: (error: AnthropicError) => void;
  end: () => void;
}
```

---

## 4. Message Delta Event (Token Usage)

```typescript
interface RawMessageDeltaEvent {
  type: 'message_delta';
  delta: {
    stop_reason: StopReason | null;  // ⭐ CRITICAL for message stage detection
    stop_sequence: string | null;
  };
  usage: MessageDeltaUsage;  // ⭐ Cumulative token counts
}

interface MessageDeltaUsage {
  input_tokens: number | null;           // Cumulative input tokens
  output_tokens: number;                 // Cumulative output tokens
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
  thinking_tokens: number | null;        // ⭐ Extended thinking token count
}
```

---

## 5. SDK Properties vs Current Usage

| SDK Property | Type | Available | Currently Used | Stored in DB | Should Use |
|--------------|------|-----------|----------------|--------------|------------|
| **`stop_reason`** | `StopReason` | ✅ Yes | ❌ No | ❌ No | ✅ **YES** - Critical for "is final" detection |
| **`content_block.type`** | `'text' \| 'thinking' \| 'tool_use'` | ✅ Yes | ⚠️ Partial | ⚠️ As `message_type` | ✅ **YES** - Already using correctly |
| **`content_block.index`** | `number` | ✅ Yes | ❌ No | ❌ No | ⚠️ Maybe - For ordering multiple blocks |
| **`usage` (cumulative)** | `MessageDeltaUsage` | ✅ Yes | ⚠️ Partial | ⚠️ As separate fields | ✅ **YES** - Track per-turn token usage |
| **`thinking_tokens`** | `number` (in usage) | ✅ Yes | ❌ No | ⚠️ Column exists but unused | ✅ **YES** - Populate from usage |
| **`tool_use_id`** | `string` | ✅ Yes | ✅ Yes | ✅ Yes (in metadata) | ✅ **YES** - Already using |
| **`signature`** (thinking) | `string` | ✅ Yes | ❌ No | ❌ No | ⚠️ Maybe - For integrity verification |
| **`citations`** | `TextCitation[]` | ✅ Yes | ❌ No | ❌ No | ❌ No - Not relevant for BC |

---

## 6. Content Block Index (Ordering)

Every streaming event for a content block includes an `index` property:

```typescript
interface RawContentBlockStartEvent {
  type: 'content_block_start';
  index: number;  // ⭐ Position in final Message.content array
  content_block: ContentBlock;
}
```

**Usage**:
- Thinking is usually `index: 0`
- Text blocks follow (`index: 1, 2, ...`)
- Tool use blocks have their own indices
- Use to maintain chronological order when displaying messages

---

## 7. Implementation Recommendations

### Database Schema

**Add `stop_reason` field to messages table:**

```sql
ALTER TABLE messages
ADD stop_reason NVARCHAR(20) NULL;

ALTER TABLE messages
ADD CONSTRAINT chk_messages_stop_reason
CHECK (stop_reason IN ('end_turn', 'tool_use', 'max_tokens', 'stop_sequence', 'pause_turn', 'refusal'));
```

### Backend: Capture stop_reason

```typescript
// In DirectAgentService.executeQuery()
for (const block of response.content) {
  if (block.type === 'text') {
    onEvent({
      type: 'message',
      content: block.text,
      role: 'assistant',
      stopReason: response.stop_reason,  // ⭐ ADD THIS
    });
  }
}
```

### Frontend: Filter by stop_reason

```typescript
// Intermediate messages (during agentic loop)
const intermediateMessages = messages.filter(m =>
  m.message_type === 'standard' &&
  m.stop_reason === 'tool_use'  // ⭐ KEY INDICATOR
);

// Final messages (completed turns)
const finalMessages = messages.filter(m =>
  m.message_type === 'standard' &&
  m.stop_reason === 'end_turn'  // ⭐ KEY INDICATOR
);
```

---

## 8. Testing Scenarios

**Scenario 1: Simple Query (No Tools)**
- Expected: 1 text block with `stop_reason: 'end_turn'`
- Verify: Message marked as "final"

**Scenario 2: Query with Tools**
- Expected:
  - Text block 1: `stop_reason: 'tool_use'` → Intermediate
  - Tool use block
  - Tool result (user message)
  - Text block 2: `stop_reason: 'end_turn'` → Final
- Verify: Only block 2 marked as "final"

**Scenario 3: Extended Thinking Enabled**
- Expected:
  - Thinking block (index 0)
  - Text block (index 1) with `stop_reason: 'end_turn'`
- Verify: Thinking shown separately, text marked as "final"

---

## 9. Key Takeaways

1. **Use SDK's native `stop_reason` property** - don't invent custom flags
2. **"Intermediate messages" = messages with `stop_reason: 'tool_use'`** - not a separate type
3. **Store `stop_reason` in database** for proper message categorization
4. **Follow SDK's event model** for future maintainability

---

**Last Updated**: 2025-11-17
**Related Docs**:
- `02-sdk-first-philosophy.md` - SDK-first principles
- `01-architecture.md` - System architecture
