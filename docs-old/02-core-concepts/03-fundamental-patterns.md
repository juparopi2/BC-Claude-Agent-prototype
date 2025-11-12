# Fundamental Patterns

## Introducción

Los patrones fundamentales son estrategias arquitectónicas para organizar sistemas de agentes. BC-Claude-Agent implementa cinco patrones clave.

## 1. Prompt Chaining

### Concepto
Encadenar múltiples prompts donde la salida de uno alimenta al siguiente.

### Implementación

```typescript
class PromptChain {
  private steps: ChainStep[] = [];

  addStep(step: ChainStep): this {
    this.steps.push(step);
    return this;
  }

  async execute(input: any): Promise<any> {
    let result = input;

    for (const step of this.steps) {
      result = await step.execute(result);
    }

    return result;
  }
}

// Ejemplo: Análisis de ventas
const analysisChain = new PromptChain()
  .addStep({
    name: 'extract-data',
    execute: async (input) => {
      return await llm.sendMessage(
        `Extract sales data from: ${input}`
      );
    },
  })
  .addStep({
    name: 'calculate-metrics',
    execute: async (data) => {
      return await llm.sendMessage(
        `Calculate metrics for: ${JSON.stringify(data)}`
      );
    },
  })
  .addStep({
    name: 'generate-insights',
    execute: async (metrics) => {
      return await llm.sendMessage(
        `Generate insights from: ${JSON.stringify(metrics)}`
      );
    },
  })
  .addStep({
    name: 'create-report',
    execute: async (insights) => {
      return await llm.sendMessage(
        `Create executive report with: ${JSON.stringify(insights)}`
      );
    },
  });

const report = await analysisChain.execute(salesData);
```

### Ventajas
- ✅ Cada paso es simple y enfocado
- ✅ Fácil debuggear cada etapa
- ✅ Reutilizable

### Cuándo Usar
- Tareas multi-paso secuenciales
- Cuando cada paso requiere diferente especialización
- Procesamiento de datos en pipeline

## 2. Routing

### Concepto
Dirigir requests a agentes o modelos especializados basado en clasificación.

### Implementación

```typescript
class AgentRouter {
  private routes: Map<string, Agent> = new Map([
    ['query', new BCQueryAgent()],
    ['create', new BCWriteAgent()],
    ['analysis', new AnalysisAgent()],
    ['validation', new ValidationAgent()],
  ]);

  async route(input: string): Promise<Response> {
    // 1. Classify intent
    const intent = await this.classifyIntent(input);

    // 2. Select agent
    const agent = this.routes.get(intent.type);
    if (!agent) {
      throw new Error(`No agent for intent: ${intent.type}`);
    }

    // 3. Delegate
    return await agent.execute(input);
  }

  private async classifyIntent(input: string): Promise<Intent> {
    const response = await llm.sendMessage(`
Classify this request into one of: query, create, analysis, validation

Request: ${input}

Respond with JSON: { "type": "...", "confidence": 0-1 }
    `);

    return JSON.parse(response.content);
  }
}
```

### Model Routing

```typescript
class ModelRouter {
  async route(task: Task): Promise<Response> {
    // Simple tasks → Haiku (fast, cheap)
    if (task.complexity === 'low') {
      return await this.callClaude('haiku', task);
    }

    // Complex reasoning → Sonnet (balanced)
    if (task.complexity === 'medium') {
      return await this.callClaude('sonnet', task);
    }

    // Very complex → Opus (powerful)
    return await this.callClaude('opus', task);
  }

  private estimateComplexity(task: Task): 'low' | 'medium' | 'high' {
    let score = 0;

    if (task.requiresMultiStep) score += 2;
    if (task.requiresToolUse) score += 1;
    if (task.inputLength > 10000) score += 2;

    if (score <= 2) return 'low';
    if (score <= 4) return 'medium';
    return 'high';
  }
}
```

### Ventajas
- ✅ Optimización de costos (usar modelo apropiado)
- ✅ Mejor performance (agente especializado)
- ✅ Separación de responsabilidades

## 3. Parallelization

### Concepto
Ejecutar múltiples operaciones independientes simultáneamente.

### Implementación

```typescript
class ParallelExecutor {
  async executeParallel<T>(
    tasks: Task[]
  ): Promise<T[]> {
    // Identificar tareas independientes
    const groups = this.groupIndependent(tasks);

    const allResults: T[] = [];

    for (const group of groups) {
      // Ejecutar grupo en paralelo
      const groupResults = await Promise.all(
        group.map(task => this.execute(task))
      );

      allResults.push(...groupResults);
    }

    return allResults;
  }

  private groupIndependent(tasks: Task[]): Task[][] {
    const graph = this.buildDependencyGraph(tasks);
    return this.topologicalGroups(graph);
  }
}

// Ejemplo: Crear múltiples usuarios
const users = [user1, user2, user3, user4, user5];

// ❌ Secuencial (lento)
for (const user of users) {
  await bcClient.createUser(user);
}
// Total: 5s (1s cada uno)

// ✅ Paralelo (rápido)
await Promise.all(
  users.map(user => bcClient.createUser(user))
);
// Total: 1s (todos al mismo tiempo)
```

### Parallel Tool Calling

```typescript
// Claude puede llamar múltiples tools en una respuesta
const response = await llm.sendMessage(
  'Get customer 123, their orders, and invoices',
  {
    tools: [
      getCustomerTool,
      getOrdersTool,
      getInvoicesTool,
    ],
  }
);

// Response puede contener múltiples tool_use blocks
const toolCalls = response.content.filter(
  block => block.type === 'tool_use'
);

// Ejecutar todos en paralelo
const results = await Promise.all(
  toolCalls.map(call => executeTool(call))
);
```

### Ventajas
- ✅ Reducción drástica de latencia
- ✅ Mejor utilización de recursos
- ✅ Mejor experiencia de usuario

## 4. Orchestrator-Worker

### Concepto
Un orchestrator central coordina múltiples workers especializados.

```
         ┌──────────────┐
         │              │
         │ Orchestrator │
         │              │
         └───────┬──────┘
                 │
      ┌──────────┼──────────┐
      │          │          │
      ▼          ▼          ▼
  ┌────────┐ ┌────────┐ ┌────────┐
  │Worker 1│ │Worker 2│ │Worker 3│
  └────────┘ └────────┘ └────────┘
```

### Implementación

```typescript
class Orchestrator {
  private workers: Map<string, Worker>;

  async execute(task: Task): Promise<Result> {
    // 1. Descomponer tarea
    const subtasks = await this.decompose(task);

    // 2. Asignar workers
    const assignments = subtasks.map(subtask => ({
      subtask,
      worker: this.selectWorker(subtask),
    }));

    // 3. Ejecutar (paralelo donde sea posible)
    const results = await this.executeAssignments(assignments);

    // 4. Sintetizar resultados
    return await this.synthesize(results);
  }

  private selectWorker(subtask: Subtask): Worker {
    // Seleccionar worker más apropiado
    for (const [type, worker] of this.workers) {
      if (worker.canHandle(subtask)) {
        return worker;
      }
    }

    throw new Error(`No worker can handle: ${subtask.type}`);
  }
}

class Worker {
  abstract canHandle(subtask: Subtask): boolean;
  abstract execute(subtask: Subtask): Promise<Result>;
}

class BCQueryWorker extends Worker {
  canHandle(subtask: Subtask): boolean {
    return subtask.type === 'bc-query';
  }

  async execute(subtask: Subtask): Promise<Result> {
    return await mcpClient.call('bc_query', subtask.params);
  }
}
```

### Ventajas
- ✅ Separación de concerns
- ✅ Workers especializados y reutilizables
- ✅ Fácil agregar nuevos workers
- ✅ Escalabilidad horizontal

## 5. Evaluator-Optimizer

### Concepto
Un agente evalúa outputs y otro los optimiza iterativamente.

### Implementación

```typescript
class EvaluatorOptimizerSystem {
  private generator: Agent;
  private evaluator: Agent;
  private optimizer: Agent;

  async generate(
    prompt: string,
    criteria: Criteria
  ): Promise<Output> {
    let output = await this.generator.execute(prompt);
    let iterations = 0;
    const maxIterations = 5;

    while (iterations < maxIterations) {
      // Evaluar calidad
      const evaluation = await this.evaluator.evaluate(output, criteria);

      if (evaluation.score >= criteria.threshold) {
        return output; // ✅ Alcanzó calidad deseada
      }

      // Optimizar
      output = await this.optimizer.improve(output, evaluation.feedback);
      iterations++;
    }

    return output; // Mejor intento después de max iterations
  }
}

// Ejemplo: Generar reporte
const system = new EvaluatorOptimizerSystem();

const report = await system.generate(
  'Create executive summary of Q4 sales',
  {
    threshold: 0.85,
    criteria: {
      clarity: 0.9,
      accuracy: 1.0,
      completeness: 0.8,
    },
  }
);
```

### Self-Correction Loop

```typescript
class SelfCorrectingAgent {
  async executeWithCorrection(task: Task): Promise<Result> {
    let attempt = 1;
    const maxAttempts = 3;

    while (attempt <= maxAttempts) {
      const result = await this.execute(task);

      // Auto-evaluar
      const isCorrect = await this.verify(result, task);

      if (isCorrect) {
        return result;
      }

      // Auto-corregir
      task = this.adjustTask(task, result);
      attempt++;
    }

    throw new Error('Could not achieve correct result');
  }
}
```

### Ventajas
- ✅ Mejora automática de calidad
- ✅ Reducción de errores
- ✅ Aprendizaje iterativo

## Pattern Combinations

### Chain + Parallel

```typescript
const pipeline = new PromptChain()
  .addStep({
    name: 'fetch-data',
    execute: async (input) => {
      // Parallelizar fetches
      const [customers, orders, products] = await Promise.all([
        bcClient.query('Customer'),
        bcClient.query('Order'),
        bcClient.query('Product'),
      ]);
      return { customers, orders, products };
    },
  })
  .addStep({
    name: 'analyze',
    execute: async (data) => {
      return await analysisAgent.execute(data);
    },
  });
```

### Orchestrator + Routing

```typescript
class SmartOrchestrator extends Orchestrator {
  private router: AgentRouter;

  async execute(task: Task): Promise<Result> {
    const subtasks = await this.decompose(task);

    const results = await Promise.all(
      subtasks.map(async subtask => {
        // Usar router para seleccionar mejor agente
        const agent = await this.router.route(subtask);
        return await agent.execute(subtask);
      })
    );

    return this.synthesize(results);
  }
}
```

## Resumen

| Patrón | Cuándo Usar | Beneficio Principal |
|--------|------------|-------------------|
| **Prompt Chaining** | Pipeline secuencial | Simplifica pasos complejos |
| **Routing** | Múltiples especialidades | Optimiza recursos |
| **Parallelization** | Tareas independientes | Reduce latencia |
| **Orchestrator-Worker** | Sistema complejo | Organiza responsabilidades |
| **Evaluator-Optimizer** | Requiere alta calidad | Mejora automática |

## Próximos Pasos

- [Token Economics](./04-token-economics.md)
- [Agent System](../03-agent-system/01-agentic-loop.md)
- [Distributed Patterns](../01-architecture/02-distributed-patterns.md)

---

**Última actualización**: 2025-10-28
**Versión**: 1.0
