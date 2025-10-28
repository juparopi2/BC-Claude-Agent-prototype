# Agent Fundamentals

## ¿Qué es un Agente?

Un **agente de IA** es un sistema que:
1. **Percibe** su entorno
2. **Toma decisiones** basadas en objetivos
3. **Actúa** para alcanzar esos objetivos
4. **Aprende** de los resultados

### Diferencia: Agente vs LLM Simple

| Aspecto | LLM Simple | Agente |
|---------|-----------|--------|
| **Control de flujo** | Usuario | El agente mismo |
| **Herramientas** | No | Sí (tools) |
| **Memoria** | Solo conversación | Memoria persistente |
| **Planificación** | No | Sí |
| **Iteración** | Una respuesta | Múltiples iteraciones |

```
LLM Simple:
Usuario → Prompt → LLM → Respuesta → Usuario

Agente:
Usuario → Objetivo
          ↓
       Agente ←→ Tools
          ↓        ↑
       Plan    Feedback
          ↓        ↑
       Ejecuta  Evalúa
          ↓        ↑
       Resultado → Usuario
```

## Componentes de un Agente

### 1. Brain (LLM)

El "cerebro" del agente: Claude (Sonnet, Opus, Haiku)

```typescript
class Agent {
  private llm: ClaudeClient;

  constructor(model: 'sonnet' | 'opus' | 'haiku' = 'sonnet') {
    this.llm = new ClaudeClient({
      model: `claude-${model}-4`,
    });
  }
}
```

### 2. Tools (Herramientas)

Capacidades que el agente puede ejecutar:

```typescript
interface Tool {
  name: string;
  description: string;
  input_schema: JSONSchema;
  execute: (params: any) => Promise<any>;
}

const tools: Tool[] = [
  {
    name: 'bc_create_user',
    description: 'Create a new user in Business Central',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        email: { type: 'string' },
        role: { type: 'string' },
      },
      required: ['name', 'email', 'role'],
    },
    execute: async (params) => {
      return await mcpClient.call('bc_create_entity', {
        entity: 'User',
        data: params,
      });
    },
  },
];
```

### 3. Memory (Memoria)

Almacenamiento de información relevante:

```typescript
class AgentMemory {
  private shortTerm: Map<string, any> = new Map(); // Conversación actual
  private longTerm: CloudMD; // Memoria persistente

  async remember(key: string, value: any, persistent = false) {
    this.shortTerm.set(key, value);

    if (persistent) {
      await this.longTerm.save(key, value);
    }
  }

  async recall(key: string): Promise<any> {
    // Check short-term first
    if (this.shortTerm.has(key)) {
      return this.shortTerm.get(key);
    }

    // Check long-term
    return await this.longTerm.load(key);
  }
}
```

### 4. Planning (Planificación)

Capacidad de descomponer tareas complejas:

```typescript
class TaskPlanner {
  async createPlan(goal: string, context: Context): Promise<Plan> {
    const response = await llm.sendMessage(
      `
You are a task planner. Given a goal, break it down into concrete steps.

Goal: ${goal}
Context: ${JSON.stringify(context)}

Create a detailed plan with:
1. Steps (ordered list of actions)
2. Dependencies (which steps depend on others)
3. Tools needed for each step
4. Success criteria

Output as JSON.
      `,
      {}
    );

    return JSON.parse(response.content);
  }
}
```

## El Agentic Loop

El ciclo fundamental de un agente:

```typescript
class Agent {
  async run(goal: string): Promise<Result> {
    let context = this.initializeContext(goal);
    let maxIterations = 10;

    for (let i = 0; i < maxIterations; i++) {
      // 1. PERCIBIR: Analizar situación actual
      const situation = await this.perceive(context);

      // 2. PENSAR: Decidir próxima acción
      const decision = await this.think(situation);

      // 3. ACTUAR: Ejecutar acción
      const result = await this.act(decision);

      // 4. EVALUAR: ¿Se alcanzó el objetivo?
      const evaluation = await this.evaluate(result, goal);

      // 5. ACTUALIZAR: Actualizar contexto
      context = this.updateContext(context, result);

      // 6. CHECK: ¿Terminamos?
      if (evaluation.goalAchieved) {
        return {
          success: true,
          result: result,
          iterations: i + 1,
        };
      }

      if (evaluation.shouldStop) {
        return {
          success: false,
          reason: evaluation.stopReason,
          iterations: i + 1,
        };
      }
    }

    return {
      success: false,
      reason: 'Max iterations reached',
      iterations: maxIterations,
    };
  }

  private async perceive(context: Context): Promise<Situation> {
    // Analizar contexto actual
    return {
      currentState: context.state,
      availableTools: context.tools,
      constraints: context.constraints,
      history: context.history,
    };
  }

  private async think(situation: Situation): Promise<Decision> {
    // Usar LLM para decidir próxima acción
    const response = await this.llm.sendMessage(
      this.buildThinkingPrompt(situation),
      { tools: situation.availableTools }
    );

    return {
      action: response.action,
      reasoning: response.reasoning,
      toolCalls: response.toolCalls,
    };
  }

  private async act(decision: Decision): Promise<ActionResult> {
    // Ejecutar tool calls
    const results = await Promise.all(
      decision.toolCalls.map(call => this.executeTool(call))
    );

    return {
      toolResults: results,
      timestamp: new Date(),
    };
  }

  private async evaluate(
    result: ActionResult,
    goal: string
  ): Promise<Evaluation> {
    // Evaluar si se alcanzó el objetivo
    const response = await this.llm.sendMessage(`
Goal: ${goal}
Latest action result: ${JSON.stringify(result)}

Has the goal been achieved? Should we continue or stop?
Answer with: { goalAchieved: boolean, shouldStop: boolean, stopReason?: string }
    `);

    return JSON.parse(response.content);
  }
}
```

## Tipos de Agentes

### 1. Reactive Agents (Reactivos)

Responden directamente a estímulos sin planning complejo.

```typescript
class ReactiveAgent {
  async respond(input: string): Promise<string> {
    // Respuesta directa basada en reglas o LLM
    return await this.llm.sendMessage(input);
  }
}
```

**Ventajas**: Simple, rápido
**Desventajas**: No planifica, no maneja tareas complejas

### 2. Deliberative Agents (Deliberativos)

Planifican antes de actuar.

```typescript
class DeliberativeAgent {
  async respond(goal: string): Promise<Result> {
    // 1. Crear plan
    const plan = await this.createPlan(goal);

    // 2. Ejecutar plan
    for (const step of plan.steps) {
      await this.executeStep(step);
    }

    return { success: true };
  }
}
```

**Ventajas**: Maneja complejidad, optimiza
**Desventajas**: Más lento, requiere más recursos

### 3. Hybrid Agents (Híbridos)

Combinan reactividad y deliberación.

```typescript
class HybridAgent {
  async respond(input: string): Promise<Result> {
    // Para tareas simples: reactive
    if (this.isSimple(input)) {
      return await this.reactiveResponse(input);
    }

    // Para tareas complejas: deliberative
    return await this.deliberativeResponse(input);
  }
}
```

**BC-Claude-Agent usa este enfoque.**

## Autonomía del Agente

### Niveles de Autonomía

```typescript
enum AutonomyLevel {
  MANUAL = 'manual', // Usuario aprueba cada acción
  SEMI_AUTO = 'semi-auto', // Usuario aprueba acciones críticas
  AUTO = 'auto', // Agente decide todo
}

class Agent {
  private autonomyLevel: AutonomyLevel;

  async act(action: Action): Promise<Result> {
    if (this.requiresApproval(action)) {
      // Solicitar aprobación al usuario
      const approved = await this.requestApproval(action);
      if (!approved) {
        return { cancelled: true };
      }
    }

    return await this.executeAction(action);
  }

  private requiresApproval(action: Action): boolean {
    switch (this.autonomyLevel) {
      case AutonomyLevel.MANUAL:
        return true; // Siempre

      case AutonomyLevel.SEMI_AUTO:
        // Solo acciones de escritura o críticas
        return action.type === 'write' || action.critical;

      case AutonomyLevel.AUTO:
        return false; // Nunca
    }
  }
}
```

## Características Clave de Agentes Modernos

### 1. Tool Use (Uso de Herramientas)

```typescript
// Agente puede llamar múltiples tools en secuencia
const result = await agent.run('Create 5 users from this spreadsheet');

// Internamente:
// 1. call: read_file(spreadsheet.xlsx)
// 2. call: parse_csv(data)
// 3. call: bc_create_user(user1)
// 4. call: bc_create_user(user2)
// ... etc
```

### 2. Multi-step Reasoning (Razonamiento Multi-paso)

```typescript
// Agente puede razonar en múltiples pasos
const result = await agent.run('Analyze sales trends and suggest strategy');

// Internamente:
// Step 1: Entender qué datos necesito
// Step 2: Obtener datos de ventas (bc_query)
// Step 3: Analizar datos (thinking)
// Step 4: Identificar tendencias (thinking)
// Step 5: Generar recomendaciones (thinking)
// Step 6: Presentar resultados al usuario
```

### 3. Error Recovery (Recuperación de Errores)

```typescript
class ResilientAgent {
  async execute(action: Action): Promise<Result> {
    try {
      return await this.tryExecute(action);
    } catch (error) {
      // Agente puede analizar error y decidir qué hacer
      const recovery = await this.planRecovery(error, action);

      if (recovery.shouldRetry) {
        return await this.execute(recovery.modifiedAction);
      }

      if (recovery.shouldFallback) {
        return await this.execute(recovery.fallbackAction);
      }

      throw error;
    }
  }
}
```

### 4. Learning from Feedback

```typescript
class LearningAgent {
  async executeWithFeedback(action: Action): Promise<Result> {
    const result = await this.execute(action);

    // Solicitar feedback del usuario
    const feedback = await this.requestFeedback(result);

    // Almacenar en memoria para futuro
    await this.memory.remember(`action_${action.id}_feedback`, feedback, true);

    // Ajustar estrategia basado en feedback
    if (feedback.rating < 3) {
      await this.adjustStrategy(action, feedback);
    }

    return result;
  }
}
```

## BC-Claude-Agent Architecture

```
Usuario: "Crea 5 usuarios del Excel"
    ↓
Main Orchestrator Agent (Hybrid)
    ↓
    ├─→ Analiza intent (thinking)
    ├─→ Crea plan (deliberative)
    │   • Read Excel file
    │   • Parse data
    │   • Validate users
    │   • Request approval
    │   • Create users
    │
    ├─→ Delega a subagentes
    │   ├─→ File Reader Agent → read_file()
    │   ├─→ Validation Agent → validate()
    │   ├─→ Approval Agent → request_approval()
    │   └─→ BC Write Agent → bc_create_user() x5
    │
    └─→ Sintetiza resultado final
        "✅ 5 usuarios creados exitosamente"
```

## Próximos Pasos

- [LLM Enhancements](./02-llm-enhancements.md)
- [Fundamental Patterns](./03-fundamental-patterns.md)
- [Agent System](../03-agent-system/01-agentic-loop.md)

---

**Última actualización**: 2025-10-28
**Versión**: 1.0
