# PRD-031: Plan Executor

**Estado**: Draft
**Prioridad**: Alta
**Dependencias**: PRD-030 (Planner Agent), PRD-020 (Extended State)
**Bloquea**: Fase 4 (Handoffs)

---

## 1. Objetivo

Implementar el ejecutor de planes que:
- Ejecuta steps del plan secuencialmente
- Maneja el contexto entre steps
- Emite eventos de progreso a la UI
- Gestiona errores y re-planificación
- Coordina handoffs entre agentes

---

## 2. Contexto

### 2.1 Flujo de Ejecución

```
PlanState (from Supervisor)
    │
    ▼
┌─────────────────────────────────────────┐
│           PLAN EXECUTOR                 │
│                                         │
│  for each step in plan:                │
│    1. Emit plan_step_started           │
│    2. Set currentAgentIdentity         │
│    3. Invoke agent node                │
│    4. Collect result                   │
│    5. Emit plan_step_completed         │
│    6. Check if re-plan needed          │
│                                         │
│  end: Emit plan_completed              │
└─────────────────────────────────────────┘
    │
    ▼
Final Response
```

---

## 3. Diseño Propuesto

### 3.1 Estructura de Archivos

```
backend/src/modules/agents/supervisor/
├── PlanExecutor.ts              # Main executor
├── StepExecutor.ts              # Individual step execution
├── ResultAggregator.ts          # Aggregate results across steps
├── ErrorRecoveryHandler.ts      # Handle step failures
└── events/
    ├── PlanEventEmitter.ts      # Emit plan-related events
    └── index.ts
```

### 3.2 Plan Executor

```typescript
// PlanExecutor.ts
import { randomUUID } from 'crypto';
import { getAgentRegistry } from '@/modules/agents/core/registry';
import { StepExecutor, type StepExecutionResult } from './StepExecutor';
import { ResultAggregator } from './ResultAggregator';
import { ErrorRecoveryHandler, type RecoveryAction } from './ErrorRecoveryHandler';
import { PlanEventEmitter } from './events/PlanEventEmitter';
import type { ExtendedAgentState } from '@/modules/agents/orchestrator/state';
import type { PlanState, PlanStep, PlanStepStatus } from '@/modules/agents/orchestrator/state/PlanState';
import type { HandoffRecord } from '@/modules/agents/orchestrator/state/HandoffRecord';

export interface PlanExecutionConfig {
  /** Maximum retries per step */
  maxRetries?: number;

  /** Whether to continue on step failure */
  continueOnFailure?: boolean;

  /** Timeout per step in ms */
  stepTimeoutMs?: number;
}

const DEFAULT_CONFIG: Required<PlanExecutionConfig> = {
  maxRetries: 2,
  continueOnFailure: false,
  stepTimeoutMs: 60000, // 1 minute
};

export interface PlanExecutionResult {
  /** Final plan state */
  plan: PlanState;

  /** Aggregated results from all steps */
  aggregatedResult: string;

  /** All handoffs that occurred */
  handoffs: HandoffRecord[];

  /** Whether execution was successful */
  success: boolean;

  /** Error if failed */
  error?: string;
}

/**
 * Plan Executor - Executes multi-step plans
 */
export class PlanExecutor {
  private stepExecutor: StepExecutor;
  private aggregator: ResultAggregator;
  private errorHandler: ErrorRecoveryHandler;
  private eventEmitter: PlanEventEmitter;
  private config: Required<PlanExecutionConfig>;

  constructor(
    eventEmitter: PlanEventEmitter,
    config?: PlanExecutionConfig
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.stepExecutor = new StepExecutor(this.config.stepTimeoutMs);
    this.aggregator = new ResultAggregator();
    this.errorHandler = new ErrorRecoveryHandler(this.config.maxRetries);
    this.eventEmitter = eventEmitter;
  }

  /**
   * Execute a plan
   */
  async execute(
    state: ExtendedAgentState,
    invokeAgent: (agentId: string, state: ExtendedAgentState) => Promise<ExtendedAgentState>
  ): Promise<PlanExecutionResult> {
    const plan = state.plan;
    if (!plan) {
      throw new Error('No plan to execute');
    }

    const handoffs: HandoffRecord[] = [];
    const stepResults: StepExecutionResult[] = [];
    let currentState = state;
    let previousAgentId = 'supervisor';

    // Execute each step
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];

      // Update plan state
      plan.currentStepIndex = i;
      plan.steps[i].status = 'in_progress';
      plan.steps[i].startedAt = new Date().toISOString();

      // Emit step started event
      await this.eventEmitter.emitStepStarted(state.context.sessionId, plan, step);

      // Record handoff
      if (step.agentId !== previousAgentId) {
        const handoff = this.createHandoff(previousAgentId, step.agentId, step, plan.planId);
        handoffs.push(handoff);
        currentState = {
          ...currentState,
          handoffHistory: [...currentState.handoffHistory, handoff],
        };

        // Emit handoff event
        await this.eventEmitter.emitHandoff(state.context.sessionId, handoff);
      }

      // Update agent identity
      const agent = getAgentRegistry().get(step.agentId);
      currentState = {
        ...currentState,
        activeAgent: step.agentId,
        currentAgentIdentity: {
          agentId: step.agentId,
          agentName: agent?.name ?? step.agentId,
          agentIcon: agent?.icon,
          agentColor: agent?.color,
        },
      };

      // Execute step with retry logic
      const result = await this.executeStepWithRetry(
        step,
        currentState,
        invokeAgent
      );

      stepResults.push(result);

      // Update step status
      plan.steps[i].status = result.success ? 'completed' : 'failed';
      plan.steps[i].completedAt = new Date().toISOString();
      plan.steps[i].result = result.result;
      plan.steps[i].error = result.error;

      // Emit step completed event
      await this.eventEmitter.emitStepCompleted(state.context.sessionId, plan, step);

      // Handle failure
      if (!result.success) {
        const recovery = this.errorHandler.determineRecovery(step, result.error ?? '');

        if (recovery === 'abort') {
          plan.status = 'failed';
          plan.failureReason = `Step ${i + 1} failed: ${result.error}`;
          break;
        } else if (recovery === 'skip') {
          plan.steps[i].status = 'skipped';
        }
        // 'continue' - just proceed to next step
      }

      // Update state with step result
      currentState = result.updatedState ?? currentState;
      previousAgentId = step.agentId;
    }

    // Finalize plan
    if (plan.status !== 'failed') {
      plan.status = 'completed';
    }
    plan.completedAt = new Date().toISOString();

    // Emit plan completed event
    await this.eventEmitter.emitPlanCompleted(state.context.sessionId, plan);

    // Aggregate results
    const aggregatedResult = this.aggregator.aggregate(stepResults, plan);

    return {
      plan,
      aggregatedResult,
      handoffs,
      success: plan.status === 'completed',
      error: plan.failureReason,
    };
  }

  /**
   * Execute a single step with retry logic
   */
  private async executeStepWithRetry(
    step: PlanStep,
    state: ExtendedAgentState,
    invokeAgent: (agentId: string, state: ExtendedAgentState) => Promise<ExtendedAgentState>
  ): Promise<StepExecutionResult> {
    let lastError: string | undefined;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const result = await this.stepExecutor.execute(step, state, invokeAgent);

        if (result.success) {
          return result;
        }

        lastError = result.error;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }

      // Wait before retry (exponential backoff)
      if (attempt < this.config.maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }

    return {
      stepId: step.stepId,
      success: false,
      error: lastError ?? 'Unknown error after retries',
    };
  }

  /**
   * Create handoff record
   */
  private createHandoff(
    fromAgentId: string,
    toAgentId: string,
    step: PlanStep,
    planId: string
  ): HandoffRecord {
    const registry = getAgentRegistry();
    const fromAgent = registry.get(fromAgentId);
    const toAgent = registry.get(toAgentId);

    return {
      handoffId: randomUUID().toUpperCase(),
      fromAgentId,
      toAgentId,
      reason: 'plan_step',
      explanation: `Executing plan step: ${step.task}`,
      planStepId: step.stepId,
      timestamp: new Date().toISOString(),
    };
  }
}
```

### 3.3 Step Executor

```typescript
// StepExecutor.ts
import type { ExtendedAgentState } from '@/modules/agents/orchestrator/state';
import type { PlanStep } from '@/modules/agents/orchestrator/state/PlanState';

export interface StepExecutionResult {
  stepId: string;
  success: boolean;
  result?: string;
  error?: string;
  updatedState?: ExtendedAgentState;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * Executes individual plan steps
 */
export class StepExecutor {
  constructor(private timeoutMs: number) {}

  /**
   * Execute a single step
   */
  async execute(
    step: PlanStep,
    state: ExtendedAgentState,
    invokeAgent: (agentId: string, state: ExtendedAgentState) => Promise<ExtendedAgentState>
  ): Promise<StepExecutionResult> {
    // Add step context to messages
    const contextMessage = this.buildContextMessage(step, state);
    const stateWithContext = {
      ...state,
      messages: [...state.messages, contextMessage],
    };

    // Execute with timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Step execution timeout')), this.timeoutMs);
    });

    try {
      const resultState = await Promise.race([
        invokeAgent(step.agentId, stateWithContext),
        timeoutPromise,
      ]);

      // Extract result from last message
      const lastMessage = resultState.messages[resultState.messages.length - 1];
      const result = typeof lastMessage.content === 'string'
        ? lastMessage.content
        : JSON.stringify(lastMessage.content);

      return {
        stepId: step.stepId,
        success: true,
        result,
        updatedState: resultState,
      };
    } catch (error) {
      return {
        stepId: step.stepId,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Build context message for step
   */
  private buildContextMessage(step: PlanStep, state: ExtendedAgentState) {
    const { HumanMessage } = require('@langchain/core/messages');

    // Include step task and any relevant context from previous steps
    const previousResults = state.plan?.steps
      .filter(s => s.status === 'completed' && s.result)
      .map(s => `- Step ${s.stepIndex + 1} (${s.agentId}): ${s.result}`)
      .join('\n');

    const content = previousResults
      ? `Previous step results:\n${previousResults}\n\nCurrent task: ${step.task}`
      : `Task: ${step.task}`;

    return new HumanMessage({
      content,
      additional_kwargs: {
        isPlanContext: true,
        stepId: step.stepId,
      },
    });
  }
}
```

### 3.4 Result Aggregator

```typescript
// ResultAggregator.ts
import type { StepExecutionResult } from './StepExecutor';
import type { PlanState } from '@/modules/agents/orchestrator/state/PlanState';

/**
 * Aggregates results from multiple plan steps into a coherent response
 */
export class ResultAggregator {
  /**
   * Aggregate step results into final response
   */
  aggregate(results: StepExecutionResult[], plan: PlanState): string {
    const completedResults = results.filter(r => r.success && r.result);

    if (completedResults.length === 0) {
      return `I wasn't able to complete the plan due to errors.`;
    }

    if (completedResults.length === 1) {
      return completedResults[0].result!;
    }

    // For multiple results, create a summary
    const parts: string[] = [];

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      const result = results.find(r => r.stepId === step.stepId);

      if (result?.success && result.result) {
        parts.push(`**${step.task}**\n${result.result}`);
      } else if (step.status === 'skipped') {
        parts.push(`**${step.task}**\n_Skipped_`);
      }
    }

    return parts.join('\n\n---\n\n');
  }
}
```

### 3.5 Plan Event Emitter

```typescript
// events/PlanEventEmitter.ts
import { randomUUID } from 'crypto';
import type { PlanState, PlanStep } from '@/modules/agents/orchestrator/state/PlanState';
import type { HandoffRecord } from '@/modules/agents/orchestrator/state/HandoffRecord';
import { getAgentRegistry } from '@/modules/agents/core/registry';

export interface PlanEventCallback {
  (event: PlanEvent): void;
}

export type PlanEvent =
  | PlanGeneratedEvent
  | PlanStepStartedEvent
  | PlanStepCompletedEvent
  | PlanCompletedEvent
  | AgentHandoffEvent;

interface BasePlanEvent {
  type: string;
  sessionId: string;
  eventId: string;
  timestamp: string;
}

interface PlanGeneratedEvent extends BasePlanEvent {
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

interface PlanStepStartedEvent extends BasePlanEvent {
  type: 'plan_step_started';
  planId: string;
  stepId: string;
  stepIndex: number;
  agentId: string;
  agentName: string;
  task: string;
}

interface PlanStepCompletedEvent extends BasePlanEvent {
  type: 'plan_step_completed';
  planId: string;
  stepId: string;
  stepIndex: number;
  status: 'completed' | 'failed' | 'skipped';
  result?: string;
  error?: string;
}

interface PlanCompletedEvent extends BasePlanEvent {
  type: 'plan_completed';
  planId: string;
  status: 'completed' | 'failed' | 'cancelled';
  summary?: string;
  failureReason?: string;
}

interface AgentHandoffEvent extends BasePlanEvent {
  type: 'agent_handoff';
  handoffId: string;
  fromAgent: { agentId: string; agentName: string };
  toAgent: { agentId: string; agentName: string };
  reason: string;
  explanation?: string;
}

/**
 * Emits plan-related events to WebSocket
 */
export class PlanEventEmitter {
  constructor(private callback: PlanEventCallback) {}

  async emitPlanGenerated(sessionId: string, plan: PlanState): Promise<void> {
    const registry = getAgentRegistry();

    const event: PlanGeneratedEvent = {
      type: 'plan_generated',
      sessionId,
      eventId: randomUUID().toUpperCase(),
      timestamp: new Date().toISOString(),
      planId: plan.planId,
      query: plan.query,
      steps: plan.steps.map(s => ({
        stepId: s.stepId,
        stepIndex: s.stepIndex,
        agentId: s.agentId,
        agentName: registry.get(s.agentId)?.name ?? s.agentId,
        task: s.task,
      })),
      estimatedSteps: plan.steps.length,
    };

    this.callback(event);
  }

  async emitStepStarted(sessionId: string, plan: PlanState, step: PlanStep): Promise<void> {
    const registry = getAgentRegistry();

    const event: PlanStepStartedEvent = {
      type: 'plan_step_started',
      sessionId,
      eventId: randomUUID().toUpperCase(),
      timestamp: new Date().toISOString(),
      planId: plan.planId,
      stepId: step.stepId,
      stepIndex: step.stepIndex,
      agentId: step.agentId,
      agentName: registry.get(step.agentId)?.name ?? step.agentId,
      task: step.task,
    };

    this.callback(event);
  }

  async emitStepCompleted(sessionId: string, plan: PlanState, step: PlanStep): Promise<void> {
    const event: PlanStepCompletedEvent = {
      type: 'plan_step_completed',
      sessionId,
      eventId: randomUUID().toUpperCase(),
      timestamp: new Date().toISOString(),
      planId: plan.planId,
      stepId: step.stepId,
      stepIndex: step.stepIndex,
      status: step.status === 'completed' ? 'completed' :
              step.status === 'skipped' ? 'skipped' : 'failed',
      result: step.result,
      error: step.error,
    };

    this.callback(event);
  }

  async emitPlanCompleted(sessionId: string, plan: PlanState): Promise<void> {
    const event: PlanCompletedEvent = {
      type: 'plan_completed',
      sessionId,
      eventId: randomUUID().toUpperCase(),
      timestamp: new Date().toISOString(),
      planId: plan.planId,
      status: plan.status === 'completed' ? 'completed' :
              plan.status === 'cancelled' ? 'cancelled' : 'failed',
      summary: plan.summary,
      failureReason: plan.failureReason,
    };

    this.callback(event);
  }

  async emitHandoff(sessionId: string, handoff: HandoffRecord): Promise<void> {
    const registry = getAgentRegistry();

    const event: AgentHandoffEvent = {
      type: 'agent_handoff',
      sessionId,
      eventId: randomUUID().toUpperCase(),
      timestamp: new Date().toISOString(),
      handoffId: handoff.handoffId,
      fromAgent: {
        agentId: handoff.fromAgentId,
        agentName: registry.get(handoff.fromAgentId)?.name ?? handoff.fromAgentId,
      },
      toAgent: {
        agentId: handoff.toAgentId,
        agentName: registry.get(handoff.toAgentId)?.name ?? handoff.toAgentId,
      },
      reason: handoff.reason,
      explanation: handoff.explanation,
    };

    this.callback(event);
  }
}
```

---

## 4. Graph Integration

```typescript
// planExecutorNode.ts
import { ExtendedAgentState } from '@/modules/agents/orchestrator/state';
import { PlanExecutor } from './PlanExecutor';
import { PlanEventEmitter } from './events/PlanEventEmitter';

/**
 * Plan Executor node for LangGraph
 */
export async function planExecutorNode(
  state: ExtendedAgentState,
  config: { callbacks?: { onEvent?: (event: any) => void } }
): Promise<Partial<ExtendedAgentState>> {
  const eventEmitter = new PlanEventEmitter(
    config.callbacks?.onEvent ?? (() => {})
  );

  const executor = new PlanExecutor(eventEmitter);

  // Import agent nodes
  const { bcAgentNode, ragAgentNode, graphAgentNode } = await import('../agents');

  const agentNodes: Record<string, (state: ExtendedAgentState) => Promise<ExtendedAgentState>> = {
    'bc-agent': bcAgentNode,
    'rag-agent': ragAgentNode,
    'graph-agent': graphAgentNode,
  };

  const invokeAgent = async (agentId: string, agentState: ExtendedAgentState) => {
    const agentNode = agentNodes[agentId];
    if (!agentNode) {
      throw new Error(`Unknown agent: ${agentId}`);
    }
    return agentNode(agentState);
  };

  const result = await executor.execute(state, invokeAgent);

  // Add aggregated result as assistant message
  const { AIMessage } = await import('@langchain/core/messages');
  const responseMessage = new AIMessage(result.aggregatedResult);

  return {
    messages: [responseMessage],
    plan: result.plan,
    handoffHistory: result.handoffs,
  };
}
```

---

## 5. Tests Requeridos

### 5.1 PlanExecutor Tests
```typescript
describe('PlanExecutor', () => {
  it('executes single-step plan');
  it('executes multi-step plan in order');
  it('handles step failure with retry');
  it('aborts on failure when configured');
  it('skips step on failure when configured');
  it('records handoffs between agents');
  it('emits all plan events');
  it('aggregates results correctly');
});
```

### 5.2 StepExecutor Tests
```typescript
describe('StepExecutor', () => {
  it('executes step successfully');
  it('handles timeout');
  it('passes context from previous steps');
});
```

---

## 6. Criterios de Aceptación

- [ ] Steps execute in order
- [ ] Retry logic works correctly
- [ ] Events emitted at correct times
- [ ] Handoffs tracked properly
- [ ] Results aggregated meaningfully
- [ ] Timeout handling works
- [ ] Error recovery works
- [ ] `npm run verify:types` pasa sin errores

---

## 7. Estimación

- **Desarrollo**: 5-6 días
- **Testing**: 2-3 días
- **Integration**: 2 días
- **Total**: 9-11 días

---

## 8. Changelog

| Fecha | Versión | Cambios |
|-------|---------|---------|
| 2026-01-21 | 1.0 | Draft inicial |

