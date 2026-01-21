# PRD-040: Dynamic Handoffs

**Estado**: Draft
**Prioridad**: Media
**Dependencias**: PRD-031 (Plan Executor), PRD-020 (Extended State)
**Bloquea**: Fase 5 (Graphing Agent)

---

## 1. Objetivo

Implementar handoffs dinámicos que permitan:
- Agentes delegando a otros agentes durante ejecución
- Re-routing basado en resultados parciales
- Escalación a supervisor cuando hay problemas
- Handoffs iniciados por el usuario (cambio de agente)

---

## 2. Contexto

### 2.1 Tipos de Handoffs

| Tipo | Iniciador | Ejemplo |
|------|-----------|---------|
| **Plan Step** | Supervisor | Plan dice: BC-Agent → RAG-Agent |
| **Capability Match** | Agente | BC-Agent no tiene tool, delega a RAG |
| **User Request** | Usuario | Usuario selecciona otro agente |
| **Error Recovery** | Sistema | Agente falla, escalación a supervisor |
| **Clarification** | Agente | Necesita info adicional |

### 2.2 Estado Actual

El sistema actual no permite handoffs durante ejecución - el router decide una vez al inicio.

---

## 3. Diseño Propuesto

### 3.1 Estructura de Archivos

```
backend/src/modules/agents/handoffs/
├── HandoffManager.ts           # Main handoff coordinator
├── HandoffValidator.ts         # Validate handoff requests
├── HandoffCommand.ts           # Command pattern for handoffs
├── strategies/
│   ├── PlanStepHandoff.ts      # Handoffs from plan execution
│   ├── CapabilityHandoff.ts    # Capability-based routing
│   ├── UserRequestHandoff.ts   # User-initiated handoffs
│   └── ErrorRecoveryHandoff.ts # Error recovery handoffs
└── index.ts
```

### 3.2 Handoff Command

```typescript
// HandoffCommand.ts
import { randomUUID } from 'crypto';
import type { HandoffReason, HandoffRecord } from '@/modules/agents/orchestrator/state/HandoffRecord';

/**
 * Command object for requesting a handoff
 *
 * Used by agents to signal they want to delegate to another agent.
 * Follows Command pattern for clear intent and validation.
 */
export interface HandoffCommand {
  /** Type discriminator */
  type: 'handoff';

  /** Target agent ID */
  targetAgentId: string;

  /** Reason for handoff */
  reason: HandoffReason;

  /** Human-readable explanation */
  explanation: string;

  /** Context to pass to target agent */
  payload?: Record<string, unknown>;

  /** Optional: specific task for target agent */
  task?: string;

  /** Whether to return control after target completes */
  returnControl?: boolean;
}

/**
 * Create a handoff command
 */
export function createHandoffCommand(
  targetAgentId: string,
  reason: HandoffReason,
  explanation: string,
  options?: {
    payload?: Record<string, unknown>;
    task?: string;
    returnControl?: boolean;
  }
): HandoffCommand {
  return {
    type: 'handoff',
    targetAgentId,
    reason,
    explanation,
    payload: options?.payload,
    task: options?.task,
    returnControl: options?.returnControl ?? false,
  };
}

/**
 * Check if an object is a handoff command
 */
export function isHandoffCommand(obj: unknown): obj is HandoffCommand {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    (obj as HandoffCommand).type === 'handoff' &&
    typeof (obj as HandoffCommand).targetAgentId === 'string'
  );
}

/**
 * Convert command to record for persistence
 */
export function commandToRecord(
  command: HandoffCommand,
  fromAgentId: string,
  planStepId?: string
): HandoffRecord {
  return {
    handoffId: randomUUID().toUpperCase(),
    fromAgentId,
    toAgentId: command.targetAgentId,
    reason: command.reason,
    explanation: command.explanation,
    payload: command.payload,
    planStepId,
    timestamp: new Date().toISOString(),
  };
}
```

### 3.3 Handoff Manager

```typescript
// HandoffManager.ts
import { getAgentRegistry } from '@/modules/agents/core/registry';
import { HandoffValidator } from './HandoffValidator';
import { createChildLogger } from '@/shared/utils/logger';
import type { HandoffCommand } from './HandoffCommand';
import type { ExtendedAgentState } from '@/modules/agents/orchestrator/state';
import type { HandoffRecord } from '@/modules/agents/orchestrator/state/HandoffRecord';

export interface HandoffResult {
  /** Whether handoff was accepted */
  accepted: boolean;

  /** The handoff record (if accepted) */
  record?: HandoffRecord;

  /** Reason for rejection (if rejected) */
  rejectionReason?: string;

  /** Updated state with new agent identity */
  updatedState?: Partial<ExtendedAgentState>;
}

/**
 * Manages handoffs between agents
 */
export class HandoffManager {
  private validator: HandoffValidator;
  private logger = createChildLogger({ service: 'HandoffManager' });

  constructor() {
    this.validator = new HandoffValidator();
  }

  /**
   * Process a handoff request from an agent
   */
  async processHandoff(
    command: HandoffCommand,
    currentState: ExtendedAgentState
  ): Promise<HandoffResult> {
    const fromAgentId = currentState.activeAgent;

    // Validate handoff
    const validation = this.validator.validate(command, currentState);
    if (!validation.valid) {
      this.logger.warn({
        from: fromAgentId,
        to: command.targetAgentId,
        reason: validation.reason,
      }, 'Handoff rejected');

      return {
        accepted: false,
        rejectionReason: validation.reason,
      };
    }

    // Get target agent info
    const registry = getAgentRegistry();
    const targetAgent = registry.get(command.targetAgentId);

    if (!targetAgent) {
      return {
        accepted: false,
        rejectionReason: `Unknown agent: ${command.targetAgentId}`,
      };
    }

    // Create handoff record
    const record: HandoffRecord = {
      handoffId: require('crypto').randomUUID().toUpperCase(),
      fromAgentId,
      toAgentId: command.targetAgentId,
      reason: command.reason,
      explanation: command.explanation,
      payload: command.payload,
      planStepId: currentState.plan?.steps[currentState.plan.currentStepIndex]?.stepId,
      timestamp: new Date().toISOString(),
    };

    this.logger.info({
      handoffId: record.handoffId,
      from: fromAgentId,
      to: command.targetAgentId,
      reason: command.reason,
    }, 'Handoff accepted');

    // Build updated state
    const updatedState: Partial<ExtendedAgentState> = {
      activeAgent: command.targetAgentId,
      currentAgentIdentity: {
        agentId: targetAgent.id,
        agentName: targetAgent.name,
        agentIcon: targetAgent.icon,
        agentColor: targetAgent.color,
      },
      handoffHistory: [...currentState.handoffHistory, record],
    };

    return {
      accepted: true,
      record,
      updatedState,
    };
  }

  /**
   * Process user-initiated agent change
   */
  async processUserAgentSelection(
    targetAgentId: string,
    currentState: ExtendedAgentState
  ): Promise<HandoffResult> {
    const registry = getAgentRegistry();
    const targetAgent = registry.get(targetAgentId);

    if (!targetAgent) {
      return {
        accepted: false,
        rejectionReason: `Unknown agent: ${targetAgentId}`,
      };
    }

    if (!targetAgent.isUserSelectable) {
      return {
        accepted: false,
        rejectionReason: `Agent ${targetAgentId} is not user-selectable`,
      };
    }

    const record: HandoffRecord = {
      handoffId: require('crypto').randomUUID().toUpperCase(),
      fromAgentId: currentState.activeAgent,
      toAgentId: targetAgentId,
      reason: 'user_request',
      explanation: 'User selected different agent',
      timestamp: new Date().toISOString(),
    };

    return {
      accepted: true,
      record,
      updatedState: {
        activeAgent: targetAgentId,
        operationMode: 'directed',
        directedModeContext: {
          targetAgentId,
          bypassRouting: true,
        },
        currentAgentIdentity: {
          agentId: targetAgent.id,
          agentName: targetAgent.name,
          agentIcon: targetAgent.icon,
          agentColor: targetAgent.color,
        },
        handoffHistory: [...currentState.handoffHistory, record],
      },
    };
  }
}

// Singleton
let instance: HandoffManager | null = null;

export function getHandoffManager(): HandoffManager {
  if (!instance) {
    instance = new HandoffManager();
  }
  return instance;
}
```

### 3.4 Handoff Validator

```typescript
// HandoffValidator.ts
import { getAgentRegistry } from '@/modules/agents/core/registry';
import type { HandoffCommand } from './HandoffCommand';
import type { ExtendedAgentState } from '@/modules/agents/orchestrator/state';

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validates handoff requests
 */
export class HandoffValidator {
  /**
   * Validate a handoff command
   */
  validate(
    command: HandoffCommand,
    state: ExtendedAgentState
  ): ValidationResult {
    const registry = getAgentRegistry();

    // Check target agent exists
    const targetAgent = registry.get(command.targetAgentId);
    if (!targetAgent) {
      return {
        valid: false,
        reason: `Target agent '${command.targetAgentId}' not found`,
      };
    }

    // Check not handing off to self
    if (command.targetAgentId === state.activeAgent) {
      return {
        valid: false,
        reason: 'Cannot handoff to self',
      };
    }

    // Check not handing off to system-only agent (unless from supervisor)
    if (targetAgent.isSystemAgent && state.activeAgent !== 'supervisor') {
      return {
        valid: false,
        reason: `Cannot handoff to system agent '${command.targetAgentId}'`,
      };
    }

    // Check handoff depth (prevent infinite loops)
    const recentHandoffs = state.handoffHistory.slice(-5);
    const handoffLoop = recentHandoffs.filter(
      h => h.toAgentId === command.targetAgentId
    ).length >= 2;

    if (handoffLoop) {
      return {
        valid: false,
        reason: 'Potential handoff loop detected',
      };
    }

    // Check if target has required capabilities (for capability_match reason)
    if (command.reason === 'capability_match' && command.payload?.requiredCapability) {
      const capability = command.payload.requiredCapability as string;
      if (!targetAgent.capabilities.includes(capability as any)) {
        return {
          valid: false,
          reason: `Target agent doesn't have capability: ${capability}`,
        };
      }
    }

    return { valid: true };
  }
}
```

### 3.5 Agent Integration

```typescript
// Example: How an agent can request a handoff

import { createHandoffCommand, isHandoffCommand } from '@/modules/agents/handoffs';

// In agent node:
async function bcAgentNode(state: ExtendedAgentState): Promise<Partial<ExtendedAgentState>> {
  // ... agent logic ...

  // If agent determines it can't handle the request:
  if (needsDocumentSearch(state)) {
    const handoffCommand = createHandoffCommand(
      'rag-agent',
      'capability_match',
      'Query requires document search which BC Agent cannot perform',
      {
        payload: {
          searchQuery: extractSearchQuery(state),
          requiredCapability: 'rag_search',
        },
        returnControl: true,
      }
    );

    // Return command as tool result for graph to process
    return {
      toolExecutions: [{
        toolUseId: 'handoff-request',
        toolName: '__handoff__',
        toolInput: handoffCommand,
        toolOutput: JSON.stringify(handoffCommand),
        success: true,
        timestamp: new Date().toISOString(),
      }],
    };
  }

  // Normal response
  return { /* ... */ };
}
```

### 3.6 Graph Integration

```typescript
// handoffRouter.ts - Conditional edge function

import { isHandoffCommand } from '@/modules/agents/handoffs';
import { getHandoffManager } from '@/modules/agents/handoffs';
import type { ExtendedAgentState } from '@/modules/agents/orchestrator/state';

/**
 * Route based on handoff commands in state
 */
export function routeHandoffs(state: ExtendedAgentState): string {
  // Check for handoff command in tool executions
  const handoffExec = state.toolExecutions.find(
    t => t.toolName === '__handoff__'
  );

  if (handoffExec && isHandoffCommand(handoffExec.toolInput)) {
    return 'process_handoff';
  }

  // Check if plan has more steps
  if (state.plan && state.plan.currentStepIndex < state.plan.steps.length - 1) {
    return 'next_step';
  }

  // Done
  return 'complete';
}

/**
 * Process handoff node
 */
export async function processHandoffNode(
  state: ExtendedAgentState
): Promise<Partial<ExtendedAgentState>> {
  const handoffExec = state.toolExecutions.find(
    t => t.toolName === '__handoff__'
  );

  if (!handoffExec || !isHandoffCommand(handoffExec.toolInput)) {
    throw new Error('No handoff command found');
  }

  const manager = getHandoffManager();
  const result = await manager.processHandoff(handoffExec.toolInput, state);

  if (!result.accepted) {
    // Handoff rejected - return to supervisor
    return {
      activeAgent: 'supervisor',
      // Add error message
    };
  }

  return result.updatedState!;
}
```

---

## 4. WebSocket Events

```typescript
// Eventos ya definidos en PRD-020 y PRD-031
// - agent_handoff: Emitido cuando ocurre un handoff
// - agent_changed: Emitido cuando el agente activo cambia
```

---

## 5. Tests Requeridos

```typescript
describe('HandoffManager', () => {
  it('accepts valid handoff');
  it('rejects handoff to unknown agent');
  it('rejects handoff to self');
  it('rejects handoff loop');
  it('processes user agent selection');
});

describe('HandoffValidator', () => {
  it('validates target agent exists');
  it('validates capability match');
  it('detects handoff loops');
});

describe('HandoffCommand', () => {
  it('creates valid command');
  it('converts to record');
  it('identifies command objects');
});
```

---

## 6. Criterios de Aceptación

- [ ] Agent-initiated handoffs work
- [ ] User-initiated handoffs work
- [ ] Handoff validation prevents loops
- [ ] Handoff history tracked
- [ ] Events emitted correctly
- [ ] Graph routing works
- [ ] `npm run verify:types` pasa

---

## 7. Estimación

- **Desarrollo**: 4-5 días
- **Testing**: 2-3 días
- **Integration**: 2 días
- **Total**: 8-10 días

---

## 8. Changelog

| Fecha | Versión | Cambios |
|-------|---------|---------|
| 2026-01-21 | 1.0 | Draft inicial |

