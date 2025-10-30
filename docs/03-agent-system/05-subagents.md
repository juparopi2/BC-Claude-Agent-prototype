# Specialized Agents with Claude SDK

## Overview

Los **subagents** son agentes especializados en tareas específicas. Con el Claude Agent SDK, los implementas mediante **system prompts diferenciados** y **restricciones de herramientas**, no clases custom.

**⚠️ IMPORTANTE**: No necesitas crear `BCQuerySubagent`, `BCWriteSubagent` classes. El SDK maneja esto mediante configuración.

---

## ❌ Approach Obsoleto (Custom Classes)

```typescript
// OBSOLETO - No usar
class BCQuerySubagent extends BaseAgent {
  async execute(task: QueryTask): Promise<QueryResult> {
    const query = this.buildQuery(task);
    const result = await mcpClient.call('bc_query_entity', query);
    return this.formatResult(result);
  }
}

class BCWriteSubagent extends BaseAgent {
  async execute(task: WriteTask): Promise<WriteResult> {
    await this.validate(task.data);
    const approved = await this.requestApproval(task);
    if (!approved) return { cancelled: true };

    const result = await mcpClient.call('bc_create_entity', task.data);
    return { success: true, result };
  }
}
```

**Problema**: 200+ LOC de boilerplate que el SDK ya provee.

---

## ✅ Approach Moderno (SDK + System Prompts)

### 1. BC Query Agent

Especializado en **leer datos** de Business Central:

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

function createBCQueryAgent(userRequest: string, sessionId: string) {
  return query(userRequest, {
    systemPrompt: `You are a specialized Business Central Query Agent.

## Your Role
Expert at retrieving data from Microsoft Business Central.

## Your Responsibilities
1. Understand user queries about BC entities (customers, items, vendors, etc.)
2. Construct optimal OData filters and queries
3. Use bc_query_entity and bc_get_entity tools efficiently
4. Handle pagination for large datasets
5. Format results in readable tables, JSON, or charts

## Available BC Entities
- Customers
- Vendors
- Items
- Sales Orders
- Purchase Orders
- General Ledger Entries
- ... (see MCP schema for full list)

## Best Practices
- Always ask for clarification if the query is ambiguous
- Use filters to limit results to what's needed
- Format results in the most useful way for the user
- Explain the query logic used

## RESTRICTIONS
- NEVER use bc_create, bc_update, or bc_delete tools
- You can ONLY read data, never modify it
- If asked to make changes, explain you're a read-only agent`,

    mcpServers: [
      {
        type: 'sse',
        url: process.env.MCP_SERVER_URL!,
        name: 'bc-mcp',
      },
    ],

    resume: sessionId,

    // Enforce: Only query tools allowed
    canUseTool: (toolName) => {
      return (
        toolName.startsWith('bc_query') ||
        toolName.startsWith('bc_get') ||
        toolName.includes('read') ||
        toolName.includes('list')
      );
    },
  });
}

// Usage
async function queryCustomers(socket: Socket, sessionId: string) {
  const agent = createBCQueryAgent('Get all customers from Spain', sessionId);

  for await (const event of agent) {
    socket.emit('agent:event', event);
  }
}
```

---

### 2. BC Write Agent

Especializado en **crear/actualizar datos** en Business Central:

```typescript
function createBCWriteAgent(userRequest: string, sessionId: string) {
  return query(userRequest, {
    systemPrompt: `You are a specialized Business Central Write Agent.

## Your Role
Expert at creating and updating data in Microsoft Business Central.

## Your Responsibilities
1. Validate ALL data before writes
2. Request user approval for EVERY change
3. Explain clearly what will be changed and why
4. Use bc_create_entity and bc_update_entity tools
5. Handle errors gracefully with clear messages
6. Suggest rollback if something goes wrong

## Validation Checklist
- Required fields present
- Data types correct
- Business rules satisfied (unique emails, valid formats, etc.)
- No duplicate entries
- Relationships valid (FK constraints)

## Approval Process
1. Clearly explain what will be changed
2. Show before/after comparison when updating
3. Wait for explicit user confirmation
4. NEVER proceed without approval

## Error Handling
- If a write fails, explain why in plain language
- Suggest corrections
- Offer to retry with fixed data

## RESTRICTIONS
- NEVER make changes without user approval
- You can use bc_query tools to validate data before writes
- Always create a plan and show it to the user first`,

    mcpServers: [bcMcpServer],
    resume: sessionId,

    // CRITICAL: Request approval before ALL writes
    onPreToolUse: async (toolName, args) => {
      if (toolName.startsWith('bc_create') || toolName.startsWith('bc_update')) {
        // Show approval dialog
        return await approvalManager.request({
          session_id: sessionId,
          tool_name: toolName,
          tool_args: args,
          summary: generateChangeSummary(toolName, args),
        });
      }

      // Queries are allowed without approval
      return true;
    },

    onPostToolUse: async (toolName, result) => {
      // Log all writes to audit log
      if (toolName.startsWith('bc_create') || toolName.startsWith('bc_update')) {
        await db.audit_log.create({
          tool_name: toolName,
          result,
          timestamp: new Date(),
        });
      }
    },

    // Enforce: Write + query tools only
    canUseTool: (toolName) => {
      return (
        toolName.startsWith('bc_create') ||
        toolName.startsWith('bc_update') ||
        toolName.startsWith('bc_query') || // For validation
        toolName.startsWith('bc_get') // For validation
      );
    },
  });
}

// Helper: Generate human-readable change summary
function generateChangeSummary(toolName: string, args: any): string {
  if (toolName === 'bc_create_entity') {
    return `Create new ${args.entity_type}: ${JSON.stringify(args.data, null, 2)}`;
  }

  if (toolName === 'bc_update_entity') {
    return `Update ${args.entity_type} (ID: ${args.id}): ${JSON.stringify(args.data, null, 2)}`;
  }

  return `Unknown operation: ${toolName}`;
}
```

---

### 3. Validation Agent

Especializado en **validar datos** sin hacer cambios:

```typescript
function createValidationAgent(userRequest: string, sessionId: string) {
  return query(userRequest, {
    systemPrompt: `You are a Business Central Validation Agent.

## Your Role
Expert at validating data against BC schemas and business rules.

## Your Responsibilities
1. Validate data structures against BC entity schemas
2. Check business rules (unique constraints, formats, ranges)
3. Use bc_get_schema tool to understand entity requirements
4. Provide detailed validation reports
5. Suggest corrections for invalid data

## Validation Types
- **Schema validation**: Required fields, data types, field lengths
- **Business rules**: Unique emails, valid phone formats, date ranges
- **Relationship validation**: FKs exist, parent-child consistency
- **Data quality**: Duplicates, inconsistencies, missing info

## Output Format
{
  "valid": boolean,
  "errors": [
    { "field": "email", "message": "Invalid format", "severity": "error" },
    { "field": "phone", "message": "Missing country code", "severity": "warning" }
  ],
  "suggestions": [ "Add country code to phone", "Use format: email@domain.com" ]
}

## RESTRICTIONS
- You CANNOT make any changes
- You can ONLY read schemas and validate data
- permissionMode is set to 'plan' (read-only)`,

    mcpServers: [bcMcpServer],
    resume: sessionId,
    permissionMode: 'plan', // Read-only mode

    canUseTool: (toolName) => {
      // Only allow schema/read tools
      return (
        toolName.startsWith('bc_get_schema') ||
        toolName.startsWith('bc_query') ||
        toolName.includes('validate')
      );
    },
  });
}

// Usage
async function validateCustomerData(data: any): Promise<ValidationResult> {
  const agent = createValidationAgent(
    `Validate this customer data: ${JSON.stringify(data)}`,
    null
  );

  for await (const event of agent) {
    if (event.type === 'message') {
      return JSON.parse(event.content);
    }
  }
}
```

---

### 4. Analysis Agent

Especializado en **analizar datos** y generar insights:

```typescript
function createAnalysisAgent(userRequest: string, sessionId: string) {
  return query(userRequest, {
    systemPrompt: `You are a Business Central Analysis Agent.

## Your Role
Expert at analyzing BC data and generating business insights.

## Your Responsibilities
1. Fetch relevant data using bc_query tools
2. Analyze trends, patterns, anomalies
3. Generate actionable insights
4. Suggest data visualizations (charts, tables, dashboards)
5. Answer "why" questions about the data

## Analysis Types
- **Trend analysis**: Sales over time, customer growth
- **Comparison**: This year vs last year, region performance
- **Segmentation**: Customer segments, product categories
- **Anomaly detection**: Unusual transactions, outliers
- **Predictive insights**: Forecasts based on historical data

## Output Format
- Clear insights in plain language
- Supporting data/evidence
- Visualization suggestions
- Actionable recommendations

## Available Data
- Sales data (orders, invoices, payments)
- Customer data (demographics, purchase history)
- Inventory data (stock levels, movements)
- Financial data (GL entries, budgets)

## RESTRICTIONS
- You can ONLY read data for analysis
- You cannot make changes to BC
- Focus on insights, not just data retrieval`,

    mcpServers: [bcMcpServer],
    resume: sessionId,
    permissionMode: 'default',

    canUseTool: (toolName) => {
      // Read-only + analysis tools
      return (
        toolName.startsWith('bc_query') ||
        toolName.startsWith('bc_get') ||
        toolName.includes('analyze') ||
        toolName.includes('chart')
      );
    },
  });
}
```

---

## Context Isolation

Cada agent tiene contexto aislado mediante `sessionId`:

```typescript
// Agent 1: Query (session A)
const sessionA = 'query-session-123';
const queryAgent = createBCQueryAgent('Get customers', sessionA);

// Agent 2: Write (session B - isolated from A)
const sessionB = 'write-session-456';
const writeAgent = createBCWriteAgent('Create customer', sessionB);
```

**Beneficio**: Un agent no contamina el contexto del otro.

---

## Delegation Patterns

### Sequential Delegation

Un orchestrator delega tareas secuencialmente:

```typescript
async function sequentialWorkflow(userGoal: string, socket: Socket) {
  // Step 1: Query agent fetches data
  const querySession = generateSessionId();
  const data = await runAgent(
    createBCQueryAgent('Get all customers with overdue invoices', querySession)
  );

  socket.emit('step:completed', { step: 1, data });

  // Step 2: Analysis agent analyzes
  const analysisSession = generateSessionId();
  const insights = await runAgent(
    createAnalysisAgent(
      `Analyze these customers and prioritize by risk: ${JSON.stringify(data)}`,
      analysisSession
    )
  );

  socket.emit('step:completed', { step: 2, insights });

  // Step 3: Write agent creates reminders (requires approval)
  const writeSession = generateSessionId();
  await runAgentWithStream(
    createBCWriteAgent(
      `Create payment reminder emails for these high-risk customers: ${JSON.stringify(insights.highRisk)}`,
      writeSession
    ),
    socket
  );
}
```

### Parallel Delegation

Ejecutar múltiples agents independientes en paralelo:

```typescript
async function parallelExecution(socket: Socket) {
  const results = await Promise.all([
    runAgent(createBCQueryAgent('Get top 10 customers by revenue', null)),
    runAgent(createBCQueryAgent('Get low-stock items', null)),
    runAgent(createBCQueryAgent('Get pending orders', null)),
  ]);

  socket.emit('parallel:completed', {
    topCustomers: results[0],
    lowStockItems: results[1],
    pendingOrders: results[2],
  });
}
```

### Conditional Delegation

Delegar basado en resultados previos:

```typescript
async function conditionalWorkflow(userRequest: string, socket: Socket) {
  // Step 1: Validation
  const validation = await runAgent(
    createValidationAgent(`Validate: ${userRequest}`, null)
  );

  if (!validation.valid) {
    socket.emit('validation:failed', validation.errors);
    return; // Stop workflow
  }

  // Step 2: If valid, proceed to write
  const writeResult = await runAgent(
    createBCWriteAgent(userRequest, generateSessionId())
  );

  socket.emit('write:success', writeResult);
}
```

---

## Agent Factory Pattern

Centraliza la creación de agents:

```typescript
class AgentFactory {
  static create(
    type: 'query' | 'write' | 'validation' | 'analysis',
    request: string,
    sessionId: string
  ) {
    switch (type) {
      case 'query':
        return createBCQueryAgent(request, sessionId);
      case 'write':
        return createBCWriteAgent(request, sessionId);
      case 'validation':
        return createValidationAgent(request, sessionId);
      case 'analysis':
        return createAnalysisAgent(request, sessionId);
      default:
        throw new Error(`Unknown agent type: ${type}`);
    }
  }
}

// Usage
const agent = AgentFactory.create('query', 'Get all customers', sessionId);
```

---

## Comparison: Custom vs SDK

| Aspecto | Custom Subagent Classes | SDK Specialized Agents |
|---------|-------------------------|------------------------|
| **LOC** | 200-300 per agent | 50-100 per agent |
| **Configuration** | Class inheritance | System prompt + config |
| **Tool restrictions** | Manual logic | `canUseTool` callback |
| **Approval flow** | Custom implementation | `onPreToolUse` hook |
| **Context isolation** | Manual session management | Built-in `sessionId` |
| **Error handling** | Custom try-catch | SDK handles |
| **Testing** | Complex mocking | Easier to test |

---

## Best Practices

### 1. Clear Role Definition

Cada agent debe tener un role claro en su system prompt:

```typescript
systemPrompt: `You are a [SPECIFIC ROLE] Agent.

## Your Role
[1-2 sentence description]

## Your Responsibilities
- [Specific task 1]
- [Specific task 2]

## RESTRICTIONS
- NEVER do [forbidden action]
- You can ONLY do [allowed actions]`
```

### 2. Tool Restrictions

Usa `canUseTool` para enforcing:

```typescript
canUseTool: (toolName) => {
  // QueryAgent: reads only
  if (agentType === 'query') {
    return toolName.startsWith('bc_query') || toolName.startsWith('bc_get');
  }

  // WriteAgent: can validate + write
  if (agentType === 'write') {
    return (
      toolName.startsWith('bc_create') ||
      toolName.startsWith('bc_update') ||
      toolName.startsWith('bc_query') // For validation
    );
  }

  return true;
}
```

### 3. Session Isolation

Usa sessions diferentes para agents que no deben compartir contexto:

```typescript
// Isolated sessions
const querySession = `query-${Date.now()}`;
const writeSession = `write-${Date.now()}`;

// Shared session (agents collaborate)
const sharedSession = `workflow-${Date.now()}`;
const agent1 = createQueryAgent(prompt1, sharedSession);
const agent2 = createWriteAgent(prompt2, sharedSession); // Remembers agent1's context
```

---

## Próximos Pasos

- [Agent SDK Usage Guide](../../02-core-concepts/06-agent-sdk-usage.md)
- [Orchestration Patterns](./02-orchestration.md)
- [Backend Integration](../../11-backend/07-agent-sdk-integration.md)

---

**Última actualización**: 2025-10-30
**Versión**: 2.0 (Actualizado para Claude Agent SDK)
