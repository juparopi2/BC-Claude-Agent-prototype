# LLM Enhancements

## Introducción

Un LLM base (como Claude) es poderoso, pero tiene limitaciones. Este documento describe las mejoras que transforman un LLM en un agente completo.

## 1. Retrievals (Recuperación de Información)

### Concepto

Permitir al agente acceder a información externa que no está en su training data.

### Implementación

#### RAG (Retrieval-Augmented Generation)

```typescript
class RAGSystem {
  private vectorDB: VectorDatabase;

  async retrieve(query: string, limit = 5): Promise<Document[]> {
    // 1. Convertir query a embedding
    const queryEmbedding = await this.embed(query);

    // 2. Buscar documentos similares
    const results = await this.vectorDB.search(queryEmbedding, limit);

    return results;
  }

  async enhancePrompt(query: string, context: Context): Promise<string> {
    // Obtener documentos relevantes
    const docs = await this.retrieve(query);

    // Agregar al prompt
    return `
Context from knowledge base:
${docs.map((d, i) => `[${i + 1}] ${d.content}`).join('\n\n')}

User query: ${query}
    `;
  }
}
```

#### MCP Resources

```typescript
// Usar MCP para exponer recursos
const mcpResources = [
  {
    uri: 'bc://docs/user-management',
    name: 'User Management Documentation',
    mimeType: 'text/markdown',
  },
  {
    uri: 'bc://schemas/customer',
    name: 'Customer Entity Schema',
    mimeType: 'application/json',
  },
];

// Agente puede solicitar recursos cuando los necesite
const resource = await mcpClient.readResource('bc://docs/user-management');
```

## 2. Tools (Herramientas)

### Concepto

Extender las capacidades del LLM con funciones ejecutables.

### Categorías de Tools

#### A) Data Access Tools

```typescript
const dataAccessTools = [
  {
    name: 'bc_query',
    description: 'Query data from Business Central',
    category: 'read',
  },
  {
    name: 'read_file',
    description: 'Read contents of a file',
    category: 'read',
  },
];
```

#### B) Data Manipulation Tools

```typescript
const dataManipulationTools = [
  {
    name: 'bc_create',
    description: 'Create entity in Business Central',
    category: 'write',
  },
  {
    name: 'bc_update',
    description: 'Update entity in Business Central',
    category: 'write',
  },
  {
    name: 'bc_delete',
    description: 'Delete entity from Business Central',
    category: 'write',
  },
];
```

#### C) Computation Tools

```typescript
const computationTools = [
  {
    name: 'calculate',
    description: 'Perform mathematical calculations',
    execute: async (params: { expression: string }) => {
      return eval(params.expression); // Sandboxed!
    },
  },
  {
    name: 'analyze_data',
    description: 'Statistical analysis of datasets',
    execute: async (params: { data: number[] }) => {
      return {
        mean: _.mean(params.data),
        median: _.median(params.data),
        stdDev: _.stdDev(params.data),
      };
    },
  },
];
```

#### D) Communication Tools

```typescript
const communicationTools = [
  {
    name: 'send_email',
    description: 'Send email notification',
  },
  {
    name: 'create_notification',
    description: 'Create in-app notification',
  },
];
```

### Tool Selection Strategy

```typescript
class ToolSelector {
  selectTools(intent: Intent, context: Context): Tool[] {
    const allTools = this.getAllTools();

    // Filter by intent
    let relevant = allTools.filter(tool => {
      if (intent.type === 'query') return tool.category === 'read';
      if (intent.type === 'create') return tool.category === 'write';
      return true;
    });

    // Filter by permissions
    relevant = relevant.filter(tool =>
      context.permissions.includes(tool.requiredPermission)
    );

    // Prioritize by usage history
    relevant.sort((a, b) => {
      const aUsage = context.toolUsageHistory.get(a.name) || 0;
      const bUsage = context.toolUsageHistory.get(b.name) || 0;
      return bUsage - aUsage;
    });

    return relevant.slice(0, 15); // Max 15 tools
  }
}
```

## 3. Memory (Memoria)

### Short-Term Memory (Contexto de Conversación)

```typescript
class ShortTermMemory {
  private messages: Message[] = [];
  private maxMessages = 50;

  add(message: Message) {
    this.messages.push(message);

    // Limit size
    if (this.messages.length > this.maxMessages) {
      this.messages = this.messages.slice(-this.maxMessages);
    }
  }

  getContext(): Message[] {
    return this.messages;
  }

  clear() {
    this.messages = [];
  }
}
```

### Long-Term Memory (CloudMD)

```typescript
class LongTermMemory {
  private storage: CloudMD;

  async save(key: string, value: any, metadata?: any) {
    await this.storage.write({
      key,
      value: JSON.stringify(value),
      metadata: {
        ...metadata,
        timestamp: new Date(),
      },
    });
  }

  async load(key: string): Promise<any> {
    const data = await this.storage.read(key);
    return JSON.parse(data.value);
  }

  async search(query: string): Promise<any[]> {
    // Vector search en memoria
    const results = await this.storage.search({
      query,
      limit: 10,
    });

    return results.map(r => JSON.parse(r.value));
  }
}
```

### Semantic Memory (Conocimiento)

```typescript
class SemanticMemory {
  private facts: Map<string, Fact> = new Map();

  async learn(fact: Fact) {
    this.facts.set(fact.id, fact);

    // Persist
    await longTermMemory.save(`fact:${fact.id}`, fact);
  }

  async recall(query: string): Promise<Fact[]> {
    // Semantic search
    const results = await longTermMemory.search(query);

    return results.map(r => r as Fact);
  }
}

// Ejemplo
await semanticMemory.learn({
  id: 'user-creation-process',
  content: 'To create a user in BC, we need: name, email, role',
  category: 'procedure',
});
```

## 4. Enhanced Capabilities

### A) Chain of Thought (CoT)

```typescript
class ChainOfThoughtAgent {
  async solve(problem: string): Promise<Solution> {
    const response = await llm.sendMessage(`
Problem: ${problem}

Solve this step by step:
1. First, let's understand what we're trying to achieve
2. Then, identify what information we need
3. Next, determine which tools we can use
4. Plan the sequence of actions
5. Finally, execute and verify

Think through each step carefully before proceeding.
    `);

    return this.parseResponse(response);
  }
}
```

### B) Self-Reflection

```typescript
class ReflectiveAgent {
  async executeWithReflection(task: Task): Promise<Result> {
    // 1. Execute task
    const result = await this.execute(task);

    // 2. Reflect on result
    const reflection = await llm.sendMessage(`
Task: ${task.description}
Result: ${JSON.stringify(result)}

Reflect on this execution:
- Did we achieve the goal?
- Could we have done it better?
- What would you do differently next time?
    `);

    // 3. Store learnings
    await this.storeLearning(task, result, reflection);

    return result;
  }
}
```

### C) Multi-Agent Collaboration

```typescript
class CollaborativeSystem {
  async solve(problem: string): Promise<Solution> {
    // Divide problema entre múltiples agentes especializados
    const tasks = await this.decompose(problem);

    // Cada agente resuelve su parte
    const results = await Promise.all(
      tasks.map(task => {
        const agent = this.selectAgent(task);
        return agent.execute(task);
      })
    );

    // Sintetizar resultados
    return await this.synthesize(results);
  }
}
```

## Integration Example

```typescript
class EnhancedAgent {
  private retrieval: RAGSystem;
  private tools: ToolRegistry;
  private memory: {
    shortTerm: ShortTermMemory;
    longTerm: LongTermMemory;
    semantic: SemanticMemory;
  };

  async process(input: string): Promise<Response> {
    // 1. Retrieve relevant context
    const relevantDocs = await this.retrieval.retrieve(input);

    // 2. Recall from memory
    const relevantMemories = await this.memory.semantic.recall(input);

    // 3. Select appropriate tools
    const tools = this.tools.selectRelevant(input);

    // 4. Build enhanced prompt
    const prompt = this.buildPrompt({
      input,
      context: relevantDocs,
      memories: relevantMemories,
      conversationHistory: this.memory.shortTerm.getContext(),
    });

    // 5. Call LLM with tools
    const response = await llm.sendMessage(prompt, { tools });

    // 6. Execute tool calls
    if (response.toolCalls) {
      for (const call of response.toolCalls) {
        const result = await this.tools.execute(call);
        response.toolResults.push(result);
      }
    }

    // 7. Store in memory
    this.memory.shortTerm.add({
      role: 'user',
      content: input,
    });
    this.memory.shortTerm.add({
      role: 'assistant',
      content: response.content,
    });

    return response;
  }
}
```

## Best Practices

### 1. Tool Design

✅ **DO**:
- Clear, specific tool names
- Detailed descriptions
- Well-defined input schemas
- Idempotent operations when possible

❌ **DON'T**:
- Vague tool names like "doSomething"
- Tools that do too many things
- Missing error handling
- Non-deterministic side effects

### 2. Memory Management

✅ **DO**:
- Clear old irrelevant memories
- Use semantic search for retrieval
- Store structured data
- Version control for memories

❌ **DON'T**:
- Store everything forever
- Use only keyword search
- Store unstructured blobs
- Forget to clean up

### 3. Retrieval Strategy

✅ **DO**:
- Index documents with metadata
- Use hybrid search (keyword + semantic)
- Cache frequent queries
- Filter by relevance threshold

❌ **DON'T**:
- Return too many results
- Ignore metadata
- Skip caching
- Include irrelevant docs

## Próximos Pasos

- [Fundamental Patterns](./03-fundamental-patterns.md)
- [Token Economics](./04-token-economics.md)
- [Agent System](../03-agent-system/01-agentic-loop.md)

---

**Última actualización**: 2025-10-28
**Versión**: 1.0
