# Context Management

## Context Isolation

Cada agente tiene su propio contexto aislado.

```typescript
class ContextManager {
  private contexts: Map<string, AgentContext> = new Map();
  
  getContext(agentId: string): AgentContext {
    if (!this.contexts.has(agentId)) {
      this.contexts.set(agentId, this.createContext(agentId));
    }
    return this.contexts.get(agentId)!;
  }
  
  clearContext(agentId: string) {
    this.contexts.delete(agentId);
  }
}
```

## Context Compaction

Reduce el tamaño del contexto manteniendo información relevante.

```typescript
class ContextCompactor {
  async compact(context: Context, maxTokens: number): Promise<Context> {
    const current = this.estimateTokens(context);
    
    if (current <= maxTokens) return context;
    
    // 1. Remove old messages
    const scored = this.scoreByRelevance(context.messages);
    const kept = scored.slice(0, Math.floor(context.messages.length * 0.7));
    
    // 2. Summarize removed
    const summary = await this.summarize(
      context.messages.filter(m => !kept.includes(m))
    );
    
    return {
      summary,
      messages: kept,
      data: context.data
    };
  }
}
```

## Prompt Caching

```typescript
const systemPrompt = {
  type: 'text',
  text: SYSTEM_PROMPT,
  cache_control: { type: 'ephemeral' } // 90% cost reduction
};
```

## Extended Context Window

Claude supports up to 200K tokens:
- Reserve 50K for system + tools
- Use 100K for conversation history
- Keep 50K for new responses

---

**Versión**: 1.0
