# PRD-011: Agent Registry (Simplificado)

**Estado**: ✅ COMPLETADO (2026-02-06)
**Prioridad**: Alta
**Dependencias**: PRD-010 (Test Strategy)
**Bloquea**: Fase 2 (Extended State), Fase 3 (Supervisor)

---

## 1. Objetivo

Crear un registro centralizado de agentes que:
- Proporcione metadata para UI (icon, color, description)
- Exponga agentes a `createSupervisor()` para routing automático
- Facilite la integración con `createReactAgent()`
- Elimine la necesidad de routing manual por keywords

### Simplificación vs Versión Original

| Original | Simplificado | Razón |
|----------|--------------|-------|
| `triggerKeywords` | ELIMINADO | Supervisor LLM decide routing |
| `triggerPatterns` | ELIMINADO | Supervisor LLM decide routing |
| `findByKeywords()` | ELIMINADO | Supervisor maneja automáticamente |
| Routing manual | `createSupervisor()` | Pattern nativo de LangGraph |

---

## 2. Diseño Propuesto

### 2.1 Estructura de Archivos

```
backend/src/modules/agents/core/
├── registry/
│   ├── AgentRegistry.ts           # Registro singleton
│   ├── AgentDefinition.ts         # Interface simplificada
│   └── index.ts
├── definitions/
│   ├── orchestrator.definition.ts
│   ├── bc-agent.definition.ts
│   ├── rag-agent.definition.ts
│   └── index.ts
└── index.ts
```

### 2.2 AgentDefinition (Simplificado)

```typescript
// AgentDefinition.ts
import type { StructuredToolInterface } from "@langchain/core/tools";

/**
 * Agent capability categories
 */
export type AgentCapability =
  | "erp_query"      // Can query ERP data
  | "erp_mutation"   // Can modify ERP data
  | "rag_search"     // Can search documents
  | "data_viz"       // Can create visualizations
  | "general";       // General conversation

/**
 * Simplified agent definition for multi-agent architecture
 *
 * NOTE: triggerKeywords and triggerPatterns REMOVED.
 * Routing is handled by createSupervisor() using LLM.
 */
export interface AgentDefinition {
  // ============================================
  // Identity
  // ============================================

  /** Unique identifier (e.g., 'bc-agent') */
  id: string;

  /** Display name (e.g., 'Business Central Expert') */
  name: string;

  /** Short description for supervisor and UI */
  description: string;

  // ============================================
  // Visual (for UI)
  // ============================================

  /** Icon (emoji or icon name) */
  icon: string;

  /** Hex color for UI theming */
  color: string;

  // ============================================
  // Capabilities
  // ============================================

  /** What this agent can do */
  capabilities: AgentCapability[];

  // ============================================
  // Configuration
  // ============================================

  /** Base system prompt */
  systemPrompt: string;

  /** Model role from ModelFactory */
  modelRole: "orchestrator" | "router" | "bc_agent" | "rag_agent" | "graph_agent";

  // ============================================
  // Availability
  // ============================================

  /** Can user select this agent directly? */
  isUserSelectable: boolean;

  /** Is this an internal/system agent? */
  isSystemAgent: boolean;
}

/**
 * Agent with tools attached (for createReactAgent)
 */
export interface AgentWithTools extends AgentDefinition {
  tools: StructuredToolInterface[];
}
```

### 2.3 AgentRegistry

```typescript
// AgentRegistry.ts
import type { AgentDefinition, AgentWithTools, AgentCapability } from "./AgentDefinition";
import type { StructuredToolInterface } from "@langchain/core/tools";

/**
 * Summary for UI (excludes sensitive data)
 */
export interface AgentUISummary {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  capabilities: AgentCapability[];
}

/**
 * Agent info for createSupervisor()
 */
export interface SupervisorAgentInfo {
  name: string;
  description: string;
}

/**
 * AgentRegistry - Centralized agent management
 *
 * Used by:
 * - createSupervisor() for available agents
 * - UI for displaying agent selector
 * - createReactAgent() for building agents
 */
export class AgentRegistry {
  private static instance: AgentRegistry | null = null;
  private agents: Map<string, AgentDefinition> = new Map();
  private tools: Map<string, StructuredToolInterface[]> = new Map();

  private constructor() {}

  // ============================================
  // Singleton
  // ============================================

  public static getInstance(): AgentRegistry {
    if (!AgentRegistry.instance) {
      AgentRegistry.instance = new AgentRegistry();
    }
    return AgentRegistry.instance;
  }

  public static resetInstance(): void {
    AgentRegistry.instance = null;
  }

  // ============================================
  // Registration
  // ============================================

  /**
   * Register an agent definition
   */
  register(definition: AgentDefinition): void {
    if (this.agents.has(definition.id)) {
      throw new Error(`Agent '${definition.id}' is already registered`);
    }
    this.agents.set(definition.id, definition);
  }

  /**
   * Register tools for an agent
   */
  registerTools(agentId: string, tools: StructuredToolInterface[]): void {
    if (!this.agents.has(agentId)) {
      throw new Error(`Agent '${agentId}' not found. Register agent first.`);
    }
    this.tools.set(agentId, tools);
  }

  /**
   * Register agent with tools in one call
   */
  registerWithTools(
    definition: AgentDefinition,
    tools: StructuredToolInterface[]
  ): void {
    this.register(definition);
    this.registerTools(definition.id, tools);
  }

  /**
   * Unregister an agent (for testing)
   */
  unregister(agentId: string): boolean {
    this.tools.delete(agentId);
    return this.agents.delete(agentId);
  }

  // ============================================
  // Query APIs
  // ============================================

  /**
   * Get agent by ID
   */
  get(agentId: string): AgentDefinition | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get agent with tools
   */
  getWithTools(agentId: string): AgentWithTools | undefined {
    const agent = this.agents.get(agentId);
    if (!agent) return undefined;

    return {
      ...agent,
      tools: this.tools.get(agentId) ?? [],
    };
  }

  /**
   * Get all registered agents
   */
  getAll(): AgentDefinition[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get agents that users can select
   */
  getUserSelectableAgents(): AgentDefinition[] {
    return this.getAll().filter(agent => agent.isUserSelectable);
  }

  /**
   * Get non-system agents (for supervisor)
   */
  getWorkerAgents(): AgentDefinition[] {
    return this.getAll().filter(agent => !agent.isSystemAgent);
  }

  /**
   * Get agents with specific capability
   */
  getByCapability(capability: AgentCapability): AgentDefinition[] {
    return this.getAll().filter(agent =>
      agent.capabilities.includes(capability)
    );
  }

  /**
   * Check if agent exists
   */
  has(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  /**
   * Get agent count
   */
  get size(): number {
    return this.agents.size;
  }

  // ============================================
  // createSupervisor() Integration
  // ============================================

  /**
   * Get agent info for createSupervisor()
   *
   * Returns names and descriptions for the supervisor to use
   * when deciding which agent to route to.
   */
  getAgentsForSupervisor(): SupervisorAgentInfo[] {
    return this.getWorkerAgents().map(agent => ({
      name: agent.id,
      description: agent.description,
    }));
  }

  /**
   * Build supervisor prompt with available agents
   *
   * Use this to create the system prompt for createSupervisor()
   */
  buildSupervisorAgentList(): string {
    const agents = this.getWorkerAgents();

    return agents.map(agent =>
      `- **${agent.id}** (${agent.name}): ${agent.description}\n  Capabilities: ${agent.capabilities.join(", ")}`
    ).join("\n");
  }

  // ============================================
  // UI Serialization
  // ============================================

  /**
   * Get summary for UI (excludes systemPrompt)
   */
  getUISummary(): AgentUISummary[] {
    return this.getUserSelectableAgents().map(agent => ({
      id: agent.id,
      name: agent.name,
      description: agent.description,
      icon: agent.icon,
      color: agent.color,
      capabilities: agent.capabilities,
    }));
  }
}

// Convenience function
export function getAgentRegistry(): AgentRegistry {
  return AgentRegistry.getInstance();
}
```

### 2.4 Agent Definitions

#### bc-agent.definition.ts

```typescript
import type { AgentDefinition } from "../core/registry/AgentDefinition";

export const bcAgentDefinition: AgentDefinition = {
  id: "bc-agent",
  name: "Business Central Expert",
  description: "Specialist in Microsoft Business Central ERP. Can query customers, vendors, invoices, sales orders, inventory, and other BC entities.",

  icon: "📊",
  color: "#3B82F6", // Blue

  capabilities: ["erp_query", "erp_mutation"],

  systemPrompt: `You are an expert in Microsoft Business Central ERP.
You help users query and manage business data including:
- Customers and vendors
- Sales and purchase orders
- Invoices and payments
- Inventory and items
- Financial data

Always use the available tools to fetch real data. Never make up data.`,

  modelRole: "bc_agent",

  isUserSelectable: true,
  isSystemAgent: false,
};
```

#### rag-agent.definition.ts

```typescript
import type { AgentDefinition } from "../core/registry/AgentDefinition";

export const ragAgentDefinition: AgentDefinition = {
  id: "rag-agent",
  name: "Knowledge Base Expert",
  description: "Searches and analyzes uploaded documents using semantic search. Can answer questions based on document content.",

  icon: "🧠",
  color: "#10B981", // Green

  capabilities: ["rag_search"],

  systemPrompt: `You are a knowledge assistant that helps users find information in their uploaded documents.
Use semantic search to find relevant content and provide accurate answers with citations.
Always cite the source document when providing information.`,

  modelRole: "rag_agent",

  isUserSelectable: true,
  isSystemAgent: false,
};
```

#### supervisor.definition.ts

```typescript
import type { AgentDefinition } from "../core/registry/AgentDefinition";

export const supervisorDefinition: AgentDefinition = {
  id: "supervisor",
  name: "Supervisor",
  description: "Routes queries to specialized agents and coordinates multi-step tasks.",

  icon: "🎯",
  color: "#8B5CF6", // Purple

  capabilities: ["general"],

  systemPrompt: "", // Built dynamically with agent list

  modelRole: "router",

  isUserSelectable: false,
  isSystemAgent: true,
};
```

### 2.5 Integration with createSupervisor()

```typescript
// supervisor-graph.ts
import { createSupervisor } from "@langchain/langgraph/prebuilt";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatAnthropic } from "@langchain/anthropic";
import { getAgentRegistry } from "@/modules/agents/core/registry";
import { ModelFactory } from "@/shared/models/ModelFactory";

export async function buildSupervisorGraph() {
  const registry = getAgentRegistry();

  // Build react agents from registry
  const agents = [];
  for (const agentDef of registry.getWorkerAgents()) {
    const agentWithTools = registry.getWithTools(agentDef.id);
    if (!agentWithTools) continue;

    const model = await ModelFactory.create(agentDef.modelRole);

    const agent = createReactAgent({
      llm: model,
      tools: agentWithTools.tools,
      name: agentDef.id,
      prompt: agentDef.systemPrompt,
    });

    agents.push(agent);
  }

  // Build supervisor with all agents
  const supervisorModel = await ModelFactory.create("router");
  const agentList = registry.buildSupervisorAgentList();

  const supervisor = createSupervisor({
    agents,
    model: supervisorModel,
    prompt: `You are a supervisor managing specialized agents.

## Available Agents

${agentList}

## Instructions

1. Analyze the user's request
2. Decide which agent is best suited to handle it
3. Route the request to that agent
4. If the task requires multiple agents, coordinate between them

For simple queries, route directly to the appropriate agent.
For complex queries requiring multiple steps, you may need to call multiple agents in sequence.`,
  });

  return supervisor;
}
```

---

## 3. API Endpoint for UI

```typescript
// routes/agents.ts
import { Router } from "express";
import { getAgentRegistry } from "@/modules/agents/core/registry";
import { authenticateMicrosoft } from "@/domains/auth";

const router = Router();

/**
 * GET /api/agents
 *
 * Returns list of user-selectable agents for UI
 */
router.get("/", authenticateMicrosoft, (req, res) => {
  const registry = getAgentRegistry();
  const agents = registry.getUISummary();

  res.json({
    agents,
    count: agents.length,
  });
});

/**
 * GET /api/agents/:id
 *
 * Returns details for a specific agent
 */
router.get("/:id", authenticateMicrosoft, (req, res) => {
  const registry = getAgentRegistry();
  const agent = registry.get(req.params.id);

  if (!agent) {
    return res.status(404).json({ error: "Agent not found" });
  }

  if (!agent.isUserSelectable) {
    return res.status(403).json({ error: "Agent not available for selection" });
  }

  res.json({
    id: agent.id,
    name: agent.name,
    description: agent.description,
    icon: agent.icon,
    color: agent.color,
    capabilities: agent.capabilities,
  });
});

export default router;
```

---

## 4. Application Startup

```typescript
// In app.ts or startup
import { getAgentRegistry } from "@/modules/agents/core/registry";
import { bcAgentDefinition } from "@/modules/agents/definitions/bc-agent.definition";
import { ragAgentDefinition } from "@/modules/agents/definitions/rag-agent.definition";
import { supervisorDefinition } from "@/modules/agents/definitions/supervisor.definition";
import { bcTools } from "@/modules/agents/business-central/tools";
import { ragTools } from "@/modules/agents/rag-knowledge/tools";

export function registerAgents(): void {
  const registry = getAgentRegistry();

  // Register agents with their tools
  registry.registerWithTools(bcAgentDefinition, bcTools);
  registry.registerWithTools(ragAgentDefinition, ragTools);
  registry.register(supervisorDefinition); // No tools for supervisor

  console.log(`Registered ${registry.size} agents`);
}
```

---

## 5. Tests Requeridos

```typescript
describe("AgentRegistry", () => {
  beforeEach(() => {
    AgentRegistry.resetInstance();
  });

  describe("registration", () => {
    it("registers agent successfully");
    it("throws on duplicate registration");
    it("registers agent with tools");
    it("unregisters agent");
  });

  describe("queries", () => {
    it("gets agent by ID");
    it("returns undefined for unknown ID");
    it("gets all agents");
    it("gets user-selectable agents only");
    it("gets worker agents (non-system)");
    it("gets agents by capability");
  });

  describe("supervisor integration", () => {
    it("returns agent info for supervisor");
    it("builds supervisor agent list string");
  });

  describe("serialization", () => {
    it("returns UI summary without systemPrompt");
  });
});
```

---

## 6. Criterios de Aceptación

- [x] AgentRegistry singleton works correctly
- [x] All existing agents registered
- [x] `getAgentsForSupervisor()` returns correct format
- [x] `buildSupervisorAgentList()` generates valid prompt section
- [x] UI summary excludes sensitive data
- [x] API endpoint returns agent list
- [x] Tests cover all functionality (26 tests)
- [x] `npm run verify:types` pasa sin errores

---

## 7. Archivos a Crear

```
backend/src/modules/agents/core/
├── registry/
│   ├── AgentRegistry.ts
│   ├── AgentDefinition.ts
│   └── index.ts
├── definitions/
│   ├── bc-agent.definition.ts
│   ├── rag-agent.definition.ts
│   ├── supervisor.definition.ts
│   └── index.ts
└── index.ts

backend/src/routes/agents.ts
backend/src/__tests__/unit/agents/AgentRegistry.test.ts
```

---

## 8. Lo que se ELIMINÓ

| Componente | Razón |
|------------|-------|
| `triggerKeywords` | `createSupervisor()` usa LLM para routing |
| `triggerPatterns` | `createSupervisor()` usa LLM para routing |
| `findByKeywords()` | No necesario con supervisor |
| `AgentModelConfig` | Simplificado a `modelRole` |
| `AgentToolDefinition[]` | Usar tools directamente con `registerTools()` |

---

## 9. Estimación

- **Desarrollo**: 2-3 días
- **Testing**: 1-2 días
- **Integration**: 1 día
- **Total**: 4-6 días

---

## 10. Notas de Implementación

### Decisiones tomadas durante la implementación (2026-02-06)

**1. Constantes centralizadas en `@bc-agent/shared`** (no estaba en el PRD original)

El PRD original tenía los tipos y constantes solo en el backend. Durante la implementación se decidió mover IDs, colores, iconos, nombres y capabilities al shared package para que el frontend pueda importar los mismos valores sin duplicación.

Archivos creados:
- `packages/shared/src/constants/agent-registry.constants.ts`
- `packages/shared/src/types/agent-registry.types.ts`

**2. Patrón `AgentToolConfig` con `toolFactory`** (diferencia vs PRD)

El PRD mostraba `registerWithTools(definition, tools)` con tools estáticos. En la práctica, RAG tools requieren `userId` en tiempo de creación (`createKnowledgeSearchTool(userId)`) por aislamiento multi-tenant. Se implementó:

```typescript
interface AgentToolConfig {
  staticTools?: StructuredToolInterface[];     // BC Agent: 7 tools fijos
  toolFactory?: (userId: string) => StructuredToolInterface[];  // RAG Agent: dinámico
}
```

**3. Corrección de import de `createSupervisor`** (descubierta durante investigación)

El PRD indicaba `import { createSupervisor } from "@langchain/langgraph/prebuilt"`. Esto es **incorrecto**. El import correcto es:
```typescript
import { createSupervisor } from "@langchain/langgraph-supervisor";
```
Esto es un paquete separado que debe instalarse. Se documentó en PRD-030.

**4. Implementación aditiva (no destructiva)**

No se modificaron `graph.ts` ni `router.ts`. El registro coexiste con `AgentFactory.ts` (IAgentNode/BaseAgent) que sigue en uso activo por el graph. La migración se hará en Phase 3.

### Archivos creados

| Archivo | Propósito |
|---------|-----------|
| `packages/shared/src/constants/agent-registry.constants.ts` | Constantes visuales |
| `packages/shared/src/types/agent-registry.types.ts` | Tipos frontend-safe |
| `backend/src/modules/agents/core/registry/AgentDefinition.ts` | Tipos backend-only |
| `backend/src/modules/agents/core/registry/AgentRegistry.ts` | Singleton registry |
| `backend/src/modules/agents/core/registry/registerAgents.ts` | Bootstrap de registro |
| `backend/src/modules/agents/core/registry/index.ts` | Barrel export |
| `backend/src/modules/agents/core/definitions/bc-agent.definition.ts` | Definición BC Agent |
| `backend/src/modules/agents/core/definitions/rag-agent.definition.ts` | Definición RAG Agent |
| `backend/src/modules/agents/core/definitions/supervisor.definition.ts` | Definición Supervisor |
| `backend/src/modules/agents/core/definitions/index.ts` | Barrel export |
| `backend/src/modules/agents/core/index.ts` | Core barrel export |
| `backend/src/routes/agents.ts` | REST API (`GET /api/agents`) |
| `backend/src/modules/agents/core/registry/AgentRegistry.test.ts` | 26 unit tests |

### Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `packages/shared/src/constants/index.ts` | Export agent registry constants |
| `packages/shared/src/types/index.ts` | Export agent registry types |
| `packages/shared/src/index.ts` | Barrel exports |
| `backend/src/server.ts` | `registerAgents()` al arrancar + mount `/api/agents` |

### Verificación

- 26/26 tests unitarios del registry pasan
- 2916/2916 tests del backend pasan (0 regresiones)
- `verify:types` limpio
- Backend lint: 0 errores

---

## 11. Changelog

| Fecha | Versión | Cambios |
|-------|---------|---------|
| 2026-01-21 | 1.0 | Draft inicial con keyword routing |
| 2026-02-02 | 2.0 | Simplificado: Eliminado keyword routing, agregado createSupervisor() integration |
| 2026-02-06 | 3.0 | **COMPLETADO**: Implementación con constantes en shared, toolFactory pattern, API endpoint, 26 tests |
