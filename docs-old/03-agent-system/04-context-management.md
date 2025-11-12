# Context Management with Claude SDK

## Overview

El **Claude Agent SDK** maneja el contexto de conversación automáticamente. No necesitas construir un `ContextManager` class custom.

**⚠️ IMPORTANTE**: El SDK ya maneja:
- Historial de mensajes
- Tool results
- Session continuity
- Token limits

Solo necesitas gestionar metadata adicional (user preferences, settings, etc.).

---

## Context Types

### 1. Conversation Context - SDK Built-in

El SDK mantiene automáticamente el contexto de la conversación:

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

// Primera conversación
const result1 = query('Create a customer named Acme Corp');

let sessionId: string;

for await (const event of result1) {
  if (event.type === 'session_start') {
    sessionId = event.sessionId;
  }
}

// Segunda conversación - SDK mantiene contexto automáticamente
const result2 = query('What is the email of that customer?', {
  resume: sessionId, // SDK carga todo el historial automáticamente
});

// Claude recuerda automáticamente:
// - Que creaste un customer
// - Que se llama "Acme Corp"
// - El contexto completo de la conversación
```

**No necesitas un `ContextManager` class.** El SDK lo hace con `resume`.

---

### 2. System Context (Configuration) - System Prompt

Para inyectar contexto de sistema (configuración, preferences, etc.), usa `systemPrompt`:

```typescript
const result = query(userMessage, {
  systemPrompt: `You are a BC assistant for ${company.name}.

Company preferences:
- Default language: ${company.language}
- Default currency: ${company.currency}
- Business hours: ${company.businessHours}

User preferences:
- Preferred format: ${user.preferredFormat}
- Notification settings: ${user.notifications}

Use this information to provide tailored assistance.`,

  mcpServers: [mcpServer],
  resume: sessionId,
});
```

---

### 3. Tool Context (MCP Resources) - SDK Built-in

El SDK automáticamente pasa tool definitions y schemas a Claude:

```typescript
const result = query(userMessage, {
  mcpServers: [
    {
      type: 'sse',
      url: process.env.MCP_SERVER_URL,
      name: 'bc-mcp',
    },
  ], // SDK automáticamente carga todas las tools del MCP server
});

// Claude automáticamente tiene acceso a:
// - bc_query_entity
// - bc_create_entity
// - bc_update_entity
// - etc.
// Sin que tengas que construir un ToolRegistry
```

---

## Context Isolation

### Per-User Isolation

Usa `sessionId` diferente por usuario para aislar contextos:

```typescript
class AgentService {
  private sessions: Map<string, string> = new Map(); // userId -> sessionId

  async runForUser(userId: string, message: string) {
    // Get or create session for this user
    let sessionId = this.sessions.get(userId);

    const result = query(message, {
      mcpServers: [mcpServer],
      resume: sessionId, // null para nueva sesión, string para continuar
    });

    for await (const event of result) {
      if (event.type === 'session_start') {
        this.sessions.set(userId, event.sessionId);
      }
    }
  }
}
```

### Per-Agent Isolation

Para agentes especializados aislados, usa sesiones separadas:

```typescript
// QueryAgent - Session A
const querySession = 'query-session-123';
const queryResult = createQueryAgent('Get customers', querySession);

// WriteAgent - Session B (aislada de A)
const writeSession = 'write-session-456';
const writeResult = createWriteAgent('Create customer', writeSession);
```

---

## Context Enrichment

### Inject Business Context

```typescript
async function runWithBusinessContext(
  userMessage: string,
  userId: string,
  sessionId: string
) {
  // 1. Load user's business context
  const user = await db.users.findOne({ id: userId });
  const company = await db.companies.findOne({ id: user.company_id });

  // 2. Load recent activity
  const recentSessions = await db.sessions.find({
    user_id: userId,
    limit: 5,
    order: 'desc',
  });

  // 3. Inject into system prompt
  const systemPrompt = `You are assisting ${user.name} from ${company.name}.

Company Context:
- Industry: ${company.industry}
- Size: ${company.employeeCount} employees
- Primary BC modules: ${company.bcModules.join(', ')}

User Context:
- Role: ${user.role}
- Permissions: ${user.permissions.join(', ')}
- Recent activity: ${recentSessions.map((s) => s.goal).join(', ')}

Tailor your responses to this context.`;

  const result = query(userMessage, {
    systemPrompt,
    mcpServers: [mcpServer],
    resume: sessionId,
  });

  return result;
}
```

### Inject File Context

```typescript
async function runWithFileContext(
  userMessage: string,
  sessionId: string,
  fileIds: string[]
) {
  // 1. Load files from database
  const files = await db.files.find({ id: { in: fileIds } });

  // 2. Inject into prompt
  const enrichedMessage = `${userMessage}

Relevant files:
${files.map((f) => `- ${f.name}: ${f.summary}`).join('\n')}

Use these files as context.`;

  const result = query(enrichedMessage, {
    mcpServers: [mcpServer],
    resume: sessionId,
  });

  return result;
}
```

---

## Context Limits & Optimization

### 1. Prompt Caching (SDK Built-in)

El SDK soporta prompt caching para reducir costos y latencia:

```typescript
const result = query(userMessage, {
  promptCaching: true, // Cache system prompt and tools
  systemPrompt: 'claudeCode', // Use pre-cached Claude Code prompt
  mcpServers: [mcpServer],
});
```

**Beneficios**:
- 90% reducción de costo en tokens cached
- ~50% reducción de latencia

### 2. Token Management

El SDK maneja automáticamente el límite de 200K tokens:

```typescript
// SDK automáticamente:
// - Mantiene historial hasta ~150K tokens
// - Reserva ~50K para system + tools
// - Limpia contexto viejo si excede límite

// No necesitas implementar token counting manual
```

### 3. Context Compaction (Si necesario)

Si necesitas compactar contexto manualmente:

```typescript
async function compactSession(oldSessionId: string) {
  // 1. Get session history
  const messages = await db.messages.find({ session_id: oldSessionId });

  // 2. Use Claude SDK to summarize
  const summaryResult = query(
    `Summarize this conversation concisely:\n\n${JSON.stringify(messages)}`,
    { permissionMode: 'plan' }
  );

  let summary = '';
  for await (const event of summaryResult) {
    if (event.type === 'message') {
      summary = event.content;
    }
  }

  // 3. Start new session with summary
  const newResult = query(`Previous context: ${summary}\n\nContinuing...`, {
    mcpServers: [mcpServer],
    // No 'resume' - fresh session
  });

  return newResult;
}
```

---

## Context Persistence

### Save Context to Database

```typescript
async function persistContext(sessionId: string, userId: string) {
  // SDK provides session ID, you save metadata
  await db.sessions.update(
    { id: sessionId },
    {
      user_id: userId,
      last_activity_at: new Date(),
      status: 'active',
    }
  );
}
```

### Load Context from Database

```typescript
async function loadContext(sessionId: string) {
  const session = await db.sessions.findOne({ id: sessionId });
  const messages = await db.messages.find({ session_id: sessionId });

  return {
    session,
    messages,
  };

  // SDK loads conversation automatically with 'resume'
  // This is just for metadata/audit
}
```

---

## Comparison: Custom vs SDK

| Aspect | Custom ContextManager | With SDK |
|--------|----------------------|----------|
| **Conversation history** | Manual tracking (~200 LOC) | ✅ SDK `resume` (automatic) |
| **Token counting** | Manual implementation (~100 LOC) | ✅ SDK handles automatically |
| **Context isolation** | Manual session management | ✅ SDK `sessionId` |
| **Prompt caching** | Manual implementation | ✅ SDK `promptCaching: true` |
| **Tool context** | Manual registry | ✅ SDK loads from MCP |
| **Context compaction** | Manual summarization | ✅ SDK handles (or use SDK to summarize) |

**Total LOC saved**: ~300-400 lines of context management code

---

## Best Practices

### 1. Always Use Sessions

```typescript
// ✅ CORRECTO - Mantiene contexto
const result = query(message, {
  resume: sessionId,
});

// ❌ INCORRECTO - Pierde contexto
const result = query(message);
```

### 2. Enrich System Prompt

```typescript
// ✅ CORRECTO - Contexto rico
const result = query(message, {
  systemPrompt: `Context: ${businessContext}`,
  resume: sessionId,
});

// ❌ INCORRECTO - Sin contexto
const result = query(message, {
  resume: sessionId,
});
```

### 3. Isolate Per User

```typescript
// ✅ CORRECTO - Aislamiento
const userSessionId = `${userId}-${Date.now()}`;

// ❌ INCORRECTO - Sesión compartida
const sharedSessionId = 'global-session';
```

---

## Next Steps

- [Memory System with SDK](./03-memory-system.md)
- [Session Persistence](../../08-state-persistence/03-session-persistence.md)
- [Prompt Caching](../../09-performance/01-prompt-caching.md)

---

**Última actualización**: 2025-10-30
**Versión**: 2.0 (Actualizado para Claude Agent SDK)
