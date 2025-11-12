# Agent-Computer Interface (ACI) Principles

## Introducción

El **Agent-Computer Interface (ACI)** define cómo los agentes de IA interactúan eficientemente con sistemas computacionales. Este documento detalla los principios de ACI aplicados a BC-Claude-Agent para minimizar cargas, optimizar resultados y maximizar eficiencia.

## Principios Fundamentales de ACI

### 1. Minimización de Cargas (Token Economics)

**Objetivo**: Reducir el número de tokens enviados a Claude sin sacrificar calidad.

#### Estrategias

**a) Prompt Caching**

```typescript
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

class ClaudeClient {
  async sendMessage(
    systemPrompt: string,
    userMessage: string,
    cacheConfig?: CacheConfig
  ): Promise<Response> {
    return await anthropic.messages.create({
      model: 'claude-sonnet-4',
      max_tokens: 4096,
      system: [
        {
          type: 'text',
          text: systemPrompt,
          // Cachear system prompt (reutilizable entre mensajes)
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: userMessage,
        },
      ],
    });
  }
}
```

**Impacto**:
- ✅ 90% de reducción en costos para prompts cacheados
- ✅ 50% reducción en latencia

**b) Context Compaction**

```typescript
class ContextCompactor {
  /**
   * Compacta contexto largo manteniendo información relevante
   */
  async compact(context: Context, maxTokens: number): Promise<Context> {
    const currentTokens = this.estimateTokens(context);

    if (currentTokens <= maxTokens) {
      return context;
    }

    // Estrategia 1: Remover mensajes antiguos menos relevantes
    const scored = this.scoreMessages(context.messages);
    const kept = scored
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.floor(context.messages.length * 0.7));

    // Estrategia 2: Summarizar bloques de mensajes
    const summarized = await this.summarizeOldMessages(
      context.messages.filter(m => !kept.includes(m))
    );

    // Estrategia 3: Comprimir datos estructurados
    const compressedData = this.compressStructuredData(context.data);

    return {
      messages: [
        { role: 'system', content: summarized },
        ...kept.map(m => m.message),
      ],
      data: compressedData,
    };
  }

  private scoreMessages(messages: Message[]): ScoredMessage[] {
    return messages.map(message => ({
      message,
      score: this.calculateRelevanceScore(message),
    }));
  }

  private calculateRelevanceScore(message: Message): number {
    let score = 0;

    // Mensajes recientes son más relevantes
    const age = Date.now() - message.timestamp.getTime();
    score += Math.max(0, 100 - age / (1000 * 60)); // Decay por minuto

    // Mensajes con tool calls son importantes
    if (message.toolCalls && message.toolCalls.length > 0) {
      score += 50;
    }

    // Mensajes con errores son relevantes
    if (message.content.includes('error') || message.content.includes('failed')) {
      score += 30;
    }

    return score;
  }

  private async summarizeOldMessages(messages: Message[]): Promise<string> {
    // Usar Claude con Haiku (barato) para summarizar
    const summary = await claudeClient.sendMessage(
      'Eres un asistente que resume conversaciones.',
      `Resume estos mensajes en 2-3 oraciones:\n\n${messages
        .map(m => `${m.role}: ${m.content}`)
        .join('\n')}`
    );

    return `[Resumen de mensajes anteriores]: ${summary}`;
  }

  private compressStructuredData(data: any): any {
    // Comprimir JSON removiendo campos redundantes
    return {
      ...data,
      // Solo incluir IDs en lugar de objetos completos
      entities: data.entities?.map((e: any) => e.id),
      // Remover metadata no esencial
      metadata: undefined,
    };
  }
}
```

**Impacto**:
- ✅ 40-60% reducción en tokens de contexto
- ✅ Mantiene información crítica
- ✅ Mejora latencia

**c) Progressive Disclosure**

```typescript
class ProgressiveDisclosureManager {
  /**
   * Solo exponer herramientas relevantes al contexto actual
   */
  getRelevantTools(intent: Intent, context: Context): Tool[] {
    const allTools = this.getAllTools();

    // Filtrar por intención
    const relevant = allTools.filter(tool => {
      // Si intent es "query", solo exponer tools de lectura
      if (intent.type === 'query') {
        return tool.category === 'read';
      }

      // Si intent es "create", exponer tools de escritura
      if (intent.type === 'create') {
        return tool.category === 'write';
      }

      return true;
    });

    // Ordenar por relevancia
    return relevant
      .sort((a, b) => this.calculateToolRelevance(b, context) -
                      this.calculateToolRelevance(a, context))
      .slice(0, 10); // Máximo 10 tools
  }

  private calculateToolRelevance(tool: Tool, context: Context): number {
    let score = tool.baseRelevance;

    // Incrementar si el tool fue usado recientemente
    if (context.recentTools.includes(tool.name)) {
      score += 50;
    }

    // Incrementar si es relevante al entity actual
    if (context.currentEntity && tool.supportedEntities.includes(context.currentEntity)) {
      score += 30;
    }

    return score;
  }
}

// Uso
const relevantTools = progressiveDisclosure.getRelevantTools(intent, context);

const response = await anthropic.messages.create({
  model: 'claude-sonnet-4',
  tools: relevantTools, // Solo tools relevantes, no todas
  messages: [...],
});
```

**Impacto**:
- ✅ Reducción de 50-80% en definiciones de tools
- ✅ Mejora precisión de tool selection
- ✅ Reduce confusión del modelo

### 2. Formatos Óptimos de Resultados

**Objetivo**: Estructurar outputs para fácil parsing y procesamiento.

#### Structured Output

```typescript
// Definir schemas Zod para outputs esperados
import { z } from 'zod';

const EntityQueryResultSchema = z.object({
  entity: z.string(),
  results: z.array(
    z.object({
      id: z.string(),
      fields: z.record(z.any()),
    })
  ),
  metadata: z.object({
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
  }),
});

type EntityQueryResult = z.infer<typeof EntityQueryResultSchema>;

// Tool que retorna formato estructurado
const bcQueryTool: Tool = {
  name: 'bc_query_entity',
  description: 'Query entities from Business Central',
  input_schema: {
    type: 'object',
    properties: {
      entity: { type: 'string' },
      filters: { type: 'object' },
      limit: { type: 'number' },
    },
    required: ['entity'],
  },
  // Output schema para validación
  output_schema: EntityQueryResultSchema,
};

// Implementación
async function executeBCQuery(params: any): Promise<EntityQueryResult> {
  const result = await mcpClient.call('bc_query_entity', params);

  // Validar output
  const parsed = EntityQueryResultSchema.parse(result);

  return parsed;
}
```

**Ventajas**:
- ✅ Type safety
- ✅ Validación automática
- ✅ Fácil debugging
- ✅ Documentación automática

#### Markdown para Resultados Complejos

```typescript
class ResultFormatter {
  formatQueryResult(result: EntityQueryResult): string {
    return `
## ${result.entity} Query Results

**Total**: ${result.metadata.total} items
**Page**: ${result.metadata.page} of ${Math.ceil(result.metadata.total / result.metadata.pageSize)}

### Results

${result.results
  .map(
    (item, index) => `
#### ${index + 1}. ${item.fields.name || item.id}

${Object.entries(item.fields)
  .map(([key, value]) => `- **${key}**: ${value}`)
  .join('\n')}
`
  )
  .join('\n')}
    `.trim();
  }
}
```

### 3. Simplicidad Arquitectónica

**Objetivo**: Mantener la arquitectura simple y mantenible.

#### Single Responsibility per Tool

```typescript
// ❌ MAL: Tool que hace demasiado
const badTool = {
  name: 'bc_manage_entity',
  description: 'Create, read, update, or delete entities',
  // Demasiadas responsabilidades
};

// ✅ BIEN: Tools específicos
const goodTools = [
  {
    name: 'bc_create_entity',
    description: 'Create a new entity in Business Central',
  },
  {
    name: 'bc_read_entity',
    description: 'Read an entity from Business Central',
  },
  {
    name: 'bc_update_entity',
    description: 'Update an existing entity',
  },
  {
    name: 'bc_delete_entity',
    description: 'Delete an entity',
  },
];
```

#### Composición sobre Herencia

```typescript
// ❌ MAL: Herencia profunda
class Agent {}
class BCAgent extends Agent {}
class BCQueryAgent extends BCAgent {}
class BCCustomerQueryAgent extends BCQueryAgent {}

// ✅ BIEN: Composición
interface IAgent {
  execute(task: Task): Promise<Result>;
}

class BCQueryAgent implements IAgent {
  constructor(
    private queryBuilder: QueryBuilder,
    private validator: Validator,
    private mcpClient: MCPClient
  ) {}

  async execute(task: Task): Promise<Result> {
    const query = this.queryBuilder.build(task);
    this.validator.validate(query);
    return await this.mcpClient.call('bc_query', query);
  }
}
```

### 4. Context Isolation por Agente

**Objetivo**: Cada agente tiene su propio contexto aislado.

```typescript
class ContextManager {
  private contexts: Map<string, AgentContext> = new Map();

  getContext(agentId: string): AgentContext {
    if (!this.contexts.has(agentId)) {
      this.contexts.set(agentId, this.createContext(agentId));
    }
    return this.contexts.get(agentId)!;
  }

  private createContext(agentId: string): AgentContext {
    return {
      agentId,
      memory: new Map(),
      history: [],
      variables: {},
      tools: this.getToolsForAgent(agentId),
      // Cada agente tiene su prompt cache independiente
      cacheKey: `agent-${agentId}-cache`,
    };
  }

  clearContext(agentId: string) {
    this.contexts.delete(agentId);
  }
}

// Main Orchestrator mantiene contextos de subagentes
class MainOrchestratorAgent {
  private contextManager = new ContextManager();

  async delegateToSubagent(
    subagentType: string,
    task: Task
  ): Promise<Result> {
    const subagent = this.getSubagent(subagentType);
    const context = this.contextManager.getContext(subagent.id);

    // Subagent ejecuta con su propio contexto aislado
    const result = await subagent.execute(task, context);

    // Limpiar contexto después (opcional)
    if (!task.persistent) {
      this.contextManager.clearContext(subagent.id);
    }

    return result;
  }
}
```

**Ventajas**:
- ✅ No hay "bleeding" de contexto entre agentes
- ✅ Cada agente puede tener prompts especializados
- ✅ Fácil debugging y tracing
- ✅ Mejor cache efficiency

### 5. Minimización de Round Trips

**Objetivo**: Reducir número de llamadas al LLM.

#### Batch Tool Calling

```typescript
// En lugar de múltiples llamadas:
// ❌ MAL
const customer = await agent.call('get_customer', { id: '123' });
const orders = await agent.call('get_orders', { customerId: '123' });
const invoices = await agent.call('get_invoices', { customerId: '123' });

// Usar tool calling paralelo:
// ✅ BIEN
const response = await anthropic.messages.create({
  model: 'claude-sonnet-4',
  messages: [
    {
      role: 'user',
      content: 'Get customer 123 with their orders and invoices',
    },
  ],
  tools: [getCustomerTool, getOrdersTool, getInvoicesTool],
});

// Claude puede hacer múltiples tool calls en una respuesta
if (response.stop_reason === 'tool_use') {
  const results = await Promise.all(
    response.content
      .filter(block => block.type === 'tool_use')
      .map(block => executeToolCall(block))
  );
}
```

#### Smart Caching de Decisiones

```typescript
class DecisionCache {
  private cache = new Map<string, Decision>();

  async getOrCompute(
    key: string,
    computeFn: () => Promise<Decision>
  ): Promise<Decision> {
    // Check cache primero
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    // Compute y cachear
    const decision = await computeFn();
    this.cache.set(key, decision);

    return decision;
  }
}

// Uso
class MainOrchestratorAgent {
  private decisionCache = new DecisionCache();

  async analyzeIntent(message: string): Promise<Intent> {
    // Mensajes similares probablemente tienen mismo intent
    const cacheKey = this.hashMessage(message);

    return this.decisionCache.getOrCompute(cacheKey, async () => {
      return await this.llmAnalyzeIntent(message);
    });
  }
}
```

### 6. Optimización de Payloads

#### Compresión de Datos

```typescript
class PayloadOptimizer {
  /**
   * Comprimir datos grandes antes de enviar a Claude
   */
  optimizePayload(data: any): string {
    // Para datos muy grandes, usar formato comprimido
    if (JSON.stringify(data).length > 10000) {
      return this.compressToCSV(data);
    }

    return JSON.stringify(data, null, 2);
  }

  private compressToCSV(data: any[]): string {
    if (!Array.isArray(data) || data.length === 0) {
      return JSON.stringify(data);
    }

    // Convertir array de objetos a CSV
    const headers = Object.keys(data[0]);
    const rows = data.map(item => headers.map(h => item[h]).join(','));

    return `CSV Data (${data.length} rows):
Headers: ${headers.join(', ')}

${rows.join('\n')}`;
  }
}
```

#### Lazy Loading de Datos

```typescript
class LazyDataLoader {
  /**
   * Solo cargar datos cuando el agente lo solicite
   */
  async provideLazyContext(entity: string): Promise<ContextBlock> {
    // En lugar de cargar todos los datos:
    // ❌ const allCustomers = await bcClient.getAllCustomers();

    // Proveer "resource" que Claude puede solicitar:
    // ✅
    return {
      type: 'resource',
      resource: {
        uri: `bc://entities/${entity}`,
        name: `${entity} data`,
        description: `Access to ${entity} data. Use bc_query_entity tool to fetch specific records.`,
      },
    };
  }
}
```

## Token Economics Dashboard

```typescript
class TokenEconomicsDashboard {
  private metrics = {
    totalTokensUsed: 0,
    cacheHits: 0,
    cacheMisses: 0,
    avgTokensPerMessage: 0,
    costSavingsFromCache: 0,
  };

  trackMessage(message: Message, tokens: TokenUsage) {
    this.metrics.totalTokensUsed += tokens.total;

    if (tokens.cacheRead > 0) {
      this.metrics.cacheHits++;
      // Cache reads son 90% más baratos
      this.metrics.costSavingsFromCache +=
        tokens.cacheRead * 0.9 * PRICE_PER_TOKEN;
    } else {
      this.metrics.cacheMisses++;
    }

    this.metrics.avgTokensPerMessage =
      this.metrics.totalTokensUsed /
      (this.metrics.cacheHits + this.metrics.cacheMisses);
  }

  generateReport(): Report {
    return {
      totalCost: this.metrics.totalTokensUsed * PRICE_PER_TOKEN,
      savings: this.metrics.costSavingsFromCache,
      cacheEfficiency:
        this.metrics.cacheHits / (this.metrics.cacheHits + this.metrics.cacheMisses),
      avgTokensPerMessage: this.metrics.avgTokensPerMessage,
    };
  }
}
```

## Best Practices Summary

### DO's ✅

1. **Cache system prompts** usando prompt caching
2. **Usar context compaction** para conversaciones largas
3. **Progressive disclosure** de tools
4. **Structured outputs** con schemas Zod
5. **Context isolation** por agente
6. **Batch tool calling** cuando sea posible
7. **Lazy loading** de datos grandes
8. **Comprimir payloads** grandes
9. **Monitor token usage** constantemente

### DON'Ts ❌

1. **No enviar** todo el contexto cada vez
2. **No exponer** todas las tools siempre
3. **No usar** strings cuando hay structured outputs
4. **No hacer** múltiples llamadas cuando una basta
5. **No compartir** contexto entre agentes sin aislamiento
6. **No enviar** datos raw sin optimizar
7. **No ignorar** métricas de tokens

## Métricas de Éxito

| Métrica | Target | Actual |
|---------|--------|--------|
| Tokens por mensaje | < 2000 | - |
| Cache hit rate | > 70% | - |
| Cost per message | < $0.01 | - |
| Avg latency | < 2s | - |

## Próximos Pasos

- [Core Concepts](../02-core-concepts/01-agents-fundamentals.md)
- [Agent System](../03-agent-system/01-agentic-loop.md)
- [Performance](../09-performance/01-prompt-caching.md)

---

**Última actualización**: 2025-10-28
**Versión**: 1.0
**Autor**: BC-Claude-Agent Team
