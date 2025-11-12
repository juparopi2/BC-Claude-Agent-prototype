# Agent Orchestration (Backend) with Claude SDK

## Overview

Este documento describe cómo integrar el Claude Agent SDK en el backend Express para orquestar agentes especializados.

**⚠️ IMPORTANTE**: No crear `MainOrchestrator` class custom. Usar el SDK con factory functions.

---

## Architecture

```
Express Server
    ↓
Socket.IO Handler
    ↓
OrchestratorService.delegateToAgent()
    ↓
AgentFactory.create() → SDK query()
    ↓
Specialized Agent (via system prompt)
    ↓
MCP Tools (via SDK)
    ↓
Business Central
```

---

## AgentService Implementation

```typescript
// backend/src/services/agent/AgentService.ts
import { query } from '@anthropic-ai/claude-agent-sdk';
import { approvalManager } from '../approval/ApprovalManager';
import { todoManager } from '../todo/TodoManager';

export class AgentService {
  private mcpServerConfig = {
    type: 'sse' as const,
    url: process.env.MCP_SERVER_URL!,
    name: 'bc-mcp',
  };

  /**
   * Run a general agent with default configuration
   */
  async runAgent(
    prompt: string,
    sessionId: string | null,
    socket: any
  ) {
    const result = query(prompt, {
      mcpServers: [this.mcpServerConfig],
      resume: sessionId,
      includePartialMessages: true,

      onPreToolUse: async (toolName, args) => {
        // Handle approvals for writes
        if (toolName.startsWith('bc_create') || toolName.startsWith('bc_update')) {
          return await approvalManager.request({
            session_id: sessionId,
            tool_name: toolName,
            tool_args: args,
          });
        }

        // Update todos
        await todoManager.markInProgress(sessionId, toolName);

        return true;
      },

      onPostToolUse: async (toolName, result) => {
        // Mark todo as completed
        await todoManager.markCompleted(sessionId, toolName);

        // Log to audit
        await this.logToolUse(toolName, result, sessionId);
      },
    });

    // Stream events to client
    for await (const event of result) {
      socket.emit('agent:event', event);

      if (event.type === 'session_start') {
        await this.saveSession(event.sessionId);
      }
    }
  }

  /**
   * Create a specialized Query Agent
   */
  createQueryAgent(prompt: string, sessionId: string) {
    return query(prompt, {
      systemPrompt: `You are a specialized Business Central Query Agent.

## Your Role
Expert at retrieving data from Microsoft Business Central.

## Your Responsibilities
1. Understand user queries about BC entities
2. Construct optimal OData filters
3. Use bc_query_entity and bc_get_entity tools efficiently
4. Format results in readable tables or JSON
5. Handle pagination for large datasets

## RESTRICTIONS
- NEVER use bc_create, bc_update, or bc_delete tools
- You can ONLY read data, never modify it`,

      mcpServers: [this.mcpServerConfig],
      resume: sessionId,

      canUseTool: (toolName) => {
        return (
          toolName.startsWith('bc_query') ||
          toolName.startsWith('bc_get') ||
          toolName.includes('read')
        );
      },
    });
  }

  /**
   * Create a specialized Write Agent with approval hooks
   */
  createWriteAgent(prompt: string, sessionId: string) {
    return query(prompt, {
      systemPrompt: `You are a specialized Business Central Write Agent.

## Your Role
Expert at creating and updating data in Microsoft Business Central.

## Your Responsibilities
1. Validate ALL data before writes
2. Request user approval for EVERY change
3. Explain clearly what will be changed
4. Use bc_create_entity and bc_update_entity tools
5. Handle errors gracefully

## RESTRICTIONS
- NEVER make changes without user approval
- Always explain what will be changed first`,

      mcpServers: [this.mcpServerConfig],
      resume: sessionId,

      onPreToolUse: async (toolName, args) => {
        if (toolName.startsWith('bc_create') || toolName.startsWith('bc_update')) {
          return await approvalManager.request({
            session_id: sessionId,
            tool_name: toolName,
            tool_args: args,
            summary: this.generateChangeSummary(toolName, args),
          });
        }
        return true;
      },

      onPostToolUse: async (toolName, result) => {
        // Log all writes to audit log
        await this.logToolUse(toolName, result, sessionId);
      },

      canUseTool: (toolName) => {
        return (
          toolName.startsWith('bc_create') ||
          toolName.startsWith('bc_update') ||
          toolName.startsWith('bc_query') // For validation
        );
      },
    });
  }

  /**
   * Create a validation agent (read-only)
   */
  createValidationAgent(prompt: string, sessionId: string) {
    return query(prompt, {
      systemPrompt: `You are a Business Central Validation Agent.

## Your Role
Validate data against BC schemas and business rules.

## RESTRICTIONS
- You CANNOT make any changes
- You can ONLY read schemas and validate data`,

      mcpServers: [this.mcpServerConfig],
      resume: sessionId,
      permissionMode: 'plan', // Read-only
    });
  }

  private generateChangeSummary(toolName: string, args: any): string {
    if (toolName === 'bc_create_entity') {
      return `Create new ${args.entity_type}: ${JSON.stringify(args.data, null, 2)}`;
    }
    if (toolName === 'bc_update_entity') {
      return `Update ${args.entity_type} (ID: ${args.id}): ${JSON.stringify(args.data, null, 2)}`;
    }
    return `Unknown operation: ${toolName}`;
  }

  private async logToolUse(toolName: string, result: any, sessionId: string) {
    // Log to audit_log table
    await db.audit_log.create({
      session_id: sessionId,
      tool_name: toolName,
      result: JSON.stringify(result),
      timestamp: new Date(),
    });
  }

  private async saveSession(sessionId: string) {
    // Save session to database if it doesn't exist
    await db.sessions.upsert({
      id: sessionId,
      started_at: new Date(),
    });
  }
}

export const agentService = new AgentService();
```

---

## OrchestratorService Implementation

```typescript
// backend/src/services/agent/OrchestratorService.ts
import { query } from '@anthropic-ai/claude-agent-sdk';
import { agentService } from './AgentService';

export class OrchestratorService {
  /**
   * Analyze user intent and delegate to appropriate agent
   */
  async orchestrate(
    userRequest: string,
    sessionId: string,
    socket: any
  ) {
    // 1. Analyze intent
    const intent = await this.analyzeIntent(userRequest);

    // 2. Delegate to appropriate agent
    let agent;

    switch (intent.type) {
      case 'query':
        agent = agentService.createQueryAgent(userRequest, sessionId);
        break;

      case 'create':
      case 'update':
        agent = agentService.createWriteAgent(userRequest, sessionId);
        break;

      case 'validate':
        agent = agentService.createValidationAgent(userRequest, sessionId);
        break;

      default:
        // Fallback: general agent
        await agentService.runAgent(userRequest, sessionId, socket);
        return;
    }

    // 3. Stream agent results to client
    for await (const event of agent) {
      socket.emit('agent:event', event);
    }
  }

  /**
   * Use SDK in plan mode to classify intent
   */
  private async analyzeIntent(userRequest: string): Promise<Intent> {
    const result = query(
      `Analyze this user request and classify the intent:

Request: "${userRequest}"

Return JSON:
{
  "type": "query" | "create" | "update" | "delete" | "analyze" | "validate",
  "confidence": 0.0 - 1.0,
  "reasoning": "explanation"
}`,
      {
        permissionMode: 'plan', // Just analysis, no actions
      }
    );

    for await (const event of result) {
      if (event.type === 'message') {
        return JSON.parse(event.content);
      }
    }

    throw new Error('Failed to analyze intent');
  }
}

export const orchestratorService = new OrchestratorService();
```

---

## Socket.IO Integration

```typescript
// backend/src/server.ts
import express from 'express';
import { createServer } from 'http';
import { Server as SocketIO } from 'socket.io';
import { orchestratorService } from './services/agent/OrchestratorService';

const app = express();
const server = createServer(app);
const io = new SocketIO(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  },
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Handle chat messages
  socket.on('chat:message', async (data) => {
    const { message, sessionId } = data;

    try {
      await orchestratorService.orchestrate(message, sessionId, socket);
    } catch (error) {
      socket.emit('agent:error', {
        error: error.message,
      });
    }
  });

  // Handle approval responses
  socket.on('approval:response', async (data) => {
    const { approvalId, decision } = data;
    await approvalManager.respondToApproval(approvalId, decision);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

server.listen(3001, () => {
  console.log('Server running on port 3001');
});
```

---

## Comparison: Custom vs SDK

| Component | Custom Approach | SDK Approach |
|-----------|----------------|--------------|
| **MainOrchestrator class** | 400+ LOC | N/A (SDK handles) |
| **ClaudeClient wrapper** | 200+ LOC | N/A (SDK handles) |
| **Tool execution** | Manual logic | SDK automatic |
| **Streaming** | Custom implementation | SDK async generator |
| **Session management** | Custom tracking | SDK `resume` |
| **AgentService** | N/A | 200 LOC (configuration) |
| **OrchestratorService** | N/A | 100 LOC (delegation) |

**Total LOC**: ~600 LOC eliminated, ~300 LOC configuration added = **~300 LOC net savings**

---

## Next Steps

1. Implement `AgentService.ts`
2. Implement `OrchestratorService.ts`
3. Integrate with Socket.IO in `server.ts`
4. Test with frontend client

See also:
- [Agent SDK Usage Guide](../02-core-concepts/06-agent-sdk-usage.md)
- [Agentic Loop with SDK](../03-agent-system/01-agentic-loop.md)

---

**Última actualización**: 2025-10-30
**Versión**: 2.0 (Actualizado para Claude Agent SDK)
