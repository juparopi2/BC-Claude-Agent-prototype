# PRD-091: Event Transmission, Persistence & Integrity Verification

**Estado**: 🟢 COMPLETE (Phase 9.B + 9.D)
**Fecha**: 2026-02-12
**Fase**: 9 (Graph Optimization)
**Dependencias**: PRD-061 (Agent Workflow Visibility), PRD-090 (Graph Logic Optimization)

---

## 1. Problem Statement

During **live WebSocket streaming**, users see a rich multi-agent experience: agent transitions, supervisor thinking, tool calls, messages from multiple agents, and orchestrator return flow. After **page refresh**, most of this context is lost — only thinking and one assistant message are visible.

### Live Experience vs Reload Experience

| Element | Live (WebSocket) | After Refresh |
|---------|-----------------|---------------|
| Supervisor thinking | Visible | Visible (persisted) |
| Agent transition (agent_changed) | Visible | **Missing** |
| Supervisor routing context (transfer_to_*) | Visible | **Missing** |
| Domain tool calls (tool_use/tool_result) | Not happening (PRD-090 issue) | **Missing** |
| Worker agent response | Visible | Visible (persisted) |
| Handoff-back (transfer_back_to_supervisor) | Visible (internal) | Correctly hidden |
| Supervisor final message | Visible (empty) | **Missing** |
| Orchestrator return flow | Visible | **Missing** |
| Complete event | Visible | Correctly hidden (transient) |

Only **2 of ~8 meaningful events** survive a page refresh.

---

## 2. Evidence from Logs

### Full Execution Trace

From `backend/logs/app.log` for a typical supervisor-routed query:

```
Step 1: HumanMessage (user query)
  → 1 message total

Step 2: 3 messages
  → Supervisor AIMessage (thinking content + transfer_to_bc-agent tool_call)
  → ToolMessage (handoff confirmation)
  → messageCount: 3

Step 3: 6 messages
  → BC Agent AIMessage (domain response)
  → transfer_back_to_supervisor ToolMessage
  → messageCount: 6

Step 4: 7 messages
  → Supervisor AIMessageChunk (EMPTY content array, contentLength: 0)
  → messageCount: 7
```

### Normalized Events Produced

`BatchResultNormalizer` processes all 7 messages and produces:

| Index | Event Type | Source | Persisted? |
|-------|-----------|--------|-----------|
| 0 | `thinking` | Supervisor AIMessage (step 2) | Yes (seq 2) |
| 1 | `tool_request` (transfer_to_bc-agent) | Supervisor AIMessage (step 2) | No (transient, isInternal) |
| 2 | `assistant_message` | BC Agent AIMessage (step 3) | Yes (seq 3) |
| 3 | `assistant_message` | Handoff-back message (step 3) | No (transient, isInternal) |
| 4 | `complete` | End of normalization | No (transient) |

**Zero events** from Step 4 — Supervisor's `AIMessageChunk` has empty content array, producing zero normalized events. `BatchResultNormalizer` logs: "AI message produced ZERO events - possible data loss" (`BatchResultNormalizer.ts:117-126`).

### Persistence Result

- 2 events persisted: thinking (supervisor) + assistant_message (BC agent)
- On reload, `reconstructFromMessages()` creates 2 groups from `agent_identity` field
- All agent transitions, routing context, and supervisor bookkeeping are lost

---

## 3. Root Cause Analysis per Missing Element

### 3.1 `agent_changed` Events — Now Persisted with `is_internal=true`

**✅ COMPLETE (Phase 9.B)**: `agent_changed` events are now persisted to the database with `is_internal=true` and `message_type: 'agent_changed'` via `PersistenceCoordinator.persistAgentChangedAsync()`. They are emitted via WebSocket during live execution for real-time UI updates, but also written to the database for audit trail and historical analysis.

**Impact**: Transition indicators are visible during live execution. On page reload, these events are stored in the database but filtered from the API response by the `is_internal` flag in `SessionService.getSessionMessages()`. This ensures the database has a complete audit trail of all agent transitions while the user-facing API returns only content-bearing messages.

**Implementation**: The `messages` table now has an `is_internal` column (BIT, defaults to 0). Internal events like agent transitions are marked `is_internal=1` during persistence.

### 3.2 Supervisor Routing Context — Now Persisted for Audit

The supervisor's `transfer_to_bc-agent` tool call is now marked with `persistenceStrategy: 'async_allowed'` (changed from `'transient'`) in `BatchResultNormalizer.ts:164-174`:

```typescript
// BatchResultNormalizer.ts:164-174
if (event.toolName.startsWith('transfer_to_')) {
  event.persistenceStrategy = 'async_allowed';  // Changed from 'transient'
  event.isInternal = true;
}
```

**Impact**: The routing decision is now persisted to the database with `is_internal=true` for audit purposes. On page reload, these internal tool calls are filtered from the API response, so users still only see the result (BC agent response) but not the internal routing mechanism. However, the database contains a complete record of all supervisor routing decisions for debugging and analytics.

**Acceptable design**: Handoff tools are internal infrastructure, not user-facing content. Persisting them as internal events preserves the audit trail without cluttering the user experience.

### 3.3 Domain Tool Calls — Not Happening

This is the PRD-090 issue. Agents are not calling domain tools, so there are zero `tool_use`/`tool_result` events to persist.

**Impact**: Once PRD-090 is implemented and agents start calling tools, tool events will flow through the existing persistence pipeline. `tool_use` and `tool_result` events with `persistenceStrategy: 'async_allowed'` are already designed to be persisted.

**No additional work needed for tool persistence** — the pipeline already handles it. PRD-090 will naturally fix this gap.

### 3.4 Supervisor Final Message — Empty Content

At Step 4, the supervisor produces an `AIMessageChunk` with an empty content array (`contentLength: 0`). This produces zero normalized events.

**Two possible explanations**:

1. **`createSupervisor` bookkeeping**: The supervisor may emit an internal state-tracking message after the worker completes. This message has no user-facing content and is expected to be empty.

2. **Lost supervisor response**: The supervisor may have intended to generate a synthesized final response, but the content was lost in the stream/adapt pipeline.

**Investigation needed**: Add detailed logging to `result-adapter.ts` at `adaptSupervisorResult()` to inspect the full content of each message at each step.

```typescript
// Proposed diagnostic logging in result-adapter.ts
for (let i = 0; i < messages.length; i++) {
  const msg = messages[i];
  logger.debug({
    index: i,
    type: msg.constructor.name,
    name: (msg as { name?: string }).name,
    contentType: typeof msg.content,
    contentIsArray: Array.isArray(msg.content),
    contentLength: Array.isArray(msg.content) ? msg.content.length : String(msg.content).length,
    contentPreview: Array.isArray(msg.content)
      ? JSON.stringify(msg.content.slice(0, 2))
      : String(msg.content).substring(0, 100),
  }, 'Message detail in supervisor result');
}
```

### 3.5 Orchestrator Return Flow — Persisted for Audit, Hidden from Users

The `transfer_back_to_supervisor` tool call is internal LangGraph machinery. It is now persisted with `is_internal=true` for audit trail but filtered from API responses. Users never see it on reload.

### 3.6 ChatMessageHandler Internal Event Check — Now Defense-in-Depth

**✅ COMPLETE (Phase 9.D)**: At `ChatMessageHandler.ts:281-293`, the handler checks for unpersisted messages. With the new architecture, internal events are no longer emitted via WebSocket (suppressed in `EventProcessor`), so the handler should never see them. The check now serves as defense-in-depth to catch any pipeline bugs where internal events leak through.

**Implementation**: `EventProcessor.processEvent()` now suppresses internal events before WebSocket emission. The handler's check for `isInternal` is retained as a safety net, but should never trigger under normal operation.

---

## 4. Event Persistence Tiers

### Tier 1: Already Persisted (Working Correctly)

| Event | Source | Status |
|-------|--------|--------|
| `thinking` | Supervisor extended thinking | Persisted with `sequenceNumber` |
| `assistant_message` | Domain agent response | Persisted with `sequenceNumber` |
| `user_message_confirmed` | User input | Persisted before agent execution |
| `agent_changed` | Agent transitions | **✅ NOW**: Persisted with `is_internal=true` |

### Tier 2: Should Be Persisted (Action Required)

| Event | Source | Current Status | Proposed Fix |
|-------|--------|---------------|-------------|
| `tool_use` | Domain tool calls | N/A (tools not called yet) | Will flow automatically after PRD-090 |
| `tool_result` | Domain tool results | N/A (tools not called yet) | Will flow automatically after PRD-090 |

### Tier 3: Internal Events — Persisted for Audit, Filtered from API

| Event | Source | Status |
|-------|--------|--------|
| `transfer_to_*` tool events | Supervisor handoff tools | **✅ NOW**: Persisted with `is_internal=true`, filtered from API |
| `transfer_back_to_*` messages | Worker return-to-supervisor | **✅ NOW**: Persisted with `is_internal=true`, filtered from API |

### Tier 4: Correctly Transient (No Changes Needed)

| Event | Source | Rationale |
|-------|--------|-----------|
| `session_start` | Session lifecycle | UI-only, reconstructed on reload |
| `complete` | Execution completion | UI-only, no content to persist |
| Supervisor final empty message | `createSupervisor` bookkeeping (if confirmed) | No user-facing content |

---

## 5. Investigation: Supervisor Final Message Empty Content

### Current Understanding

`adaptSupervisorResult()` in `result-adapter.ts:191-225` passes ALL messages (including the final empty one) to `BatchResultNormalizer`. The normalizer correctly skips messages that produce zero events, but logs a warning:

```
WARN: AI message produced ZERO events - possible data loss
  messageIndex: 6, contentType: object, contentIsArray: true, contentLength: 0
```

### Hypothesis A: `createSupervisor` Bookkeeping

`createSupervisor` from `@langchain/langgraph-supervisor` may add an internal state-tracking `AIMessageChunk` when the supervisor regains control after a worker completes. This message would intentionally have no user-facing content.

Evidence supporting this:
- The message is the last one (step 4), after the worker has completed
- It's an `AIMessageChunk` (not a full `AIMessage`), suggesting it's a stream fragment
- `createSupervisor` uses `addHandoffBackMessages: true`, which adds messages for transitions

### Hypothesis B: Lost Supervisor Response

The supervisor may generate a final synthesized response (e.g., "Here's what the BC Agent found...") that gets lost because:
- Stream mode (`streamMode: 'values'`) only captures the last state, not intermediate chunks
- The final message's content is set to empty during internal LangGraph state merging

### Investigation Plan

1. Add detailed message logging to `result-adapter.ts` (see Section 3.4)
2. Run test query through supervisor, inspect full message content at each step
3. Compare with `createSupervisor` source code to understand expected behavior
4. If Hypothesis A confirmed: suppress the "ZERO events" warning for final supervisor messages
5. If Hypothesis B confirmed: fix the stream/adapt pipeline to capture the response

---

## 6. Investigation: `reconstructFromMessages()` Limitations

### Current Implementation

`agentWorkflowStore.ts:182-228` reconstructs workflow groups from persisted messages:

```typescript
reconstructFromMessages: (messages) => {
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue;
    const agentIdentity = msg.agent_identity;
    if (!agentIdentity) continue;

    if (agentIdentity.agentId !== currentAgentId) {
      // New agent group
      groups.push({ id, agent: agentIdentity, ... });
      currentAgentId = agentIdentity.agentId;
    } else {
      // Same agent, add to current group
      groups[groups.length - 1].messageIds.push(msg.id);
    }
  }
}
```

### Current Capabilities

- Groups messages by `agent_identity.agentId` changes
- Creates transition info using the previous group's agent as `fromAgent`
- Assumes `handoffType: 'supervisor_routing'` for all reconstructed transitions
- Marks last group as final (expanded by default)

### Current Limitations

1. **Only 2 messages have `agent_identity`**: thinking (supervisor) and message (BC agent) — produces only 2 groups
2. **No transition events**: Without persisted `agent_changed` events, transitions are inferred (less accurate)
3. **No tool events**: Without domain tool calls, groups have no intermediate content
4. **All transitions assumed `supervisor_routing`**: Cannot distinguish between supervisor routing, agent handoff, and user selection

### Improvement After PRD-090 + This PRD

With PRD-090 (agents call tools) + Phase 9.B (persist transitions):

- **More messages per group**: thinking + tool_use + tool_result + assistant_message per agent
- **Explicit transitions**: `message_type: 'agent_changed'` messages provide exact `fromAgent`, `toAgent`, `handoffType`
- **Richer reconstruction**: Groups have intermediate workflow steps visible on reload

---

## 7. Proposed Remediation Strategy

### Phase 9.A: Fix Tool Enforcement First (PRD-090)

**Prerequisite for this PRD.** Once agents call domain tools:
- `tool_use` and `tool_result` events flow through existing persistence pipeline
- Groups in `reconstructFromMessages()` get richer content automatically
- The "Missing on reload" experience improves significantly without schema changes

### Phase 9.B: Persist Internal Events with `is_internal` Flag

**✅ COMPLETE (2026-02-12)**

#### Database Schema Change

Added `is_internal` column to `messages` table:

```sql
-- backend/prisma/schema.prisma
// is_internal column: BIT, defaults to 0
// Marks events that are persisted for audit but filtered from user-facing API
```

#### Implementation Details

1. **New `is_internal` column**: Added to `messages` table (BIT type, defaults to 0)

2. **New `message_type: 'agent_changed'`**: Added to supported message types alongside `'text'`, `'thinking'`, `'tool_use'`, `'tool_result'`

3. **`PersistenceCoordinator.persistAgentChangedAsync()`**: New method to persist agent transition events with `is_internal=true`

4. **`EventType` union updated**: Added `'agent_changed'` to the backend EventType union in `packages/shared/src/types/event.types.ts`

5. **Job types updated**: BullMQ job types now include `'agent_changed'` in the persistence pipeline

6. **Transfer tool persistence**: Changed from `'transient'` to `'async_allowed'` with `isInternal: true` in `BatchResultNormalizer.ts`

7. **WebSocket emission suppression**: `EventProcessor` now filters internal events before WebSocket emission

8. **API query filtering**: `SessionService.getSessionMessages()` filters `is_internal=1` events from API responses

**Design choice**: The implementation uses `is_internal` column + `message_type: 'agent_changed'` rather than the originally proposed `message_type: 'transition'`. This provides more flexibility for future internal event types.

**Audit trail preserved**: All internal events (agent transitions, transfer tools) are written to the database for debugging and analytics, but filtered from user-facing queries.

### Phase 9.C: Investigate Supervisor Empty Message

1. Add detailed logging to `result-adapter.ts` (as described in Section 5)
2. Run test queries and analyze logs
3. Determine if the empty message is expected bookkeeping or lost content
4. If bookkeeping: add `name` check to suppress the "ZERO events" warning
5. If lost content: fix the stream/adapt pipeline

### Phase 9.D: Fix EventProcessor Internal Event Suppression

**✅ COMPLETE (2026-02-12)**

Updated `EventProcessor.processEvent()` to suppress internal events before WebSocket emission:

```typescript
// EventProcessor.ts
async processEvent(event: NormalizedAgentEvent, ctx: ExecutionContext) {
  // Suppress internal events from WebSocket emission
  if (event.isInternal) {
    this.logger.debug({ eventType: event.type, isInternal: true },
      'Suppressing internal event from WebSocket emission');
    return;
  }

  // Emit to WebSocket for user-facing events only
  this.agentEventEmitter.emit(event, ctx);

  // Persist according to strategy (internal events handled separately)
  // ...
}
```

**ChatMessageHandler check now defense-in-depth**: The handler's check for `isInternal` should never trigger under normal operation, since internal events are suppressed earlier in the pipeline. The check remains as a safety net to catch pipeline bugs.

### Phase 9.E: Enhanced `reconstructFromMessages()` for Rich Workflow Reconstruction

**DEFERRED**: With PRD-092 removing the transition UI components, there is no consumer for reconstructed agent transitions. This phase is deferred until a future need arises for transition visualization on reload.

When implemented:

1. **Update `messageTransformer.ts`**: Add `'agent_changed'` case to transform DB rows into `AgentChangedMessageResponse` objects

2. **Add `AgentChangedMessageResponse` type** to `@bc-agent/shared`:
   ```typescript
   export interface AgentChangedMessageResponse {
     id: string;
     role: 'system';
     message_type: 'agent_changed';
     content: {
       fromAgent: AgentIdentity;
       toAgent: AgentIdentity;
       handoffType: HandoffType;
       reason?: string;
     };
     agent_identity: AgentIdentity;
     sequence_number: number;
     is_internal: boolean;  // always true
     created_at: string;
   }
   ```

3. **Update `reconstructFromMessages()`**: Use agent_changed messages for explicit group boundaries instead of inferring from `agent_identity` changes:
   ```typescript
   // If message is agent_changed, create new group with exact transition info
   if (msg.message_type === 'agent_changed' && !msg.is_internal) {
     const transition = JSON.parse(msg.content);
     groups.push({
       agent: transition.toAgent,
       transition: {
         fromAgent: transition.fromAgent,
         handoffType: transition.handoffType,
         reason: transition.reason,
       },
       ...
     });
   }
   ```

4. **Backward compatibility**: Fall back to current `agent_identity`-based grouping when agent_changed messages are absent (older sessions)

5. **Frontend renderer**: Create an `AgentChangedMessage` component to visually render transition messages (reuse `AgentTransitionIndicator` styling)

---

## 8. Diagnostic Scripts Available

For investigating specific sessions:

```bash
# Analyze session events and persistence state
npx tsx scripts/inspect-session.ts "<session-id>" --verbose --events

# Parse raw logs for a session
npx tsx scripts/extract-session-logs.ts "<session-id>"

# Check BullMQ persistence queue status
npx tsx scripts/queue-status.ts --verbose
```

---

## 9. Files to Investigate/Modify

### Backend — Persistence

| File | Change | Priority | Status |
|------|--------|----------|--------|
| `backend/prisma/schema.prisma` | Add `is_internal` column to messages table | P0 | ✅ COMPLETE |
| `backend/src/domains/agent/persistence/PersistenceCoordinator.ts` | Add `persistAgentChangedAsync()` method | P0 | ✅ COMPLETE |
| `backend/src/domains/agent/orchestration/events/EventProcessor.ts` | Suppress internal events from WebSocket emission | P0 | ✅ COMPLETE |
| `backend/src/shared/providers/normalizers/BatchResultNormalizer.ts` | Change transfer tools to `'async_allowed'` with `isInternal: true` | P0 | ✅ COMPLETE |
| `backend/src/modules/agents/supervisor/result-adapter.ts` | Add message content diagnostic logging | P1 | ⏳ DEFERRED |
| `backend/src/services/sessions/SessionService.ts` | Filter `is_internal=1` from API responses | P0 | ✅ COMPLETE |

### Backend — API

| File | Change | Priority | Status |
|------|--------|----------|--------|
| `backend/src/services/sessions/transformers/messageTransformer.ts` | Add `'agent_changed'` case | P1 | ⏳ DEFERRED |
| `backend/src/domains/sessions/types.ts` | Add `AgentChangedMessageResponse` type | P1 | ⏳ DEFERRED |
| `backend/src/services/websocket/ChatMessageHandler.ts` | Internal event check now defense-in-depth | P1 | ✅ COMPLETE |

### Shared Types

| File | Change | Priority | Status |
|------|--------|----------|--------|
| `packages/shared/src/types/event.types.ts` | Add `'agent_changed'` to EventType union | P0 | ✅ COMPLETE |
| `packages/shared/src/types/message.types.ts` | Add `AgentChangedMessage` type to `MessageResponse` union | P1 | ⏳ DEFERRED |

### Frontend

| File | Change | Priority | Status |
|------|--------|----------|--------|
| `frontend/src/domains/chat/stores/agentWorkflowStore.ts` | Enhanced `reconstructFromMessages()` with agent_changed messages | P1 | ⏳ DEFERRED |
| `frontend/src/presentation/chat/` or `frontend/src/components/chat/` | `AgentChangedMessage` renderer component | P2 | ⏳ DEFERRED |

---

## 10. Success Metrics

After implementation:

1. **✅ Internal event audit trail**: `agent_changed` and transfer tool events are persisted with `is_internal=true`
2. **✅ No WebSocket pollution**: Internal events are suppressed before WebSocket emission
3. **✅ Clean API responses**: `is_internal=1` events are filtered from user-facing queries
4. **✅ No false CRITICAL logs**: ChatMessageHandler check is now defense-in-depth
5. **⏳ Reload fidelity (DEFERRED)**: After Phase 9.E, agent transitions will be visible on reload
6. **⏳ Tool events visible on reload (BLOCKED by PRD-090)**: Once PRD-090 is implemented, tool_use/tool_result events will appear on reload

### Verification Commands

```bash
# After implementation
npm run -w backend test:unit              # All tests pass
npx vitest run "PersistenceCoordinator"   # Agent changed persistence tests
npx vitest run "EventProcessor"           # Internal event suppression tests
npx vitest run "SessionService"           # API filtering tests
npx vitest run "ChatMessageHandler"       # Defense-in-depth check tests
npm run -w bc-agent-frontend test         # Frontend tests

# Manual verification
# 1. Send multi-agent query → verify agent transitions visible live
# 2. Check WebSocket traffic → verify NO internal events emitted
# 3. Inspect DB: SELECT * FROM messages WHERE is_internal = 1
# 4. Query API: GET /api/sessions/{id}/messages → verify internal events filtered
# 5. Check logs for absence of false CRITICAL entries
```

---

## Changelog

| Fecha | Cambios |
|-------|---------|
| 2026-02-11 | Creacion inicial: analisis de integridad de eventos, root cause por elemento faltante, estrategia de remediacion en 5 fases. |
| 2026-02-12 | Scope revision per PRD-092: Phase 9.A marked "Completed by PRD-090". Phase 9.B DEFERRED (no consumer for transitions after PRD-092 removes transition UI). Phase 9.D COMPLETE (isInternal check added). Phase 9.E revised to "fix agent_id on all persisted messages" — agentId now propagated through tool persistence chain. New Phase 9.F: INTERNAL_TOOL_PREFIXES + isInternalTool() added to @bc-agent/shared. |
| 2026-02-12 | **Phase 9.B COMPLETE**: Internal events (transfer tools, agent transitions) now persisted with `is_internal=true` for audit trail. New `is_internal` column in messages table (BIT, defaults to 0). `PersistenceCoordinator.persistAgentChangedAsync()` method added. Transfer tools changed from `'transient'` to `'async_allowed'` with `isInternal: true` in BatchResultNormalizer. WebSocket emission suppressed for internal events in EventProcessor. API query filters `is_internal=1` in SessionService. **Phase 9.D COMPLETE**: Internal events suppressed in EventProcessor before WebSocket emission. ChatMessageHandler check now serves as defense-in-depth (should never trigger under normal operation). Implementation uses `is_internal` column + `message_type: 'agent_changed'` instead of originally proposed `message_type: 'transition'`. EventType union updated with `'agent_changed'`. BullMQ job types updated to include agent_changed persistence. Phase 9.E DEFERRED until future need for transition visualization on reload. |
