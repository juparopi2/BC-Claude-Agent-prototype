# PRD-040: Dynamic Handoffs with Command Pattern

**Estado**: Draft
**Prioridad**: Media
**Dependencias**: PRD-030 (Supervisor Integration)
**Bloquea**: Fase 5 (Graphing Agent)

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

- [ ] Agents can delegate via handoff tool
- [ ] Users can select different agent
- [ ] Command pattern routes correctly
- [ ] Handoff events emitted
- [ ] State preserved during handoffs
- [ ] `npm run verify:types` pasa sin errores

---

## 9. Archivos a Crear

- `backend/src/modules/agents/handoffs/handoff-tools.ts`
- `backend/src/modules/agents/handoffs/user-handoff.ts`
- `backend/src/modules/agents/handoffs/index.ts`
- `backend/src/__tests__/unit/agents/handoffs/handoff-tools.test.ts`

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
