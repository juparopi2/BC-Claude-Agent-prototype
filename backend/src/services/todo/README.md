# Todo Manager Service

Automatic todo list generation and tracking for agent tasks.

## Overview

The TodoManager service automatically generates and tracks todo lists for agent tasks in real-time. It uses the **Agent SDK in 'plan' mode** to analyze user prompts and generate step-by-step plans.

## Architecture

```
User Prompt → TodoManager.generateFromPlan()
                    ↓
              [Agent SDK: plan mode]
                    ↓
              [Parse steps from plan]
                    ↓
              [Create todos in DB]
                    ↓
              [Emit todo:created event]
                    ↓
Agent starts → onPreToolUse → markInProgress()
                    ↓
              [Update todo: in_progress]
                    ↓
              [Emit todo:updated event]
                    ↓
Tool completes → onPostToolUse → markCompleted()
                    ↓
              [Update todo: completed/failed]
                    ↓
              [Emit todo:completed event]
```

## Usage

### Basic Usage

```typescript
import { getTodoManager } from './services/todo/TodoManager';

// Initialize with Socket.IO server
const todoManager = getTodoManager(io);

// Generate todos from user prompt
const todos = await todoManager.generateFromPlan({
  sessionId: 'session-123',
  prompt: 'Create 3 customers: Acme Corp, Beta Inc, Gamma LLC',
});

// Result:
// [
//   { id: 'todo-1', content: 'Create customer Acme Corp', status: 'pending', order: 0 },
//   { id: 'todo-2', content: 'Create customer Beta Inc', status: 'pending', order: 1 },
//   { id: 'todo-3', content: 'Create customer Gamma LLC', status: 'pending', order: 2 }
// ]
```

### Integration with Agent SDK Hooks

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';
import { getTodoManager } from './services/todo/TodoManager';

const todoManager = getTodoManager(io);

// Generate initial todos from prompt
await todoManager.generateFromPlan({
  sessionId,
  prompt: userMessage,
});

// Track progress via hooks
const result = query(userMessage, {
  mcpServers: [...],
  resume: sessionId,

  onPreToolUse: async (toolName, args) => {
    // Find current todo (simple: get first pending)
    const todos = await todoManager.getTodosBySession(sessionId);
    const currentTodo = todos.find(t => t.status === 'pending');

    if (currentTodo) {
      await todoManager.markInProgress(sessionId, currentTodo.id);
    }

    return true;
  },

  onPostToolUse: async (toolName, result) => {
    // Find current in-progress todo
    const todos = await todoManager.getTodosBySession(sessionId);
    const currentTodo = todos.find(t => t.status === 'in_progress');

    if (currentTodo) {
      const success = !result.error;
      await todoManager.markCompleted(sessionId, currentTodo.id, success);
    }
  },
});
```

## Features

### ✅ Auto-Generation with Agent SDK

Uses Agent SDK in 'plan' mode to analyze prompts and generate plans:

```typescript
const todos = await todoManager.generateFromPlan({
  sessionId: 'session-123',
  prompt: 'Update prices for items DESK001, CHAIR100, LAMP50 to match competitor pricing',
});

// Generated todos:
// 1. "Update price for item DESK001"
// 2. "Update price for item CHAIR100"
// 3. "Update price for item LAMP50"
```

### ✅ Heuristic Fallback

If SDK planning fails, falls back to simple pattern matching:

- "Create 5 customers" → 5 todos
- "Create customer A, B, C" → 3 todos
- Complex prompt → 1 generic todo

### ✅ Real-Time Status Updates

Emits WebSocket events for every status change:

- `todo:created` - When todos are generated
- `todo:updated` - When status changes
- `todo:completed` - When todo is completed/failed

### ✅ Active Form Display

Automatically converts imperative to present continuous for UI:

- "Create customer" → "Creating customer"
- "Update item" → "Updating item"
- "Delete vendor" → "Deleting vendor"

## WebSocket Events

### Server → Client

**`todo:created`**
```typescript
{
  sessionId: string;
  todos: Todo[];
}
```

**`todo:updated`**
```typescript
{
  todoId: string;
  sessionId: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  completedAt?: Date;
}
```

**`todo:completed`**
```typescript
{
  todoId: string;
  sessionId: string;
  status: 'completed' | 'failed';
  completedAt: Date;
}
```

## Database Schema

```sql
CREATE TABLE todos (
  id VARCHAR(100) PRIMARY KEY,
  session_id VARCHAR(100) NOT NULL,
  content NVARCHAR(500) NOT NULL, -- Imperative form
  activeForm NVARCHAR(500) NOT NULL, -- Present continuous form
  status VARCHAR(20) NOT NULL, -- pending, in_progress, completed, failed
  [order] INT NOT NULL, -- 0-indexed order
  created_at DATETIME2 NOT NULL,
  started_at DATETIME2 NULL,
  completed_at DATETIME2 NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);
```

## API Methods

### `generateFromPlan(options)`

Generate todos from user prompt using Agent SDK.

**Parameters:**
- `sessionId` (string): Session ID
- `prompt` (string): User prompt to analyze
- `useSDKPlanning?` (boolean): Use Agent SDK (default: true)

**Returns:** `Promise<Todo[]>` - Array of created todos

### `createManualTodo(request)`

Create a single todo manually.

**Parameters:**
- `sessionId` (string): Session ID
- `content` (string): Todo content (imperative form)
- `activeForm` (string): Present continuous form
- `order?` (number): Optional order (auto-calculated if not provided)

**Returns:** `Promise<Todo>` - Created todo

### `markInProgress(sessionId, todoId)`

Mark a todo as in progress.

**Parameters:**
- `sessionId` (string): Session ID
- `todoId` (string): Todo ID

**Returns:** `Promise<void>`

### `markCompleted(sessionId, todoId, success)`

Mark a todo as completed or failed.

**Parameters:**
- `sessionId` (string): Session ID
- `todoId` (string): Todo ID
- `success` (boolean): Whether task succeeded

**Returns:** `Promise<void>`

### `getTodosBySession(sessionId)`

Get all todos for a session.

**Parameters:**
- `sessionId` (string): Session ID

**Returns:** `Promise<Todo[]>` - Array of todos ordered by `order` field

## Examples

### Example 1: Batch Customer Creation

```typescript
// User: "Create customers: Acme Corp, Beta Inc, Gamma LLC"

const todos = await todoManager.generateFromPlan({
  sessionId: 'session-123',
  prompt: 'Create customers: Acme Corp, Beta Inc, Gamma LLC',
});

// Result:
// [
//   { content: 'Create customer Acme Corp', activeForm: 'Creating customer Acme Corp', status: 'pending' },
//   { content: 'Create customer Beta Inc', activeForm: 'Creating customer Beta Inc', status: 'pending' },
//   { content: 'Create customer Gamma LLC', activeForm: 'Creating customer Gamma LLC', status: 'pending' }
// ]
```

### Example 2: Complex Multi-Step Task

```typescript
// User: "Analyze Q4 sales and generate report"

const todos = await todoManager.generateFromPlan({
  sessionId: 'session-456',
  prompt: 'Analyze Q4 sales and generate report',
});

// Agent SDK generates:
// [
//   { content: 'Query Q4 sales data from Business Central', status: 'pending' },
//   { content: 'Calculate total revenue and top customers', status: 'pending' },
//   { content: 'Identify trends and anomalies', status: 'pending' },
//   { content: 'Generate summary report', status: 'pending' }
// ]
```

### Example 3: Manual Todo Creation

```typescript
// Create custom todo
const todo = await todoManager.createManualTodo({
  sessionId: 'session-789',
  content: 'Verify data integrity after import',
  activeForm: 'Verifying data integrity after import',
});

// Mark as in progress
await todoManager.markInProgress('session-789', todo.id);

// Complete
await todoManager.markCompleted('session-789', todo.id, true);
```

## Agent SDK Planning

The TodoManager uses Agent SDK's 'plan' mode for intelligent task breakdown:

```typescript
// Internally:
const planResult = query(
  `Break down this task into steps:\n\n"${prompt}"\n\nReturn JSON: {"steps": [...]}`,
  {
    permissionMode: 'plan', // Read-only, no tool execution
    mcpServers: [], // No MCP needed for planning
  }
);
```

**Benefits:**
- ✅ Intelligent task decomposition
- ✅ Context-aware step generation
- ✅ Natural language understanding
- ✅ Handles complex multi-step tasks

**Fallback:**
If SDK planning fails (network issue, parsing error), falls back to heuristic pattern matching.

## Error Handling

```typescript
try {
  const todos = await todoManager.generateFromPlan({
    sessionId,
    prompt: userMessage,
  });

  console.log(`Generated ${todos.length} todos`);
} catch (error) {
  console.error('Failed to generate todos:', error);
  // TodoManager automatically falls back to heuristic method
  // Errors only thrown for database issues
}
```

## Testing

See `backend/scripts/test-todo-tracking.ts` for test scripts.

---

**Related Documentation:**
- [Todo Lists](../../../docs/06-observability/06-todo-lists.md)
- [Agent SDK Usage](../../../docs/02-core-concepts/06-agent-sdk-usage.md)
- [Todo System Types](../../types/todo.types.ts)

**Version:** 1.0
**Last Updated:** 2025-01-07
