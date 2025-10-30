# Agentic Loop Pattern with Claude Agent SDK

## Overview

El **agentic loop** es el patrón fundamental de los agentes de IA: un ciclo continuo de **percibir → pensar → actuar → evaluar** que se repite hasta alcanzar el objetivo.

**⚠️ IMPORTANTE**: Con el Claude Agent SDK, **NO necesitas implementar el agentic loop manualmente**. El SDK ya lo provee.

Este documento explica:
1. Cómo funciona el agentic loop conceptualmente
2. Cómo el SDK lo implementa automáticamente
3. Cómo personalizarlo para Business Central

---

## El Ciclo Fundamental

```
┌─────────────────────────────────────────┐
│         HUMAN IN THE LOOP               │
│              (Usuario)                  │
└──────────┬────────────────────▲─────────┘
           │ Input/Goal         │ Results
           │                    │
┌──────────▼────────────────────┴─────────┐
│                                          │
│     AGENTIC LOOP (SDK Automático)       │
│                                          │
│  ┌─────────────────────────────────┐    │
│  │  1. CONTEXTO                    │    │
│  │  • Analizar situación actual    │    │
│  │  • Recuperar memoria relevante  │    │
│  │  • Identificar constraints      │    │
│  └───────────────┬─────────────────┘    │
│                  │                       │
│  ┌───────────────▼─────────────────┐    │
│  │  2. ACCIÓN                      │    │
│  │  • Decidir próximo paso         │    │
│  │  • Seleccionar herramientas     │    │
│  │  • Ejecutar (SDK auto)          │    │
│  └───────────────┬─────────────────┘    │
│                  │                       │
│  ┌───────────────▼─────────────────┐    │
│  │  3. VERIFICACIÓN                │    │
│  │  • Evaluar resultado            │    │
│  │  • Comparar con objetivo        │    │
│  │  • Detectar errores             │    │
│  └───────────────┬─────────────────┘    │
│                  │                       │
│  ┌───────────────▼─────────────────┐    │
│  │  4. DECISIÓN                    │    │
│  │  ✓ ¿Objetivo alcanzado? → FIN   │    │
│  │  ✓ ¿Error crítico? → STOP       │    │
│  │  ✓ ¿Continuar? → REPETIR        │    │
│  └──────────────────────────────────┘   │
│           │                              │
│           └──────────┐                   │
│                      │                   │
└──────────────────────┼───────────────────┘
                       │ Loop
                       └──────┐
```

---

## Con Claude Agent SDK

### ❌ Antes (Custom Implementation)

```typescript
// OBSOLETO - No uses este approach
class AgenticLoop {
  private maxIterations: number = 20;
  private context: Context;
  private memory: Memory;

  async run(goal: string): Promise<Result> {
    this.context = await this.initialize(goal);
    let iteration = 0;

    while (iteration < this.maxIterations) {
      // 1. CONTEXTO: Analizar situación
      const situation = await this.analyzeSituation(this.context);

      // 2. ACCIÓN: Decidir y ejecutar
      const action = await this.decideAction(situation);
      const actionResult = await this.executeAction(action);

      // 3. VERIFICACIÓN: Evaluar resultado
      const verification = await this.verify(actionResult, goal);

      // 4. DECISIÓN: ¿Qué hacer?
      if (verification.goalAchieved) {
        return { success: true, result: actionResult };
      }

      if (verification.shouldStop) {
        return { success: false, reason: verification.stopReason };
      }

      this.context = this.updateContext(this.context, actionResult);
      iteration++;
    }

    return { success: false, reason: 'Max iterations reached' };
  }
}
```

**Líneas de código**: ~200-300 LOC
**Tiempo de implementación**: 2-3 días
**Bugs potenciales**: Alto

---

### ✅ Ahora (Con SDK)

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

async function runAgent(goal: string) {
  const result = query(goal, {
    // El agentic loop está aquí, automático
    mcpServers: [{ type: 'sse', url: process.env.MCP_SERVER_URL, name: 'bc-mcp' }],
  });

  for await (const event of result) {
    // Recibir eventos del loop automático
    console.log(event);
  }
}
```

**Líneas de código**: ~10 LOC
**Tiempo de implementación**: 10 minutos
**Bugs potenciales**: Mínimo (probado por Anthropic)

---

## Cómo Funciona el SDK Internamente

El SDK ejecuta automáticamente este ciclo:

```typescript
// Pseudocódigo de lo que el SDK hace internamente
async function* query(prompt, options) {
  let context = initializeContext(prompt, options);
  let iteration = 0;

  while (iteration < MAX_ITERATIONS) {
    // 1. CONTEXTO: Construir prompt con contexto actual
    const fullPrompt = buildPromptWithContext(context);

    // 2. ACCIÓN: Claude decide qué hacer
    const response = await claude.messages.create({
      model: options.model || 'claude-sonnet-4',
      messages: context.messages,
      tools: getAvailableTools(options.mcpServers),
      system: options.systemPrompt || claudeCodePrompt,
    });

    // Si Claude usa tools
    if (response.stop_reason === 'tool_use') {
      for (const toolUse of response.content.filter(c => c.type === 'tool_use')) {
        // Hook: onPreToolUse
        if (options.onPreToolUse) {
          const allowed = await options.onPreToolUse(toolUse.name, toolUse.input);
          if (!allowed) continue;
        }

        yield { type: 'tool_use', toolName: toolUse.name, args: toolUse.input };

        // Ejecutar tool
        const result = await executeTool(toolUse.name, toolUse.input, options.mcpServers);

        yield { type: 'tool_result', toolName: toolUse.name, result };

        // Hook: onPostToolUse
        if (options.onPostToolUse) {
          await options.onPostToolUse(toolUse.name, result);
        }

        // Agregar result al context
        context.messages.push({
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(result) }],
        });
      }

      // 3. VERIFICACIÓN: Claude evalúa si continuar
      // (automático: Claude decide si llamar más tools o dar respuesta final)

      // 4. DECISIÓN: Continuar loop
      iteration++;
      continue;
    }

    // Si Claude da respuesta final (stop_reason === 'end_turn')
    yield { type: 'message', content: response.content };

    break; // Objetivo alcanzado
  }

  if (iteration >= MAX_ITERATIONS) {
    yield { type: 'error', error: new Error('Max iterations reached') };
  }
}
```

**No necesitas escribir esto. El SDK lo hace por ti.**

---

## Personalización para Business Central

### 1. Human-in-the-Loop Integration

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

async function runWithApprovals(goal: string, sessionId: string, socket: Socket) {
  const result = query(goal, {
    mcpServers: [bcMcpServer],
    resume: sessionId,

    // Hook en el loop: ANTES de ejecutar tool
    onPreToolUse: async (toolName, args) => {
      // Acciones críticas requieren aprobación
      if (isCriticalAction(toolName)) {
        socket.emit('approval:requested', {
          toolName,
          args,
          timestamp: new Date(),
        });

        // PAUSAR EL LOOP y esperar decisión del usuario
        return new Promise((resolve) => {
          socket.once('approval:response', (response) => {
            resolve(response.approved); // true = continuar loop, false = stop
          });
        });
      }

      return true; // Continuar loop
    },
  });

  for await (const event of result) {
    socket.emit('agent:event', event);
  }
}

function isCriticalAction(toolName: string): boolean {
  return (
    toolName.startsWith('bc_create') ||
    toolName.startsWith('bc_update') ||
    toolName.startsWith('bc_delete') ||
    toolName.includes('payment')
  );
}
```

### 2. To-Do List Automático

```typescript
class TodoManager {
  private todos: Map<string, Todo[]> = new Map();

  async initializeFromGoal(sessionId: string, goal: string) {
    // Generar plan inicial como todos
    const planResult = query(
      `Break down into steps:\n${goal}\n\nReturn JSON: { steps: string[] }`,
      { permissionMode: 'plan' }
    );

    for await (const event of planResult) {
      if (event.type === 'message') {
        const plan = JSON.parse(event.content);
        this.todos.set(
          sessionId,
          plan.steps.map((step: string) => ({
            description: step,
            status: 'pending',
          }))
        );
      }
    }
  }

  updateForToolUse(sessionId: string, toolName: string) {
    const todos = this.todos.get(sessionId);
    if (!todos) return;

    // Encontrar todo correspondiente y marcar como in_progress
    const todo = todos.find((t) => t.status === 'pending');
    if (todo) {
      todo.status = 'in_progress';
      this.emit('todos:updated', todos);
    }
  }

  completeCurrentTodo(sessionId: string) {
    const todos = this.todos.get(sessionId);
    if (!todos) return;

    const todo = todos.find((t) => t.status === 'in_progress');
    if (todo) {
      todo.status = 'completed';
      this.emit('todos:updated', todos);
    }
  }
}

// Integración con el loop
async function runWithTodos(goal: string, sessionId: string, socket: Socket) {
  const todoManager = new TodoManager();

  // 1. Generar todos iniciales
  await todoManager.initializeFromGoal(sessionId, goal);

  // 2. Ejecutar loop con tracking
  const result = query(goal, {
    resume: sessionId,

    onPreToolUse: async (toolName, args) => {
      // Marcar todo como in_progress
      todoManager.updateForToolUse(sessionId, toolName);
      return true;
    },

    onPostToolUse: async (toolName, result) => {
      // Marcar todo como completed
      todoManager.completeCurrentTodo(sessionId);
    },
  });

  for await (const event of result) {
    socket.emit('agent:event', event);

    // Sync todos to UI
    todoManager.on('todos:updated', (todos) => {
      socket.emit('todos:updated', todos);
    });
  }
}
```

### 3. Error Recovery

```typescript
async function runWithRecovery(goal: string, sessionId: string) {
  let attempt = 0;
  const MAX_RETRIES = 3;

  while (attempt < MAX_RETRIES) {
    try {
      const result = query(goal, {
        resume: sessionId,

        onPostToolUse: async (toolName, result) => {
          // Verificar si hubo error
          if (result.error) {
            logger.error(`Tool ${toolName} failed:`, result.error);

            // El SDK intentará recovery automático
            // Pero podemos agregar lógica custom
            if (result.error.includes('rate_limit')) {
              await sleep(5000); // Esperar antes de retry
            }
          }
        },
      });

      for await (const event of result) {
        if (event.type === 'error') {
          throw event.error;
        }

        // Handle normal events
      }

      break; // Éxito, salir del loop de retries
    } catch (error) {
      attempt++;
      logger.warn(`Attempt ${attempt} failed:`, error);

      if (attempt >= MAX_RETRIES) {
        logger.error('Max retries reached');
        throw error;
      }

      await sleep(1000 * attempt); // Exponential backoff
    }
  }
}
```

### 4. Stopping Conditions

```typescript
interface StoppingConditions {
  maxIterations?: number;
  maxTime?: number; // milliseconds
  maxCost?: number; // dollars
  errorThreshold?: number;
}

async function runWithLimits(
  goal: string,
  sessionId: string,
  conditions: StoppingConditions
) {
  const stats = {
    iterations: 0,
    startTime: Date.now(),
    cost: 0,
    consecutiveErrors: 0,
  };

  const result = query(goal, {
    resume: sessionId,

    onPreToolUse: async (toolName, args) => {
      stats.iterations++;

      // Check stopping conditions
      if (conditions.maxIterations && stats.iterations >= conditions.maxIterations) {
        throw new Error('Max iterations reached');
      }

      if (conditions.maxTime && Date.now() - stats.startTime >= conditions.maxTime) {
        throw new Error('Max time exceeded');
      }

      if (conditions.maxCost && stats.cost >= conditions.maxCost) {
        throw new Error('Max cost exceeded');
      }

      return true;
    },

    onPostToolUse: async (toolName, result) => {
      // Update cost (estimate based on tokens)
      stats.cost += estimateCost(result);

      // Track errors
      if (result.error) {
        stats.consecutiveErrors++;

        if (
          conditions.errorThreshold &&
          stats.consecutiveErrors >= conditions.errorThreshold
        ) {
          throw new Error('Error threshold exceeded');
        }
      } else {
        stats.consecutiveErrors = 0; // Reset on success
      }
    },
  });

  for await (const event of result) {
    // Handle events
  }

  return stats;
}
```

---

## Streaming del Loop

El SDK streamea eventos del loop en tiempo real:

```typescript
async function streamLoopToUI(goal: string, socket: Socket) {
  const result = query(goal, {
    mcpServers: [bcMcpServer],
    includePartialMessages: true, // Stream partial messages

    onPreToolUse: async (toolName, args) => {
      // Usuario ve: "Calling bc_query_entity..."
      socket.emit('agent:thinking', {
        message: `Calling ${toolName}...`,
        args,
      });
      return true;
    },
  });

  for await (const event of result) {
    switch (event.type) {
      case 'thinking':
        // Claude está pensando (extended thinking mode)
        socket.emit('agent:thinking', { content: event.content });
        break;

      case 'message_partial':
        // Streaming de mensaje parcial
        socket.emit('agent:message_chunk', { content: event.content });
        break;

      case 'message':
        // Mensaje completo
        socket.emit('agent:message_complete', { content: event.content });
        break;

      case 'tool_use':
        // Tool siendo llamado
        socket.emit('agent:tool_use', {
          tool: event.toolName,
          args: event.args,
        });
        break;

      case 'tool_result':
        // Resultado de tool
        socket.emit('agent:tool_result', {
          tool: event.toolName,
          result: event.result,
        });
        break;
    }
  }
}
```

---

## Persistence del Loop State

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

// El SDK maneja session state automáticamente
async function persistentAgent(userMessage: string, sessionId: string | null) {
  // Primera conversación: sessionId = null
  // El SDK crea un nuevo sessionId
  const result = query(userMessage, {
    resume: sessionId, // null = new session, string = resume
  });

  let newSessionId: string | null = null;

  for await (const event of result) {
    if (event.type === 'session_start') {
      newSessionId = event.sessionId;

      // Guardar en database
      await db.sessions.create({
        id: newSessionId,
        user_id: userId,
        started_at: new Date(),
      });
    }

    // Handle other events
  }

  return newSessionId; // Return para próximas conversaciones
}

// Uso:
let sessionId = null;

// Primera interacción
sessionId = await persistentAgent('Create a customer named Acme', sessionId);

// Segunda interacción (mismo context)
sessionId = await persistentAgent('Update its email to new@acme.com', sessionId);

// Tercera interacción (Claude recuerda todo)
sessionId = await persistentAgent('Delete that customer', sessionId);
```

---

## Performance Optimization

### Prompt Caching

```typescript
const result = query(goal, {
  promptCaching: true, // Enable caching
  systemPrompt: 'claudeCode', // Cached prompt
  mcpServers: [bcMcpServer], // Cached tool definitions
});
```

Esto cachea:
- System prompt
- Tool definitions
- MCP schemas

Reduce:
- Latencia: ~50%
- Costos: ~90% (tokens cached)

---

## Comparación: Custom vs SDK

| Aspecto | Custom Agentic Loop | SDK Agentic Loop |
|---------|---------------------|------------------|
| **LOC** | 200-300 | 10-20 |
| **Tiempo implementación** | 2-3 días | 10 minutos |
| **Tool calling** | Manual | Automático |
| **Streaming** | Custom logic | Built-in |
| **Error handling** | Custom | Built-in retry |
| **Session management** | Custom | Built-in |
| **Prompt caching** | Manual | Built-in |
| **Thinking mode** | No | Sí (extended thinking) |
| **Testing** | Tu responsabilidad | Probado por Anthropic |
| **Bugs** | Alto riesgo | Bajo riesgo |
| **Maintenance** | Tu responsabilidad | Anthropic mantiene |

---

## Lo que SÍ debes construir

El SDK provee el loop, pero **todavía necesitas**:

1. **Approval System** - Lógica de aprobaciones específica de BC
2. **Todo Manager** - Generación y tracking de todos
3. **BC Validation** - Validaciones de negocio de Business Central
4. **UI** - Frontend React para chat, approvals, todos
5. **Database** - Persistir sessions, messages, approvals en PostgreSQL/SQL

---

## Próximos Pasos

- [Agent SDK Usage Guide](../../02-core-concepts/06-agent-sdk-usage.md) - Guía completa del SDK
- [Orchestration with SDK](./02-orchestration.md) - Patrones de orquestación
- [Agent SDK Backend Integration](../../11-backend/07-agent-sdk-integration.md) - Integración en Express

---

**Última actualización**: 2025-10-30
**Versión**: 2.0 (Actualizado para Claude Agent SDK)
