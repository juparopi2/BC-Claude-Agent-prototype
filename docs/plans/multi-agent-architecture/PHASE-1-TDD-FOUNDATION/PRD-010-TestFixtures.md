# PRD-010: Test Fixtures for Multi-Agent Architecture

**Estado**: Draft
**Prioridad**: Alta
**Dependencias**: Fase 0 completada
**Bloquea**: Todas las fases siguientes

---

## 1. Objetivo

Crear infraestructura de testing robusta que permita:
- Testing aislado de agentes sin llamadas a LLM reales
- Simulación determinista de respuestas de agentes
- Contract tests para WebSocket events y AgentState
- Fixtures reutilizables para diferentes escenarios

---

## 2. Contexto

### 2.1 Estado Actual

Testing de agentes actualmente requiere:
- LLM real (costoso, no determinista)
- Mocks ad-hoc en cada test
- No hay fixtures compartidos
- Contract tests inexistentes

### 2.2 Por qué es Crítico

La arquitectura multi-agente introduce:
- Supervisor que genera planes
- Múltiples agentes que pueden ser invocados
- Handoffs entre agentes
- Nuevos tipos de eventos WebSocket

Sin fixtures adecuados, cada nuevo componente requeriría:
- Tests complejos con muchas dependencias
- Mocking manual y repetitivo
- Riesgo de breaking changes silenciosos

---

## 3. Diseño Propuesto

### 3.1 Estructura de Archivos

```
backend/src/__tests__/
├── fakes/
│   ├── FakeChatModel.ts         # Mock LLM provider-agnostic
│   ├── FakeAgentRegistry.ts     # Mock agent registry
│   ├── FakeEventStore.ts        # In-memory event store
│   ├── FakePersistenceCoordinator.ts
│   └── FakeSocketIO.ts          # Mock Socket.IO for events
├── fixtures/
│   ├── AgentStateFixture.ts     # Builder para AgentState
│   ├── PlanFixture.ts           # Builder para planes
│   ├── MessageFixture.ts        # Builder para mensajes
│   ├── ToolExecutionFixture.ts  # Builder para tool executions
│   └── LLMResponseSimulator.ts  # Simular respuestas LLM
├── contracts/
│   ├── agent-events.contract.test.ts    # WebSocket event schemas
│   ├── agent-state.contract.test.ts     # AgentState schema validation
│   ├── plan-events.contract.test.ts     # Plan-related events
│   └── tool-events.contract.test.ts     # Tool use/result events
└── helpers/
    ├── createTestContext.ts     # Factory para ExecutionContext
    └── waitForEvent.ts          # Helper para async events
```

### 3.2 Componentes Detallados

#### FakeChatModel.ts
```typescript
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, BaseMessage } from '@langchain/core/messages';

/**
 * FakeChatModel - Mock LLM for deterministic testing
 *
 * Replaces real LLM calls with pre-configured responses.
 * Supports multiple response modes:
 * - Fixed response
 * - Sequence of responses
 * - Response based on input pattern
 * - Tool use responses
 */
export class FakeChatModel extends BaseChatModel {
  private responseQueue: AIMessage[] = [];
  private callHistory: BaseMessage[][] = [];
  private responsePatterns: Map<RegExp, AIMessage> = new Map();

  // Configure fixed response
  setResponse(response: string | AIMessage): this;

  // Configure sequence of responses
  setResponseSequence(responses: Array<string | AIMessage>): this;

  // Configure pattern-based responses
  addResponsePattern(pattern: RegExp, response: string | AIMessage): this;

  // Configure tool use response
  setToolUseResponse(toolName: string, args: Record<string, unknown>): this;

  // Get call history for assertions
  getCallHistory(): BaseMessage[][];
  getLastCall(): BaseMessage[] | undefined;
  getCallCount(): number;

  // Clear state between tests
  reset(): void;

  // BaseChatModel implementation
  _llmType(): string { return 'fake'; }
  async _generate(messages: BaseMessage[]): Promise<ChatResult>;
}
```

#### AgentStateFixture.ts
```typescript
import { AgentState, ExtendedAgentState } from '@/modules/agents/orchestrator/state';

/**
 * AgentStateFixture - Builder pattern for test AgentState
 *
 * Provides fluent API for creating AgentState with various configurations.
 */
export class AgentStateFixture {
  private state: Partial<AgentState> = {};

  static create(): AgentStateFixture;

  // Message builders
  withUserMessage(content: string): this;
  withAssistantMessage(content: string): this;
  withToolUse(toolName: string, args: Record<string, unknown>): this;
  withToolResult(toolUseId: string, result: string): this;
  withMessages(messages: BaseMessage[]): this;

  // Context builders
  withContext(context: Partial<AgentContext>): this;
  withUserId(userId: string): this;
  withSessionId(sessionId: string): this;
  withFileContext(fileContext: FileContextResult): this;

  // Agent state
  withActiveAgent(agentName: string): this;
  withToolExecutions(executions: ToolExecution[]): this;

  // Extended state (for Phase 2+)
  withPlan(plan: PlanState): this;
  withAgentIdentity(identity: AgentIdentity): this;
  withHandoffHistory(history: HandoffRecord[]): this;

  // Build
  build(): AgentState;
  buildExtended(): ExtendedAgentState;

  // Presets
  static empty(): AgentState;
  static withSimpleQuery(query: string): AgentState;
  static withToolUsage(toolName: string, args: Record<string, unknown>): AgentState;
  static withMultiTurnConversation(turns: Array<{role: string, content: string}>): AgentState;
}
```

#### PlanFixture.ts
```typescript
/**
 * PlanFixture - Builder for PlanState (Phase 3+)
 */
export class PlanFixture {
  private plan: Partial<PlanState> = {};

  static create(): PlanFixture;

  withPlanId(id: string): this;
  withQuery(query: string): this;
  withStatus(status: 'planning' | 'executing' | 'completed' | 'failed'): this;

  // Steps
  addStep(step: Partial<PlanStep>): this;
  withSteps(steps: PlanStep[]): this;
  withCurrentStepIndex(index: number): this;

  // Step shortcuts
  addBCAgentStep(task: string): this;
  addRAGAgentStep(task: string): this;
  addGraphingAgentStep(task: string): this;

  // Build
  build(): PlanState;

  // Presets
  static simplePlan(query: string, agentId: string): PlanState;
  static multiStepPlan(query: string, steps: Array<{agentId: string, task: string}>): PlanState;
  static completedPlan(query: string): PlanState;
  static failedPlan(query: string, errorStep: number): PlanState;
}
```

#### LLMResponseSimulator.ts
```typescript
/**
 * LLMResponseSimulator - Simulate realistic LLM responses
 *
 * Generates deterministic responses that match real LLM output structure.
 */
export class LLMResponseSimulator {
  // Simulate text response
  static textResponse(content: string, options?: {
    model?: string;
    stopReason?: StopReason;
    inputTokens?: number;
    outputTokens?: number;
  }): AIMessage;

  // Simulate thinking response
  static thinkingResponse(thinking: string, content: string): AIMessage;

  // Simulate tool use
  static toolUseResponse(tools: Array<{
    name: string;
    args: Record<string, unknown>;
  }>): AIMessage;

  // Simulate tool_use + text (mixed)
  static mixedResponse(
    text: string,
    tools: Array<{name: string; args: Record<string, unknown>}>
  ): AIMessage;

  // Simulate plan generation (Phase 3+)
  static planResponse(plan: PlanState): AIMessage;

  // Simulate routing decision
  static routingResponse(targetAgent: string, reason: string): AIMessage;
}
```

#### Contract Tests

```typescript
// agent-events.contract.test.ts
import { z } from 'zod';
import {
  AgentEventSchema,
  MessageEventSchema,
  ToolUseEventSchema,
  ToolResultEventSchema,
  ThinkingCompleteEventSchema,
  CompleteEventSchema,
} from '@bc-agent/shared';

describe('Agent Event Contracts', () => {
  describe('MessageEvent', () => {
    it('validates required fields', () => {
      const event = {
        type: 'message',
        sessionId: 'test-session',
        eventId: 'event-123',
        messageId: 'msg-123',
        content: 'Hello',
        role: 'assistant',
        timestamp: new Date().toISOString(),
        persistenceState: 'persisted',
      };

      expect(() => MessageEventSchema.parse(event)).not.toThrow();
    });

    it('rejects invalid stopReason', () => {
      const event = {
        type: 'message',
        sessionId: 'test-session',
        eventId: 'event-123',
        messageId: 'msg-123',
        content: 'Hello',
        role: 'assistant',
        timestamp: new Date().toISOString(),
        persistenceState: 'persisted',
        stopReason: 'invalid_reason', // Invalid
      };

      expect(() => MessageEventSchema.parse(event)).toThrow();
    });
  });

  describe('ToolUseEvent', () => {
    it('validates tool use fields');
    it('validates args is object');
  });

  // ... more contracts
});
```

#### createTestContext.ts
```typescript
import { createExecutionContextSync } from '@/domains/agent/orchestration/ExecutionContextSync';

export interface TestContextOptions {
  sessionId?: string;
  userId?: string;
  callback?: (event: AgentEvent) => void;
  enableThinking?: boolean;
  thinkingBudget?: number;
}

export function createTestContext(options?: TestContextOptions): ExecutionContextSync {
  const events: AgentEvent[] = [];
  const callback = options?.callback ?? ((e) => events.push(e));

  const ctx = createExecutionContextSync(
    options?.sessionId ?? 'test-session-' + Date.now(),
    options?.userId ?? 'test-user-' + Date.now(),
    callback,
    {
      enableThinking: options?.enableThinking ?? false,
      thinkingBudget: options?.thinkingBudget ?? 10000,
    }
  );

  // Attach events for assertions
  (ctx as any).__testEvents = events;

  return ctx;
}

export function getTestEvents(ctx: ExecutionContextSync): AgentEvent[] {
  return (ctx as any).__testEvents ?? [];
}
```

---

## 4. Plan de Implementación

### Paso 1: Core Fakes (3 días)
1. FakeChatModel
2. FakeEventStore
3. FakePersistenceCoordinator
4. FakeSocketIO

### Paso 2: Fixtures (2 días)
1. AgentStateFixture
2. MessageFixture
3. ToolExecutionFixture
4. createTestContext helper

### Paso 3: Contract Tests (2 días)
1. agent-events.contract.test.ts
2. agent-state.contract.test.ts
3. tool-events.contract.test.ts

### Paso 4: Extended Fixtures (Phase 3 prep) (1 día)
1. PlanFixture
2. plan-events.contract.test.ts
3. LLMResponseSimulator

---

## 5. Tests Requeridos

### 5.1 FakeChatModel Tests
```typescript
describe('FakeChatModel', () => {
  it('returns fixed response');
  it('returns responses in sequence');
  it('matches response by pattern');
  it('tracks call history');
  it('generates tool use response');
  it('resets state between tests');
});
```

### 5.2 AgentStateFixture Tests
```typescript
describe('AgentStateFixture', () => {
  it('creates empty state');
  it('adds user message');
  it('adds assistant message');
  it('adds tool use');
  it('chains multiple operations');
  it('builds valid AgentState');
});
```

### 5.3 Contract Test Self-Validation
```typescript
describe('Contract Tests', () => {
  it('schemas match @bc-agent/shared types');
  it('all event types have contracts');
  it('contracts are exhaustive');
});
```

---

## 6. Criterios de Aceptación

- [ ] FakeChatModel works with LangGraph
- [ ] Fixtures produce valid AgentState
- [ ] Contract tests cover all WebSocket events
- [ ] Tests are deterministic (no flaky tests)
- [ ] Fixtures documented with examples
- [ ] < 5ms per fixture creation
- [ ] `npm run verify:types` pasa sin errores

---

## 7. Archivos a Crear

### Fakes
- `backend/src/__tests__/fakes/FakeChatModel.ts`
- `backend/src/__tests__/fakes/FakeEventStore.ts`
- `backend/src/__tests__/fakes/FakePersistenceCoordinator.ts`
- `backend/src/__tests__/fakes/FakeSocketIO.ts`
- `backend/src/__tests__/fakes/FakeAgentRegistry.ts`

### Fixtures
- `backend/src/__tests__/fixtures/AgentStateFixture.ts`
- `backend/src/__tests__/fixtures/MessageFixture.ts`
- `backend/src/__tests__/fixtures/ToolExecutionFixture.ts`
- `backend/src/__tests__/fixtures/PlanFixture.ts`
- `backend/src/__tests__/fixtures/LLMResponseSimulator.ts`

### Contracts
- `backend/src/__tests__/contracts/agent-events.contract.test.ts`
- `backend/src/__tests__/contracts/agent-state.contract.test.ts`
- `backend/src/__tests__/contracts/plan-events.contract.test.ts`
- `backend/src/__tests__/contracts/tool-events.contract.test.ts`

### Helpers
- `backend/src/__tests__/helpers/createTestContext.ts`
- `backend/src/__tests__/helpers/waitForEvent.ts`

---

## 8. Ejemplo de Uso

```typescript
// Test file example
import { FakeChatModel } from '@/__tests__/fakes/FakeChatModel';
import { AgentStateFixture } from '@/__tests__/fixtures/AgentStateFixture';
import { LLMResponseSimulator } from '@/__tests__/fixtures/LLMResponseSimulator';
import { createTestContext, getTestEvents } from '@/__tests__/helpers/createTestContext';

describe('BCAgent', () => {
  let fakeLLM: FakeChatModel;

  beforeEach(() => {
    fakeLLM = new FakeChatModel();
  });

  it('processes simple query', async () => {
    // Arrange
    fakeLLM.setResponse(LLMResponseSimulator.textResponse(
      'Here is the customer information.',
      { stopReason: 'end_turn' }
    ));

    const state = AgentStateFixture.create()
      .withUserMessage('Show me customer ABC')
      .withContext({ userId: 'user-1', sessionId: 'session-1' })
      .build();

    const ctx = createTestContext();

    // Act
    const result = await bcAgent.invoke(state, { llm: fakeLLM });

    // Assert
    expect(result.messages).toHaveLength(2);
    expect(getTestEvents(ctx)).toContainEqual(
      expect.objectContaining({ type: 'message' })
    );
  });

  it('uses tools when needed', async () => {
    // Arrange
    fakeLLM.setResponse(LLMResponseSimulator.toolUseResponse([
      { name: 'bc_get_customer', args: { customerId: 'ABC' } }
    ]));

    const state = AgentStateFixture.withSimpleQuery('Get customer ABC');

    // Act
    const result = await bcAgent.invoke(state, { llm: fakeLLM });

    // Assert
    expect(result.toolExecutions).toHaveLength(1);
    expect(result.toolExecutions[0].toolName).toBe('bc_get_customer');
  });
});
```

---

## 9. Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| FakeChatModel no compatible con LangGraph | Media | Alto | Test exhaustivo con graph real |
| Fixtures out of sync con types | Media | Medio | Contract tests + type safety |
| Performance overhead | Baja | Bajo | Optimize fixture creation |

---

## 10. Estimación

- **Desarrollo**: 5-6 días
- **Testing**: 2-3 días
- **Documentation**: 1 día
- **Total**: 8-10 días

---

## 11. Changelog

| Fecha | Versión | Cambios |
|-------|---------|---------|
| 2026-01-21 | 1.0 | Draft inicial |

