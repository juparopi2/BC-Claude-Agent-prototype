# PRD-030: Supervisor Integration with createSupervisor()

**Estado**: ✅ COMPLETADO (2026-02-06)
**Prioridad**: Alta
**Dependencias**: PRD-020 (Extended State), PRD-011 (Agent Registry)
**Bloquea**: PRD-032 (Persistence), Fase 4 (Handoffs)

---

## 1. Objetivo

Implementar orquestación multi-agente usando `createSupervisor()` nativo de LangGraph:
- Routing automático basado en LLM (no keywords)
- Coordinación de múltiples agentes especializados
- Plan generation y execution manejados internamente
- Integración con checkpointer para persistencia

### Pre-requisitos de instalación

> **IMPORTANTE** (descubierto durante PRD-011): `createSupervisor` NO está en `@langchain/langgraph/prebuilt`.
> Es un paquete separado que debe instalarse:
>
> ```bash
> npm install @langchain/langgraph-supervisor
> ```
>
> El import correcto es:
> ```typescript
> import { createSupervisor } from "@langchain/langgraph-supervisor";
> ```
>
> `createReactAgent` sí está en `@langchain/langgraph/prebuilt` (correcto como estaba).

### Integración con Agent Registry (PRD-011)

El Agent Registry ya está implementado y disponible. Este PRD debe consumirlo:
- `registry.getWorkerAgents()` → agentes para crear con `createReactAgent()`
- `registry.getToolsForAgent(agentId, userId)` → tools resueltos (estáticos + factory)
- `registry.buildSupervisorAgentList()` → prompt formateado para el supervisor
- `registry.getAgentsForSupervisor()` → `{ name, description }[]` para configuración

---

## 2. Arquitectura

```
User Query
    │
    ▼
┌─────────────────────────────────┐
│   createSupervisor()            │
│   ┌─────────────────────────┐   │
│   │  Router LLM (Haiku)     │   │
│   │  - Analyzes query       │   │
│   │  - Selects agent        │   │
│   │  - Coordinates flow     │   │
│   └───────────┬─────────────┘   │
└───────────────┼─────────────────┘
       ┌────────┼────────┐
       ▼        ▼        ▼
┌──────────┐ ┌──────────┐ ┌──────────┐
│ BC Agent │ │RAG Agent │ │Graph     │
│          │ │          │ │Agent     │
└──────────┘ └──────────┘ └──────────┘
       └────────┼────────┘
                ▼
         Final Response
```

---

## 3. Implementación

### 3.1 Estructura de Archivos

```
backend/src/modules/agents/supervisor/
├── supervisor-graph.ts      # Main supervisor setup
├── supervisor-prompt.ts     # System prompt for routing
├── agent-builders.ts        # Build react agents from registry
└── index.ts
```

### 3.2 Supervisor Graph

```typescript
// supervisor-graph.ts
import { createSupervisor } from "@langchain/langgraph-supervisor";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { getAgentRegistry } from "@/modules/agents/core/registry";
import { ModelFactory } from "@/shared/models/ModelFactory";
import { getSupervisorPrompt } from "./supervisor-prompt";
import { ExtendedAgentStateAnnotation } from "../orchestrator/state";

/**
 * Build the multi-agent supervisor graph
 */
export async function buildSupervisorGraph() {
  const registry = getAgentRegistry();

  // Build react agents from registry
  const agents = await buildAgentsFromRegistry();

  // Get router model (fast, cheap)
  const routerModel = await ModelFactory.create("router");

  // Build supervisor prompt with available agents
  const agentList = registry.buildSupervisorAgentList();
  const supervisorPrompt = getSupervisorPrompt(agentList);

  // Create supervisor
  const supervisor = createSupervisor({
    agents,
    model: routerModel,
    prompt: supervisorPrompt,
    // Use our extended state schema
    stateSchema: ExtendedAgentStateAnnotation,
  });

  return supervisor;
}

/**
 * Compile supervisor with checkpointer for production
 */
export async function compileSupervisorGraph() {
  const supervisor = await buildSupervisorGraph();

  // Use PostgresSaver for production persistence
  const checkpointer = PostgresSaver.fromConnString(
    process.env.DATABASE_URL!
  );

  const graph = supervisor.compile({
    checkpointer,
    // Interrupt before sensitive operations (optional)
    // interruptBefore: ["bc-agent"],
  });

  return graph;
}

/**
 * Build react agents from registry definitions
 */
async function buildAgentsFromRegistry() {
  const registry = getAgentRegistry();
  const agents = [];

  for (const agentDef of registry.getWorkerAgents()) {
    const agentWithTools = registry.getWithTools(agentDef.id);
    if (!agentWithTools) {
      console.warn(`Agent ${agentDef.id} has no tools registered, skipping`);
      continue;
    }

    const model = await ModelFactory.create(agentDef.modelRole);

    const agent = createReactAgent({
      llm: model,
      tools: agentWithTools.tools,
      name: agentDef.id,
      prompt: agentDef.systemPrompt,
    });

    agents.push(agent);
  }

  return agents;
}
```

### 3.3 Supervisor Prompt

```typescript
// supervisor-prompt.ts

/**
 * Build supervisor system prompt with available agents
 */
export function getSupervisorPrompt(agentList: string): string {
  return `You are a supervisor managing specialized AI agents. Your job is to route user requests to the most appropriate agent.

## Available Agents

${agentList}

## Routing Guidelines

1. **Analyze the request**: Understand what the user is asking for
2. **Match to capabilities**: Choose the agent whose capabilities best match the request
3. **Handle ambiguity**: If unclear, prefer the more specialized agent
4. **Coordinate multi-step**: For complex requests, you may call multiple agents in sequence

## Examples

- "Show me customer ABC" → Route to bc-agent (ERP query)
- "What does the contract say about payment terms?" → Route to rag-agent (document search)
- "Create a chart of monthly sales" → Route to graph-agent (visualization)
- "Compare our top customers" → May need bc-agent then graph-agent

## Response Format

Respond with which agent should handle the request and why. The system will route automatically.

Remember: You coordinate, the agents execute. Don't try to answer questions directly - delegate to the appropriate specialist.`;
}
```

### 3.4 Usage in Application

```typescript
// In WebSocket handler or API route
import { compileSupervisorGraph } from "@/modules/agents/supervisor";
import { HumanMessage } from "@langchain/core/messages";

// Initialize once at startup
let supervisorGraph: Awaited<ReturnType<typeof compileSupervisorGraph>>;

export async function initializeSupervisor() {
  supervisorGraph = await compileSupervisorGraph();
  console.log("Supervisor graph initialized");
}

// Handle user message
export async function handleUserMessage(
  sessionId: string,
  userId: string,
  message: string
) {
  const result = await supervisorGraph.invoke(
    {
      messages: [new HumanMessage(message)],
      context: { userId, sessionId },
    },
    {
      configurable: {
        thread_id: sessionId, // Persistence key
      },
    }
  );

  return result;
}
```

---

## 4. Human-in-the-Loop con interrupt()

Para operaciones que requieren aprobación humana:

```typescript
import { interrupt } from "@langchain/langgraph";

// En el agente que maneja operaciones sensibles
const bcAgentWithApproval = createReactAgent({
  llm: model,
  tools: bcTools.map(tool => {
    // Wrap sensitive tools with interrupt
    if (tool.name.includes("create") || tool.name.includes("update")) {
      return wrapWithApproval(tool);
    }
    return tool;
  }),
  name: "bc-agent",
  prompt: bcSystemPrompt,
});

function wrapWithApproval(tool) {
  return {
    ...tool,
    func: async (args) => {
      // Pause for human approval
      const approved = interrupt({
        type: "approval_request",
        toolName: tool.name,
        args,
        description: tool.description,
      });

      if (!approved) {
        return "Operation cancelled by user";
      }

      return tool.func(args);
    },
  };
}
```

### Resuming After Interrupt

```typescript
// When user approves/rejects
export async function handleApprovalResponse(
  sessionId: string,
  approved: boolean
) {
  // Resume the graph with the approval decision
  const result = await supervisorGraph.invoke(
    approved, // This value is returned by interrupt()
    {
      configurable: { thread_id: sessionId },
    }
  );

  return result;
}
```

---

## 5. Event Emission

El supervisor emite eventos via LangSmith callbacks y nuestro event system:

```typescript
import { compileSupervisorGraph } from "./supervisor-graph";

const graph = await compileSupervisorGraph();

// Invoke with callbacks
const result = await graph.invoke(input, {
  configurable: { thread_id: sessionId },
  callbacks: [
    {
      handleLLMStart: (llm, prompts) => {
        emitEvent(sessionId, { type: "llm_start", model: llm.model });
      },
      handleLLMEnd: (output) => {
        emitEvent(sessionId, { type: "llm_end", tokens: output.usage });
      },
      handleToolStart: (tool, input) => {
        emitEvent(sessionId, { type: "tool_use", name: tool.name, input });
      },
      handleToolEnd: (output) => {
        emitEvent(sessionId, { type: "tool_result", output });
      },
    },
  ],
});
```

---

## 6. Tests Requeridos

### 6.1 Unit Tests (Deterministic)

```typescript
describe("Supervisor Prompt", () => {
  it("includes all agents from registry", () => {
    const agentList = "- bc-agent: BC Expert\n- rag-agent: Knowledge";
    const prompt = getSupervisorPrompt(agentList);

    expect(prompt).toContain("bc-agent");
    expect(prompt).toContain("rag-agent");
  });
});

describe("buildAgentsFromRegistry", () => {
  it("creates react agents for all worker agents");
  it("skips agents without tools");
  it("uses correct model for each agent");
});
```

### 6.2 LangSmith Evaluations

```typescript
// Routing accuracy evaluation
const routingDataset = [
  { input: "Show customer ABC", expected_agent: "bc-agent" },
  { input: "Search my documents for contracts", expected_agent: "rag-agent" },
  { input: "Create a sales chart", expected_agent: "graph-agent" },
];

await evaluate(supervisorTarget, {
  data: "supervisor-routing",
  evaluators: [
    {
      evaluate: ({ output, reference }) => ({
        key: "routing_accuracy",
        score: output.activeAgent === reference.expected_agent ? 1 : 0,
      }),
    },
  ],
  numRepetitions: 3,
});
```

---

## 7. Criterios de Aceptación

- [ ] `createSupervisor()` routes queries correctly
- [ ] All agents from registry are available
- [ ] Checkpointer persists conversation state
- [ ] `interrupt()` pauses for approval when configured
- [ ] Events emitted via callbacks
- [ ] LangSmith routing evaluation >= 90% accuracy
- [ ] `npm run verify:types` pasa sin errores

---

## 8. Archivos a Crear

- `backend/src/modules/agents/supervisor/supervisor-graph.ts`
- `backend/src/modules/agents/supervisor/supervisor-prompt.ts`
- `backend/src/modules/agents/supervisor/agent-builders.ts`
- `backend/src/modules/agents/supervisor/index.ts`
- `backend/src/__tests__/unit/agents/supervisor/supervisor-prompt.test.ts`
- `backend/src/__tests__/langsmith/supervisor-routing.ts`

---

## 9. Archivos a Modificar

- `backend/src/app.ts` (initialize supervisor at startup)
- `backend/src/services/websocket/ChatMessageHandler.ts` (use supervisor graph)

---

## 10. Estimación

- **Desarrollo**: 3-4 días
- **Testing**: 2-3 días
- **Integration**: 1-2 días
- **Total**: 6-9 días

---

## 11. Changelog

| Fecha | Versión | Cambios |
|-------|---------|---------|
| 2026-02-02 | 1.0 | Initial draft with createSupervisor() |
| 2026-02-06 | 1.1 | **Corrección**: `createSupervisor` requiere paquete `@langchain/langgraph-supervisor` (no está en prebuilt). Agregada sección de pre-requisitos y notas de integración con Agent Registry (PRD-011 completado). |
| 2026-02-06 | 2.0 | **COMPLETADO**. Implementación completa. Ver sección "Resultados de Implementación" abajo. |

---

## 12. Resultados de Implementación

### Decisiones Técnicas vs PRD Original

| Aspecto | PRD Original | Implementación Real | Razón |
|---------|-------------|---------------------|-------|
| **Checkpointer** | `PostgresSaver` | `MemorySaver` | Proyecto usa Azure SQL (MSSQL), no PostgreSQL. MemorySaver para MVP; PRD-032 proveerá persistencia durable |
| **State Schema** | `stateSchema: ExtendedAgentStateAnnotation` | `config.configurable` para userId | `createSupervisor()` JS API no documenta `stateSchema` param. userId se propaga via configurable |
| **RAG Tool** | `toolFactory(userId)` closure | Static `knowledgeSearchTool` con `config.configurable.userId` | Incompatible con compile-once: `createReactAgent` necesita tools estáticos |
| **Interrupt** | `interrupt()` inline | `interrupt()` + `MemorySaver` + `Command({ resume })` | Implementado completo con WebSocket handler `supervisor:resume` |
| **Slash Commands** | No mencionado | `slash-command-router.ts` preserva `/bc`, `/search` | Fast-path bypass del supervisor LLM para comandos explícitos |

### Archivos Creados (13 source + 5 tests)

| Archivo | Propósito |
|---------|-----------|
| `supervisor/supervisor-graph.ts` | Core: init, compile, adapter (ICompiledGraph), interrupt/resume |
| `supervisor/supervisor-prompt.ts` | Prompt dinámico desde registry |
| `supervisor/agent-builders.ts` | `buildReactAgents()` desde registry definitions |
| `supervisor/slash-command-router.ts` | Pre-routing `/bc`, `/search`, `/rag` |
| `supervisor/result-adapter.ts` | Map supervisor output → AgentState + identity + tools |
| `supervisor/supervisor-state.ts` | Schema state para agentes |
| `supervisor/index.ts` | Barrel exports |
| `__tests__/unit/agents/supervisor/slash-command-router.test.ts` | 8 tests |
| `__tests__/unit/agents/supervisor/supervisor-prompt.test.ts` | 7 tests |
| `__tests__/unit/agents/supervisor/result-adapter.test.ts` | 18 tests |
| `__tests__/unit/agents/supervisor/agent-builders.test.ts` | 7 tests |
| `__tests__/unit/agents/supervisor/supervisor-graph.test.ts` | 4 tests |

### Archivos Modificados (6)

| Archivo | Cambio |
|---------|--------|
| `infrastructure/config/models.ts` | Agregado `supervisor` model role (Haiku 3.5, temp 0, 1024 tokens) |
| `modules/agents/rag-knowledge/tools.ts` | Static `knowledgeSearchTool` con `config.configurable.userId` |
| `modules/agents/core/registry/registerAgents.ts` | `staticTools: [knowledgeSearchTool]` reemplaza `toolFactory` |
| `domains/agent/orchestration/AgentOrchestrator.ts` | `getSupervisorGraphAdapter()` reemplaza `orchestratorGraph` |
| `server.ts` | `initializeSupervisorGraph()` en startup + `supervisor:resume` socket handler |
| `modules/agents/core/index.ts` | Removido export de `BaseAgent`/`IAgentNode` |

### Archivos Eliminados (4)

| Archivo | Reemplazado Por |
|---------|----------------|
| `orchestrator/router.ts` | Supervisor LLM + `slash-command-router.ts` |
| `orchestrator/graph.ts` | `supervisor-graph.ts` |
| `orchestrator/check_graph.ts` | Ya no necesario |
| `core/AgentFactory.ts` | `createReactAgent()` en `agent-builders.ts` |

### Métricas

- **Tests nuevos**: 44 (5 archivos), todos pasando
- **Tests existentes**: 2986 pasando, 0 regresiones
- **Lint**: 0 errores (59 warnings pre-existentes)
- **verify:types**: Pasa (shared + frontend)
- **Paquete instalado**: `@langchain/langgraph-supervisor@0.0.25`

### Flujo userId (Implementado)

```
ChatMessageHandler → executeAgentSync(prompt, sessionId, callback, userId)
  → AgentOrchestrator → MessageContextBuilder → context: { userId, sessionId }
    → GraphExecutor → supervisorAdapter.invoke({ messages, context: { userId } })
      → supervisorAdapter extrae userId, pasa en config.configurable
        → supervisor.invoke(messages, { configurable: { thread_id, userId } })
          → LangGraph propaga configurable a child agents
            → RAG tool lee config.configurable.userId en runtime
```

### Flujo Interrupt/Resume (Implementado)

```
1. Agent/tool llama interrupt({ question, options })
2. MemorySaver guarda estado en punto de interrupción
3. supervisor.invoke() retorna resultado parcial
4. supervisorAdapter detecta interrupt via graph.getState()
5. result-adapter formatea como approval_requested event
6. AgentOrchestrator emite approval_requested al frontend
7. Frontend muestra prompt al usuario
8. Usuario responde via WebSocket supervisor:resume
9. server.ts → resumeSupervisor(sessionId, answer)
10. supervisor.invoke(Command({ resume: answer }), { configurable: { thread_id } })
11. Ejecución continúa desde punto de interrupción
```
