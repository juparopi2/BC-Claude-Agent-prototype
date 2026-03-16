---
description: Multi-agent architecture invariants — event lifecycle, attribution, persistence, supervisor-worker pattern
globs:
  - "backend/src/domains/agent/**"
  - "backend/src/modules/agents/**"
---

# Multi-Agent Architecture Invariants

## Event Lifecycle (6 stages)
```
Creation → Normalization → Attribution → Filtering → Persistence → Reconstruction
```
Information available at stage N must propagate to all subsequent stages.

## Internal vs External Events
- **External**: User-facing (thinking, tool calls, messages). Persisted + emitted via WebSocket + rendered.
- **Internal**: Infrastructure artifacts (routing, handoffs, transfer tools, agent transitions). Persisted with `is_internal=true` for audit, NOT emitted via WebSocket.

**Persistence ≠ Visibility.** Internal event detection MUST be centralized in `@bc-agent/shared`.

## Agent Attribution Invariant
Every persisted assistant-side event MUST carry `sourceAgentId` (the originating agent). Without it:
- UI can't group events by agent
- Page reload reconstruction breaks

**Common failure**: New persistence path missing `agentId` → `null` in DB → broken frontend.

## Persistence Strategies
| Strategy | Meaning | Examples |
|---|---|---|
| `sync_required` | Persist synchronously before emission | User messages |
| `async_allowed` | Persist asynchronously after emission | Assistant messages, tool events |
| `transient` | NOT persisted | Completion signals |

Internal events are `async_allowed` with `isInternal: true`.

## Supervisor-Worker Pattern
- **Supervisor**: Routes to workers, may use extended thinking. Exclusively controls routing.
- **Workers**: Domain-specific (ERP, RAG). Use domain tools. Deterministic temperature.
- Workers never decide routing. Workers must use domain tools on first call (tool enforcement layer).
- Thinking and `tool_choice` cannot coexist (Anthropic constraint) — only supervisor uses thinking.

## Shared Package as Source of Truth
`@bc-agent/shared` defines: agent identifiers, event types, classification logic, type contracts. When a concept must be consistent across frontend/backend, it MUST live in shared.

## Reconstruction Fidelity
Live UI (WebSocket events) must match reloaded UI (database query). Both paths must produce the same visual result. After any event processing change, verify BOTH live and reloaded experiences.
