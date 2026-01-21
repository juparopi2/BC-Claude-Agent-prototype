# PRD-003: AgentOrchestrator Refactoring

**Estado**: Draft
**Prioridad**: Alta
**Dependencias**: Ninguna
**Bloquea**: Fase 1 (TDD Foundation)

---

## 1. Objetivo

Descomponer `AgentOrchestrator.ts` (853 líneas) en módulos especializados, separando:
- Preparación de contexto (file context, chat attachments)
- Ejecución del grafo
- Normalización de eventos
- Persistencia de eventos
- Emisión de eventos WebSocket

Esta refactorización es **crítica** para la Fase 3 (Supervisor Node) porque el orquestador actual está acoplado al flujo lineal.

---

## 2. Contexto

### 2.1 Estado Actual

`backend/src/domains/agent/orchestration/AgentOrchestrator.ts` maneja:

| Responsabilidad | Métodos/Secciones | Líneas Aprox. |
|-----------------|-------------------|---------------|
| Input validation | Section 1 | ~20 |
| Context creation | Section 2 | ~50 |
| File context preparation | Section 2 (inline) | ~100 |
| Chat attachments resolution | Section 2 (inline) | ~50 |
| Session start emission | Section 2 | ~20 |
| User message persistence | Section 3 | ~30 |
| Graph execution | Section 4 | ~50 |
| Event normalization | Section 5 | ~30 |
| Sequence pre-allocation | Section 5.1 | ~40 |
| Event processing loop | Section 6 | ~100 |
| Tool lifecycle finalization | Section 7 | ~20 |
| Event conversion | `toAgentEvent()` | ~100 |
| Sync persistence | `persistSyncEvent()` | ~60 |
| Async persistence | `persistAsyncEvent()` | ~100 |

### 2.2 Problemas Actuales

1. **Método principal de 300+ líneas**: `executeAgentSync()` hace demasiado
2. **Acoplamiento temporal**: Orden de operaciones difícil de modificar
3. **No extensible**: Añadir supervisor requiere modificar código existente
4. **Testing complejo**: Muchas dependencias en un solo lugar

---

## 3. Diseño Propuesto

### 3.1 Estructura de Módulos

```
backend/src/domains/agent/orchestration/
├── AgentOrchestrator.ts         # Coordinator - ~150 líneas
├── execution/
│   ├── GraphExecutor.ts         # Graph invoke wrapper - ~100 líneas
│   └── ExecutionPipeline.ts     # Pipeline orchestration - ~150 líneas
├── context/
│   └── MessageContextBuilder.ts # Build message with context - ~100 líneas
├── events/
│   ├── EventProcessor.ts        # Process normalized events - ~150 líneas
│   ├── EventConverter.ts        # NormalizedEvent -> AgentEvent - ~100 líneas
│   └── EventSequencer.ts        # Sequence number management - ~80 líneas
├── persistence/
│   └── EventPersister.ts        # Sync/async persistence logic - ~150 líneas
├── types.ts                     # Ya existe
├── ExecutionContextSync.ts      # Ya existe (mantener)
└── index.ts
```

### 3.2 Responsabilidades por Módulo

#### GraphExecutor.ts (~100 líneas)
```typescript
export class GraphExecutor {
  constructor(private graph: StateGraph);

  async execute(
    inputs: GraphInputs,
    options: GraphExecutionOptions
  ): Promise<GraphExecutionResult>;

  // Isolated graph.invoke() with timeout handling
  private async invokeWithTimeout(
    inputs: GraphInputs,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<AgentState>;
}
```

#### ExecutionPipeline.ts (~150 líneas)
```typescript
export class ExecutionPipeline {
  constructor(
    private contextBuilder: MessageContextBuilder,
    private graphExecutor: GraphExecutor,
    private eventProcessor: EventProcessor,
    private persister: EventPersister
  );

  async execute(
    prompt: string,
    ctx: ExecutionContextSync,
    options: PipelineOptions
  ): Promise<PipelineResult>;

  // Orchestrates: context -> execute -> normalize -> persist -> emit
}
```

#### MessageContextBuilder.ts (~100 líneas)
```typescript
export class MessageContextBuilder {
  constructor(
    private fileContextPreparer: IFileContextPreparer,
    private attachmentResolver: AttachmentContentResolver
  );

  async build(
    prompt: string,
    userId: string,
    options: ContextOptions
  ): Promise<MessageContext>;

  // Combines: KB files + chat attachments + semantic search
  private buildMultiModalContent(
    prompt: string,
    attachments: LangChainContentBlock[],
    contextText?: string
  ): ContentBlock[];
}
```

#### EventProcessor.ts (~150 líneas)
```typescript
export class EventProcessor {
  constructor(
    private converter: EventConverter,
    private persister: EventPersister,
    private citationExtractor: ICitationExtractor
  );

  async processAll(
    events: NormalizedAgentEvent[],
    ctx: ExecutionContextSync,
    sessionId: string,
    agentMessageId: string
  ): Promise<EventProcessingResult>;

  async processSingle(
    event: NormalizedAgentEvent,
    ctx: ExecutionContextSync,
    sessionId: string,
    agentMessageId: string
  ): Promise<void>;
}
```

#### EventConverter.ts (~100 líneas)
```typescript
export class EventConverter {
  // Pure conversion logic - no side effects
  toAgentEvent(
    normalized: NormalizedAgentEvent,
    ctx: ExecutionContextSync,
    agentMessageId: string
  ): AgentEvent;

  toThinkingCompleteEvent(event: NormalizedThinkingEvent): ThinkingCompleteEvent;
  toToolUseEvent(event: NormalizedToolRequestEvent): ToolUseEvent;
  toToolResultEvent(event: NormalizedToolResponseEvent): ToolResultEvent;
  toMessageEvent(event: NormalizedAssistantMessageEvent): MessageEvent;
  toCompleteEvent(event: NormalizedCompleteEvent, ctx: ExecutionContextSync): CompleteEvent;
}
```

#### EventSequencer.ts (~80 líneas)
```typescript
export class EventSequencer {
  constructor(private eventStore: EventStore);

  // Pre-allocate sequence numbers for deterministic ordering
  async allocateSequences(
    sessionId: string,
    events: NormalizedAgentEvent[]
  ): Promise<number[]>;

  // Assign sequences to events
  assignSequences(events: NormalizedAgentEvent[], sequences: number[]): void;

  // Count events needing persistence
  countPersistableEvents(events: NormalizedAgentEvent[]): number;
}
```

#### EventPersister.ts (~150 líneas)
```typescript
export class EventPersister {
  constructor(
    private persistenceCoordinator: IPersistenceCoordinator,
    private toolLifecycleManager: ToolLifecycleManager
  );

  // Sync persistence (thinking, assistant_message)
  async persistSync(
    event: NormalizedAgentEvent,
    sessionId: string,
    agentMessageId: string,
    preAllocatedSeq?: number
  ): Promise<PersistedEvent | undefined>;

  // Async persistence (tools) - fire and forget
  persistAsync(
    event: NormalizedAgentEvent,
    sessionId: string,
    ctx: ExecutionContextSync,
    preAllocatedSeq?: number
  ): void;
}
```

#### AgentOrchestrator.ts (Coordinator - ~150 líneas)
```typescript
export class AgentOrchestrator implements IAgentOrchestrator {
  private pipeline: ExecutionPipeline;
  private persistenceCoordinator: IPersistenceCoordinator;

  constructor(deps?: AgentOrchestratorDependencies);

  // Main API (signature unchanged)
  async executeAgentSync(
    prompt: string,
    sessionId: string,
    onEvent?: (event: AgentEvent) => void,
    userId?: string,
    options?: ExecuteSyncOptions
  ): Promise<AgentExecutionResult>;

  // Helper for event emission (unchanged)
  private emitEventSync(ctx: ExecutionContextSync, event: AgentEvent): void;
}
```

---

## 4. Plan de Migración

### Paso 1: Extract EventConverter (Safe - Pure Functions)
1. Crear EventConverter con `toAgentEvent()` y helpers
2. Tests unitarios (pure functions, easy to test)
3. AgentOrchestrator usa EventConverter

### Paso 2: Extract EventSequencer
1. Crear EventSequencer con sequence allocation
2. Tests unitarios
3. AgentOrchestrator usa EventSequencer

### Paso 3: Extract EventPersister
1. Crear EventPersister con sync/async logic
2. Tests unitarios con mocks
3. AgentOrchestrator usa EventPersister

### Paso 4: Extract EventProcessor
1. Crear EventProcessor que coordina converter + persister
2. Tests unitarios
3. AgentOrchestrator usa EventProcessor

### Paso 5: Extract MessageContextBuilder
1. Crear MessageContextBuilder
2. Tests unitarios
3. AgentOrchestrator usa MessageContextBuilder

### Paso 6: Extract GraphExecutor
1. Crear GraphExecutor
2. Tests unitarios (mock graph)
3. AgentOrchestrator usa GraphExecutor

### Paso 7: Create ExecutionPipeline
1. Crear ExecutionPipeline que coordina todo
2. Integration tests
3. AgentOrchestrator delega a ExecutionPipeline

### Paso 8: Simplify AgentOrchestrator
1. Reducir a coordinator puro
2. Tests existentes deben pasar
3. Cleanup

---

## 5. Tests Requeridos

### 5.1 EventConverter Tests
```typescript
describe('EventConverter', () => {
  it('converts thinking event to thinking_complete');
  it('converts tool_request to tool_use');
  it('converts tool_response to tool_result');
  it('converts assistant_message to message');
  it('converts complete event with citations');
  it('normalizes tool args');
});
```

### 5.2 EventSequencer Tests
```typescript
describe('EventSequencer', () => {
  it('allocates correct number of sequences');
  it('skips transient events');
  it('assigns sequences in order');
});
```

### 5.3 EventPersister Tests
```typescript
describe('EventPersister', () => {
  it('persists thinking event synchronously');
  it('persists assistant_message synchronously');
  it('persists tool events asynchronously');
  it('uses pre-allocated sequence numbers');
  it('handles tool lifecycle correctly');
});
```

### 5.4 ExecutionPipeline Tests
```typescript
describe('ExecutionPipeline', () => {
  it('executes full pipeline in correct order');
  it('emits session_start first');
  it('emits user_message_confirmed second');
  it('processes all events from graph');
  it('handles graph timeout');
  it('handles graph error');
});
```

---

## 6. Criterios de Aceptación

- [ ] Cada nuevo módulo tiene < 200 líneas
- [ ] `executeAgentSync()` signature unchanged
- [ ] 100% tests existentes siguen pasando
- [ ] Nuevos módulos tienen >= 80% coverage
- [ ] Event emission order preserved exactly
- [ ] Tool lifecycle preserved
- [ ] Citation extraction preserved
- [ ] `npm run verify:types` pasa sin errores

---

## 7. Archivos Afectados

### Crear
- `backend/src/domains/agent/orchestration/execution/GraphExecutor.ts`
- `backend/src/domains/agent/orchestration/execution/ExecutionPipeline.ts`
- `backend/src/domains/agent/orchestration/context/MessageContextBuilder.ts`
- `backend/src/domains/agent/orchestration/events/EventProcessor.ts`
- `backend/src/domains/agent/orchestration/events/EventConverter.ts`
- `backend/src/domains/agent/orchestration/events/EventSequencer.ts`
- `backend/src/domains/agent/orchestration/persistence/EventPersister.ts`
- Tests en `backend/src/__tests__/unit/agent/orchestration/`

### Modificar
- `backend/src/domains/agent/orchestration/AgentOrchestrator.ts`
- `backend/src/domains/agent/orchestration/index.ts`

---

## 8. Impacto en Fase 3 (Supervisor)

Esta refactorización habilita la Fase 3 porque:

1. **ExecutionPipeline** puede ser extendido para ejecutar sub-grafos
2. **GraphExecutor** puede invocar diferentes grafos (supervisor vs agent)
3. **EventProcessor** puede manejar nuevos tipos de eventos (plan_generated, etc.)
4. **MessageContextBuilder** puede añadir plan context a mensajes

---

## 9. Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| Event ordering breaks | Media | Alto | Tests de ordering estrictos |
| Sequence numbers incorrectos | Media | Alto | Integration tests con EventStore |
| Tool lifecycle breaks | Media | Alto | Tests exhaustivos de tool flow |
| Performance regression | Baja | Medio | Benchmark antes/después |

---

## 10. Estimación

- **Desarrollo**: 5-6 días
- **Testing**: 3-4 días
- **Code Review**: 1-2 días
- **Total**: 9-12 días

---

## 11. Changelog

| Fecha | Versión | Cambios |
|-------|---------|---------|
| 2026-01-21 | 1.0 | Draft inicial |

