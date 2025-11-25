# Implementation Plan: Pending Tasks

**Date**: 2025-11-24
**Status**: PLANNING
**Tasks**: 2 (thinking_tokens elimination + Extended Thinking per-request)

---

## Overview

Based on user decisions from the audit interview:
- **Option A**: Eliminate `thinking_tokens` column (approved)
- **Extended Thinking**: Per-request configuration (not global env only)

---

## Task 1: Eliminate thinking_tokens Column

### 1.1 Context

**User Decision**: Option A - Eliminate the column entirely

**Rationale**:
- SDK doesn't provide `thinking_tokens` separately (included in `output_tokens`)
- Current implementation uses estimation which is unreliable
- Column adds complexity without real value

### 1.2 Files to Modify

| File | Current State | Action |
|------|---------------|--------|
| `migrations/003-add-thinking-tokens.sql` | Adds column | Create rollback migration |
| `MessageQueue.ts:62` | `thinkingTokens?: number` | Remove field |
| `MessageQueue.ts:536,570,603,608-609` | Uses thinkingTokens | Remove usage |
| `database.ts:46` | `'thinking_tokens': sql.Int` | Remove mapping |
| `DirectAgentService.ts:236,687,695,783,837,867` | Tracks thinkingTokens | Keep for WebSocket (not DB) |
| `agent.types.ts:203,414` | `thinkingTokens?: number` | Keep in tokenUsage (WebSocket only) |
| `sessions.transformers.test.ts` | Tests thinking_tokens | Update tests |

### 1.3 Implementation Steps

#### Step 1: Create Rollback Migration

**File**: `migrations/004-remove-thinking-tokens.sql`

```sql
-- Migration 004: Remove thinking_tokens column from messages table
-- Implements Option A: Eliminate thinking_tokens (user approved 2025-11-24)
-- Reason: SDK doesn't provide thinking_tokens separately (included in output_tokens)

IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'messages' AND COLUMN_NAME = 'thinking_tokens'
)
BEGIN
    -- Drop index first if exists
    IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_messages_thinking_tokens')
    BEGIN
        DROP INDEX IX_messages_thinking_tokens ON messages;
        PRINT 'Dropped index IX_messages_thinking_tokens';
    END

    -- Drop column
    ALTER TABLE messages DROP COLUMN thinking_tokens;
    PRINT 'Removed thinking_tokens column from messages table';
END
ELSE
BEGIN
    PRINT 'Column thinking_tokens does not exist - skipping';
END
GO
```

#### Step 2: Update MessagePersistenceJob Interface

**File**: `MessageQueue.ts`

Remove:
```typescript
// ⭐ PHASE 1F: Extended Thinking token tracking
thinkingTokens?: number;
```

#### Step 3: Update processMessagePersistence

**File**: `MessageQueue.ts`

Remove from destructuring:
```typescript
const { ..., thinkingTokens } = job.data;  // Remove thinkingTokens
```

Remove from params:
```typescript
thinking_tokens: thinkingTokens ?? null,  // Remove this line
```

Update INSERT:
```sql
-- Remove thinking_tokens from column list and VALUES
INSERT INTO messages (id, ..., output_tokens)  -- Remove thinking_tokens
VALUES (@id, ..., @output_tokens)              -- Remove @thinking_tokens
```

#### Step 4: Update Database Type Mapping

**File**: `database.ts`

Remove:
```typescript
'thinking_tokens': sql.Int,
```

#### Step 5: Update Tests

**File**: `sessions.transformers.test.ts`

- Remove all `thinking_tokens` references from test expectations
- Update assertions to not expect `thinking_tokens` in response

#### Step 6: Keep WebSocket tokenUsage (DO NOT REMOVE)

**IMPORTANT**: Keep `thinkingTokens` in:
- `agent.types.ts:MessageEvent.tokenUsage.thinkingTokens` - For WebSocket streaming
- `DirectAgentService.ts` - For real-time estimation display

**Rationale**: Even if we don't persist to DB, we can still show estimated thinking tokens in real-time UI.

### 1.4 Test Plan

Create: `backend/src/__tests__/unit/migrations/thinking-tokens-removal.test.ts`

```typescript
describe('Migration 004: Remove thinking_tokens', () => {
  describe('MessagePersistenceJob', () => {
    it('should NOT have thinkingTokens field', () => {
      // Verify interface doesn't include thinkingTokens
    });
  });

  describe('MessageQueue INSERT', () => {
    it('should NOT include thinking_tokens column', () => {
      // Verify INSERT SQL doesn't reference thinking_tokens
    });
  });

  describe('Database type mapping', () => {
    it('should NOT have thinking_tokens mapping', () => {
      // Verify PARAMETER_TYPE_MAP doesn't include thinking_tokens
    });
  });

  describe('WebSocket tokenUsage (preserved)', () => {
    it('should still have thinkingTokens in MessageEvent.tokenUsage', () => {
      // Verify agent.types.ts still has thinkingTokens in tokenUsage
    });

    it('should still track thinking tokens in DirectAgentService', () => {
      // Verify DirectAgentService still calculates for real-time display
    });
  });
});
```

### 1.5 Documentation Updates

| Document | Section | Update |
|----------|---------|--------|
| `03-database-schema.md` | messages table | Remove thinking_tokens column |
| `types-reference.md` | MessageDbRecord | Remove thinking_tokens field |
| `TOKEN-USAGE-DESIGN.md` | Decision | Document Option A implementation |
| `DIAGNOSTIC-FINDINGS.md` | Action Items | Mark as completed |

---

## Task 2: Extended Thinking Per-Request Configuration

### 2.1 Context

**Current State**:
- Global env variable `ENABLE_EXTENDED_THINKING` (default: true)
- `AgentOptions.enableThinking` exists but not exposed to API

**Goal**: Allow per-request control of Extended Thinking from:
1. WebSocket `chat:message` payload
2. REST API (if applicable)

### 2.2 Files to Modify

| File | Current State | Action |
|------|---------------|--------|
| `websocket.types.ts` | `ChatMessageData` interface | Add `enableThinking`, `thinkingBudget` |
| `ChatMessageHandler.ts` | Handles `chat:message` | Pass thinking options to DirectAgentService |
| `DirectAgentService.ts` | Already supports options | No changes needed |
| `websocket-contract.md` | Documents `chat:message` | Add thinking options |
| `api-reference.md` | REST endpoints | Document if REST supports thinking |

### 2.3 Implementation Steps

#### Step 1: Update ChatMessageData Interface

**File**: `websocket.types.ts`

```typescript
export interface ChatMessageData {
  message: string;
  sessionId: string;
  userId: string;
  // ⭐ NEW: Per-request Extended Thinking configuration
  enableThinking?: boolean;    // Override global ENABLE_EXTENDED_THINKING
  thinkingBudget?: number;     // Budget tokens (default: 10000, min: 1024)
}
```

#### Step 2: Update ChatMessageHandler

**File**: `ChatMessageHandler.ts`

```typescript
// In handleChatMessage method
const {
  message,
  sessionId,
  userId,
  enableThinking,   // ⭐ NEW
  thinkingBudget,   // ⭐ NEW
} = data;

// Pass to DirectAgentService
const result = await this.agentService.executeQueryStreaming(
  sessionId,
  message,
  {
    userId,
    enableThinking,    // ⭐ Pass through
    thinkingBudget,    // ⭐ Pass through
    // ...other options
  },
  onEvent
);
```

#### Step 3: Add Validation

**File**: `ChatMessageHandler.ts`

```typescript
// Validate thinkingBudget
if (thinkingBudget !== undefined) {
  if (thinkingBudget < 1024) {
    throw new Error('thinkingBudget must be at least 1024 tokens');
  }
  if (thinkingBudget > 100000) {
    throw new Error('thinkingBudget cannot exceed 100000 tokens');
  }
}
```

### 2.4 Test Plan

Create: `backend/src/__tests__/unit/websocket/extended-thinking-config.test.ts`

```typescript
describe('Extended Thinking Per-Request Configuration', () => {
  describe('ChatMessageData interface', () => {
    it('should accept enableThinking boolean', () => {
      const data: ChatMessageData = {
        message: 'test',
        sessionId: 'uuid',
        userId: 'uuid',
        enableThinking: true,
      };
      expect(data.enableThinking).toBe(true);
    });

    it('should accept thinkingBudget number', () => {
      const data: ChatMessageData = {
        message: 'test',
        sessionId: 'uuid',
        userId: 'uuid',
        thinkingBudget: 15000,
      };
      expect(data.thinkingBudget).toBe(15000);
    });
  });

  describe('Validation', () => {
    it('should reject thinkingBudget < 1024', () => {
      // Test validation
    });

    it('should reject thinkingBudget > 100000', () => {
      // Test validation
    });

    it('should allow undefined (uses env default)', () => {
      // Test default behavior
    });
  });

  describe('DirectAgentService integration', () => {
    it('should pass enableThinking to executeQueryStreaming', () => {
      // Verify options are passed through
    });

    it('should override ENABLE_EXTENDED_THINKING when specified', () => {
      // Verify per-request overrides global
    });
  });
});
```

### 2.5 Documentation Updates

| Document | Section | Update |
|----------|---------|--------|
| `websocket-contract.md` | `chat:message` payload | Add enableThinking, thinkingBudget |
| `types-reference.md` | ChatMessageData | Add new fields |
| `api-reference.md` | WebSocket section | Document thinking configuration |

---

## Implementation Order

### Phase 1: thinking_tokens Removal (Lower Risk)

1. Create migration `004-remove-thinking-tokens.sql`
2. Update `MessageQueue.ts`
3. Update `database.ts`
4. Update tests
5. Update documentation
6. Run all tests
7. Build and verify

### Phase 2: Extended Thinking Config (Higher Complexity)

1. Update `websocket.types.ts`
2. Update `ChatMessageHandler.ts`
3. Create tests
4. Update documentation
5. Run all tests
6. Build and verify

---

## Verification Checklist

### Task 1: thinking_tokens Removal

- [ ] Migration `004-remove-thinking-tokens.sql` created
- [ ] `MessagePersistenceJob` no longer has `thinkingTokens`
- [ ] `processMessagePersistence` doesn't reference `thinking_tokens`
- [ ] `PARAMETER_TYPE_MAP` doesn't include `thinking_tokens`
- [ ] Tests updated and passing
- [ ] WebSocket `tokenUsage.thinkingTokens` still works (real-time display)
- [ ] Documentation updated
- [ ] Build passes
- [ ] Type-check passes
- [ ] Lint passes

### Task 2: Extended Thinking Config

- [ ] `ChatMessageData` includes `enableThinking`, `thinkingBudget`
- [ ] `ChatMessageHandler` validates and passes options
- [ ] Tests created and passing
- [ ] Documentation updated (websocket-contract.md)
- [ ] Build passes
- [ ] Type-check passes
- [ ] Lint passes

---

## Risk Assessment

| Task | Risk | Mitigation |
|------|------|------------|
| thinking_tokens removal | LOW | Column likely empty, migration is simple DROP |
| Extended Thinking config | MEDIUM | Need to ensure backward compatibility (undefined = use env default) |

---

## Estimated Effort

| Task | Effort |
|------|--------|
| thinking_tokens removal | 1-2 hours |
| Extended Thinking config | 2-3 hours |
| **Total** | **3-5 hours** |

---

**Plan Created**: 2025-11-24
**Ready for Implementation**: YES
