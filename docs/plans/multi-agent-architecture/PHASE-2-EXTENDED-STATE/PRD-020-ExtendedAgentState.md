# PRD-020: Extended AgentState Schema

**Estado**: Draft
**Prioridad**: Alta
**Dependencias**: PRD-010 (Test Fixtures), PRD-011 (AgentRegistry)
**Bloquea**: Fase 3 (Supervisor), Fase 4 (Handoffs)

---

## 1. Objetivo

Extender el schema `AgentState` de LangGraph para soportar:
- **Plan State**: Planes generados por el supervisor con steps y estado
- **Agent Identity**: Identificación de qué agente generó cada mensaje
- **Handoff History**: Tracking de delegaciones entre agentes
- **Operation Mode**: Modo autónomo vs dirigido por usuario

---

## 2. Contexto

### 2.1 Estado Actual

`backend/src/modules/agents/orchestrator/state.ts` define:

```typescript
export const AgentStateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({...}),
  activeAgent: Annotation<string>({...}),
  context: Annotation<AgentContext>({...}),
  toolExecutions: Annotation<ToolExecution[]>({...}),
});
```

### 2.2 Limitaciones

1. **No hay concepto de plan**: El sistema ejecuta un solo agente por turno
2. **No hay identidad de agente**: No sabemos quién generó cada mensaje
3. **No hay historial de handoffs**: No hay tracking de delegaciones
4. **No hay modo de operación**: No distinguimos autónomo vs dirigido

---

## 3. Diseño Propuesto

### 3.1 Estructura de Archivos

```
backend/src/modules/agents/orchestrator/
├── state.ts                    # Modificar - añadir nuevas annotations
├── state/
│   ├── PlanState.ts           # Plan types y reducers
│   ├── AgentIdentity.ts       # Identity types
│   ├── HandoffRecord.ts       # Handoff tracking
│   └── index.ts               # Re-exports
└── types/
    └── extended-state.types.ts # Type definitions
```

### 3.2 Nuevos Tipos

#### PlanState.ts
```typescript
import { Annotation } from '@langchain/langgraph';

/**
 * Status of a plan
 */
export type PlanStatus = 'planning' | 'executing' | 'completed' | 'failed' | 'cancelled';

/**
 * Status of a plan step
 */
export type PlanStepStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';

/**
 * A single step in an execution plan
 */
export interface PlanStep {
  /** Unique step identifier */
  stepId: string;

  /** Index in the plan (0-based) */
  stepIndex: number;

  /** Agent responsible for this step */
  agentId: string;

  /** Task description for the agent */
  task: string;

  /** Expected output type (optional) */
  expectedOutput?: 'text' | 'data' | 'visualization' | 'confirmation';

  /** Dependencies - step IDs that must complete first */
  dependsOn?: string[];

  /** Current status */
  status: PlanStepStatus;

  /** Result summary (set on completion) */
  result?: string;

  /** Error message (set on failure) */
  error?: string;

  /** Timestamps */
  startedAt?: string;
  completedAt?: string;
}

/**
 * Complete plan state
 */
export interface PlanState {
  /** Unique plan identifier */
  planId: string;

  /** Original user query that triggered the plan */
  query: string;

  /** Plan status */
  status: PlanStatus;

  /** Ordered list of steps */
  steps: PlanStep[];

  /** Current step being executed (index) */
  currentStepIndex: number;

  /** Summary of the overall plan */
  summary?: string;

  /** Reason for failure (if failed) */
  failureReason?: string;

  /** Timestamps */
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

/**
 * Reducer for plan state - replaces entire plan
 */
export const planReducer = (
  existing: PlanState | null,
  incoming: PlanState | null
): PlanState | null => {
  if (incoming === null) return null;
  return { ...incoming, updatedAt: new Date().toISOString() };
};

/**
 * Plan annotation for LangGraph state
 */
export const PlanAnnotation = Annotation<PlanState | null>({
  reducer: planReducer,
  default: () => null,
});
```

#### AgentIdentity.ts
```typescript
import { Annotation } from '@langchain/langgraph';

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
  agentId: 'orchestrator',
  agentName: 'Orchestrator',
  agentIcon: '🎯',
  agentColor: '#8B5CF6',
};

/**
 * Reducer for agent identity - replaces entirely
 */
export const agentIdentityReducer = (
  _existing: AgentIdentity,
  incoming: AgentIdentity
): AgentIdentity => incoming;

/**
 * Agent identity annotation
 */
export const AgentIdentityAnnotation = Annotation<AgentIdentity>({
  reducer: agentIdentityReducer,
  default: () => DEFAULT_AGENT_IDENTITY,
});
```

#### HandoffRecord.ts
```typescript
import { Annotation } from '@langchain/langgraph';

/**
 * Reason for handoff
 */
export type HandoffReason =
  | 'plan_step'        // Supervisor delegating per plan
  | 'capability_match' // Agent doesn't have required capability
  | 'user_request'     // User explicitly requested agent
  | 'error_recovery'   // Recovering from agent error
  | 'clarification';   // Need clarification from another agent

/**
 * Record of a handoff between agents
 */
export interface HandoffRecord {
  /** Unique handoff identifier */
  handoffId: string;

  /** Source agent ID */
  fromAgentId: string;

  /** Target agent ID */
  toAgentId: string;

  /** Reason for handoff */
  reason: HandoffReason;

  /** Human-readable explanation */
  explanation?: string;

  /** Context passed to target agent */
  payload?: Record<string, unknown>;

  /** Reference to plan step (if from plan) */
  planStepId?: string;

  /** Timestamp */
  timestamp: string;
}

/**
 * Reducer for handoff history - appends new records
 */
export const handoffHistoryReducer = (
  existing: HandoffRecord[],
  incoming: HandoffRecord[]
): HandoffRecord[] => {
  return [...existing, ...incoming];
};

/**
 * Handoff history annotation
 */
export const HandoffHistoryAnnotation = Annotation<HandoffRecord[]>({
  reducer: handoffHistoryReducer,
  default: () => [],
});
```

#### OperationMode
```typescript
import { Annotation } from '@langchain/langgraph';

/**
 * Operation mode for the agent system
 *
 * - autonomous: Supervisor generates plan and executes
 * - directed: User selected specific agent, bypass supervisor
 */
export type OperationMode = 'autonomous' | 'directed';

/**
 * Directed mode context
 */
export interface DirectedModeContext {
  /** Agent selected by user */
  targetAgentId: string;

  /** Whether to bypass routing entirely */
  bypassRouting: boolean;
}

/**
 * Operation mode annotation
 */
export const OperationModeAnnotation = Annotation<OperationMode>({
  reducer: (_, incoming) => incoming ?? 'autonomous',
  default: () => 'autonomous',
});

export const DirectedModeContextAnnotation = Annotation<DirectedModeContext | null>({
  reducer: (_, incoming) => incoming ?? null,
  default: () => null,
});
```

### 3.3 Extended AgentState

```typescript
// state.ts - Updated
import { Annotation } from '@langchain/langgraph';
import { BaseMessage } from '@langchain/core/messages';
import { PlanAnnotation, type PlanState } from './state/PlanState';
import { AgentIdentityAnnotation, type AgentIdentity } from './state/AgentIdentity';
import { HandoffHistoryAnnotation, type HandoffRecord } from './state/HandoffRecord';
import { OperationModeAnnotation, DirectedModeContextAnnotation } from './state/OperationMode';
import type { ToolExecution, AgentContext } from './types';

/**
 * Extended AgentState for multi-agent architecture
 *
 * Adds support for:
 * - Plan generation and execution
 * - Agent identity tracking
 * - Handoff history
 * - Operation modes
 */
export const ExtendedAgentStateAnnotation = Annotation.Root({
  // ============================================
  // Existing fields (unchanged)
  // ============================================

  /** Conversation messages */
  messages: Annotation<BaseMessage[]>({
    reducer: (existing, incoming) => [...existing, ...incoming],
    default: () => [],
  }),

  /** Currently active agent */
  activeAgent: Annotation<string>({
    reducer: (_, y) => y ?? 'orchestrator',
    default: () => 'orchestrator',
  }),

  /** Execution context */
  context: Annotation<AgentContext>({
    reducer: (existing, incoming) => ({ ...existing, ...incoming }),
    default: () => ({} as AgentContext),
  }),

  /** Tool executions */
  toolExecutions: Annotation<ToolExecution[]>({
    reducer: (existing, incoming) => [...existing, ...incoming],
    default: () => [],
  }),

  // ============================================
  // New fields for multi-agent architecture
  // ============================================

  /**
   * Execution plan generated by supervisor.
   * Null when no plan is active (simple queries).
   */
  plan: PlanAnnotation,

  /**
   * Identity of the agent that generated the current/last response.
   * Used for UI badges and tracking.
   */
  currentAgentIdentity: AgentIdentityAnnotation,

  /**
   * History of handoffs between agents.
   * Used for debugging and UI visualization.
   */
  handoffHistory: HandoffHistoryAnnotation,

  /**
   * Current operation mode.
   * - autonomous: Supervisor plans and executes
   * - directed: User selected specific agent
   */
  operationMode: OperationModeAnnotation,

  /**
   * Context for directed mode (when user selects agent).
   */
  directedModeContext: DirectedModeContextAnnotation,
});

/**
 * Type alias for extended state
 */
export type ExtendedAgentState = typeof ExtendedAgentStateAnnotation.State;

/**
 * Type guard for checking if state has a plan
 */
export function hasPlan(state: ExtendedAgentState): state is ExtendedAgentState & { plan: PlanState } {
  return state.plan !== null;
}

/**
 * Type guard for checking if in directed mode
 */
export function isDirectedMode(state: ExtendedAgentState): boolean {
  return state.operationMode === 'directed' && state.directedModeContext !== null;
}
```

---

## 4. WebSocket Events

### 4.1 Nuevos Eventos

```typescript
// En @bc-agent/shared/types/agent.types.ts

/**
 * Event emitted when supervisor generates a plan
 */
export interface PlanGeneratedEvent extends BaseAgentEvent {
  type: 'plan_generated';
  planId: string;
  query: string;
  steps: Array<{
    stepId: string;
    stepIndex: number;
    agentId: string;
    agentName: string;
    task: string;
  }>;
  estimatedSteps: number;
}

/**
 * Event emitted when a plan step starts
 */
export interface PlanStepStartedEvent extends BaseAgentEvent {
  type: 'plan_step_started';
  planId: string;
  stepId: string;
  stepIndex: number;
  agentId: string;
  agentName: string;
  task: string;
}

/**
 * Event emitted when a plan step completes
 */
export interface PlanStepCompletedEvent extends BaseAgentEvent {
  type: 'plan_step_completed';
  planId: string;
  stepId: string;
  stepIndex: number;
  status: 'completed' | 'failed' | 'skipped';
  result?: string;
  error?: string;
}

/**
 * Event emitted when entire plan completes
 */
export interface PlanCompletedEvent extends BaseAgentEvent {
  type: 'plan_completed';
  planId: string;
  status: 'completed' | 'failed' | 'cancelled';
  summary?: string;
  failureReason?: string;
}

/**
 * Event emitted when agent hands off to another
 */
export interface AgentHandoffEvent extends BaseAgentEvent {
  type: 'agent_handoff';
  handoffId: string;
  fromAgent: AgentIdentity;
  toAgent: AgentIdentity;
  reason: HandoffReason;
  explanation?: string;
}

/**
 * Event emitted when active agent changes
 */
export interface AgentChangedEvent extends BaseAgentEvent {
  type: 'agent_changed';
  previousAgent: AgentIdentity;
  currentAgent: AgentIdentity;
}
```

### 4.2 Zod Schemas

```typescript
// En @bc-agent/shared/schemas/agent-events.schema.ts

export const PlanStepSchema = z.object({
  stepId: z.string().uuid(),
  stepIndex: z.number().int().min(0),
  agentId: z.string(),
  agentName: z.string(),
  task: z.string(),
});

export const PlanGeneratedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal('plan_generated'),
  planId: z.string().uuid(),
  query: z.string(),
  steps: z.array(PlanStepSchema),
  estimatedSteps: z.number().int().min(1),
});

export const PlanStepStartedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal('plan_step_started'),
  planId: z.string().uuid(),
  stepId: z.string().uuid(),
  stepIndex: z.number().int().min(0),
  agentId: z.string(),
  agentName: z.string(),
  task: z.string(),
});

export const PlanStepCompletedEventSchema = BaseAgentEventSchema.extend({
  type: z.literal('plan_step_completed'),
  planId: z.string().uuid(),
  stepId: z.string().uuid(),
  stepIndex: z.number().int().min(0),
  status: z.enum(['completed', 'failed', 'skipped']),
  result: z.string().optional(),
  error: z.string().optional(),
});

export const AgentHandoffEventSchema = BaseAgentEventSchema.extend({
  type: z.literal('agent_handoff'),
  handoffId: z.string().uuid(),
  fromAgent: AgentIdentitySchema,
  toAgent: AgentIdentitySchema,
  reason: z.enum(['plan_step', 'capability_match', 'user_request', 'error_recovery', 'clarification']),
  explanation: z.string().optional(),
});
```

---

## 5. Migration Strategy

### 5.1 Backward Compatibility

El `ExtendedAgentStateAnnotation` extiende el existente:
- Todos los campos existentes mantienen su estructura
- Nuevos campos tienen defaults que no afectan flujo actual
- Grafos existentes funcionan sin modificación

### 5.2 Gradual Adoption

1. **Fase 1**: Añadir tipos sin usarlos
2. **Fase 2**: Supervisor comienza a usar `plan`
3. **Fase 3**: Agentes usan `currentAgentIdentity`
4. **Fase 4**: Handoffs usan `handoffHistory`

---

## 6. Tests Requeridos

### 6.1 Reducer Tests
```typescript
describe('PlanState Reducer', () => {
  it('replaces plan entirely');
  it('updates timestamp on change');
  it('handles null plan');
});

describe('HandoffHistory Reducer', () => {
  it('appends new handoffs');
  it('preserves existing history');
  it('handles empty incoming array');
});

describe('AgentIdentity Reducer', () => {
  it('replaces identity');
  it('uses default when not set');
});
```

### 6.2 Type Guard Tests
```typescript
describe('Type Guards', () => {
  it('hasPlan returns true when plan exists');
  it('hasPlan returns false when plan is null');
  it('isDirectedMode returns true in directed mode');
  it('isDirectedMode returns false in autonomous mode');
});
```

### 6.3 Contract Tests
```typescript
describe('Extended State Contracts', () => {
  it('PlanState matches schema');
  it('HandoffRecord matches schema');
  it('AgentIdentity matches schema');
  it('All new events have valid schemas');
});
```

---

## 7. Criterios de Aceptación

- [ ] Todos los nuevos tipos tienen Zod schemas
- [ ] Reducers funcionan correctamente
- [ ] Type guards son precisos
- [ ] Backward compatible con estado actual
- [ ] Nuevos eventos documentados
- [ ] Contract tests cubren todos los tipos
- [ ] `npm run verify:types` pasa sin errores

---

## 8. Archivos a Crear

### Backend
- `backend/src/modules/agents/orchestrator/state/PlanState.ts`
- `backend/src/modules/agents/orchestrator/state/AgentIdentity.ts`
- `backend/src/modules/agents/orchestrator/state/HandoffRecord.ts`
- `backend/src/modules/agents/orchestrator/state/OperationMode.ts`
- `backend/src/modules/agents/orchestrator/state/index.ts`

### Shared Package
- `packages/shared/src/types/plan.types.ts`
- `packages/shared/src/schemas/plan-events.schema.ts`

### Tests
- `backend/src/__tests__/unit/agents/state/PlanState.test.ts`
- `backend/src/__tests__/unit/agents/state/reducers.test.ts`
- `backend/src/__tests__/contracts/extended-state.contract.test.ts`

---

## 9. Archivos a Modificar

- `backend/src/modules/agents/orchestrator/state.ts` (extend with new annotations)
- `packages/shared/src/types/agent.types.ts` (add new event types)
- `packages/shared/src/types/index.ts` (export new types)

---

## 10. Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| Breaking change en estado | Baja | Alto | Defaults para nuevos campos |
| Serialization issues | Media | Medio | Contract tests exhaustivos |
| Performance overhead | Baja | Bajo | Lazy evaluation de reducers |

---

## 11. Estimación

- **Desarrollo**: 3-4 días
- **Testing**: 2-3 días
- **Documentation**: 1 día
- **Total**: 6-8 días

---

## 12. Changelog

| Fecha | Versión | Cambios |
|-------|---------|---------|
| 2026-01-21 | 1.0 | Draft inicial |

