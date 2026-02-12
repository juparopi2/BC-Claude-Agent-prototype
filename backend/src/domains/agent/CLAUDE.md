# Agent Domain

## Purpose

Central domain for AI agent orchestration, execution, and event management. This is the **core business logic** layer that coordinates how user messages become agent responses — independent of which LLM provider, graph framework, or transport layer is used.

## Domain Boundaries

This domain owns:
- **Orchestration**: The execution pipeline that transforms a user prompt into a sequence of agent events
- **Event Processing**: Normalization, attribution, sequencing, and emission of agent events
- **Tool Lifecycle**: Coordination of tool request/response pairs, deduplication, and approval gates
- **Persistence Coordination**: Two-phase persistence strategy (sync sequence allocation + async database write)
- **Context Preparation**: Building the input context from conversation history, files, and semantic search

This domain does NOT own:
- **Agent Implementations**: Individual agents (ERP, RAG, etc.) live in `modules/agents/`
- **Graph Topology**: The supervisor-worker graph structure lives in `modules/agents/supervisor/`
- **LLM Configuration**: Model selection and provider constraints live in `core/langchain/`
- **Transport**: WebSocket handling lives in `services/websocket/`

## Orchestration Pipeline

The pipeline executes synchronously for each user message. Each stage has a single responsibility:

```
User Prompt
    │
    ▼
┌─────────────────────┐
│  Context Building    │  Prepare files, search results, conversation history
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│  Graph Execution     │  Run LangGraph (supervisor routes to workers)
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│  Result Normalization│  Convert provider-specific output → NormalizedAgentEvent[]
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│  Sequence Allocation │  Reserve atomic sequence numbers via Redis
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│  Event Processing    │  Attribute, filter, emit, and persist each event
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│  Tool Finalization   │  Close orphan tool lifecycles, persist remaining pairs
└─────────────────────┘
```

**Key principle**: Each stage receives the output of the previous stage and transforms it. Stages do not reach back to previous stages or skip ahead. This makes the pipeline testable in isolation.

## Event Classification

### Two Dimensions

Every agent event is classified along two independent dimensions:

**1. Visibility: External vs Internal**
- **External**: Content the user should see (thinking, tool calls, messages)
- **Internal**: Infrastructure artifacts (routing decisions, handoff signals, transfer tools)

Internal events are marked with `isInternal: true` during normalization. They are persisted for audit trail (with `is_internal=true` in the database) but NOT emitted via WebSocket.

**2. Persistence: How the event is saved**
- **Transient**: Not saved (completion signals, streaming intermediates)
- **Async-allowed**: Saved asynchronously after emission (assistant messages, tool events, internal tools)
- **Sync-required**: Saved synchronously before continuing (user messages, sequence-critical events)

**Key principle: Persistence != Visibility.** All substantive events are persisted for audit. Visibility is a separate concern:
- Internal events are persisted with `is_internal=true` but not emitted via WebSocket
- On page reload, the API filters `is_internal` events from the query
- The frontend also filters as defense-in-depth

### Internal Event Detection

Internal events are identified by their tool names (matching known infrastructure prefixes). This detection logic lives in the shared package to ensure frontend and backend use identical classification. When adding new infrastructure tools, their prefixes must be registered in the shared package.

## Agent Attribution

### The Invariant

**Every event produced by an agent must carry that agent's identity throughout its entire lifecycle** — from creation through normalization, emission, persistence, and eventual reconstruction.

### Attribution Sources

In a multi-agent turn, events come from different agents. Attribution is determined by:

1. **Per-event source**: Each normalized event may carry `sourceAgentId` from the LangGraph node that produced it
2. **Batch-level fallback**: If `sourceAgentId` is missing, the batch-level `currentAgentIdentity` is used

### Agent Transition Detection

When processing events sequentially, the pipeline detects agent transitions (agent A's events followed by agent B's events) and emits `agent_changed` signals for real-time UI updates. These transitions are also persisted to the database with `is_internal=true` for audit trail.

On page reload, agent transitions are reconstructed from the `agent_id` column on persisted messages (the `agent_changed` rows are filtered out by `is_internal`). This is why the attribution invariant is critical: missing `agent_id` values break reconstruction.

## Tool Lifecycle

Tools follow a strict request-response lifecycle:

1. **Request**: Agent calls a tool → `tool_request` event emitted
2. **Execution**: Tool runs (may require human approval)
3. **Response**: Result returned → `tool_response` event emitted
4. **Pairing**: Request and response are linked by `toolUseId`

The `ToolLifecycleManager` ensures:
- Every request gets exactly one response (no orphans, no duplicates)
- Tool events are deduplicated across concurrent processing paths
- Orphan tool requests (interrupted execution) are finalized at pipeline end

### Internal Tools

Some tools are infrastructure mechanisms (agent transfers). These:
- Are marked as `isInternal: true` during normalization
- Are persisted to the database with `is_internal=true` (for audit trail)
- Are NOT emitted via WebSocket (suppressed in EventProcessor)
- Are filtered from the API response on page reload (SessionService)
- Do NOT count as "tools used" in the execution result

## Persistence Contract

### What Gets Persisted

| Event Type | Persisted? | What's Saved |
|---|---|---|
| Thinking/reasoning | Yes | Content, agent_id, sequence_number |
| Assistant message | Yes | Content, agent_id, tokens, model, sequence_number |
| Tool request | Yes | Tool name, arguments, agent_id, sequence_number |
| Tool response | Yes | Result, success/error, agent_id, sequence_number |
| Agent transition | Yes | Content, agent_id, is_internal=true, sequence_number |
| Internal tools | Yes | Tool name, arguments, agent_id, is_internal=true, sequence_number |
| Completion signal | No | Transient — UI-only lifecycle event |

### Sequence Number Guarantee

All persisted events receive a globally-ordered sequence number via atomic Redis increment. Sequence numbers are **pre-allocated in batch** before event processing begins, ensuring:
- No gaps in the sequence
- No race conditions between concurrent sessions
- Deterministic replay order on reconstruction

## Frontend Contract

This domain communicates with the frontend through WebSocket events. The contract:

1. **Event ordering**: Events are emitted in `originalIndex` order within a turn
2. **Agent identity**: Each event carries sufficient agent identity for UI grouping
3. **Completeness**: A `complete` event signals the end of a turn
4. **Reconstruction equivalence**: Everything the frontend needs for reconstruction is persisted in the database. The live WebSocket experience and the reloaded experience must be visually identical.

### What the Frontend Expects

- Agent badge and grouping information via `agent_identity` on persisted messages
- Tool events paired (request + response) with matching `toolUseId`
- Internal events filtered out (the frontend also filters, but backend should not send unnecessary data)
- Token usage and model information on the completion event

## Stateless Execution

All components in this domain are **stateless singletons**. Per-execution mutable state lives exclusively in `ExecutionContextSync`, which is:
- Created fresh for each user message
- Passed through all pipeline stages
- Never shared between concurrent executions
- Garbage collected after execution completes

This enables horizontal scaling — multiple container instances can handle concurrent requests without coordination.

## Adding New Event Types

When introducing a new type of agent event:

1. Define the type in `@bc-agent/shared` (the shared package is source of truth for event shapes)
2. Ensure the normalization layer produces the event with correct `persistenceStrategy` and `sourceAgentId`
3. If persisted: add persistence path that includes `agentId` in the database write
4. If visible: ensure the frontend WebSocket processor handles the new type
5. If internal: register the classification pattern in the shared package
6. **Update DB CHECK constraints**: If the event introduces new `message_type` or `event_type` values, update the corresponding CHECK constraint in Azure SQL (see `backend/prisma/CLAUDE.md` → "CHECK Constraints")
7. Verify reconstruction: reload the page and confirm the event appears correctly

## Adding New Agents

New agents are registered in the agent registry (`modules/agents/core/registry/`). From this domain's perspective, a new agent is transparent — the pipeline processes events identically regardless of which agent produced them. The only requirement is that the new agent's events carry proper `sourceAgentId` attribution.
