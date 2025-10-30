# Claude Agent SDK - Usage Guide

## Overview

El **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) es la biblioteca oficial de Anthropic para construir aplicaciones agenticas con Claude. Proporciona toda la infraestructura necesaria para agentes, incluyendo:

- ✅ Agentic loop completo
- ✅ Orquestación multi-agente
- ✅ Tool calling automático
- ✅ Streaming de respuestas
- ✅ Gestión de sesiones
- ✅ Sistema de permisos
- ✅ Integración con MCP
- ✅ Hooks de lifecycle

**No necesitas construir un sistema de agentes desde cero.** El SDK ya provee todo lo necesario.

---

## Installation

```bash
npm install @anthropic-ai/claude-agent-sdk
```

---

## Core Concept: `query()`

La función principal del SDK es `query()`. Acepta un prompt y retorna un async generator que streamea eventos:

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

const result = query(
  'Create a customer named Acme Corp with email acme@example.com',
  {
    // Options
  }
);

for await (const event of result) {
  console.log(event);
}
```

---

## Basic Usage

### 1. Simple Query

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

async function simpleAgent() {
  const result = query('What is 2 + 2?');

  for await (const event of result) {
    if (event.type === 'message') {
      console.log('Agent:', event.content);
    }
  }
}
```

### 2. With MCP Server Integration

```typescript
const result = query('List all customers from Business Central', {
  mcpServers: [
    {
      type: 'sse',
      url: 'https://app-erptools-mcp-dev.purplemushroom-befedc5f.westeurope.azurecontainerapps.io/mcp',
      name: 'bc-mcp',
    },
  ],
});

for await (const event of result) {
  if (event.type === 'tool_use') {
    console.log('Tool called:', event.toolName, event.args);
  }

  if (event.type === 'tool_result') {
    console.log('Tool result:', event.result);
  }

  if (event.type === 'message') {
    console.log('Agent response:', event.content);
  }
}
```

### 3. With Streaming to UI

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';
import { Server as SocketIO } from 'socket.io';

async function streamToClient(socket: SocketIO, prompt: string) {
  const result = query(prompt, {
    mcpServers: [/* ... */],
    includePartialMessages: true, // Enable partial streaming
  });

  for await (const event of result) {
    // Stream all events to client
    socket.emit('agent:event', event);

    if (event.type === 'message_partial') {
      socket.emit('agent:message_chunk', event.content);
    }

    if (event.type === 'message') {
      socket.emit('agent:message_complete', event.content);
    }

    if (event.type === 'tool_use') {
      socket.emit('agent:tool_use', {
        tool: event.toolName,
        args: event.args,
      });
    }
  }
}
```

---

## Configuration Options

### Full Options Interface

```typescript
interface QueryOptions {
  // Model configuration
  model?: 'claude-sonnet-4' | 'claude-opus-4' | 'claude-haiku-4';
  fallbackModel?: string;

  // System prompt
  systemPrompt?: string | 'claudeCode'; // Use Claude Code's system prompt

  // MCP servers
  mcpServers?: MCPServerConfig[];

  // Permissions
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
  canUseTool?: (toolName: string) => boolean;

  // Session management
  resume?: string; // Session ID to resume
  continue?: boolean; // Continue last conversation

  // Streaming
  includePartialMessages?: boolean;

  // Environment
  workingDirectory?: string;
  environment?: Record<string, string>;
  restrictToDirectory?: string;

  // Advanced
  maxThinkingTokens?: number;
  promptCaching?: boolean;

  // Hooks
  onPreToolUse?: (toolName: string, args: any) => Promise<boolean>;
  onPostToolUse?: (toolName: string, result: any) => Promise<void>;
  onSessionStart?: (sessionId: string) => Promise<void>;
}
```

---

## Event Types

El SDK emite varios tipos de eventos a través del async generator:

```typescript
type SDKEvent =
  | { type: 'thinking'; content: string }
  | { type: 'message_partial'; content: string }
  | { type: 'message'; content: string; role: 'user' | 'assistant' }
  | { type: 'tool_use'; toolName: string; args: any; id: string }
  | { type: 'tool_result'; toolName: string; result: any; id: string }
  | { type: 'error'; error: Error }
  | { type: 'session_start'; sessionId: string }
  | { type: 'session_end'; sessionId: string };
```

### Handling Events

```typescript
for await (const event of result) {
  switch (event.type) {
    case 'thinking':
      console.log('Agent is thinking:', event.content);
      break;

    case 'message_partial':
      // Partial message for streaming
      process.stdout.write(event.content);
      break;

    case 'message':
      console.log('Complete message:', event.content);
      break;

    case 'tool_use':
      console.log(`Calling tool: ${event.toolName}`);
      console.log('Args:', event.args);
      break;

    case 'tool_result':
      console.log(`Tool ${event.toolName} returned:`, event.result);
      break;

    case 'error':
      console.error('Error:', event.error);
      break;
  }
}
```

---

## Multi-Agent Patterns

El SDK soporta multi-agent workflows mediante configuración:

```typescript
// Specialized agents via prompts
const queryAgent = (prompt: string) =>
  query(prompt, {
    systemPrompt: `You are a specialized query agent for Business Central.
    Your job is to:
    - Understand user queries
    - Construct optimal OData filters
    - Query BC entities via MCP tools
    - Format results for readability`,
    mcpServers: [bcMcpServer],
  });

const writeAgent = (prompt: string) =>
  query(prompt, {
    systemPrompt: `You are a specialized write agent for Business Central.
    Your job is to:
    - Validate data before writes
    - Request user approval for all changes
    - Execute create/update operations via MCP
    - Handle errors and rollbacks`,
    mcpServers: [bcMcpServer],
    onPreToolUse: async (toolName, args) => {
      // Only allow write tools
      if (!toolName.startsWith('bc_create') && !toolName.startsWith('bc_update')) {
        throw new Error('This agent only handles write operations');
      }
      return true;
    },
  });

// Main orchestrator delegates to specialized agents
async function orchestrator(userRequest: string) {
  // Analyze intent
  const intent = await analyzeIntent(userRequest);

  if (intent.type === 'query') {
    return queryAgent(userRequest);
  }

  if (intent.type === 'write') {
    return writeAgent(userRequest);
  }
}
```

---

## Permission System

### Built-in Permission Modes

```typescript
// 1. Default mode - Ask for permission on critical tools
query(prompt, {
  permissionMode: 'default',
});

// 2. Accept all edits automatically
query(prompt, {
  permissionMode: 'acceptEdits',
});

// 3. Bypass all permissions (use with caution!)
query(prompt, {
  permissionMode: 'bypassPermissions',
});

// 4. Plan mode - Only research, no modifications
query(prompt, {
  permissionMode: 'plan',
});
```

### Custom Permission Logic

```typescript
query(prompt, {
  canUseTool: async (toolName: string, args: any) => {
    // Custom permission logic
    if (toolName.startsWith('bc_delete')) {
      // Never allow deletes
      return false;
    }

    if (toolName.startsWith('bc_create') || toolName.startsWith('bc_update')) {
      // Request user approval for writes
      return await requestApproval(toolName, args);
    }

    // Allow all reads
    return true;
  },
});
```

---

## Hooks System

El SDK proporciona hooks para interceptar events:

```typescript
const result = query(prompt, {
  onSessionStart: async (sessionId) => {
    console.log('Session started:', sessionId);
    await db.sessions.create({ id: sessionId, started_at: new Date() });
  },

  onPreToolUse: async (toolName, args) => {
    console.log(`About to call: ${toolName}`);

    // Log to database
    await db.tool_calls.create({
      tool_name: toolName,
      args,
      timestamp: new Date(),
    });

    // BC writes require approval
    if (toolName.startsWith('bc_create') || toolName.startsWith('bc_update')) {
      return await approvalManager.request({
        toolName,
        args,
      });
    }

    return true; // Allow
  },

  onPostToolUse: async (toolName, result) => {
    console.log(`${toolName} completed:`, result);

    // Update database
    await db.tool_calls.update({
      where: { tool_name: toolName },
      data: { result, completed_at: new Date() },
    });
  },

  onUserPromptSubmit: async (prompt) => {
    console.log('User submitted:', prompt);
  },
});
```

---

## Session Management

### Resume Previous Session

```typescript
// First session
const session1 = query('Create a customer named Acme Corp');
for await (const event of session1) {
  if (event.type === 'session_start') {
    console.log('Session ID:', event.sessionId);
    // Save sessionId for later
  }
}

// Later: Resume session
const session2 = query('Now update that customer email', {
  resume: savedSessionId, // Agent remembers previous context
});
```

### Continue Last Conversation

```typescript
// Continue the last conversation
const result = query('What was the last thing I asked you?', {
  continue: true,
});
```

---

## Integration with Express + Socket.IO

### Backend Setup

```typescript
import express from 'express';
import { createServer } from 'http';
import { Server as SocketIO } from 'socket.io';
import { query } from '@anthropic-ai/claude-agent-sdk';

const app = express();
const server = createServer(app);
const io = new SocketIO(server);

io.on('connection', (socket) => {
  console.log('Client connected');

  socket.on('chat:message', async (data) => {
    const { message, sessionId } = data;

    try {
      const result = query(message, {
        mcpServers: [
          {
            type: 'sse',
            url: process.env.MCP_SERVER_URL!,
            name: 'bc-mcp',
          },
        ],
        resume: sessionId,
        includePartialMessages: true,

        onPreToolUse: async (toolName, args) => {
          // Request approval for writes
          if (toolName.startsWith('bc_create') || toolName.startsWith('bc_update')) {
            socket.emit('approval:requested', {
              toolName,
              args,
            });

            // Wait for user response
            return new Promise((resolve) => {
              socket.once('approval:response', (response) => {
                resolve(response.approved);
              });
            });
          }

          return true;
        },
      });

      for await (const event of result) {
        // Stream all events to client
        socket.emit('agent:event', event);

        if (event.type === 'session_start') {
          socket.emit('session:started', { sessionId: event.sessionId });
        }
      }
    } catch (error) {
      socket.emit('agent:error', { error: error.message });
    }
  });
});

server.listen(3001, () => console.log('Server running on port 3001'));
```

---

## Advanced: Todo List Integration

El SDK no tiene todo lists built-in, pero se pueden implementar usando hooks:

```typescript
class TodoManager {
  private todos: Map<string, Todo[]> = new Map();

  async generateFromPlan(sessionId: string, prompt: string) {
    // Use Claude to generate initial plan
    const planResult = query(
      `Break down this task into steps:\n${prompt}\n\nReturn JSON: { steps: string[] }`,
      {
        permissionMode: 'plan', // No modifications
      }
    );

    for await (const event of planResult) {
      if (event.type === 'message') {
        const plan = JSON.parse(event.content);
        this.todos.set(
          sessionId,
          plan.steps.map((step: string) => ({
            description: step,
            status: 'pending',
          }))
        );
      }
    }
  }

  markInProgress(sessionId: string, stepIndex: number) {
    const todos = this.todos.get(sessionId);
    if (todos) {
      todos[stepIndex].status = 'in_progress';
      this.emit('todo:updated', todos);
    }
  }

  markCompleted(sessionId: string, stepIndex: number) {
    const todos = this.todos.get(sessionId);
    if (todos) {
      todos[stepIndex].status = 'completed';
      this.emit('todo:updated', todos);
    }
  }
}

// Usage with SDK
const todoManager = new TodoManager();

async function runWithTodos(prompt: string, sessionId: string) {
  // 1. Generate todos
  await todoManager.generateFromPlan(sessionId, prompt);

  // 2. Execute with todo tracking
  const result = query(prompt, {
    resume: sessionId,

    onPreToolUse: async (toolName) => {
      // Mark current step as in progress
      todoManager.markInProgress(sessionId, currentStepIndex);
      return true;
    },

    onPostToolUse: async (toolName, result) => {
      // Mark current step as completed
      todoManager.markCompleted(sessionId, currentStepIndex);
      currentStepIndex++;
    },
  });

  for await (const event of result) {
    // Handle events
  }
}
```

---

## Error Handling

```typescript
try {
  const result = query(prompt, options);

  for await (const event of result) {
    if (event.type === 'error') {
      console.error('Agent error:', event.error);

      // Handle specific error types
      if (event.error.message.includes('rate limit')) {
        await sleep(5000);
        // Retry
      }
    }

    if (event.type === 'tool_result' && !event.result.success) {
      console.error('Tool failed:', event.result.error);
      // Handle tool failure
    }
  }
} catch (error) {
  console.error('Fatal error:', error);
}
```

---

## Performance: Prompt Caching

El SDK soporta prompt caching de Claude:

```typescript
const result = query(prompt, {
  promptCaching: true, // Enable caching
  systemPrompt: 'claudeCode', // Use cached Claude Code prompt
});
```

Esto reduce latencia y costos para conversaciones largas.

---

## What You Still Need to Build

El SDK provee la infraestructura de agentes, pero **todavía necesitas construir**:

### 1. Approval System
```typescript
class ApprovalManager {
  async request(action: Action): Promise<boolean> {
    // Store approval request in database
    const approval = await db.approvals.create({
      session_id: sessionId,
      action_type: action.toolName,
      action_data: action.args,
      status: 'pending',
    });

    // Emit to frontend via WebSocket
    socket.emit('approval:requested', approval);

    // Wait for user decision
    return new Promise((resolve) => {
      socket.once(`approval:${approval.id}:response`, (response) => {
        resolve(response.approved);
      });
    });
  }
}
```

### 2. Todo List Manager
```typescript
// As shown above
class TodoManager {
  // Custom implementation for BC-specific todos
}
```

### 3. Business Central Validation
```typescript
async function validateBCData(entityType: string, data: any): Promise<ValidationResult> {
  // Custom validation logic specific to BC
  // - Check required fields
  // - Validate formats
  // - Check business rules
}
```

### 4. Database Persistence
```typescript
// Save sessions, messages, approvals, todos to PostgreSQL/Azure SQL
await db.messages.create({
  session_id: sessionId,
  role: 'assistant',
  content: message,
  thinking_tokens: thinkingTokenCount,
});
```

### 5. UI Components
```typescript
// Frontend React components for:
// - Chat interface
// - Approval dialogs
// - Todo lists
// - Source panel
```

---

## Comparison: Custom vs SDK

### ❌ What You DON'T Need to Build Anymore

| Component | Custom Approach | With SDK |
|-----------|----------------|----------|
| **Agentic Loop** | Custom `AgenticLoop` class (200+ LOC) | ✅ Built-in |
| **Orchestration** | Custom `MainOrchestrator` (300+ LOC) | ✅ Built-in via `query()` |
| **Tool Calling** | Manual tool execution logic | ✅ Automatic |
| **Streaming** | Custom streaming implementation | ✅ Built-in async generator |
| **Session Management** | Custom session tracking | ✅ Built-in with `resume` |
| **Permissions** | Custom permission system | ✅ Built-in with hooks |
| **Error Recovery** | Custom error handling | ✅ Built-in retry logic |

### ✅ What You Still Build

| Component | Why Custom? |
|-----------|-------------|
| **Approval System** | BC-specific business rules |
| **Todo Lists** | Custom workflow tracking |
| **UI/Frontend** | Application-specific design |
| **BC Validation** | Domain-specific logic |
| **Database Persistence** | Application data model |

---

## Migration Path

Si ya empezaste a construir un sistema custom, migra así:

### Before (Custom)

```typescript
class MainOrchestrator {
  async run(message: string): Promise<Result> {
    const intent = await this.analyzeIntent(message);
    const plan = await this.createPlan(intent);

    for (const step of plan.steps) {
      const subagent = this.selectSubagent(step);
      await subagent.execute(step);
    }

    return { success: true };
  }
}
```

### After (SDK)

```typescript
async function runAgent(message: string, sessionId: string) {
  const result = query(message, {
    mcpServers: [bcMcpServer],
    resume: sessionId,

    onPreToolUse: async (toolName, args) => {
      if (isWriteOperation(toolName)) {
        return await approvalManager.request({ toolName, args });
      }
      return true;
    },
  });

  for await (const event of result) {
    // Handle events
  }
}
```

**Líneas de código eliminadas**: ~500+ LOC de infraestructura de agentes.

---

## Next Steps

- [Agent SDK Integration (Backend)](../../11-backend/07-agent-sdk-integration.md)
- [Human-in-the-Loop with SDK](../../05-control-flow/01-human-in-the-loop.md)
- [MCP Integration](../../04-integrations/01-mcp-overview.md)

---

**Última actualización**: 2025-10-30
**Versión**: 2.0
