# PRD-091: Event Transmission, Persistence & Integrity Verification

**Estado**: 🟡 PLANIFICADO
**Fecha**: 2026-02-11
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

### 3.1 `agent_changed` Events — Transient by Design

`agent_changed` events are emitted by `ExecutionPipeline.ts` during live execution but with `persistenceStrategy: 'transient'`. They are **never written to the database**.

**Impact**: No transition indicators on page reload. The `AgentTransitionIndicator` component (PRD-061) only works during live execution.

**Root cause**: No `message_type` for transitions exists in the database schema. The `messages` table only supports: `text`, `thinking`, `tool_use`, `tool_result`.

### 3.2 Supervisor Routing Context — Partially Lost

The supervisor's `transfer_to_bc-agent` tool call is correctly marked as transient/internal by `BatchResultNormalizer.ts:164-174`:

```typescript
// BatchResultNormalizer.ts:164-174
if (event.toolName.startsWith('transfer_to_')) {
  event.persistenceStrategy = 'transient';
  event.isInternal = true;
}
```

**Impact**: The routing decision is invisible on reload. Users only see the result (BC agent response) but not why that agent was chosen.

**Acceptable for now**: Handoff tools are internal infrastructure, not user-facing content. But agent transitions (the fact that a handoff occurred) should be visible.

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

### 3.5 Orchestrator Return Flow — Correctly Hidden

The `transfer_back_to_supervisor` tool call is internal LangGraph machinery. It should NOT be visible to users on reload. The current behavior (transient/internal) is correct.

### 3.6 ChatMessageHandler "CRITICAL" False Alarm

At `ChatMessageHandler.ts:281-293`:

```typescript
case 'message':
  if ((event as MessageEvent).persistenceState !== 'persisted') {
    this.logger.error('CRITICAL: Complete message NOT marked as persisted...', { ... });
  }
```

This check fires for **all** message events, including transient ones (handoff-back messages with `isInternal: true`). These messages are intentionally not persisted, but the handler doesn't distinguish between "should be persisted but wasn't" and "intentionally transient".

**Impact**: Misleading CRITICAL log entries that create noise in error monitoring.

---

## 4. Event Persistence Tiers

### Tier 1: Already Persisted (Working Correctly)

| Event | Source | Status |
|-------|--------|--------|
| `thinking` | Supervisor extended thinking | Persisted with `sequenceNumber` |
| `assistant_message` | Domain agent response | Persisted with `sequenceNumber` |
| `user_message_confirmed` | User input | Persisted before agent execution |

### Tier 2: Should Be Persisted (Action Required)

| Event | Source | Current Status | Proposed Fix |
|-------|--------|---------------|-------------|
| `agent_changed` | Agent transitions | Transient | New `message_type: 'transition'` |
| `tool_use` | Domain tool calls | N/A (tools not called yet) | Will flow automatically after PRD-090 |
| `tool_result` | Domain tool results | N/A (tools not called yet) | Will flow automatically after PRD-090 |

### Tier 3: Correctly Transient (No Changes Needed)

| Event | Source | Rationale |
|-------|--------|-----------|
| `session_start` | Session lifecycle | UI-only, reconstructed on reload |
| `complete` | Execution completion | UI-only, no content to persist |
| `transfer_to_*` tool events | Supervisor handoff tools | Internal infrastructure |
| `transfer_back_to_*` messages | Worker return-to-supervisor | Internal infrastructure, `isInternal: true` |
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
- **Explicit transitions**: `message_type: 'transition'` messages provide exact `fromAgent`, `toAgent`, `handoffType`
- **Richer reconstruction**: Groups have intermediate workflow steps visible on reload

---

## 7. Proposed Remediation Strategy

### Phase 9.A: Fix Tool Enforcement First (PRD-090)

**Prerequisite for this PRD.** Once agents call domain tools:
- `tool_use` and `tool_result` events flow through existing persistence pipeline
- Groups in `reconstructFromMessages()` get richer content automatically
- The "Missing on reload" experience improves significantly without schema changes

### Phase 9.B: Persist Agent Transitions as `message_type: 'transition'`

#### Database Schema Change

Add `'transition'` as a valid value for the `message_type` column in `messages` table:

```prisma
// backend/prisma/schema.prisma
// message_type column: currently NVarChar(20), stores 'text', 'thinking', 'tool_use', 'tool_result'
// Add: 'transition' for agent_changed events
```

Note: Since `message_type` is `NVarChar(20)` (not a Prisma enum), no migration is needed — just ensure the value `'transition'` is accepted by all consumers.

#### Persist `agent_changed` Events

In `ExecutionPipeline.ts`, change `agent_changed` events from transient emission to persisted events:

```typescript
// Current: transient emission only
emitEvent({
  type: 'agent_changed',
  persistenceStrategy: 'transient',
  ...
});

// Proposed: persist as lightweight message
emitEvent({
  type: 'agent_changed',
  persistenceStrategy: 'async_allowed',  // Changed from 'transient'
  ...
});
```

Persist as a `messages` row with:
- `role: 'system'`
- `message_type: 'transition'`
- `content: JSON.stringify({ fromAgent, toAgent, handoffType, reason })`
- `agent_id: toAgent.agentId`
- `sequence_number`: from pre-allocated sequences (must be counted in `EventSequencer`)

#### Update Event Counting

`EventSequencer.ts` must count transition events in the sequence pre-allocation:

```typescript
// Count transition events for sequence number reservation
const transitionCount = events.filter(e => e.type === 'agent_changed').length;
totalEventsToReserve += transitionCount;
```

#### Update Persistence Handler

`EventPersister.ts` must handle the new `'transition'` message type:

```typescript
case 'agent_changed':
  await this.persistTransition(event, sequenceNumber, sessionId);
  break;
```

### Phase 9.C: Investigate Supervisor Empty Message

1. Add detailed logging to `result-adapter.ts` (as described in Section 5)
2. Run test queries and analyze logs
3. Determine if the empty message is expected bookkeeping or lost content
4. If bookkeeping: add `name` check to suppress the "ZERO events" warning
5. If lost content: fix the stream/adapt pipeline

### Phase 9.D: Fix ChatMessageHandler "CRITICAL" False Alarm

Update the check at `ChatMessageHandler.ts:281-293` to distinguish transient from persistence-required messages:

```typescript
case 'message':
  const msgEvent = event as MessageEvent;
  // Only log CRITICAL for messages that SHOULD be persisted
  if (msgEvent.persistenceState !== 'persisted' && !msgEvent.isInternal) {
    this.logger.error('CRITICAL: Complete message NOT marked as persisted...', { ... });
  } else if (msgEvent.isInternal) {
    this.logger.debug('Internal message (transient, not persisted)', {
      messageId: msgEvent.messageId,
      isInternal: true,
    });
  } else {
    this.logger.info('Complete message confirmed persisted', { ... });
  }
  break;
```

### Phase 9.E: Enhanced `reconstructFromMessages()` for Rich Workflow Reconstruction

With new `'transition'` messages in the database:

1. **Update `messageTransformer.ts`**: Add `'transition'` case to transform DB rows into `TransitionMessageResponse` objects

2. **Add `TransitionMessageResponse` type** to `@bc-agent/shared`:
   ```typescript
   export interface TransitionMessageResponse {
     id: string;
     role: 'system';
     message_type: 'transition';
     content: {
       fromAgent: AgentIdentity;
       toAgent: AgentIdentity;
       handoffType: HandoffType;
       reason?: string;
     };
     agent_identity: AgentIdentity;
     sequence_number: number;
     created_at: string;
   }
   ```

3. **Update `reconstructFromMessages()`**: Use transition messages for explicit group boundaries instead of inferring from `agent_identity` changes:
   ```typescript
   // If message is a transition, create new group with exact transition info
   if (msg.message_type === 'transition') {
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

4. **Backward compatibility**: Fall back to current `agent_identity`-based grouping when transition messages are absent (older sessions)

5. **Frontend renderer**: Create a `TransitionMessage` component to visually render transition messages (reuse `AgentTransitionIndicator` styling)

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

## 9. Files to Investigate/Modify (Future Implementation)

### Backend — Persistence

| File | Change | Priority |
|------|--------|----------|
| `backend/prisma/schema.prisma` | Document `'transition'` as valid `message_type` value | P1 |
| `backend/src/domains/agent/orchestration/execution/ExecutionPipeline.ts` | Change `agent_changed` from transient to `async_allowed` | P0 |
| `backend/src/domains/agent/orchestration/events/EventSequencer.ts` | Count transition events for sequence pre-allocation | P0 |
| `backend/src/domains/agent/orchestration/persistence/EventPersister.ts` | Handle `'transition'` message type persistence | P0 |
| `backend/src/modules/agents/supervisor/result-adapter.ts` | Add message content diagnostic logging | P1 |
| `backend/src/shared/providers/normalizers/BatchResultNormalizer.ts` | Suppress "ZERO events" warning for expected empty messages | P2 |

### Backend — API

| File | Change | Priority |
|------|--------|----------|
| `backend/src/services/sessions/transformers/messageTransformer.ts` | Add `'transition'` case | P1 |
| `backend/src/domains/sessions/types.ts` | Add `TransitionMessageResponse` type | P1 |
| `backend/src/services/websocket/ChatMessageHandler.ts` | Fix false CRITICAL log (check `isInternal`) | P1 |

### Shared Types

| File | Change | Priority |
|------|--------|----------|
| `packages/shared/src/types/message.types.ts` | Add `TransitionMessage` type to `MessageResponse` union | P1 |

### Frontend

| File | Change | Priority |
|------|--------|----------|
| `frontend/src/domains/chat/stores/agentWorkflowStore.ts` | Enhanced `reconstructFromMessages()` with transition messages | P1 |
| `frontend/src/presentation/chat/` or `frontend/src/components/chat/` | `TransitionMessage` renderer component | P2 |

---

## 10. Success Metrics

After implementation:

1. **Reload fidelity**: After refresh, agent transitions are visible between message groups
2. **Tool events visible on reload**: Once PRD-090 is implemented, tool_use/tool_result events appear on reload
3. **No false CRITICAL logs**: ChatMessageHandler only logs CRITICAL for genuinely un-persisted messages
4. **Backward compatible**: Old sessions (without transition messages) still reconstruct correctly
5. **`reconstructFromMessages()`** produces groups identical to live execution (within transient-event limits)

### Verification Commands

```bash
# After implementation
npm run -w backend test:unit              # All tests pass
npx vitest run "EventPersister"           # Transition persistence tests
npx vitest run "EventSequencer"           # Sequence counting tests
npx vitest run "agentWorkflowStore"       # Reconstruction tests (updated)
npx vitest run "ChatMessageHandler"       # Fixed CRITICAL log tests
npm run -w bc-agent-frontend test         # Frontend tests

# Manual verification
# 1. Send multi-agent query → verify agent transitions visible live
# 2. Refresh page → verify transitions still visible
# 3. Inspect DB: SELECT * FROM messages WHERE message_type = 'transition'
# 4. Check logs for absence of false CRITICAL entries
```

---

## Changelog

| Fecha | Cambios |
|-------|---------|
| 2026-02-11 | Creacion inicial: analisis de integridad de eventos, root cause por elemento faltante, estrategia de remediacion en 5 fases. |
