# PRD-040: Dynamic Handoffs with Command Pattern

**Estado**: ✅ COMPLETADO (2026-02-09)
**Prioridad**: Media
**Dependencias**: PRD-030 (Supervisor Integration), PRD-011 (Agent Registry), PRD-020 (Extended State)
**Bloquea**: Fase 5 (Graphing Agent), PRD-060 (Agent Selector UI)

---

## 1. Objetivo

Implementar handoffs dinámicos entre agentes usando el `Command` pattern nativo de LangGraph:
- Agentes pueden delegar a otros agentes durante ejecución
- Re-routing basado en resultados parciales
- User-initiated agent switching

---

## 2. Command Pattern

LangGraph provee `Command` para control de flujo dinámico:

```typescript
import { Command } from "@langchain/langgraph";

// Dentro de cualquier nodo del grafo
return new Command({
  goto: "target-agent-id",  // Destino
  update: {                  // Estado a pasar
    messages: state.messages,
    context: extractedContext,
  },
});
```

---

## 3. Tipos de Handoffs

| Tipo | Iniciador | Mecanismo |
|------|-----------|-----------|
| **Supervisor Routing** | Supervisor | `createSupervisor()` automático |
| **Agent-to-Agent** | Agente | `Command(goto=...)` |
| **User Selection** | Usuario | Update state + route |

---

## 4. Implementación

### 4.1 Estructura de Archivos

```
backend/src/modules/agents/handoffs/
├── handoff-tools.ts        # Handoff tool for agents
├── user-handoff.ts         # User-initiated handoffs
└── index.ts
```

### 4.2 Handoff Tool para Agentes

```typescript
// handoff-tools.ts
import { Command } from "@langchain/langgraph";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getAgentRegistry } from "@/modules/agents/core/registry";

/**
 * Create a handoff tool that allows agents to delegate to other agents
 */
export function createHandoffTool() {
  return tool(
    async ({ targetAgent, reason, context }) => {
      const registry = getAgentRegistry();

      // Validate target agent exists
      if (!registry.has(targetAgent)) {
        return `Cannot handoff: agent '${targetAgent}' not found`;
      }

      const agent = registry.get(targetAgent)!;
      if (agent.isSystemAgent) {
        return `Cannot handoff to system agent '${targetAgent}'`;
      }

      // Return Command to route to target agent
      return new Command({
        goto: targetAgent,
        update: {
          handoffReason: reason,
          handoffContext: context,
        },
      });
    },
    {
      name: "transfer_to_agent",
      description: `Transfer the conversation to another specialized agent.
Use this when:
- The current request is better handled by a different specialist
- You need capabilities you don't have
- The user explicitly asks for a different agent

Available agents:
${getAgentRegistry().getWorkerAgents().map(a =>
  `- ${a.id}: ${a.description}`
).join("\n")}`,
      schema: z.object({
        targetAgent: z.string().describe("ID of the agent to transfer to"),
        reason: z.string().describe("Brief explanation of why transferring"),
        context: z.string().optional().describe("Additional context for target agent"),
      }),
    }
  );
}
```

### 4.3 Agents con Handoff Capability

```typescript
// Añadir handoff tool a agentes
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { createHandoffTool } from "@/modules/agents/handoffs";

const bcAgent = createReactAgent({
  llm: model,
  tools: [
    ...bcTools,
    createHandoffTool(), // Permite delegar a otros agentes
  ],
  name: "bc-agent",
  prompt: bcSystemPrompt,
});
```

### 4.4 User-Initiated Handoffs

```typescript
// user-handoff.ts
import { getAgentRegistry } from "@/modules/agents/core/registry";
import { ExtendedAgentState } from "@/modules/agents/orchestrator/state";

/**
 * Handle user selection of a different agent
 */
export function processUserAgentSelection(
  targetAgentId: string,
  currentState: ExtendedAgentState
): Partial<ExtendedAgentState> {
  const registry = getAgentRegistry();
  const targetAgent = registry.get(targetAgentId);

  if (!targetAgent) {
    throw new Error(`Unknown agent: ${targetAgentId}`);
  }

  if (!targetAgent.isUserSelectable) {
    throw new Error(`Agent ${targetAgentId} is not user-selectable`);
  }

  return {
    currentAgentIdentity: {
      agentId: targetAgent.id,
      agentName: targetAgent.name,
      agentIcon: targetAgent.icon,
      agentColor: targetAgent.color,
    },
  };
}
```

### 4.5 WebSocket Handler

```typescript
// In ChatMessageHandler.ts
import { processUserAgentSelection } from "@/modules/agents/handoffs";

socket.on("select_agent", async ({ sessionId, agentId }) => {
  try {
    // Validate user owns session
    await validateSessionOwnership(socket.userId, sessionId);

    // Process agent selection
    const stateUpdate = processUserAgentSelection(agentId, currentState);

    // Update state and emit confirmation
    await graph.updateState(
      { configurable: { thread_id: sessionId } },
      stateUpdate
    );

    socket.emit("agent_changed", {
      sessionId,
      currentAgent: stateUpdate.currentAgentIdentity,
    });
  } catch (error) {
    socket.emit("error", { message: error.message });
  }
});
```

---

## 5. Swarm Pattern (Optional)

Para agentes que se comunican directamente entre sí sin supervisor:

```typescript
import { createSwarm } from "@langchain/langgraph/prebuilt";

// Cada agente tiene herramientas para handoff
const bcAgent = createReactAgent({
  llm: model,
  tools: [...bcTools, createHandoffTool()],
  name: "bc-agent",
});

const ragAgent = createReactAgent({
  llm: model,
  tools: [...ragTools, createHandoffTool()],
  name: "rag-agent",
});

// Swarm permite comunicación peer-to-peer
const swarm = createSwarm({
  agents: [bcAgent, ragAgent],
  defaultActiveAgent: "bc-agent",
});

const graph = swarm.compile({ checkpointer });
```

---

## 6. Events

### 6.1 Agent Handoff Event

```typescript
// Emitido cuando ocurre un handoff
interface AgentHandoffEvent {
  type: "agent_handoff";
  sessionId: string;
  eventId: string;
  timestamp: string;
  fromAgent: AgentIdentity;
  toAgent: AgentIdentity;
  reason?: string;
}
```

### 6.2 Emitting Handoff Events

```typescript
// Via LangSmith callbacks
callbacks: [{
  handleChainEnd: (outputs, runId, parentRunId, tags) => {
    // Check if output is a Command
    if (outputs?.goto) {
      emitHandoffEvent({
        fromAgent: currentAgentIdentity,
        toAgent: getAgentIdentity(outputs.goto),
        reason: outputs.update?.handoffReason,
      });
    }
  },
}]
```

---

## 7. Tests Requeridos

```typescript
describe("createHandoffTool", () => {
  it("returns Command with correct target");
  it("validates target agent exists");
  it("rejects handoff to system agents");
  it("includes reason and context in Command");
});

describe("processUserAgentSelection", () => {
  it("returns updated agent identity");
  it("throws for unknown agent");
  it("throws for non-selectable agent");
});
```

---

## 8. Criterios de Aceptación

- [x] Agents can delegate via handoff tool (`createAgentHandoffTool` + `Command.PARENT`)
- [x] Users can select different agent (WebSocket `agent:select` handler)
- [x] Command pattern routes correctly (`transfer_to_*` tools with `Command.PARENT`)
- [x] Handoff events emitted (`agent_changed` with `handoffType` discriminator)
- [x] State preserved during handoffs (`addHandoffBackMessages: true`)
- [x] `npm run verify:types` pasa sin errores
- [x] `npm run -w backend test:unit` pasa (3036 tests, 0 failures)
- [x] `npm run -w backend lint` pasa (0 errors)

---

## 9. Archivos Creados/Modificados

### Archivos Nuevos (7)
| Archivo | Propósito |
|---------|-----------|
| `backend/src/modules/agents/handoffs/handoff-tools.ts` | `createAgentHandoffTool()` factory con `Command.PARENT` + `getCurrentTaskInput()` |
| `backend/src/modules/agents/handoffs/handoff-tool-builder.ts` | `buildHandoffToolsForAgent()` - genera N-1 tools por worker agent |
| `backend/src/modules/agents/handoffs/user-handoff.ts` | `processUserAgentSelection()` - validación de selección por usuario |
| `backend/src/modules/agents/handoffs/index.ts` | Barrel exports |
| `backend/src/__tests__/unit/agents/handoffs/handoff-tools.test.ts` | 4 tests unitarios |
| `backend/src/__tests__/unit/agents/handoffs/handoff-tool-builder.test.ts` | 6 tests unitarios |
| `backend/src/__tests__/unit/agents/handoffs/user-handoff.test.ts` | 5 tests unitarios |

### Archivos Modificados (8)
| Archivo | Cambio |
|---------|--------|
| `packages/shared/src/types/agent.types.ts` | `HandoffType`, `AgentChangedEvent` extendido |
| `packages/shared/src/types/websocket.types.ts` | `AgentSelectData`, `agent:select` event |
| `packages/shared/src/schemas/agent-identity.schema.ts` | `handoffType` y `reason` en schema |
| `backend/src/modules/agents/supervisor/agent-builders.ts` | Inyección de handoff tools |
| `backend/src/modules/agents/supervisor/supervisor-graph.ts` | `addHandoffBackMessages: true` |
| `backend/src/modules/agents/supervisor/result-adapter.ts` | `detectHandoffs()` function |
| `backend/src/services/websocket/ChatMessageHandler.ts` | Case `agent_changed` explícito |
| `backend/src/server.ts` | `agent:select` socket handler |

### Migración Prisma (1)
| Archivo | Cambio |
|---------|--------|
| `backend/src/shared/utils/session-ownership.ts` | `executeQuery` → `prisma.sessions.findUnique()` |

### Tests Actualizados (3)
| Archivo | Cambio |
|---------|--------|
| `backend/src/__tests__/unit/session-ownership.test.ts` | Mock migrado a Prisma |
| `backend/src/__tests__/unit/utils/session-ownership.security.test.ts` | Mock migrado a Prisma |
| `backend/src/__tests__/unit/agents/supervisor/agent-builders.test.ts` | Test PRD-040 handoff tools |

---

## 10. Estimación

- **Desarrollo**: 2-3 días
- **Testing**: 1-2 días
- **Integration**: 1 día
- **Total**: 4-6 días

---

## 11. Changelog

| Fecha | Versión | Cambios |
|-------|---------|---------|
| 2026-02-02 | 1.0 | Initial draft with Command pattern |
| 2026-02-09 | 2.0 | **COMPLETADO**. Implementación final difiere del draft en diseño de handoff tools: se usa patrón oficial LangGraph (`getCurrentTaskInput()` + `Command.PARENT` + `ToolMessage`) en lugar de `transfer_to_agent` genérico con schema de args. Cada agente recibe tools `transfer_to_<target>` pre-built (target baked-in, no args para el LLM). Se agregó `handoff-tool-builder.ts` para construir tools per-agent desde el registry. `addHandoffBackMessages: true` para historial explícito. `detectHandoffs()` en result-adapter. WebSocket `agent:select` con ownership validation. `session-ownership.ts` migrado a Prisma. `HandoffType` discriminator en `@bc-agent/shared`. 16 tests nuevos, 3036 tests totales pasando. |
