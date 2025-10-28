# Token Economics & Architectural Simplicity

## Token Economics

### Principios Fundamentales

1. **Minimizar tokens sin sacrificar calidad**
2. **Reutilizar contexto mediante caching**
3. **Seleccionar modelo apropiado por tarea**
4. **Optimizar payloads**

### Estrategias de Optimización

#### 1. Prompt Caching

```typescript
// Cache system prompts (reutilizables)
const systemPrompt = {
  type: 'text',
  text: SYSTEM_PROMPT_TEXT,
  cache_control: { type: 'ephemeral' }, // 90% savings
};

// Ahorro: $0.10 → $0.01 por request
```

#### 2. Model Selection

| Tarea | Modelo | Costo | Latencia |
|-------|--------|-------|----------|
| Simple query | Haiku | $0.001 | 500ms |
| Reasoning | Sonnet | $0.01 | 1500ms |
| Complex analysis | Opus | $0.05 | 3000ms |

```typescript
function selectModel(complexity: number): Model {
  if (complexity < 3) return 'haiku';
  if (complexity < 7) return 'sonnet';
  return 'opus';
}
```

#### 3. Context Compaction

```typescript
// Antes: 50,000 tokens
// Después: 15,000 tokens (70% reduction)

const compacted = compactor.compact(context, {
  maxTokens: 20000,
  strategy: 'semantic-importance',
});
```

#### 4. Progressive Disclosure

```typescript
// Exponer solo 10 tools relevantes en lugar de 50
// Ahorro: ~5,000 tokens por request
```

### Métricas Clave

```typescript
interface TokenMetrics {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cost: number;
  savings: number;
}

// Target metrics
const targets = {
  avgTokensPerMessage: 2000,
  cacheHitRate: 0.75,
  avgCost: 0.005,
};
```

## Architectural Simplicity

### Principios SOLID Aplicados

#### Single Responsibility

```typescript
// ✅ GOOD: Una responsabilidad
class BCQueryExecutor {
  async execute(query: Query): Promise<Result> {
    return await mcpClient.call('bc_query', query);
  }
}

// ❌ BAD: Múltiples responsabilidades
class BCManager {
  query() {}
  create() {}
  update() {}
  delete() {}
  validate() {}
  transform() {}
}
```

#### Dependency Inversion

```typescript
// Depender de abstracciones, no implementaciones
interface IStorage {
  save(key: string, value: any): Promise<void>;
  load(key: string): Promise<any>;
}

class Agent {
  constructor(private storage: IStorage) {} // ✅
  // constructor(private db: PostgreSQL) {} // ❌
}
```

### Keep It Simple, Stupid (KISS)

```typescript
// ✅ Simple and clear
function calculateDiscount(price: number, percentage: number): number {
  return price * (percentage / 100);
}

// ❌ Over-engineered
class DiscountCalculationStrategyFactory {
  createStrategy(type: DiscountType): IDiscountStrategy {
    // ... 50 lines of code
  }
}
```

### You Aren't Gonna Need It (YAGNI)

```typescript
// ❌ Building features "just in case"
class Agent {
  // Future feature que nadie pidió
  async predictFuture() {}
  async timeTravel() {}
  async readMinds() {}
}

// ✅ Only what's needed now
class Agent {
  async execute(task: Task): Promise<Result> {
    // Core functionality only
  }
}
```

### Composición sobre Herencia

```typescript
// ❌ Herencia profunda
class Agent {}
class BCAgent extends Agent {}
class BCQueryAgent extends BCAgent {}
class BCCustomerQueryAgent extends BCQueryAgent {}

// ✅ Composición
class Agent {
  constructor(
    private executor: IExecutor,
    private validator: IValidator,
    private logger: ILogger
  ) {}
}
```

## Cost Optimization

### Monthly Cost Projection

```typescript
interface CostProjection {
  messagesPerDay: number;
  avgTokensPerMessage: number;
  pricePerToken: number;
  monthlyCost: number;
}

function projectCost(config: CostProjection): number {
  const totalTokens = config.messagesPerDay * config.avgTokensPerMessage * 30;
  return totalTokens * config.pricePerToken;
}

// Example
const cost = projectCost({
  messagesPerDay: 1000,
  avgTokensPerMessage: 2000,
  pricePerToken: 0.000003, // Sonnet with cache
  monthlyCost: 0, // calculated
});

console.log(`Monthly cost: $${cost.toFixed(2)}`);
// Output: Monthly cost: $180.00

// With caching (75% cache hit rate):
// $180 * 0.25 + $180 * 0.75 * 0.1 = $58.50
```

### Cost Tracking

```typescript
class CostTracker {
  private costs: Cost[] = [];

  track(usage: TokenUsage) {
    const cost = this.calculateCost(usage);
    this.costs.push({
      timestamp: new Date(),
      tokens: usage,
      cost,
    });
  }

  getMonthlyReport(): Report {
    const monthlyCosts = this.costs.filter(this.isThisMonth);
    return {
      totalCost: _.sumBy(monthlyCosts, 'cost'),
      totalTokens: _.sumBy(monthlyCosts, c => c.tokens.total),
      avgCostPerMessage: _.meanBy(monthlyCosts, 'cost'),
    };
  }
}
```

## Performance vs Cost Trade-offs

| Strategy | Performance | Cost | Complexity |
|----------|------------|------|-----------|
| Always use Opus | ⭐⭐⭐⭐⭐ | 💰💰💰💰💰 | ⚙️ |
| Always use Haiku | ⭐⭐ | 💰 | ⚙️ |
| Dynamic selection | ⭐⭐⭐⭐ | 💰💰 | ⚙️⚙️⚙️ |
| With caching | ⭐⭐⭐⭐ | 💰 | ⚙️⚙️ |
| **Recommended** | ⭐⭐⭐⭐ | 💰 | ⚙️⚙️ |

## Best Practices

### ✅ DO

1. **Cache aggressively** - System prompts, entity schemas
2. **Choose right model** - Don't use Opus for simple tasks
3. **Compact context** - Remove irrelevant history
4. **Batch operations** - Multiple tool calls in one request
5. **Monitor costs** - Track and alert on anomalies

### ❌ DON'T

1. **Send full history** every time
2. **Expose all tools** always
3. **Use Opus** for everything
4. **Ignore metrics**
5. **Over-engineer** solutions

## Próximos Pasos

- [Agent System](../03-agent-system/01-agentic-loop.md)
- [ACI Principles](../01-architecture/04-aci-principles.md)
- [Performance](../09-performance/01-prompt-caching.md)

---

**Última actualización**: 2025-10-28
**Versión**: 1.0
