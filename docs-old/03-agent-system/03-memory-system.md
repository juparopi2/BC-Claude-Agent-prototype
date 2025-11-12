# Memory System with Claude SDK

## Overview

El **Claude Agent SDK** maneja la memoria de conversación automáticamente mediante el parámetro `resume`. Para memoria de largo plazo (CloudMD), necesitas implementación custom.

**⚠️ IMPORTANTE**: No construyas `ShortTermMemory`, `EpisodicMemory` classes custom. El SDK ya maneja short-term y episodic memory.

---

## Memory Types

### 1. Short-Term (Working Memory) - SDK Built-in

El SDK maneja automáticamente la conversación actual:

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

// Primera conversación
const result1 = query('Create a customer named Acme Corp', {
  mcpServers: [mcpServer],
});

let sessionId: string | null = null;

for await (const event of result1) {
  if (event.type === 'session_start') {
    sessionId = event.sessionId; // SDK genera session ID
  }
}

// Segunda conversación - SDK recuerda el contexto
const result2 = query('Update that customer email to new@acme.com', {
  mcpServers: [mcpServer],
  resume: sessionId, // SDK carga conversación previa automáticamente
});

// El SDK automáticamente:
// - Mantiene el historial de mensajes
// - Recuerda que "that customer" = Acme Corp
// - Continúa la conversación sin perder contexto
```

**No necesitas construir `ShortTermMemory` class.** El SDK lo hace automáticamente con `resume`.

---

### 2. Episodic Memory (Session History) - Database + SDK

El SDK provee session IDs. Tú guardas metadata en la base de datos:

```typescript
// backend/src/services/memory/SessionMemory.ts
import { db } from '../../config/database';

export class SessionMemory {
  /**
   * Save session metadata to database
   */
  async saveSession(sessionId: string, userId: string, goal: string) {
    await db.sessions.create({
      id: sessionId,
      user_id: userId,
      goal,
      started_at: new Date(),
      status: 'active',
    });
  }

  /**
   * Save message to database
   */
  async saveMessage(sessionId: string, role: 'user' | 'assistant', content: string) {
    await db.messages.create({
      session_id: sessionId,
      role,
      content,
      timestamp: new Date(),
    });
  }

  /**
   * Get session history
   */
  async getSessionHistory(sessionId: string) {
    const session = await db.sessions.findOne({ id: sessionId });
    const messages = await db.messages.find({ session_id: sessionId });

    return {
      session,
      messages,
    };
  }

  /**
   * Find similar past sessions (for context)
   */
  async findSimilarSessions(userId: string, query: string, limit = 5) {
    // Use vector search or keyword search
    return await db.sessions.search({
      user_id: userId,
      query,
      limit,
    });
  }
}

export const sessionMemory = new SessionMemory();
```

**Integration with SDK:**

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';
import { sessionMemory } from './SessionMemory';

async function runAgentWithMemory(
  userMessage: string,
  userId: string,
  sessionId: string | null
) {
  const result = query(userMessage, {
    mcpServers: [mcpServer],
    resume: sessionId,

    onSessionStart: async (newSessionId) => {
      // Save to database
      await sessionMemory.saveSession(newSessionId, userId, userMessage);
    },
  });

  for await (const event of result) {
    // Save messages to database
    if (event.type === 'message') {
      await sessionMemory.saveMessage(
        sessionId || event.sessionId,
        'assistant',
        event.content
      );
    }
  }
}
```

---

### 3. Long-Term Memory (CloudMD) - Custom Implementation

Para memoria de largo plazo con **CloudMD**, necesitas implementación custom:

```typescript
// backend/src/services/memory/LongTermMemory.ts
import { CloudMD } from '@cloudmd/sdk'; // Ejemplo

export class LongTermMemory {
  private cloudMD: CloudMD;

  constructor() {
    this.cloudMD = new CloudMD({
      apiKey: process.env.CLOUDMD_API_KEY,
    });
  }

  /**
   * Save important information to long-term memory
   */
  async save(userId: string, key: string, value: any, metadata?: any) {
    await this.cloudMD.write({
      user_id: userId,
      key,
      value,
      metadata: {
        ...metadata,
        timestamp: new Date(),
      },
    });
  }

  /**
   * Recall information from long-term memory
   */
  async recall(userId: string, query: string): Promise<any[]> {
    const results = await this.cloudMD.search({
      user_id: userId,
      query,
      limit: 10,
    });

    return results;
  }

  /**
   * Save learnings from a session
   */
  async saveLearnings(sessionId: string, userId: string) {
    const session = await sessionMemory.getSessionHistory(sessionId);

    // Extract key learnings (use Claude to summarize)
    const learnings = await this.extractLearnings(session);

    // Save to CloudMD
    for (const learning of learnings) {
      await this.save(userId, learning.key, learning.value, {
        session_id: sessionId,
        type: 'learning',
      });
    }
  }

  /**
   * Use Claude SDK to extract learnings from session
   */
  private async extractLearnings(session: any) {
    const result = query(
      `Analyze this session and extract key learnings that should be remembered:

Session messages:
${JSON.stringify(session.messages, null, 2)}

Return JSON array:
[
  { "key": "customer_preference", "value": "Acme Corp prefers email over phone" },
  { "key": "workflow_pattern", "value": "User always creates customers before orders" }
]`,
      {
        permissionMode: 'plan', // Read-only analysis
      }
    );

    for await (const event of result) {
      if (event.type === 'message') {
        return JSON.parse(event.content);
      }
    }

    return [];
  }
}

export const longTermMemory = new LongTermMemory();
```

**Integration with Agent SDK:**

```typescript
async function runAgentWithLongTermMemory(
  userMessage: string,
  userId: string,
  sessionId: string | null
) {
  // 1. Recall relevant long-term memories
  const relevantMemories = await longTermMemory.recall(userId, userMessage);

  // 2. Inject memories into system prompt
  const systemPrompt = `You are a BC assistant for user ${userId}.

Relevant information from past sessions:
${relevantMemories.map((m) => `- ${m.key}: ${m.value}`).join('\n')}

Use this information to provide better assistance.`;

  // 3. Run agent with injected context
  const result = query(userMessage, {
    systemPrompt,
    mcpServers: [mcpServer],
    resume: sessionId,
  });

  for await (const event of result) {
    // Process events
  }

  // 4. After session, save learnings
  if (sessionId) {
    await longTermMemory.saveLearnings(sessionId, userId);
  }
}
```

---

## Memory Management Best Practices

### 1. Token Limits

El SDK maneja automáticamente el límite de tokens, pero puedes optimizar:

```typescript
const result = query(userMessage, {
  resume: sessionId,
  promptCaching: true, // Cache system prompt and tools (90% cost reduction)
});
```

### 2. Context Cleanup

Si una sesión es muy larga, puedes crear una nueva con un summary:

```typescript
async function startFreshWithSummary(oldSessionId: string, userId: string) {
  // 1. Get old session
  const oldSession = await sessionMemory.getSessionHistory(oldSessionId);

  // 2. Summarize with Claude SDK
  const summaryResult = query(
    `Summarize this conversation in 2-3 paragraphs:\n\n${JSON.stringify(oldSession.messages)}`,
    { permissionMode: 'plan' }
  );

  let summary = '';
  for await (const event of summaryResult) {
    if (event.type === 'message') {
      summary = event.content;
    }
  }

  // 3. Start new session with summary
  const newResult = query(
    `Previous conversation summary:\n${summary}\n\nContinuing conversation...`,
    {
      mcpServers: [mcpServer],
      // No 'resume' - fresh session with injected summary
    }
  );

  return newResult;
}
```

### 3. Privacy & Isolation

Siempre filtra por `user_id` para aislamiento de datos:

```typescript
// ✅ CORRECTO
await db.sessions.find({ user_id: userId, id: sessionId });

// ❌ INCORRECTO - Fuga de datos
await db.sessions.find({ id: sessionId });
```

---

## Comparison: Custom vs SDK

| Memory Type | Custom Implementation | With SDK |
|-------------|----------------------|----------|
| **Short-Term** | Custom `ShortTermMemory` class (~100 LOC) | ✅ SDK `resume` (automatic) |
| **Episodic** | Custom session tracking | ✅ SDK session IDs + Database persistence |
| **Long-Term** | CloudMD integration (~200 LOC) | Custom (same as before) |
| **Context Management** | Manual token counting | ✅ SDK handles automatically |
| **Prompt Caching** | Manual implementation | ✅ SDK `promptCaching: true` |

---

## Next Steps

- [Context Management with SDK](./04-context-management.md)
- [Session Persistence](../../08-state-persistence/03-session-persistence.md)

---

**Última actualización**: 2025-10-30
**Versión**: 2.0 (Actualizado para Claude Agent SDK)
