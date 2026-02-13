# PRD-092: Chat UX Redesign — Agent-Grouped Messages

**Estado**: 🟠 EN PROGRESO (Sprint 1 + Sprint 2 COMPLETE, Sprint 3 IN PROGRESS, Phase 92.7 COMPLETE)
**Fecha**: 2026-02-12
**Fase**: 9 (Graph Optimization)
**Dependencias**: PRD-061 (Agent Workflow Visibility), PRD-090 (Graph Logic Optimization), PRD-091 (Event Integrity)

---

## 1. Problem Statement

The current chat UX suffers from three critical issues:

### 1.1 Collapsible Sections Hide Content

Agent sections use `CollapsibleAgentSection` components with expand/collapse functionality. This creates friction:
- Users must manually expand sections to see agent thinking and tool calls
- Default collapsed state hides valuable workflow information
- Expansion state is not preserved on page refresh
- Users lose context when sections collapse automatically

### 1.2 Internal Infrastructure Leaks into UI

The UI displays internal agent orchestration events that should never reach end users:
- `agent_changed` events (internal LangGraph state transitions)
- `transfer_to_*` / `transfer_back_to_*` tool calls (supervisor handoff machinery)
- Empty supervisor messages (LangGraph bookkeeping)
- Tool execution deduplication warnings

These events are implementation details of the multi-agent architecture, not user-facing content.

### 1.3 Page Refresh Shows Different UI Than Live

During live execution:
- WebSocket streams include transient events (transitions, internal tools)
- UI renders collapsible agent sections with transition indicators
- Rich multi-agent workflow is visible

After page refresh:
- Messages reconstructed from database (which excludes transient events)
- UI attempts to reconstruct agent groups using different logic
- Agent sections may be grouped differently or missing entirely
- `AgentTransitionIndicator` components render differently (or not at all)

**Users see two different UIs for the same conversation.**

---

## 2. Design Principles

### 2.1 Visual Grouping Without Collapsing

Instead of collapsible sections, use **visual grouping with persistent visibility**:

1. **Vertical colored line** along the left edge of each agent group
2. **Agent badge** at the top of the first message in each group (not repeated)
3. **All messages visible** — no expand/collapse controls
4. **Natural flow** — messages read top-to-bottom without interaction

### 2.2 Filter Internal Events at Source

Internal events should never reach the frontend WebSocket handlers:

1. **Backend filtering**: `EventProcessor` suppresses WebSocket emission for `isInternal` events
2. **Type safety**: Frontend message types exclude internal event types
3. **Persistence ≠ Visibility**: Internal events ARE persisted (with `is_internal=true` for audit trail) but NOT emitted via WebSocket and filtered from the reload API query

### 2.3 Reconstruction Consistency

Page refresh must produce identical UI to live execution:

1. **Same grouping logic**: `reconstructFromMessages()` uses identical rules to live grouping
2. **Same message transformation**: Database messages transform to same shape as WebSocket events
3. **No special cases**: Avoid "if reconstructed then..." branches in rendering logic

---

## 3. Implementation Phases

### Phase 92.1: Filter Internal Events in WebSocket Processor — ✅ COMPLETE

**Status**: COMPLETE (2026-02-12)

**Changes**:
- `ChatMessageHandler.ts`: Added `isInternal` check before emitting events
- Internal events (agent_changed, transfer tools) no longer reach frontend
- Frontend never sees infrastructure events, simplifying state management

**Result**: Clean event stream with only user-facing content.

---

### Phase 92.2: Remove AgentTransitionIndicator from Rendering — ✅ COMPLETE

**Status**: COMPLETE (2026-02-12)

**Changes**:
- Removed `AgentTransitionIndicator` component renders from `MessageList`
- `agent_changed` events no longer rendered (they don't reach frontend after 92.1)
- Transition state removed from `agentWorkflowStore` (no longer needed)

**Result**: No transition indicators, cleaner message flow.

---

### Phase 92.3: Create AgentGroupedSection, Replace Collapsibles — ✅ COMPLETE

**Status**: COMPLETE (2026-02-12)

**Objective**: Replace `CollapsibleAgentSection` with a simpler `AgentGroupedSection` that provides visual grouping without collapse functionality.

**Changes**:
1. **New component**: `AgentGroupedSection.tsx`
   - Renders colored vertical line (using agent color from registry)
   - Shows agent badge at top of group
   - Renders all messages without collapse controls
   - No animation or transition effects

2. **Update `MessageList.tsx`**:
   - Replace `CollapsibleAgentSection` with `AgentGroupedSection`
   - Remove collapse state management
   - Remove expansion/collapse event handlers

3. **Styling**:
   ```tsx
   // AgentGroupedSection.tsx
   <div className="relative pl-4 border-l-4" style={{ borderColor: agentColor }}>
     <AgentBadge agent={agent} className="mb-2" />
     {messages.map(msg => <MessageItem key={msg.id} message={msg} />)}
   </div>
   ```

**Result**: Always-visible agent groups with clear visual boundaries.

---

### Phase 92.4: Fix Reload Reconstruction Consistency — ✅ COMPLETE

**Status**: COMPLETE (2026-02-12)

**Objective**: Ensure `reconstructFromMessages()` produces identical groups to live execution.

**Changes**:
1. **Unified grouping logic**:
   - Both live and reconstructed use `agent_identity.agentId` to detect group boundaries
   - Remove special handling for transition events (they're filtered at source)
   - Remove inference of handoff types (not needed without transition indicators)

2. **Consistent message transformation**:
   - `messageTransformer.ts` ensures DB messages have same shape as WebSocket events
   - `agent_identity` field preserved consistently
   - Internal events persisted with `is_internal=true` but filtered from API query (SessionService)

3. **Testing**:
   - Add test: send multi-agent query, verify live grouping
   - Refresh page, verify reconstructed groups match live groups exactly
   - Compare DOM structure of live vs reloaded message list

**Result**: Identical UI before and after page refresh.

---

### Phase 92.5: Cleanup Collapsible Code — ✅ COMPLETE

**Status**: COMPLETE (2026-02-12)

**Objective**: Remove unused collapsible infrastructure.

**Files to Remove/Clean**:
1. `CollapsibleAgentSection.tsx` — entire component
2. `agentWorkflowStore.ts`:
   - Remove `collapseAllGroups()`, `expandAllGroups()`
   - Remove `isExpanded` field from `AgentGroup` type
   - Remove expansion state management
3. `MessageList.tsx`:
   - Remove collapse/expand imports
   - Remove expansion state handlers

**Result**: Simplified codebase, no dead code.

---

## 4. Files Changed

### Backend

| File | Change | Status |
|------|--------|--------|
| `backend/src/services/websocket/ChatMessageHandler.ts` | Add `isInternal` filter before emit | ✅ COMPLETE |

### Frontend

| File | Change | Status |
|------|--------|--------|
| `frontend/src/components/chat/AgentGroupedSection.tsx` | New component (visual grouping only) | ✅ COMPLETE |
| `frontend/src/components/chat/MessageList.tsx` | Replace CollapsibleAgentSection with AgentGroupedSection | ✅ COMPLETE |
| `frontend/src/domains/chat/stores/agentWorkflowStore.ts` | Remove collapse state, unify grouping logic | ✅ COMPLETE |
| `frontend/src/components/chat/CollapsibleAgentSection.tsx` | Delete entire component | ✅ COMPLETE |

---

## 5. Success Metrics

After full implementation:

1. **Zero collapsible sections** — all agent messages visible by default
2. **No internal events in frontend** — `agent_changed`, `transfer_*` never reach UI
3. **Identical reload experience** — live and reconstructed UIs match exactly
4. **Visual clarity** — colored lines and badges clearly show agent boundaries
5. **No dead code** — collapsible infrastructure fully removed

### Verification Commands

```bash
# Frontend tests
npm run -w bc-agent-frontend test

# Visual verification
# 1. Send multi-agent query → verify colored agent groups, no collapse controls
# 2. Verify no transition indicators or internal tool calls visible
# 3. Refresh page → verify identical grouping and layout
# 4. Check console for internal events (should be zero)
```

---

## 6. Design Mockup (Text Representation)

```
┌─────────────────────────────────────────────┐
│ User Message                                 │
│ "What endpoints does Customer have?"         │
└─────────────────────────────────────────────┘

┃  🤖 Supervisor (purple line)
┃
┃  [Thinking]
┃  The user is asking about Business Central
┃  endpoints. I'll route this to the BC Agent.
┃
┃  [Agent routes internally - NOT SHOWN]

┃  🏢 BC Agent (blue line)
┃
┃  [Tool: list_all_entities]
┃  Found entities: customers, vendors, items...
┃
┃  [Tool: get_endpoint_documentation("customers")]
┃  Endpoint docs: GET /companies/{id}/customers...
┃
┃  [Response]
┃  The Customer entity has the following endpoints:
┃  - GET /companies/{id}/customers
┃  - POST /companies/{id}/customers
┃  ...
```

**Key visual elements**:
- Vertical colored line (`┃`) differentiates agent groups
- Agent badge with icon appears once at top of group
- All content visible, no [...] or collapse buttons
- Internal handoffs not shown (filtered at backend)

---

### Phase 92.6: Fix Agent Grouping Bugs — ✅ COMPLETE

**Status**: COMPLETE (2026-02-12)

**Objective**: Fix two critical bugs that break the multi-agent grouped UX.

**Bug 1: Live grouping fragmented**
- **Root cause**: `tool_response` events from `BatchResultNormalizer.createToolResponseMap()` had no `sourceAgentId`. The `ExecutionPipeline` fallback resolved them to `'supervisor'`, causing spurious `agent_changed` emissions that fragmented a single agent group into multiple.
- **Fix**: In `BatchResultNormalizer.ts`, copy `sourceAgentId` from the `tool_request` to its matched `tool_response` during interleaving. The agent that requested a tool owns its response.
- **File**: `backend/src/shared/providers/normalizers/BatchResultNormalizer.ts` (+1 line)

**Bug 2: Refresh loses grouping**
- **Root cause**: `agentWorkflowStore.reconstructFromMessages()` was defined but never called. On page load, `ChatPage.tsx` set messages but never triggered group reconstruction, so `groups = []` and messages rendered flat.
- **Fix**: In `ChatPage.tsx`, import `getAgentWorkflowStore`, reset workflow store on session change, and call `reconstructFromMessages()` after `setMessages()`.
- **File**: `frontend/app/chat/[sessionId]/page.tsx` (+4 lines)

**Result**: Consecutive events from the same agent render in a single group both live and after refresh.

---

### Phase 92.7: Graphing Agent Chart Delivery via `validate_chart_config` — ✅ COMPLETE

**Status**: COMPLETE (2026-02-13)

**Objective**: Make `validate_chart_config` deliver interactive charts directly in the UI instead of returning `{ valid: true }` and relying on the agent to paste JSON code blocks.

**Problem**:
The frontend already had a full chart rendering pipeline (`AgentResultRenderer` → `ChartRenderer` → 10 recharts views) that activates when a tool result has `_type: 'chart_config'`. But this pipeline was never triggered because:
1. `validate_chart_config` returned `{ valid: true, chartType }` instead of the validated config
2. The system prompt instructed the agent to output charts as JSON code blocks in text
3. `AgentResultRenderer` didn't parse JSON strings (WebSocket sends strings, reload sends objects)
4. `ToolCard` showed "validate_chart_config" with a wrench icon instead of chart-specific UX

**Changes**:

| File | Change |
|------|--------|
| `backend/src/modules/agents/graphing/tools.ts` | On valid config, return `result.data` (full config with `_type: 'chart_config'`) instead of `{ valid: true }`. Updated tool description to "validates and delivers a chart". Error path unchanged. |
| `backend/src/modules/agents/core/definitions/graphing-agent.definition.ts` | Rewrote Steps 5-6: `validate_chart_config` delivers charts, agent writes only a brief confirmation. Added CHART DELIVERY section prohibiting JSON code blocks. Updated TOOL MAPPING. |
| `frontend/src/presentation/chat/AgentResultRenderer/AgentResultRenderer.tsx` | Added `useMemo` JSON string parsing before `_type` detection. Ensures both live (WebSocket strings) and reload (parsed objects) trigger `ChartRenderer`. |
| `frontend/src/presentation/chat/ToolCard.tsx` | Chart-aware rendering: `BarChart3` icon, chart title as display name, amber avatar/badge colors, "Chart" badge label, auto-expand for completed chart results. |
| `backend/src/modules/agents/graphing/__tests__/tools.test.ts` | Updated valid config assertions to expect full chart config object (`_type`, `chartType`, `title`, `data`) instead of `{ valid: true }`. |

**Reconstruction fidelity** (Section 14.5 of CLAUDE.md): The `AgentResultRenderer` JSON parsing ensures live and reload paths produce the same interactive chart, not raw JSON on one path and a chart on the other.

**Result**: Charts render interactively inside the `ToolCard` result area. The agent's text response is a brief confirmation instead of a raw JSON dump.

---

## Changelog

| Fecha | Cambios |
|-------|---------|
| 2026-02-12 | Creation: Sprint 1 COMPLETE (internal event filtering), Sprint 2 COMPLETE (remove transition indicators, implement AgentGroupedSection, fix reconstruction consistency, cleanup collapsibles). Sprint 3 IN PROGRESS (agentId propagation through tool chain). Updated: internal events now persisted with `is_internal=true` for audit (Persistence ≠ Visibility principle). EventProcessor suppresses WebSocket emission. SessionService filters `is_internal` from API. |
| 2026-02-12 | Phase 92.6 COMPLETE: Fixed two agent grouping bugs — (1) tool_response sourceAgentId propagation in BatchResultNormalizer eliminates spurious agent transitions, (2) reconstructFromMessages() call in ChatPage.tsx restores grouping on page refresh. |
| 2026-02-13 | Phase 92.7 COMPLETE: Chart delivery via `validate_chart_config` — tool returns full config with `_type: 'chart_config'`, AgentResultRenderer parses JSON strings for reconstruction fidelity, ToolCard renders chart-aware UX (BarChart3 icon, chart title, amber colors, auto-expand). |
