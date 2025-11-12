# Orchestration & Multi-Agent Patterns with Claude SDK

## Overview

La **orquestación** es el proceso de coordinar múltiples agentes especializados para completar tareas complejas.

**⚠️ IMPORTANTE**: Con el Claude Agent SDK, la orquestación se hace mediante **configuración declarativa**, no construyendo un `MainOrchestrator` class custom.

---

## ❌ Approach Obsoleto (Custom)

```typescript
// OBSOLETO - No usar
class MainOrchestrator {
  private subagents: Map<string, Subagent>;

  async execute(task: Task): Promise<Result> {
    // 1. Analyze & plan
    const plan = await this.createPlan(task);

    // 2. Delegate to subagents
    const results = [];
    for (const step of plan.steps) {
      const subagent = this.selectSubagent(step);
      const result = await subagent.execute(step);
      results.push(result);
    }

    // 3. Synthesize
    return this.synthesize(results);
  }
}
```

**Problema**: 300+ LOC de infraestructura que el SDK ya provee.

---

## ✅ Approach Moderno (SDK)

### Patrón 1: Single Agent con Tools Especializados

El approach más simple: un solo agent con acceso a todas las tools de MCP.

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

async function bcAgent(userRequest: string, sessionId: string) {
  const result = query(userRequest, {
    mcpServers: [
      {
        type: 'sse',
        url: process.env.MCP_SERVER_URL!,
        name: 'bc-mcp',
      },
    ],
    resume: sessionId,

    // El agent automáticamente orquesta qué tools usar y cuándo
    onPreToolUse: async (toolName, args) => {
      // Approvals para writes
      if (toolName.startsWith('bc_create') || toolName.startsWith('bc_update')) {
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

**Claude decide automáticamente**:
- Qué tools llamar
- En qué orden
- Si necesita múltiples llamadas
- Cómo combinar resultados

---

### Patrón 2: Specialized Agents via System Prompts

Para casos donde quieres **agentes especializados**, usa system prompts diferentes:

```typescript
// BCQueryAgent: Especializado en queries
function createQueryAgent(prompt: string, sessionId: string) {
  return query(prompt, {
    systemPrompt: `You are a specialized Business Central Query Agent.

Your responsibilities:
- Understand user queries about BC data
- Construct optimal OData filters
- Use bc_query_entity tool efficiently
- Format results in readable tables or JSON
- Handle pagination for large datasets

NEVER use bc_create, bc_update, or bc_delete tools. You only read data.`,

    mcpServers: [bcMcpServer],
    resume: sessionId,

    canUseTool: (toolName) => {
      // Enforce: only allow query tools
      return toolName.startsWith('bc_query') || toolName.startsWith('bc_get');
    },
  });
}

// BCWriteAgent: Especializado en writes
function createWriteAgent(prompt: string, sessionId: string) {
  return query(prompt, {
    systemPrompt: `You are a specialized Business Central Write Agent.

Your responsibilities:
- Validate data before writes
- Request user approval for ALL changes
- Use bc_create_entity and bc_update_entity tools
- Create checkpoints before writes
- Handle errors and suggest rollbacks

NEVER proceed without user approval. Always explain what will be changed.`,

    mcpServers: [bcMcpServer],
    resume: sessionId,

    onPreToolUse: async (toolName, args) => {
      // ALL writes require approval
      if (toolName.startsWith('bc_create') || toolName.startsWith('bc_update')) {
        return await approvalManager.request({ toolName, args });
      }
      return true;
    },

    canUseTool: (toolName) => {
      // Enforce: only allow write tools (and query for validation)
      return (
        toolName.startsWith('bc_create') ||
        toolName.startsWith('bc_update') ||
        toolName.startsWith('bc_query') // For validation
      );
    },
  });
}

// ValidationAgent: Especializado en validación
function createValidationAgent(prompt: string, sessionId: string) {
  return query(prompt, {
    systemPrompt: `You are a Business Central Validation Agent.

Your responsibilities:
- Validate data against BC schemas
- Check business rules (unique emails, valid formats, etc.)
- Use bc_get_schema tool to understand entity structures
- Return detailed validation reports

You cannot make changes, only validate data.`,

    mcpServers: [bcMcpServer],
    resume: sessionId,
    permissionMode: 'plan', // Read-only mode
  });
}
```

---

### Patrón 3: Orchestrator que Delega

Si necesitas un orchestrator que **decide a qué agent delegar**:

```typescript
async function orchestrator(userRequest: string, sessionId: string, socket: Socket) {
  // 1. Analyze intent with a planning agent
  const intent = await analyzeIntent(userRequest);

  // 2. Delegate to appropriate specialized agent
  let agentResult;

  switch (intent.type) {
    case 'query':
      agentResult = createQueryAgent(userRequest, sessionId);
      break;

    case 'create':
    case 'update':
      agentResult = createWriteAgent(userRequest, sessionId);
      break;

    case 'analyze':
      agentResult = createAnalysisAgent(userRequest, sessionId);
      break;

    case 'validate':
      agentResult = createValidationAgent(userRequest, sessionId);
      break;

    default:
      // Fallback: general agent
      agentResult = query(userRequest, {
        mcpServers: [bcMcpServer],
        resume: sessionId,
      });
  }

  // 3. Stream results to client
  for await (const event of agentResult) {
    socket.emit('agent:event', event);
  }
}

// Intent analysis using Claude
async function analyzeIntent(userRequest: string): Promise<Intent> {
  const result = query(
    `Analyze this user request and classify the intent:

Request: "${userRequest}"

Return JSON:
{
  "type": "query" | "create" | "update" | "delete" | "analyze" | "validate",
  "confidence": 0.0 - 1.0,
  "reasoning": "why you classified it this way"
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
}
```

---

### Patrón 4: Parallel Execution

Para ejecutar múltiples agents en paralelo:

```typescript
async function parallelExecution(requests: string[], sessionId: string) {
  // Execute multiple agents in parallel
  const results = await Promise.all(
    requests.map(async (request) => {
      const events: any[] = [];
      const agent = createQueryAgent(request, sessionId);

      for await (const event of agent) {
        events.push(event);
      }

      return events;
    })
  );

  // Synthesize results
  return results.flat();
}

// Uso:
const results = await parallelExecution(
  [
    'Get all customers from BC',
    'Get all items from BC',
    'Get all vendors from BC',
  ],
  sessionId
);
```

---

### Patrón 5: Sequential Workflow

Para workflows donde un step depende del anterior:

```typescript
async function sequentialWorkflow(sessionId: string, socket: Socket) {
  // Step 1: Query data
  const customers = await runAgent(
    createQueryAgent('Get all customers with unpaid invoices', sessionId)
  );

  socket.emit('workflow:step_completed', { step: 1, data: customers });

  // Step 2: Analyze data
  const analysis = await runAgent(
    createAnalysisAgent(
      `Analyze these customers and identify high-risk accounts: ${JSON.stringify(customers)}`,
      sessionId
    )
  );

  socket.emit('workflow:step_completed', { step: 2, data: analysis });

  // Step 3: Generate actions (requires approval)
  const actions = await runAgent(
    createWriteAgent(
      `For these high-risk customers, create payment reminders: ${JSON.stringify(analysis.highRiskCustomers)}`,
      sessionId
    )
  );

  socket.emit('workflow:step_completed', { step: 3, data: actions });
}

async function runAgent(agentGenerator: AsyncGenerator): Promise<any> {
  let lastMessage;

  for await (const event of agentGenerator) {
    if (event.type === 'message') {
      lastMessage = event.content;
    }
  }

  return lastMessage;
}
```

---

## Delegation Strategy

### Intent-based Delegation

```typescript
const INTENT_TO_AGENT = {
  query: createQueryAgent,
  create: createWriteAgent,
  update: createWriteAgent,
  delete: createWriteAgent,
  analyze: createAnalysisAgent,
  validate: createValidationAgent,
};

async function intelligentDelegation(userRequest: string, sessionId: string) {
  const intent = await analyzeIntent(userRequest);
  const agentFactory = INTENT_TO_AGENT[intent.type];

  if (!agentFactory) {
    throw new Error(`Unknown intent type: ${intent.type}`);
  }

  return agentFactory(userRequest, sessionId);
}
```

### Tool-based Delegation

```typescript
async function toolBasedDelegation(userRequest: string, sessionId: string) {
  // Peek at what tools Claude would use
  const analysis = await query(
    `For this request: "${userRequest}"

    What tools would you need to use? Return JSON: { tools: string[] }`,
    { permissionMode: 'plan' }
  );

  let toolsNeeded: string[] = [];

  for await (const event of analysis) {
    if (event.type === 'message') {
      toolsNeeded = JSON.parse(event.content).tools;
    }
  }

  // Delegate based on tools
  if (toolsNeeded.every((t) => t.startsWith('bc_query'))) {
    return createQueryAgent(userRequest, sessionId);
  }

  if (toolsNeeded.some((t) => t.startsWith('bc_create') || t.startsWith('bc_update'))) {
    return createWriteAgent(userRequest, sessionId);
  }

  // Fallback: general agent
  return query(userRequest, { mcpServers: [bcMcpServer], resume: sessionId });
}
```

---

## Result Synthesis

Cuando múltiples agents retornan resultados, sintetiza con Claude:

```typescript
async function synthesizeResults(results: any[], originalRequest: string) {
  const synthesisAgent = query(
    `Original request: "${originalRequest}"

Results from multiple agents:
${JSON.stringify(results, null, 2)}

Synthesize these results into a coherent, user-friendly response.`,
    {
      permissionMode: 'plan',
    }
  );

  for await (const event of synthesisAgent) {
    if (event.type === 'message') {
      return event.content;
    }
  }
}
```

---

## Comparison: Custom vs SDK

| Aspecto | Custom Orchestrator | SDK Orchestration |
|---------|---------------------|-------------------|
| **LOC** | 300-500 | 50-100 |
| **Delegation logic** | Manual | System prompt + canUseTool |
| **Tool selection** | Manual | Automatic |
| **Parallel execution** | Complex | Promise.all |
| **Error handling** | Custom | Built-in |
| **Planning** | Custom algorithm | Claude decides |

---

## Best Practices

### 1. Clear System Prompts

Define responsabilidades claramente:

```typescript
systemPrompt: `You are a [ROLE].

Your responsibilities:
- [Responsibility 1]
- [Responsibility 2]

NEVER do:
- [Forbidden action 1]
- [Forbidden action 2]

Always:
- [Required behavior 1]
- [Required behavior 2]`
```

### 2. Tool Restrictions

Enforce tool usage con `canUseTool`:

```typescript
canUseTool: (toolName) => {
  // QueryAgent: only reads
  if (agentType === 'query') {
    return toolName.startsWith('bc_query') || toolName.startsWith('bc_get');
  }

  // WriteAgent: can read for validation + write
  if (agentType === 'write') {
    return (
      toolName.startsWith('bc_create') ||
      toolName.startsWith('bc_update') ||
      toolName.startsWith('bc_query')
    );
  }

  return true;
}
```

### 3. Session Continuity

Usa el mismo `sessionId` para mantener contexto entre agents:

```typescript
// Agent 1: Query
const sessionId = await runQueryAgent('Get customer 123', null);

// Agent 2: Update (mismo contexto)
await runWriteAgent('Update that customer email to new@example.com', sessionId);
```

---

## Próximos Pasos

- [Agent SDK Usage Guide](../../02-core-concepts/06-agent-sdk-usage.md)
- [Subagents with SDK](./05-subagents.md)
- [Backend Integration](../../11-backend/07-agent-sdk-integration.md)

---

**Última actualización**: 2025-10-30
**Versión**: 2.0 (Actualizado para Claude Agent SDK)
