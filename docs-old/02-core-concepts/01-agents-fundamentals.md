# Agent Fundamentals with Claude SDK

## ¿Qué es un Agente?

Un **agente de IA** es un sistema que:
1. **Percibe** su entorno
2. **Toma decisiones** basadas en objetivos
3. **Actúa** para alcanzar esos objetivos (usando tools)
4. **Aprende** de los resultados

**⚠️ IMPORTANTE**: Este documento ha sido actualizado para reflejar el uso del **Claude Agent SDK**, que ya implementa toda la infraestructura de agentes.

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

### 1. Brain (LLM) - Powered by Claude SDK

El "cerebro" del agente está incluido en el **Claude Agent SDK**:

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

// El SDK ya incluye el "cerebro" (Claude LLM)
const agent = query('Your task here', {
  model: 'claude-sonnet-4', // or 'claude-opus-4', 'claude-haiku-4'
  // SDK maneja toda la comunicación con Claude
});
```

**No necesitas construir un `ClaudeClient` wrapper.** El SDK lo provee.

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

El ciclo fundamental de un agente **está completamente implementado en el Claude Agent SDK**:

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

// El SDK ejecuta automáticamente el agentic loop:
// 1. PERCIBIR: Analiza la situación
// 2. PENSAR: Claude decide qué hacer
// 3. ACTUAR: Ejecuta tools automáticamente
// 4. EVALUAR: Claude decide si continuar o terminar
// 5. REPETIR: Loop automático hasta completar el goal

const result = query('Your goal here', {
  mcpServers: [{ type: 'sse', url: 'your-mcp-server', name: 'bc-mcp' }],
});

// El loop ocurre automáticamente mientras iteras sobre los events
for await (const event of result) {
  if (event.type === 'thinking') {
    console.log('Agent is thinking:', event.content);
  }

  if (event.type === 'tool_use') {
    console.log('Agent is using tool:', event.toolName);
  }

  if (event.type === 'message') {
    console.log('Agent completed:', event.content);
    // Loop terminó - goal alcanzado
  }
}
```

**No necesitas escribir el agentic loop.** El SDK lo maneja por ti.

Para más detalles, ver: [Agentic Loop with SDK](../03-agent-system/01-agentic-loop.md)

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

## BC-Claude-Agent Architecture (with SDK)

```
Usuario: "Crea 5 usuarios del Excel"
    ↓
Claude Agent SDK query()
    ↓
    ├─→ SDK analiza intent automáticamente
    ├─→ SDK crea plan automáticamente
    │   • Read Excel file (via MCP tool)
    │   • Parse data
    │   • Validate users
    │   • Request approval (via onPreToolUse hook)
    │   • Create users (via MCP tool)
    │
    ├─→ SDK ejecuta tools automáticamente
    │   ├─→ bc_read_file() - SDK calls MCP
    │   ├─→ onPreToolUse hook → pausa para approval
    │   └─→ bc_create_user() x5 - SDK calls MCP
    │
    └─→ SDK streamea resultado
        Event: { type: 'message', content: "✅ 5 usuarios creados" }
```

**Diferencia clave**: No construyes "Main Orchestrator" ni "Subagents" classes. El SDK lo hace todo automáticamente. Tú solo configuras los hooks y system prompts.

## Comparison: Building from Scratch vs Using SDK

| Concept | From Scratch | With Claude Agent SDK |
|---------|-------------|----------------------|
| **Agentic Loop** | Write 200+ LOC | ✅ Built-in |
| **Tool Calling** | Manual implementation | ✅ Automatic |
| **LLM Communication** | Anthropic SDK wrapper | ✅ Built-in |
| **Session Management** | Custom tracking | ✅ Built-in (`resume`) |
| **Streaming** | Custom logic | ✅ Async generators |
| **Memory** | Custom classes | ✅ Built-in (+ custom if needed) |
| **Orchestration** | Custom MainOrchestrator | ✅ System prompts + delegation |
| **Development Time** | 2-3 weeks | 2-3 days |

## Key Takeaway

**Don't build agent infrastructure from scratch.** Use the Claude Agent SDK and focus on:

1. ✅ **Business logic** - BC-specific validation, approvals, workflows
2. ✅ **UI/UX** - Frontend components for chat, approvals, todos
3. ✅ **Integration** - Connecting SDK with your MCP server and database
4. ✅ **Configuration** - System prompts, hooks, tool restrictions

The SDK provides the **infrastructure**. You provide the **business value**.

## Próximos Pasos

- **[Agent SDK Usage Guide](./06-agent-sdk-usage.md)** - **START HERE**
- [LLM Enhancements](./02-llm-enhancements.md)
- [Agentic Loop with SDK](../03-agent-system/01-agentic-loop.md)
- [Orchestration with SDK](../03-agent-system/02-orchestration.md)

---

**Última actualización**: 2025-10-30
**Versión**: 2.0 (Actualizado para Claude Agent SDK)
