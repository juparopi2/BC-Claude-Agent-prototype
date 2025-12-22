# Arquitectura del Refactor

**Fecha**: 2025-12-22
**Estado**: Aprobado

---

## Nueva Estructura de Carpetas

```
backend/src/domains/agent/
├── orchestration/
│   ├── AgentOrchestrator.ts          # <100 LOC - Coordinador principal
│   ├── types.ts                      # Tipos de orquestación
│   └── index.ts
├── context/
│   ├── FileContextPreparer.ts        # ~100 LOC - Adjuntos de archivos
│   ├── SemanticSearchHandler.ts      # ~80 LOC - Búsqueda automática
│   └── index.ts
├── streaming/
│   ├── GraphStreamProcessor.ts       # ~120 LOC - Procesa LangGraph events
│   ├── ThinkingAccumulator.ts        # ~60 LOC - Estado de thinking
│   ├── ContentAccumulator.ts         # ~60 LOC - Estado de mensaje
│   └── index.ts
├── tools/
│   ├── ToolEventDeduplicator.ts      # ~50 LOC - Evita duplicados
│   ├── ToolExecutionProcessor.ts     # ~100 LOC - Procesa ejecuciones
│   └── index.ts
├── persistence/
│   ├── PersistenceCoordinator.ts     # ~120 LOC - EventStore + Queue
│   ├── PersistenceErrorAnalyzer.ts   # ~60 LOC - Categoriza errores
│   └── index.ts
├── emission/
│   ├── AgentEventEmitter.ts          # ~80 LOC - Emisión WebSocket
│   ├── EventIndexTracker.ts          # ~30 LOC - Ordenamiento
│   └── index.ts
└── usage/
    ├── UsageTracker.ts               # ~70 LOC - Tracking de tokens
    └── index.ts
```

**Total**: ~910 LOC distribuidos en 13 clases (vs 1,471 LOC actual)

---

## Las 13 Clases del Refactor

| # | Clase | LOC | Responsabilidad |
|---|-------|-----|-----------------|
| 1 | **AgentOrchestrator** | <100 | Coordinador principal, entry point |
| 2 | **FileContextPreparer** | ~100 | Validación de adjuntos, contexto |
| 3 | **SemanticSearchHandler** | ~80 | Búsqueda automática de archivos |
| 4 | **GraphStreamProcessor** | ~120 | Consume LangGraph streamEvents |
| 5 | **ThinkingAccumulator** | ~60 | Acumula chunks de thinking |
| 6 | **ContentAccumulator** | ~60 | Acumula chunks de mensaje |
| 7 | **ToolEventDeduplicator** | ~50 | Previene duplicados de tool_use_id |
| 8 | **ToolExecutionProcessor** | ~100 | Procesa toolExecutions de on_chain_end |
| 9 | **PersistenceCoordinator** | ~120 | Coordina EventStore + MessageQueue |
| 10 | **PersistenceErrorAnalyzer** | ~60 | Categoriza errores de persistencia |
| 11 | **AgentEventEmitter** | ~80 | Emisión unificada WebSocket |
| 12 | **EventIndexTracker** | ~30 | Contador de eventIndex |
| 13 | **UsageTracker** | ~70 | Tracking de tokens |

---

## Descripción Detallada de Clases

### 1. AgentOrchestrator (<100 LOC)

**Responsabilidad:**
- Entry point del sistema
- Coordina todas las demás clases
- Maneja ciclo de vida de la ejecución

**Dependencias:**
- FileContextPreparer
- GraphStreamProcessor
- PersistenceCoordinator
- AgentEventEmitter
- UsageTracker

**Flujo:**
```typescript
async runGraph(prompt, sessionId, onEvent, userId, options) {
  // 1. Preparar contexto de archivos
  const context = await fileContextPreparer.prepare(userId, prompt, options);

  // 2. Procesar stream
  for await (const event of streamProcessor.process(inputs, context)) {
    // 3. Emitir eventos
    eventEmitter.emit(event);

    // 4. Persistir según tipo
    await persistenceCoordinator.persist(event);
  }

  // 5. Tracking final
  await usageTracker.finalize();
}
```

---

### 2. FileContextPreparer (~100 LOC)

**Responsabilidad:**
- Validar archivos adjuntos explícitos
- Invocar búsqueda semántica automática
- Construir contexto de archivos para el prompt

**Dependencias:**
- SemanticSearchHandler
- SemanticSearchService (externo)

**Métodos principales:**
```typescript
async prepare(userId, prompt, options): Promise<FileContextPreparationResult>
private validateAttachments(attachments): Promise<ValidatedFile[]>
private constructFileContext(files): string
```

---

### 3. SemanticSearchHandler (~80 LOC)

**Responsabilidad:**
- Ejecutar búsqueda semántica si está habilitada
- Filtrar resultados por threshold
- Limitar número de archivos

**Dependencias:**
- SemanticSearchService (externo)

**Métodos principales:**
```typescript
async search(userId, prompt, options): Promise<SearchResult[]>
private filterByThreshold(results, threshold): SearchResult[]
private limitResults(results, maxFiles): SearchResult[]
```

---

### 4. GraphStreamProcessor (~120 LOC)

**Responsabilidad:**
- Consumir eventos de `orchestratorGraph.streamEvents()`
- Discriminar entre 8 tipos de eventos
- Coordinar accumuladores y procesadores

**Dependencias:**
- ThinkingAccumulator
- ContentAccumulator
- ToolExecutionProcessor

**Eventos procesados:**
```typescript
- on_chat_model_stream (chunks)
- on_chat_model_end (thinking completo, usage)
- on_chain_start (metadata)
- on_chain_end (tool executions)
- on_tool_start
- on_tool_end
- on_chain_error
- on_llm_error
```

**Método principal:**
```typescript
async *process(inputs, context): AsyncGenerator<ProcessedStreamEvent>
```

---

### 5. ThinkingAccumulator (~60 LOC)

**Responsabilidad:**
- Acumular chunks de thinking (blockIndex 0)
- Detectar fin de bloque de thinking
- Proveer contenido completo

**Estado interno:**
```typescript
private content: string = '';
private isThinkingComplete: boolean = false;
```

**Métodos:**
```typescript
append(chunk: string): void
isComplete(): boolean
markComplete(): void
getContent(): string
reset(): void
```

---

### 6. ContentAccumulator (~60 LOC)

**Responsabilidad:**
- Acumular chunks de mensaje principal (blockIndex 1)
- Proveer contenido acumulado en cualquier momento

**Estado interno:**
```typescript
private content: string = '';
```

**Métodos:**
```typescript
append(chunk: string): void
getContent(): string
reset(): void
```

---

### 7. ToolEventDeduplicator (~50 LOC)

**Responsabilidad:**
- Mantener set de `tool_use_id` ya emitidos
- Prevenir duplicados en eventos `tool_use`

**Estado interno:**
```typescript
private emittedToolUseIds: Set<string> = new Set();
```

**Métodos:**
```typescript
shouldEmit(toolUseId: string): boolean
markEmitted(toolUseId: string): void
reset(): void
```

---

### 8. ToolExecutionProcessor (~100 LOC)

**Responsabilidad:**
- Procesar `toolExecutions` de `on_chain_end`
- Emitir eventos `tool_use` y `tool_result`
- Persistir ejecuciones

**Dependencias:**
- ToolEventDeduplicator
- PersistenceCoordinator
- AgentEventEmitter

**Métodos:**
```typescript
async processExecutions(toolExecutions, context): Promise<void>
private createToolUseEvent(execution): ToolUseEvent
private createToolResultEvent(execution): ToolResultEvent
```

---

### 9. PersistenceCoordinator (~120 LOC)

**Responsabilidad:**
- Coordinar EventStore + MessageQueue
- Manejar errores de persistencia
- Proveer interface unificada

**Dependencias:**
- EventStore
- MessageQueue
- PersistenceErrorAnalyzer

**Métodos:**
```typescript
async persistUserMessage(sessionId, content): Promise<PersistedEvent>
async persistAgentMessage(sessionId, data): Promise<PersistedEvent>
async persistThinking(sessionId, data): Promise<PersistedEvent>
async persistToolUse(sessionId, data): Promise<PersistedEvent>
async persistToolResult(sessionId, data): Promise<PersistedEvent>
```

---

### 10. PersistenceErrorAnalyzer (~60 LOC)

**Responsabilidad:**
- Categorizar errores de persistencia
- Determinar si son recuperables
- Proveer mensajes de error apropiados

**Categorías de error:**
```typescript
type ErrorCategory =
  | 'redis_connection'
  | 'db_connection'
  | 'db_constraint'
  | 'serialization'
  | 'unknown';
```

**Métodos:**
```typescript
categorize(error: Error): ErrorCategory
isRecoverable(category: ErrorCategory): boolean
getErrorMessage(category: ErrorCategory): string
```

---

### 11. AgentEventEmitter (~80 LOC)

**Responsabilidad:**
- Emisión unificada de eventos WebSocket
- Tracking de eventIndex
- Formateo de eventos

**Dependencias:**
- EventIndexTracker

**Métodos:**
```typescript
setCallback(callback: (event: AgentEvent) => void): void
emit(event: AgentEvent): void
emitError(sessionId, error, code): void
getEventIndex(): number
reset(): void
```

---

### 12. EventIndexTracker (~30 LOC)

**Responsabilidad:**
- Mantener contador de eventIndex
- Proveer índices monotónicamente crecientes

**Estado interno:**
```typescript
private currentIndex: number = 0;
```

**Métodos:**
```typescript
getNext(): number
getCurrent(): number
reset(): void
```

---

### 13. UsageTracker (~70 LOC)

**Responsabilidad:**
- Tracking de tokens (input + output)
- Coordinación con UsageTrackingService
- Registro de costos

**Dependencias:**
- UsageTrackingService (externo)

**Métodos:**
```typescript
async trackUsage(userId, sessionId, usage): Promise<void>
async finalize(): Promise<TokenUsageSummary>
```

---

## Diagrama de Dependencias

```
AgentOrchestrator
├── FileContextPreparer
│   └── SemanticSearchHandler
├── GraphStreamProcessor
│   ├── ThinkingAccumulator
│   ├── ContentAccumulator
│   └── ToolExecutionProcessor
│       ├── ToolEventDeduplicator
│       ├── PersistenceCoordinator
│       │   └── PersistenceErrorAnalyzer
│       └── AgentEventEmitter
│           └── EventIndexTracker
├── PersistenceCoordinator
└── UsageTracker
```

**Niveles de dependencia:**
- Nivel 0 (sin deps): ErrorAnalyzer, EventIndexTracker, Accumulators, Deduplicator
- Nivel 1: AgentEventEmitter, SemanticSearchHandler, UsageTracker
- Nivel 2: PersistenceCoordinator, ToolExecutionProcessor
- Nivel 3: FileContextPreparer, GraphStreamProcessor
- Nivel 4: AgentOrchestrator

---

## Comparación: Antes vs Después

| Aspecto | Antes | Después |
|---------|-------|---------|
| **LOC más grande** | 1,471 | ~120 |
| **Responsabilidades por clase** | 15+ | 1-2 |
| **Dependencias directas** | 15+ | Máx 4 |
| **Testabilidad** | Difícil (mock hell) | Fácil (deps inyectables) |
| **Reusabilidad** | Baja | Alta |
| **Mantenibilidad** | Muy baja | Alta |

---

*Última actualización: 2025-12-22*
