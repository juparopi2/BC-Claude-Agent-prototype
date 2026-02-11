# PRD-090: Agent Graph Logic Optimization

**Estado**: 🟡 PLANIFICADO
**Fecha**: 2026-02-11
**Fase**: 9 (Graph Optimization)
**Dependencias**: PRD-062 (Tool Enforcement - parcialmente incompleto), PRD-011 (Agent Registry)

---

## 1. Problem Statement

Worker agents (BC, RAG, Graphing) are **not calling their domain tools** despite each having specialized toolsets. The LLM responds from training data instead of querying the local index or executing tool-based workflows.

### Evidence

From `backend/logs/app.log` analysis of session `3F608895-D38D-424D-955D-290DC4D5DEFC`:

- User query: "What endpoints does Customer have?"
- BC Agent responded with a detailed text answer about Customer endpoints
- **Zero domain tool calls** — no `list_all_entities`, no `get_endpoint_documentation`
- The only `tool_request` in the normalized events was `transfer_to_bc-agent` (a supervisor handoff tool, not a domain tool)
- `toolExecutionCount: 1` referred exclusively to the handoff

### GAP-008: Falsely Marked as Resolved

PRD-062 claimed `tool_choice: 'any'` enforcement was implemented and marked GAP-008 as resolved. However, **the code was never changed**:

```typescript
// agent-builders.ts:75-81 — CURRENT CODE (unchanged)
// createReactAgent handles bindTools internally with tool_choice: 'auto' (default)
const agent = createReactAgent({
  llm: model,
  tools: domainTools,
  name: agentDef.id,
  prompt,
});
```

PRD-062's code example showed `model.bindTools(allTools, { tool_choice: 'any' })` but this was **never committed**. The `createReactAgent` call uses default `tool_choice: 'auto'`, which allows the LLM to skip tools entirely.

---

## 2. Root Cause Analysis

### 2.1 Why Agents Skip Tools

1. **`tool_choice: 'auto'` (default)**: `createReactAgent` calls `llm.bindTools(tools)` internally without a `tool_choice` override. The default `'auto'` means the LLM MAY call tools but is not required to.

2. **LLM training data**: Claude Haiku 4.5 contains extensive knowledge about Business Central endpoints, so it answers directly from training rather than calling `get_endpoint_documentation`.

3. **Prompt-only enforcement insufficient**: PRD-062 added "Critical Execution Rules" to agent prompts, but Haiku-class models frequently ignore prompt instructions when they have sufficient training knowledge to answer directly.

### 2.2 Code Path

```
buildReactAgents() [agent-builders.ts:45]
  → ModelFactory.create(agentDef.modelRole) [line 61]
  → createReactAgent({ llm: model, tools, name, prompt }) [line 76-81]
    → Internally: model.bindTools(tools) with tool_choice: 'auto'
```

The gap is at line 76-81: no `tool_choice` parameter is passed to `createReactAgent` or to `llm.bindTools()`.

---

## 3. Research: Tool Enforcement Options

### 3.1 Available Approaches

| Option | Mechanism | Pros | Cons | ReAct Loop Impact |
|--------|-----------|------|------|-------------------|
| `tool_choice: 'any'` | `llm.bindTools(tools, { tool_choice: 'any' })` | Guarantees tool call every turn | **Infinite loop**: agent MUST call a tool every turn, can never generate a final text response | High — needs `returnDirect` or custom stop condition |
| `tool_choice: { type: 'tool', name: '...' }` | Forces a specific named tool | Maximum precision for single-tool scenarios | Too rigid for multi-tool agents (7 tools on BC Agent) | Same infinite loop risk |
| Prompt engineering only | Stronger "MUST use tools" instructions | No code changes, zero risk | LLM can still ignore; already attempted in PRD-062, insufficient | None |
| **Hybrid first-step enforcement** | `tool_choice: 'any'` on first LLM call, then `'auto'` for subsequent turns | Guarantees at least one tool call; allows natural termination | More complex implementation | Low — only first call is forced |
| `responseFormat` (structured output) | Force structured output that includes tool selection | Different pattern entirely | Requires schema redesign, not compatible with `createReactAgent` | N/A |

### 3.2 The `tool_choice: 'any'` Infinite Loop Problem (GAP-009)

When `tool_choice: 'any'` is set, the ReAct loop operates as:

```
LLM call (MUST call tool) → execute tool → LLM call (MUST call tool) → execute tool → ...
```

The agent can **never** generate a final text response because every LLM turn is forced to call a tool. This creates an infinite loop until `recursionLimit: 50` is hit, producing 50 tool calls instead of a useful response.

**This is why PRD-062's approach (setting `tool_choice: 'any'` globally) would have caused problems even if it had been implemented.**

### 3.3 Recommended Approach: Hybrid First-Step Enforcement

The hybrid approach forces a tool call on the **first LLM invocation only**, then switches to `'auto'` for subsequent turns:

```
Turn 1: LLM call (tool_choice: 'any') → FORCED to call tool → execute tool
Turn 2: LLM call (tool_choice: 'auto') → may call another tool OR generate text response
Turn N: LLM call (tool_choice: 'auto') → generates final text response → loop ends
```

This guarantees:
- At least one domain tool is called per agent invocation
- The ReAct loop can terminate naturally with a text response
- Multi-step tool chaining is still possible (agent chooses to call more tools)

### 3.4 Implementation Options for Hybrid Approach

| Strategy | Description | Complexity | Risk |
|----------|-------------|-----------|------|
| **A: LLM Wrapper** | Create a proxy model class that tracks call count and switches `tool_choice` | Medium | Low — isolated to wrapper |
| **B: Custom `shouldContinue`** | Use LangGraph `StateGraph` with a custom conditional edge instead of `createReactAgent` | High | Medium — replaces ReAct agent |
| **C: Subclass `createReactAgent`** | Extend the agent with modified tool binding logic | Medium | Medium — depends on internal API |
| **D: Pre-call + ReAct** | Make one forced tool call manually, feed result into `createReactAgent` | Low | Low — simple composition |

**Recommended: Strategy A (LLM Wrapper)** — Create a `FirstCallToolEnforcer` wrapper that:
1. On first `bind_tools` call, sets `tool_choice: 'any'`
2. On subsequent calls (after first tool result), switches to `tool_choice: 'auto'`
3. Wraps the base model transparently for `createReactAgent`

---

## 4. Research: Handoff Mechanism

### 4.1 LangGraph Native Handoffs

**Tools ARE the native LangGraph handoff mechanism.** There is no "tool-free" handoff in LangGraph.

Two documented patterns exist:

1. **`createSupervisor`** (current architecture): Supervisor uses `transfer_to_*` tools to route messages to worker agents. Workers complete their task and return to supervisor.

2. **Manual `StateGraph` with `Command`**: Agents use handoff tools that return `Command({ goto: targetAgent, graph: Command.PARENT })` to explicitly transfer control.

Both patterns use tools as the transfer mechanism. The current architecture is correct:
- Supervisor routes via `transfer_to_*` tools (generated by `createSupervisor`)
- Workers have domain tools only (no handoff tools since PRD-040 handoffs were removed for simplicity)
- `addHandoffBackMessages: true` handles return-to-supervisor automatically

### 4.2 No Changes Needed

The handoff mechanism is functioning correctly. The supervisor successfully routes to the correct agent — the problem is that the agent doesn't use its domain tools after receiving the handoff.

---

## 5. Research: Multi-Step Tool Chaining (ReAct Loops)

### 5.1 How `createReactAgent` ReAct Loop Works

```
Input: User message
  ↓
LLM Call #1: Analyzes message, decides to call tool(s)
  ↓
Tool Execution: Runs selected tool(s), gets results
  ↓
LLM Call #2: Reads tool results, decides:
  Option A: Call more tools → loop back to Tool Execution
  Option B: Generate text response → loop ends
  ↓
Output: Final text response
```

The loop continues until:
- The LLM generates a response without tool calls (natural termination)
- `recursionLimit` is reached (safety limit, currently 50 in `supervisor-graph.ts:218,251`)

### 5.2 Multi-Step Example (With Hybrid Enforcement)

For query "What endpoints does Customer have?":

```
Turn 1 (tool_choice: 'any' — FORCED):
  → Agent calls list_all_entities
  → Gets list of all BC entities

Turn 2 (tool_choice: 'auto'):
  → Agent reads entity list, sees "customers" entity
  → Calls get_endpoint_documentation("customers")
  → Gets detailed endpoint docs

Turn 3 (tool_choice: 'auto'):
  → Agent reads endpoint docs
  → Generates comprehensive response with actual data
  → Loop ends
```

### 5.3 Enabling Multi-Step Reasoning

Current prompts don't explicitly encourage multi-step tool usage. Changes needed:

1. **Add explicit multi-step instructions**: "You may call multiple tools in sequence before responding. Analyze each tool's result to determine if additional tools are needed."

2. **Add tool chaining examples**: Show the agent that calling `list_all_entities` first, then `get_endpoint_documentation` for specific entities, produces better results.

3. **Consider `parallel_tool_calls: false`**: When sequential tool calls matter (e.g., list entities first, then get details), this option from the Anthropic API ensures tools execute one at a time. However, for `createReactAgent`, tools already execute sequentially per turn.

### 5.4 `recursionLimit` Configuration

Current settings in `supervisor-graph.ts`:
- Direct agent invocation (targetAgentId): `recursionLimit: 50` (line 192)
- Supervisor routing (auto mode): `recursionLimit: 50` (line 219)

These limits are per-graph-invocation and cover ALL nodes (supervisor + all worker turns). With hybrid enforcement and multi-step chaining, a typical flow might use 4-8 recursion steps, well within the 50 limit.

---

## 6. Research: `tool_choice` + Thinking + Temperature Constraints

### 6.1 Anthropic API Constraint

When extended thinking is enabled (`thinking.type: 'enabled'`), the Anthropic API imposes restrictions:

1. **`temperature` MUST be omitted** (API defaults to 1.0) — already handled by `ModelFactory.ts:179`
2. **`tool_choice` cannot be `'any'`** when thinking is enabled — **NOT yet guarded**

### 6.2 Current Configuration Safety Analysis

| Agent | Thinking | Temperature | tool_choice (proposed) | Safe? |
|-------|----------|-------------|----------------------|-------|
| Supervisor | enabled (5000 tokens) | omitted | N/A (no domain tools) | Yes |
| BC Agent | disabled | 0.3 | `'any'` (first call) → `'auto'` | Yes |
| RAG Agent | disabled | 0.5 | `'any'` (first call) → `'auto'` | Yes |
| Graphing Agent | disabled | 0.2 | `'any'` (first call) → `'auto'` | Yes |

**Current state is safe**: All workers have thinking disabled, so `tool_choice: 'any'` can be used.

### 6.3 Future Risk

If workers ever enable thinking (e.g., for complex BC queries), `tool_choice: 'any'` **MUST be removed** or the API will reject the request.

### 6.4 Proposed Guard

Add a guard in `ModelFactory.ts` or `agent-builders.ts` similar to the existing temperature+thinking guard:

```typescript
// ModelFactory.ts — proposed guard
if (config.thinking?.type === 'enabled' && toolChoice === 'any') {
  throw new Error(
    `Cannot use tool_choice: 'any' with thinking enabled for role '${config.role}'. ` +
    'Anthropic API constraint: tool_choice must be "auto" when thinking is enabled.'
  );
}
```

Document this constraint in `models.ts` comments alongside the existing temperature+thinking note (line 141).

---

## 7. Proposed Implementation Strategy

### Phase 9.1: Research and Prototype Hybrid Tool Enforcement

1. Create `FirstCallToolEnforcer` wrapper class (or equivalent mechanism)
2. Test with BC agent: query "What endpoints does Customer have?" should call `get_endpoint_documentation`
3. Verify ReAct loop terminates naturally after tool results
4. Verify the wrapper doesn't interfere with prompt caching

### Phase 9.2: Implement Hybrid Approach in `agent-builders.ts`

1. Replace direct model usage with wrapped model:
   ```typescript
   const wrappedModel = new FirstCallToolEnforcer(model);
   const agent = createReactAgent({
     llm: wrappedModel,
     tools: domainTools,
     name: agentDef.id,
     prompt,
   });
   ```
2. Add `tool_choice` + thinking guard to `ModelFactory.ts`
3. Add parameterized test: verify all worker agents use tool enforcement

### Phase 9.3: Enhance Agent Prompts for Multi-Step Reasoning

1. Add explicit multi-step instruction to all agent prompts:
   - "You may and SHOULD call multiple tools in sequence before responding"
   - "Analyze each tool result to determine if additional tools provide better information"
2. Add tool chaining examples to BC Agent prompt (most tools, most benefit)
3. Update supervisor prompt to indicate agents may take multiple turns

### Phase 9.4: Verify Tool Calls in Production

1. Check logs for domain tool calls: `tool_use` events with names like `list_all_entities`, `get_endpoint_documentation`, `knowledge_search`
2. Verify WebSocket events include tool call data for frontend display
3. Verify tool events are persisted correctly (tool_use + tool_result pairs)

### Phase 9.5: End-to-End Agent Testing

Test representative queries for each agent:

| Agent | Test Query | Expected Tool Calls |
|-------|-----------|-------------------|
| BC Agent | "What endpoints does Customer have?" | `list_all_entities` or `get_endpoint_documentation` |
| BC Agent | "How do I create a sales order?" | `get_entity_details` or `get_workflow_documentation` |
| RAG Agent | "What does my contract say about SLA?" | `knowledge_search` |
| Graphing Agent | "Show me a bar chart of monthly sales" | `list_available_charts`, `validate_chart_config` |

---

## 8. Files to Modify (Future Implementation)

### Core Changes

| File | Change | Priority |
|------|--------|----------|
| `backend/src/modules/agents/supervisor/agent-builders.ts` | Hybrid tool_choice wrapper around `createReactAgent` | P0 |
| `backend/src/core/langchain/ModelFactory.ts` | Add `tool_choice` + thinking guard | P1 |
| `backend/src/infrastructure/config/models.ts` | Document `tool_choice` + thinking constraint in comments | P1 |

### Prompt Enhancements

| File | Change | Priority |
|------|--------|----------|
| `backend/src/modules/agents/core/definitions/bc-agent.definition.ts` | Multi-step reasoning instructions + tool chaining examples | P1 |
| `backend/src/modules/agents/core/definitions/rag-agent.definition.ts` | Multi-step reasoning instructions | P1 |
| `backend/src/modules/agents/core/definitions/graphing-agent.definition.ts` | Multi-step reasoning instructions | P2 |

### Tests

| File | Change | Priority |
|------|--------|----------|
| `backend/src/__tests__/unit/agents/supervisor/agent-builders.test.ts` | Test hybrid tool enforcement wrapper | P0 |
| New: `**/FirstCallToolEnforcer.test.ts` | Unit tests for wrapper behavior | P0 |

---

## 9. Prompt Caching Status Update

### Current Implementation (Already Active)

Basic prompt caching IS already implemented across the system:

1. **`promptCaching: true`** in all agent configs (`models.ts:142,156,170,184`)
2. **`cache_control: { type: 'ephemeral' }`** on system prompts:
   - Worker agents: `agent-builders.ts:66-73`
   - Supervisor: `supervisor-graph.ts:91-99`
3. **`anthropic-beta: prompt-caching-2024-07-31`** header added in `ModelFactory.ts:167-169`

### PRD-080 Status

| Phase | Description | Status |
|-------|-------------|--------|
| 8.1 | Infrastructure setup (headers, config flags) | ✅ COMPLETE |
| 8.2 | Agent prompt cache_control annotations | ✅ COMPLETE |
| 8.3 | Cache hit metrics tracking in `AgentAnalyticsService` | 🔴 PENDING |

**Recommendation**: Mark PRD-080 Phases 8.1 and 8.2 as effectively complete. Remaining work (Phase 8.3) is metrics/observability and can be deferred.

---

## 10. Success Metrics

After implementation, the following must be verifiable:

1. **Every agent invocation produces at least one domain tool call** — no pure-text responses from agents with tools
2. **ReAct loop terminates naturally** — agents respond after getting tool results, not after hitting recursion limit
3. **Multi-step chaining works** — agents call 2+ tools sequentially when needed
4. **No regressions** — existing test suites pass, thinking+temperature constraints still enforced
5. **tool_choice+thinking guard** prevents future misconfiguration

### Verification Commands

```bash
# After implementation
npm run -w backend test:unit              # All tests pass
npx vitest run "agent-builders"           # Tool enforcement tests
npx vitest run "FirstCallToolEnforcer"    # Wrapper tests (new)
npx vitest run "ModelFactory"             # Guard tests

# Manual verification
# 1. Send "What endpoints does Customer have?" → check logs for domain tool_use events
# 2. Send "Search my documents for SLA terms" → check logs for knowledge_search tool_use
# 3. Inspect session: npx tsx scripts/inspect-session.ts "<id>" --verbose --events
```

---

## Changelog

| Fecha | Cambios |
|-------|---------|
| 2026-02-11 | Creacion inicial: analisis de raiz del problema, research de opciones de enforcement, documentacion de enfoque hibrido. |
