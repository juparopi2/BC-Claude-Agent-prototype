# PRD-114: State Management Audit — Cross-Store Consistency

## Status: Proposed
## Priority: P2 (after PRD-113 SharePoint integration)

## Context

During PRD-114 investigation of authentication/connection state bugs, an audit of all 26 Zustand stores across 8 frontend domains revealed 6 areas where multiple stores share overlapping data without explicit coordination contracts.

## Candidates for Audit

| # | Area | Stores Involved | Risk |
|---|------|-----------------|------|
| 1 | File Processing + Upload Batch | `fileProcessingStore` + `uploadBatchStore` | Both track file processing status independently. WebSocket events could update one without the other, causing divergence. |
| 2 | Session + Message lifecycle | `sessionStore` + `messageStore` + `agentWorkflowStore` | When session changes, messages and workflow groups must reset. Done manually in multiple places — incomplete reset shows stale data. |
| 3 | Agent Workflow reconstruction | `agentWorkflowStore` | `reconstructFromMessages()` could diverge from live execution if new event types are added without updating reconstruction logic. |
| 4 | Socket event multiplexing | `SocketClient` (singleton) | Handles 9+ event types. If one handler fails, it could block others. No error boundaries per event type. |
| 5 | Citation + File Preview | `citationStore` + `filePreviewStore` | Both track cited files with metadata that should be consistent. `hydrateFromMessages()` may not cover all edge cases. |
| 6 | Optimistic Messages | `messageStore` + `pendingChatStore` | `confirmOptimisticMessage()` uses content+timestamp matching as fallback. Under high concurrency, could confirm the wrong message. |

## Deliverables

1. **Derived selectors** — `useDerivedFileStatus()` and similar hooks that compose multiple stores into consistent derived state
2. **Error boundaries** — Per-domain WebSocket event error boundaries to prevent cascading failures
3. **Regression tests** — For concurrency scenarios (multiple sessions, rapid navigation)
4. **Coordination contracts** — Explicit documentation of which stores must stay in sync and how

## Scope

This PRD covers frontend state management only. Backend persistence coordination is covered by existing architecture (EventStore + Two-Phase persistence).
