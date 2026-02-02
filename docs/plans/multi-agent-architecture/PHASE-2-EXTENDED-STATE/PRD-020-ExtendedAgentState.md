# PRD-020: Extended AgentState Schema

**Estado**: Draft
**Prioridad**: Alta
**Dependencias**: PRD-010 (Test Strategy), PRD-011 (AgentRegistry)
**Bloquea**: Fase 3 (Supervisor), Fase 4 (Handoffs)

---

## 1. Objetivo

Extender el schema `AgentState` de LangGraph para soportar:
- **Agent Identity**: Identificación visual de qué agente generó cada mensaje
- **Agent Context**: Contexto compartido entre agentes (userId, sessionId, files)

El state se basa en `MessagesAnnotation` con `add_messages` reducer nativo.

---

## 2. Diseño

### 2.1 Principio: Usar Prebuilts de LangGraph

LangGraph proporciona state management robusto:
- `MessagesAnnotation` como base
- `add_messages` reducer para concatenar mensajes
- Checkpointers para persistencia automática
- `createSupervisor()` maneja tracking de planes internamente

No necesitamos implementar custom state para planes o handoffs.

### 2.2 Estructura de Archivos

```
backend/src/modules/agents/orchestrator/
├── state.ts                    # Extended state con annotations
├── state/
│   ├── AgentIdentity.ts        # Identity types para UI
│   ├── AgentContext.ts         # Contexto compartido
│   └── index.ts
└── types/
    └── state.types.ts
```

---

## 3. Extended State Schema

### 3.1 AgentIdentity

```typescript
// state/AgentIdentity.ts
import { Annotation } from "@langchain/langgraph";

/**
 * Identity of an agent for UI display
 */
export interface AgentIdentity {
  /** Agent ID from registry */
  agentId: string;

  /** Display name */
  agentName: string;

  /** Icon (emoji or icon name) */
  agentIcon?: string;

  /** Color for UI theming */
  agentColor?: string;
}

/**
 * Default identity (orchestrator)
 */
export const DEFAULT_AGENT_IDENTITY: AgentIdentity = {
  agentId: "supervisor",
  agentName: "Assistant",
  agentIcon: "🎯",
  agentColor: "#8B5CF6",
};

/**
 * Agent identity annotation - replaces entirely on update
 */
export const AgentIdentityAnnotation = Annotation<AgentIdentity>({
  reducer: (_, incoming) => incoming,
  default: () => DEFAULT_AGENT_IDENTITY,
});
```

### 3.2 AgentContext

```typescript
// state/AgentContext.ts
import { Annotation } from "@langchain/langgraph";

/**
 * File context from RAG/uploaded files
 */
export interface FileContext {
  fileId: string;
  fileName: string;
  content?: string;
  summary?: string;
  relevanceScore?: number;
}

/**
 * Shared context for agent execution
 */
export interface AgentContext {
  /** Current user ID */
  userId: string;

  /** Current session ID */
  sessionId: string;

  /** File context from uploaded/RAG files */
  fileContext?: FileContext[];

  /** Search context from semantic search */
  searchContext?: string[];

  /** BC Company ID (if connected) */
  bcCompanyId?: string;

  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Agent context annotation - merges on update
 */
export const AgentContextAnnotation = Annotation<AgentContext>({
  reducer: (existing, incoming) => ({ ...existing, ...incoming }),
  default: () => ({ userId: "", sessionId: "" }),
});
```

### 3.3 Extended AgentState

```typescript
// state.ts
import { Annotation, MessagesAnnotation } from "@langchain/langgraph";
import { AgentIdentityAnnotation, type AgentIdentity } from "./state/AgentIdentity";
import { AgentContextAnnotation, type AgentContext } from "./state/AgentContext";

/**
 * Extended AgentState for multi-agent architecture
 *
 * Built on MessagesAnnotation with additional fields for:
 * - Agent identity tracking (for UI)
 * - Shared context between agents
 *
 * NOTE: Plan tracking and handoff history are managed automatically
 * by createSupervisor() and Command pattern - no custom state needed.
 */
export const ExtendedAgentStateAnnotation = Annotation.Root({
  // ============================================
  // Messages (from MessagesAnnotation)
  // ============================================

  /**
   * Conversation messages with add_messages reducer
   */
  ...MessagesAnnotation.spec,

  // ============================================
  // Agent Identity (for UI)
  // ============================================

  /**
   * Identity of the currently active agent
   * Used for UI badges and visual distinction
   */
  currentAgentIdentity: AgentIdentityAnnotation,

  // ============================================
  // Shared Context
  // ============================================

  /**
   * Execution context shared between agents
   */
  context: AgentContextAnnotation,
});

/**
 * Type alias for extended state
 */
export type ExtendedAgentState = typeof ExtendedAgentStateAnnotation.State;

// Re-export for convenience
export type { AgentIdentity, AgentContext };
```

---

## 4. WebSocket Events

### 4.1 Agent Changed Event

Emitido cuando el agente activo cambia durante la conversación.

```typescript
// En @bc-agent/shared/types/agent.types.ts

/**
 * Event emitted when active agent changes
 */
export interface AgentChangedEvent extends BaseAgentEvent {
  type: "agent_changed";
  previousAgent: AgentIdentity;
  currentAgent: AgentIdentity;
}
```

### 4.2 Zod Schema

```typescript
// En @bc-agent/shared/schemas/agent-events.schema.ts
import { z } from "zod";

export const AgentIdentitySchema = z.object({
  agentId: z.string(),
  agentName: z.string(),
  agentIcon: z.string().optional(),
  agentColor: z.string().optional(),
});

export const AgentChangedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal("agent_changed"),
  previousAgent: AgentIdentitySchema,
  currentAgent: AgentIdentitySchema,
});
```

---

## 5. Usage with createSupervisor()

```typescript
import { createSupervisor } from "@langchain/langgraph/prebuilt";
import { ExtendedAgentStateAnnotation } from "./state";

// createSupervisor manages agent routing automatically
// Our extended state just adds identity tracking for UI

const supervisor = createSupervisor({
  agents: [bcAgent, ragAgent, graphAgent],
  model: routerModel,
  // State is extended with our annotations
  stateSchema: ExtendedAgentStateAnnotation,
});

// Identity is updated automatically when agent changes
// via the supervisor's internal routing
```

---

## 6. Emitting Agent Identity Updates

```typescript
// In agent nodes, update identity when agent starts processing

const bcAgentNode = async (state: ExtendedAgentState) => {
  // ... agent logic ...

  return {
    messages: [response],
    currentAgentIdentity: {
      agentId: "bc-agent",
      agentName: "Business Central Expert",
      agentIcon: "📊",
      agentColor: "#3B82F6",
    },
  };
};
```

---

## 7. Tests Requeridos

### 7.1 Reducer Tests

```typescript
describe("AgentIdentityAnnotation", () => {
  it("replaces identity entirely", () => {
    const existing = { agentId: "a", agentName: "A" };
    const incoming = { agentId: "b", agentName: "B" };

    const result = AgentIdentityAnnotation.spec.reducer(existing, incoming);

    expect(result.agentId).toBe("b");
  });

  it("uses default when not set", () => {
    const result = AgentIdentityAnnotation.spec.default();
    expect(result.agentId).toBe("supervisor");
  });
});

describe("AgentContextAnnotation", () => {
  it("merges context fields", () => {
    const existing = { userId: "u1", sessionId: "s1" };
    const incoming = { bcCompanyId: "c1" };

    const result = AgentContextAnnotation.spec.reducer(existing, incoming);

    expect(result.userId).toBe("u1");
    expect(result.bcCompanyId).toBe("c1");
  });
});
```

### 7.2 Contract Tests

```typescript
describe("Extended State Contracts", () => {
  it("AgentIdentity matches schema", () => {
    const identity = {
      agentId: "bc-agent",
      agentName: "BC Expert",
      agentIcon: "📊",
      agentColor: "#3B82F6",
    };

    expect(() => AgentIdentitySchema.parse(identity)).not.toThrow();
  });

  it("AgentChangedEvent matches schema", () => {
    const event = {
      type: "agent_changed",
      sessionId: "SESSION-123",
      eventId: "EVENT-456",
      timestamp: new Date().toISOString(),
      previousAgent: { agentId: "supervisor", agentName: "Supervisor" },
      currentAgent: { agentId: "bc-agent", agentName: "BC Expert" },
    };

    expect(() => AgentChangedEventSchema.parse(event)).not.toThrow();
  });
});
```

---

## 8. Criterios de Aceptación

- [ ] `ExtendedAgentStateAnnotation` compiles without errors
- [ ] Reducers work correctly with MessagesAnnotation
- [ ] AgentIdentity updates correctly in agent nodes
- [ ] AgentContext merges fields as expected
- [ ] WebSocket events validated by schemas
- [ ] Tests pass for all reducers
- [ ] `npm run verify:types` pasa sin errores

---

## 9. Archivos a Crear

### Backend
- `backend/src/modules/agents/orchestrator/state/AgentIdentity.ts`
- `backend/src/modules/agents/orchestrator/state/AgentContext.ts`
- `backend/src/modules/agents/orchestrator/state/index.ts`

### Shared Package
- `packages/shared/src/types/agent-identity.types.ts`
- `packages/shared/src/schemas/agent-identity.schema.ts`

### Tests
- `backend/src/__tests__/unit/agents/state/reducers.test.ts`
- `backend/src/__tests__/contracts/extended-state.contract.test.ts`

---

## 10. Archivos a Modificar

- `backend/src/modules/agents/orchestrator/state.ts` (extend with new annotations)
- `packages/shared/src/types/agent.types.ts` (add AgentChangedEvent)
- `packages/shared/src/types/index.ts` (export new types)

---

## 11. Estimación

- **Desarrollo**: 2-3 días
- **Testing**: 1-2 días
- **Total**: 3-5 días

---

## 12. Changelog

| Fecha | Versión | Cambios |
|-------|---------|---------|
| 2026-02-02 | 1.0 | Initial draft with MessagesAnnotation base |
