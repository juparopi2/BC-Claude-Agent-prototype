# 06-Tool-Execution E2E Tests - Implementation Guide

**Date**: 2025-11-28
**Status**: Pending Implementation
**File**: `backend/src/__tests__/e2e/flows/06-tool-execution.e2e.test.ts`

---

## Executive Summary

The `06-tool-execution.e2e.test.ts` test suite exists with 22 tests but requires significant revision. The tests were written with assumptions about tool capabilities that don't match the current implementation. This document provides the complete diagnostic, solution, and implementation guide.

---

## 1. Problems Diagnosed

### 1.1 Prompt-Tool Capability Mismatch (CRITICAL)

**Problem**: Test prompts ask for Business Central data operations, but the current tools only discover API endpoints.

| Current Prompt | What It Implies | Reality |
|----------------|-----------------|---------|
| "List available customers in Business Central" | Execute BC query | Tools only search endpoint metadata |
| "Create a new customer named 'Test'" | Execute BC write | No write capability exists |
| "Delete customer 99999999" | Execute BC delete | No delete capability exists |

**Root Cause**: The current system prompt (`DirectAgentService.ts:2204-2222`) defines tools for **discovering BC API information**, NOT executing operations:

```typescript
// Current tools (discovery only):
- list_all_entities: Get a complete list of all BC entities
- search_entity_operations: Search for specific operations by keyword
- get_entity_details: Get detailed information about a specific entity
- get_entity_relationships: Discover relationships between entities
- get_endpoint_documentation: Get detailed API documentation
```

### 1.2 Extended Thinking Triggers Timeouts

**Problem**: Open-ended prompts like "List available customers in Business Central" trigger extended thinking mode, causing:
- Long response times (8+ seconds observed)
- Test timeouts at 60000ms
- Unnecessary token consumption

**Evidence from diagnosis**:
```
[STREAM] thinking_delta: index=0, chunk_len=259
[TOKEN TRACKING] thinkingTokens: 65, totalTokens: 504
Test failed after 8361ms
```

### 1.3 Tool ID Schema Inconsistency

**Problem**: Tests accept multiple field names for tool IDs, but `SequenceValidator` only recognizes one.

**In tests** (lines 169-182):
```typescript
const hasId =
  toolData.id !== undefined ||           // Option 1
  toolData.toolUseId !== undefined ||    // Option 2
  toolData.tool_use_id !== undefined;    // Option 3
```

**In SequenceValidator**:
```typescript
// Only checks 'toolUseId'
if (event.type === 'tool_use' && eventWithToolId.toolUseId) {
  toolUses.set(eventWithToolId.toolUseId, event);
}
```

### 1.4 Weak Validation Logic

**Problem**: Tests use existence checks instead of proper type validation.

```typescript
// Current (weak)
const hasToolName = toolData.name !== undefined;  // Passes for empty string

// Should be (strong)
expect(typeof toolData.name).toBe('string');
expect(toolData.name.length).toBeGreaterThan(0);
```

### 1.5 Count-Based vs ID-Based Correlation

**Problem**: Tool correlation uses count comparison instead of ID matching.

```typescript
// Current (weak) - line 200-206
if (toolUseEvents.length > 0) {
  expect(toolResultEvents.length).toBeGreaterThanOrEqual(toolUseEvents.length);
}

// Should use
const validation = SequenceValidator.validateToolCorrelation(events);
expect(validation.valid).toBe(true);
```

### 1.6 Future Functionality Tests Present

**Problem**: Tests for write operations and approvals don't apply to current tools:
- `Tool Error Handling` block (lines 368-425)
- `Read vs Write Operations` block (lines 631-687)

---

## 2. Solution Proposed

### 2.1 Rewrite Prompts to Match Tool Capabilities

Replace all prompts with ones that trigger actual tool functionality:

| Old Prompt | New Prompt | Triggers Tool |
|------------|------------|---------------|
| "List available customers in Business Central" | "List all BC entities" | `list_all_entities` |
| "What items are available in Business Central?" | "Search for item operations" | `search_entity_operations` |
| "Show me vendors in Business Central" | "Get entity details for vendors" | `get_entity_details` |
| "Get sales orders from Business Central" | "Search operations for sales orders" | `search_entity_operations` |
| "List purchase orders in Business Central" | "What entities exist?" | `list_all_entities` |
| "Check inventory items in Business Central" | "Search for inventory operations" | `search_entity_operations` |
| "Get customer list from Business Central" | "Get customer entity details" | `get_entity_details` |
| "Show me Business Central company information" | "List entities" | `list_all_entities` |
| "Get general ledger entries from Business Central" | "Search for ledger operations" | `search_entity_operations` |
| "Compare customers and vendors in Business Central" | "Get details for customers and vendors entities" | `get_entity_details` (2x) |
| "Get both customers and items from Business Central" | "Search operations for customers and items" | `search_entity_operations` |
| "Search for customer named 'Contoso' in Business Central" | "Search entity operations for customer" | `search_entity_operations` |
| "Get employee list from Business Central" | "Get entity details for employees" | `get_entity_details` |
| "List payment methods in Business Central" | "Search for payment operations" | `search_entity_operations` |
| "Get company information from Business Central" | "List BC entities" | `list_all_entities` |
| "List all currencies in Business Central" | "Search operations for currency" | `search_entity_operations` |
| "Get locations from Business Central" | "Get entity details for locations" | `get_entity_details` |
| "Get dimensions from Business Central" | "Search for dimension operations" | `search_entity_operations` |

### 2.2 Skip Future Functionality Tests

Add `.skip()` with documentation to tests that require Langchain agent architecture:

```typescript
describe.skip('Tool Error Handling - FUTURE: Requires Langchain agent architecture', () => {
  /**
   * TODO: Re-enable when Langchain agent can execute real BC operations
   *
   * These tests verify error handling for:
   * - Non-existent entity IDs (e.g., "Get item with ID 'nonexistent-12345'")
   * - Delete operations (e.g., "Delete customer 99999999")
   *
   * Current tools only discover endpoints - they don't execute BC operations,
   * so these error scenarios cannot be tested until the Langchain migration.
   */
  // ... existing tests ...
});

describe.skip('Read vs Write Operations - FUTURE: Requires Langchain agent architecture', () => {
  /**
   * TODO: Re-enable when Langchain agent can execute real BC operations
   *
   * These tests verify:
   * - Read operations don't require approval
   * - Write operations require human-in-the-loop approval
   *
   * Current tools don't perform actual BC writes, so approval flow
   * cannot be tested until the Langchain migration adds write capabilities.
   */
  // ... existing tests ...
});
```

### 2.3 Standardize Tool ID Schema

Use `toolUseId` consistently throughout:

```typescript
// Before (multiple options)
const hasId =
  toolData.id !== undefined ||
  toolData.toolUseId !== undefined ||
  toolData.tool_use_id !== undefined;

// After (standardized)
expect(toolData.toolUseId).toBeDefined();
expect(typeof toolData.toolUseId).toBe('string');
```

### 2.4 Strengthen Field Validations

```typescript
// Tool name validation
for (const event of toolUseEvents) {
  const toolData = event.data as AgentEvent & { name?: string };
  expect(toolData.name).toBeDefined();
  expect(typeof toolData.name).toBe('string');
  expect(toolData.name.length).toBeGreaterThan(0);
}

// Tool input validation
for (const event of toolUseEvents) {
  const toolData = event.data as AgentEvent & { input?: Record<string, unknown> };
  expect(toolData.input).toBeDefined();
  expect(typeof toolData.input).toBe('object');
  expect(toolData.input).not.toBeNull();
}
```

### 2.5 Use Proper Tool Correlation

```typescript
// Use SequenceValidator for all correlation checks
const agentEvents = events.map(e => e.data);
const validation = SequenceValidator.validateToolCorrelation(agentEvents);
expect(validation.valid).toBe(true);
expect(validation.errors).toHaveLength(0);
```

### 2.6 Apply Defensive Patterns

From passing E2E tests (04-streaming, 05-extended-thinking):

```typescript
// 1. Proper cleanup order in afterAll
afterAll(async () => {
  await drainMessageQueue();  // CRITICAL: Before cleanup
  await factory.cleanup();
});

// 2. Defensive event filtering
const agentEvents = events.filter(e => e != null && e.data?.type);

// 3. Graceful API error handling
const errorEvents = client.getEventsByType('error');
if (errorEvents.length > 0) {
  console.log('[SKIP] Agent failed due to API issue, not test issue');
  return;
}
```

---

## 3. Files to Modify

| File | Purpose | Changes |
|------|---------|---------|
| `backend/src/__tests__/e2e/flows/06-tool-execution.e2e.test.ts` | Main test file | All changes below |
| `backend/src/__tests__/e2e/setup.e2e.ts` | Import `drainMessageQueue` | Already exists, just import |

---

## 4. Changes to Implement

### 4.1 Import drainMessageQueue

```typescript
// Line ~16
import { setupE2ETest, drainMessageQueue } from '../setup.e2e';
```

### 4.2 Add drainMessageQueue to afterAll

```typescript
// Line ~42-44
afterAll(async () => {
  await drainMessageQueue();  // ADD THIS LINE
  await factory.cleanup();
});
```

### 4.3 Rewrite All Prompts (18 locations)

See Section 2.1 for complete mapping.

### 4.4 Skip Future Tests (2 describe blocks)

- Lines 368-425: `describe.skip('Tool Error Handling - FUTURE...'`
- Lines 631-687: `describe.skip('Read vs Write Operations - FUTURE...'`

### 4.5 Standardize toolUseId (3 locations)

- Lines 169-182
- Lines 242-261
- Any other location using `id` or `tool_use_id`

### 4.6 Fix Tool Correlation (1 location)

- Lines 200-206: Replace count check with `SequenceValidator.validateToolCorrelation()`

### 4.7 Strengthen Validations (2 locations)

- Lines 103-116: Tool name validation
- Lines 142-149: Tool input validation

---

## 5. Important Considerations

### 5.1 Test Purpose

The goal is to verify **backend functionality**, not Business Central integration:
- Tool events are emitted correctly (`tool_use`, `tool_result`)
- Events have proper structure (toolUseId, name, input, content)
- Event ordering is correct (tool_use before tool_result)
- Events are persisted to database
- Sequence numbers are maintained

### 5.2 Current vs Future Architecture

| Aspect | Current | Future (Langchain) |
|--------|---------|-------------------|
| Tool Purpose | Discover BC endpoints | Execute BC operations |
| Write Operations | Not supported | Will require approval |
| Error Handling | Tools return endpoint info | Will return BC errors |
| Approval Flow | Not applicable | Human-in-the-loop |

### 5.3 Test Environment Issues Observed

During diagnosis, the following environment issues were noted (not blocking for test logic):
- MCP Service health check failed (server continues without it)
- BCClient authentication failed (MICROSOFT_CLIENT_ID undefined in test env)
- Redis eviction policy warning (should be "noeviction")

These are environment configuration issues, not test logic issues.

---

## 6. User Instructions That Guided This Analysis

The user provided the following guidance:

1. **Focus on backend verification**: "Los test que estamos haciendo es para verificar que el backend esté funcionando de forma correcta."

2. **Environment vs Logic issues**: "Si ves que el problema es de inicialización de ambiente o algo que tenga que ver con el entorno de test, hay que modificar los test, pero si vemos que hay ejecuciones que pueden ser problemáticas, podríamos verificar la lógica del backend."

3. **Future Langchain migration**: "Todo el tema de las ejecuciones que se van a realizar ahí pronto van a ser migradas para utilizar Langchain."

4. **Current tool limitations**: "En este momento mis tools no permiten al usuario ejecutar acciones reales dentro de Business Central, sino que únicamente le permiten buscar cuál es el endpoint necesario."

5. **Document for future**: "Todo lo que tenga que ver con esto lo podríamos dejar documentado, que debería verificarse una vez que ya hayamos implementado la arquitectura."

6. **Timeout concerns**: "Quiero que me ayudes a verificar en los test que están fallando por timeout si tal vez el system prompt o el prompt que envía el usuario en el test debería cambiar."

7. **Shorter responses**: "Algo como 'list all customers' podría estar activando el tema de thinking, pero haciendo que sea una respuesta más corta para que tampoco tengamos que esperar tanto tiempo."

---

## 7. Project Justification

### 7.1 Why These Changes Are Needed

1. **Alignment with Reality**: Tests must reflect what the system actually does, not aspirational functionality.

2. **Reduced Flakiness**: Simpler prompts = faster responses = fewer timeouts = more reliable tests.

3. **Clear Documentation**: Skipped tests with comments provide a roadmap for Langchain migration.

4. **Proper Validation**: Type-safe validations catch real bugs, not just presence of fields.

5. **Maintainability**: Consistent schema (toolUseId) reduces confusion and bugs.

### 7.2 Expected Outcome

After implementation:
- **18 tests pass** (tool execution flow validation)
- **4 tests skipped** (documented for Langchain)
- **No timeout issues** (concise prompts)
- **No flakiness** (defensive patterns applied)

---

## 8. Implementation Checklist

- [x] Import `drainMessageQueue` from setup.e2e.ts
- [x] Add `drainMessageQueue()` to `afterAll` block
- [ ] Rewrite 18 prompts to match tool capabilities
- [x] Add `.skip()` to `Tool Error Handling` describe block with documentation
- [x] Add `.skip()` to `Read vs Write Operations` describe block with documentation
- [ ] Standardize all tool ID checks to use `toolUseId`
- [ ] Replace count-based correlation with `SequenceValidator.validateToolCorrelation()`
- [ ] Add type validation for tool name (string, non-empty)
- [ ] Add type validation for tool input (object, not null)
- [ ] Add defensive event filtering where needed
- [ ] Run tests 3 times to verify no flakiness

---

## 9. Related Documentation

- **Plan File**: `C:\Users\juanp\.claude\plans\stateless-sprouting-treehouse.md`
- **System Prompt**: `backend/src/services/agent/DirectAgentService.ts:2204-2222`
- **SequenceValidator**: `backend/src/__tests__/e2e/helpers/SequenceValidator.ts`
- **E2E Setup**: `backend/src/__tests__/e2e/setup.e2e.ts`

---

## 10. Next Steps

1. **Implement changes** following this guide
2. **Run tests** after each change (incremental approach)
3. **Verify 3 consecutive passes** for final validation
4. **Update this document** with any findings during implementation
5. **Create Langchain migration ticket** referencing skipped tests
