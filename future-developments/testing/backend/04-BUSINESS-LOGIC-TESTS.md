# PRD 04: Business Logic Tests - TodoManager & DirectAgentService

**Document Version**: 1.0.0
**Created**: 2025-11-19
**Author**: Claude Code (Anthropic)
**Status**: Active
**Implementation Time**: 8 hours

---

## Executive Summary

**TodoManager**: High business value feature (auto-generated task lists from agent)
**DirectAgentService**: Additional tests beyond existing 11 tests (context management, caching)

**Total**: 16-18 tests (8 hours)

---

## Part 1: TodoManager Tests (8-10 tests, 4 hours)

### Overview

**File**: `backend/src/services/todo/TodoManager.ts`

**Key Features**:
- CRUD operations for todos
- SDK TodoWrite tool interception
- Order index management
- Active form conversion ("Fix bug" → "Fixing bug")

### Test Setup

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TodoManager } from '@/services/todo/TodoManager';

describe('TodoManager', () => {
  let todoManager: TodoManager;
  let dbMock: any;

  beforeEach(() => {
    dbMock = {
      request: vi.fn().mockReturnValue({
        input: vi.fn().mockReturnThis(),
        query: vi.fn().mockResolvedValue({ recordset: [] })
      })
    };
    todoManager = new TodoManager(dbMock);
  });
});
```

### Test 1: Create Todo with Order Index

```typescript
it('should create todo with auto-incremented order index', async () => {
  // Arrange: Mock existing todos count
  dbMock.request().query.mockResolvedValueOnce({ recordset: [{ count: 5 }] });
  dbMock.request().query.mockResolvedValueOnce({ recordset: [{ id: 'todo-1' }] });

  // Act
  const todo = await todoManager.create({
    sessionId: 'session-123',
    content: 'Review customer data',
    status: 'pending'
  });

  // Assert: Order index = 6 (count + 1)
  expect(todo.orderIndex).toBe(6);
  expect(todo.content).toBe('Review customer data');
  expect(todo.status).toBe('pending');
});
```

### Test 2: Update Todo Status (pending → in_progress → completed)

```typescript
it('should update todo status through workflow', async () => {
  const todoId = 'todo-123';

  // Mock todo retrieval
  dbMock.request().query.mockResolvedValue({
    recordset: [{
      id: todoId,
      status: 'pending',
      content: 'Task',
      active_form: 'Task'
    }]
  });

  // Act: pending → in_progress
  await todoManager.updateStatus(todoId, 'in_progress');
  expect(dbMock.request().query).toHaveBeenCalledWith(
    expect.stringContaining("status = 'in_progress'")
  );

  // Act: in_progress → completed
  await todoManager.updateStatus(todoId, 'completed');
  expect(dbMock.request().query).toHaveBeenCalledWith(
    expect.stringContaining("status = 'completed'")
  );
});
```

### Test 3: Active Form Conversion

```typescript
it('should convert content to active form correctly', () => {
  const testCases = [
    { content: 'Fix authentication bug', activeForm: 'Fixing authentication bug' },
    { content: 'Review pull request', activeForm: 'Reviewing pull request' },
    { content: 'Update documentation', activeForm: 'Updating documentation' },
    { content: 'Test new feature', activeForm: 'Testing new feature' }
  ];

  testCases.forEach(({ content, activeForm }) => {
    const result = todoManager.convertToActiveForm(content);
    expect(result).toBe(activeForm);
  });
});
```

### Test 4: SDK TodoWrite Tool Interception

```typescript
it('should intercept TodoWrite tool calls from SDK', async () => {
  // Arrange: Mock SDK tool_use event
  const toolUseEvent = {
    type: 'tool_use',
    id: 'tool_abc',
    name: 'TodoWrite',
    input: {
      todos: [
        { content: 'Verify results', status: 'pending' },
        { content: 'Update report', status: 'pending' }
      ]
    }
  };

  // Act
  const createdTodos = await todoManager.handleToolUse('session-123', toolUseEvent);

  // Assert: 2 todos created
  expect(createdTodos).toHaveLength(2);
  expect(createdTodos[0].content).toBe('Verify results');
  expect(createdTodos[1].content).toBe('Update report');
});
```

### Test 5: List Todos Ordered by Order Index

```typescript
it('should list todos ordered by order_index ASC', async () => {
  // Arrange
  const mockTodos = [
    { id: '1', order_index: 1, content: 'First' },
    { id: '2', order_index: 2, content: 'Second' },
    { id: '3', order_index: 3, content: 'Third' }
  ];

  dbMock.request().query.mockResolvedValue({ recordset: mockTodos });

  // Act
  const todos = await todoManager.list('session-123');

  // Assert: Ordered correctly
  expect(todos[0].orderIndex).toBe(1);
  expect(todos[1].orderIndex).toBe(2);
  expect(todos[2].orderIndex).toBe(3);

  // Assert: Query includes ORDER BY
  expect(dbMock.request().query).toHaveBeenCalledWith(
    expect.stringContaining('ORDER BY order_index ASC')
  );
});
```

### Test 6: Reorder Todos

```typescript
it('should reorder todos by updating order_index', async () => {
  // Arrange: Move todo from index 3 to index 1
  const todoId = 'todo-3';
  const newIndex = 1;

  // Act
  await todoManager.reorder(todoId, newIndex);

  // Assert: UPDATE query with new order_index
  expect(dbMock.request().query).toHaveBeenCalledWith(
    expect.stringContaining('UPDATE todos SET order_index')
  );

  // Assert: Other todos shifted (index 1 → 2, index 2 → 3)
  expect(dbMock.request().query).toHaveBeenCalledWith(
    expect.stringContaining('order_index = order_index + 1')
  );
});
```

### Test 7: Delete Todo (Soft Delete)

```typescript
it('should soft delete todo by setting deleted_at', async () => {
  const todoId = 'todo-delete';

  // Act
  await todoManager.delete(todoId);

  // Assert: UPDATE with deleted_at timestamp
  expect(dbMock.request().query).toHaveBeenCalledWith(
    expect.stringContaining('UPDATE todos SET deleted_at = GETDATE()')
  );

  // Assert: NOT a hard DELETE
  expect(dbMock.request().query).not.toHaveBeenCalledWith(
    expect.stringContaining('DELETE FROM todos')
  );
});
```

### Test 8: Bulk Operations (Mark Multiple as Completed)

```typescript
it('should mark multiple todos as completed in bulk', async () => {
  const todoIds = ['todo-1', 'todo-2', 'todo-3'];

  // Act
  await todoManager.bulkUpdateStatus(todoIds, 'completed');

  // Assert: UPDATE with IN clause
  expect(dbMock.request().query).toHaveBeenCalledWith(
    expect.stringContaining("id IN ('todo-1', 'todo-2', 'todo-3')")
  );
  expect(dbMock.request().query).toHaveBeenCalledWith(
    expect.stringContaining("status = 'completed'")
  );
});
```

**TodoManager Summary**: 8 tests, 4 hours

---

## Part 2: DirectAgentService Additional Tests (6-8 tests, 4 hours)

### Overview

**Existing Tests**: 11 tests already passing (PRD 01 reference)

**Additional Coverage Needed**:
- Context window management (>100K tokens)
- Prompt caching validation
- Tool definition schema validation
- History truncation
- System prompt regeneration

### Test 9: Context Window Management (>100K Tokens)

```typescript
it('should truncate history when exceeding 100K token limit', async () => {
  // Arrange: Create conversation with 120K tokens
  const longHistory = [];
  for (let i = 0; i < 50; i++) {
    longHistory.push({
      role: 'user',
      content: 'A'.repeat(2000) // ~2000 tokens per message
    });
    longHistory.push({
      role: 'assistant',
      content: 'B'.repeat(2000)
    });
  }

  const sessionMock = {
    id: 'session-long',
    conversationHistory: longHistory
  };

  // Mock token counter
  vi.spyOn(directAgentService, 'countTokens').mockReturnValue(120000);

  // Act
  const truncatedHistory = await directAgentService.prepareHistory(sessionMock);

  // Assert: History truncated to fit 100K limit
  const totalTokens = directAgentService.countTokens(
    JSON.stringify(truncatedHistory)
  );
  expect(totalTokens).toBeLessThanOrEqual(100000);

  // Assert: Most recent messages preserved
  expect(truncatedHistory[truncatedHistory.length - 1].role).toBe('assistant');
});
```

### Test 10: Prompt Caching Enabled

```typescript
it('should enable prompt caching for system prompt', async () => {
  // Arrange
  process.env.ENABLE_PROMPT_CACHING = 'true';

  // Mock Anthropic SDK call
  const createSpy = vi.spyOn(anthropicClient.messages, 'create');

  // Act
  await directAgentService.processMessage('session-cache', 'Test message');

  // Assert: system prompt includes cache_control
  expect(createSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      system: expect.arrayContaining([
        expect.objectContaining({
          type: 'text',
          text: expect.any(String),
          cache_control: { type: 'ephemeral' }
        })
      ])
    })
  );
});
```

### Test 11: Tool Definition Schema Validation

```typescript
it('should validate tool definitions match MCP server schema', () => {
  // Arrange: Expected MCP tool schema
  const expectedTools = [
    'list_all_entities',
    'search_entity_operations',
    'get_entity_details',
    'get_entity_relationships',
    'validate_workflow_structure',
    'build_knowledge_base_workflow',
    'get_endpoint_documentation'
  ];

  // Act
  const actualTools = directAgentService.getToolDefinitions();

  // Assert: All 7 tools present
  expect(actualTools).toHaveLength(7);

  expectedTools.forEach(toolName => {
    const tool = actualTools.find(t => t.name === toolName);
    expect(tool).toBeDefined();
    expect(tool.input_schema).toBeDefined();
    expect(tool.description).toBeTruthy();
  });
});
```

### Test 12: System Prompt Regeneration Each Turn

```typescript
it('should regenerate system prompt each turn with updated context', async () => {
  const sessionId = 'session-prompt';

  // Mock SDK calls
  const createSpy = vi.spyOn(anthropicClient.messages, 'create');

  // Act: Send 3 messages
  await directAgentService.processMessage(sessionId, 'Message 1');
  await directAgentService.processMessage(sessionId, 'Message 2');
  await directAgentService.processMessage(sessionId, 'Message 3');

  // Assert: System prompt regenerated 3 times
  expect(createSpy).toHaveBeenCalledTimes(3);

  // Assert: Each call has system prompt
  createSpy.mock.calls.forEach(call => {
    expect(call[0].system).toBeDefined();
    expect(call[0].system).toContain('You are a Business Central agent');
  });
});
```

### Test 13: Partial Messages Included in Context

```typescript
it('should include partial messages in conversation context', async () => {
  // Arrange: Session with partial message (stop_reason='tool_use')
  const sessionMock = {
    id: 'session-partial',
    conversationHistory: [
      { role: 'user', content: 'List customers' },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', name: 'list_all_entities' }],
        stop_reason: 'tool_use' // Partial message
      }
      // No final response yet
    ]
  };

  // Act
  const context = await directAgentService.buildContext(sessionMock);

  // Assert: Partial message included
  expect(context.messages).toHaveLength(2);
  expect(context.messages[1].role).toBe('assistant');
  expect(context.messages[1].content).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: 'tool_use' })
    ])
  );
});
```

### Test 14: Max Turns Safety Limit (20)

```typescript
it('should enforce max turns limit of 20', async () => {
  // Arrange: Mock SDK to always return tool_use (infinite loop)
  anthropicMock.messages.create.mockResolvedValue({
    id: 'msg-loop',
    role: 'assistant',
    content: [{ type: 'tool_use', name: 'list_all_entities', input: {} }],
    stop_reason: 'tool_use'
  });

  // Mock approval always approves
  approvalManagerMock.request.mockResolvedValue(true);

  // Act
  await expect(
    directAgentService.processMessage('session-loop', 'Test')
  ).rejects.toThrow(/Max turns limit reached/);

  // Assert: SDK called 20 times (max limit)
  expect(anthropicMock.messages.create).toHaveBeenCalledTimes(20);
});
```

**DirectAgentService Summary**: 6 additional tests, 4 hours

---

## Implementation Checklist

### TodoManager Tests (4 hours)
- [ ] Test 1: Create with order index (30 min)
- [ ] Test 2: Update status workflow (30 min)
- [ ] Test 3: Active form conversion (20 min)
- [ ] Test 4: TodoWrite interception (45 min)
- [ ] Test 5: List ordered (20 min)
- [ ] Test 6: Reorder todos (30 min)
- [ ] Test 7: Soft delete (20 min)
- [ ] Test 8: Bulk operations (25 min)

### DirectAgentService Additional Tests (4 hours)
- [ ] Test 9: Context window management (45 min)
- [ ] Test 10: Prompt caching (30 min)
- [ ] Test 11: Tool schema validation (30 min)
- [ ] Test 12: System prompt regeneration (30 min)
- [ ] Test 13: Partial messages in context (45 min)
- [ ] Test 14: Max turns limit (30 min)

### After Completion
- [ ] Run all tests: `npm test`
- [ ] Check coverage: `npm run test:coverage`
- [ ] Update TODO.md
- [ ] Proceed to PRD 05 (Integration Tests)

---

**End of PRD 04: Business Logic Tests**
