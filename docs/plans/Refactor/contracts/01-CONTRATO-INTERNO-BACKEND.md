# Contrato Interno del Backend: Arquitectura de Procesamiento de Mensajes

**Fecha**: 2025-12-23
**Estado**: Documento de Referencia
**Propósito**: Documentar el flujo completo de procesamiento de mensajes desde WebSocket hasta persistencia

---

## Índice

1. [Visión General](#visión-general)
2. [Flujo de Datos Completo](#flujo-de-datos-completo)
3. [Capa 1: Recepción WebSocket](#capa-1-recepción-websocket)
4. [Capa 2: Orquestación del Agente](#capa-2-orquestación-del-agente)
5. [Capa 3: Pipeline de Streaming](#capa-3-pipeline-de-streaming)
6. [Capa 4: Procesamiento de Herramientas](#capa-4-procesamiento-de-herramientas)
7. [Capa 5: Persistencia Bifásica](#capa-5-persistencia-bifásica)
8. [Capa 6: Emisión de Eventos](#capa-6-emisión-de-eventos)
9. [Garantías de Ordenamiento](#garantías-de-ordenamiento)
10. [Estados de Persistencia](#estados-de-persistencia)
11. [Esquema de Base de Datos](#esquema-de-base-de-datos)
12. [Patrones Arquitectónicos](#patrones-arquitectónicos)

---

## Visión General

El backend de BC Claude Agent implementa una arquitectura de **event sourcing** con persistencia bifásica para procesar mensajes de chat en tiempo real mientras mantiene un registro de auditoría completo.

### Principios Clave

1. **Event Sourcing**: Registro append-only de todos los eventos (`message_events` table)
2. **Persistencia Bifásica**: EventStore (sync ~10ms) → MessageQueue (async ~600ms)
3. **Multi-Tenant Safe**: Todas las operaciones aisladas por `userId` + `sessionId`
4. **Ordenamiento Atómico**: Redis INCR garantiza números de secuencia únicos
5. **Streaming en Tiempo Real**: WebSocket con emisión tipo-discriminada

### Sistema de Providers (Normalización Multi-Provider)

El sistema de providers centraliza toda la lógica específica de cada proveedor de LLM
(Anthropic, OpenAI, etc.) para mantener el resto del código agnóstico al proveedor.

**Archivos Clave**:
- `backend/src/shared/providers/interfaces/INormalizedEvent.ts` - Tipos normalizados
- `backend/src/shared/providers/interfaces/IStreamAdapter.ts` - Interface del adapter
- `backend/src/shared/providers/adapters/AnthropicStreamAdapter.ts` - Impl. Anthropic

**Principio de Diseño**: Toda normalización específica de provider se hace en el adapter,
NO en el AgentOrchestrator. Esto incluye:
- Normalización de eventos de stream (`processChunk()`)
- Normalización de stop reasons (`normalizeStopReason()`)
- Capacidades del provider (`IProviderCapabilities`)

### Arquitectura de 6 Capas

```
┌─────────────────────────────────────────────────────────────────┐
│ CAPA 1: WebSocket Layer (ChatMessageHandler)                    │
│ ├─ Recibe evento 'chat:message'                                 │
│ ├─ Valida sesión y autenticación                                │
│ └─ Delega a AgentOrchestrator                                   │
└──────────────────┬──────────────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────────────────┐
│ CAPA 2: Agent Orchestration (AgentOrchestrator)                 │
│ ├─ FileContextPreparer (archivos + búsqueda semántica)          │
│ ├─ Construye inputs para LangGraph                              │
│ ├─ Persiste mensaje de usuario (PersistenceCoordinator)         │
│ └─ Emite user_message_confirmed                                 │
└──────────────────┬──────────────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────────────────┐
│ CAPA 3: Streaming Pipeline                                      │
│ ├─ StreamEventRouter (enruta eventos LangGraph)                 │
│ ├─ GraphStreamProcessor (procesa eventos normalizados)          │
│ ├─ ThinkingAccumulator (acumula chunks de pensamiento)          │
│ └─ ContentAccumulator (acumula chunks de mensaje)               │
└──────────────────┬──────────────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────────────────┐
│ CAPA 4: Tool Processing (ToolExecutionProcessor)                │
│ ├─ ToolEventDeduplicator (previene duplicados)                  │
│ ├─ Emite tool_use y tool_result a WebSocket                     │
│ └─ Delega persistencia async a PersistenceCoordinator           │
└──────────────────┬──────────────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────────────────┐
│ CAPA 5: Two-Phase Persistence (PersistenceCoordinator)          │
│ ├─ FASE 1 (SYNC ~10ms): EventStore.appendEvent()                │
│ │  └─ Redis INCR → sequence_number atómico                      │
│ └─ FASE 2 (ASYNC ~600ms): MessageQueue.addMessagePersistence()  │
│    └─ BullMQ worker escribe a tabla `messages`                  │
└──────────────────┬──────────────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────────────────┐
│ CAPA 6: Event Emission (AgentEventEmitter)                      │
│ ├─ Canal único: 'agent:event' con discriminación de tipo        │
│ ├─ EventIndexTracker (índice auto-incremental)                  │
│ └─ 17 tipos de eventos soportados                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## Flujo de Datos Completo

```
1. USUARIO ENVÍA MENSAJE
   └─> WebSocket: 'chat:message' { sessionId, userId, message }

2. WEBSOCKET LAYER
   ├─> ChatMessageHandler.handle()
   ├─> validateSessionOwnership() (query a DB)
   └─> AgentOrchestrator.executeAgent()

3. ORCHESTRATION LAYER
   ├─> FileContextPreparer.prepare()
   │   ├─> Valida archivos adjuntos
   │   └─> SemanticSearchHandler (búsqueda automática)
   │
   ├─> PersistenceCoordinator.persistUserMessage()
   │   ├─> EventStore.appendEvent() → sequence_number
   │   └─> MessageQueue.addMessagePersistence() → job encolado
   │
   ├─> AgentEventEmitter.emitUserMessageConfirmed()
   │   └─> WebSocket: 'agent:event' { type: 'user_message_confirmed' }
   │
   └─> orchestratorGraph.streamEvents(inputs)

4. STREAMING LAYER
   ├─> StreamEventRouter.route()
   │   ├─> Discrimina 8 tipos de eventos LangGraph
   │   └─> Normaliza a INormalizedStreamEvent
   │
   └─> GraphStreamProcessor.process()
       ├─> ThinkingAccumulator (blockIndex 0)
       │   ├─> thinking_chunk → WebSocket (transient)
       │   └─> thinking_complete → acumulado completo
       │
       ├─> ContentAccumulator (blockIndex 1)
       │   ├─> message_chunk → WebSocket (transient)
       │   └─> final_response → contenido completo
       │
       └─> ToolExecutions → ToolExecutionProcessor

5. TOOL PROCESSING LAYER
   └─> ToolExecutionProcessor.processExecutions()
       ├─> ToolEventDeduplicator.checkAndMark()
       ├─> Emite tool_use → WebSocket (immediatamente)
       ├─> Emite tool_result → WebSocket (immediatamente)
       └─> PersistenceCoordinator.persistToolEventsAsync()
           ├─> EventStore.appendEvent() × 2 (tool_use + tool_result)
           └─> MessageQueue × 2 (async)

6. FINAL PERSISTENCE
   ├─> PersistenceCoordinator.persistThinking() (si hay)
   │   ├─> EventStore.appendEvent()
   │   └─> MessageQueue
   │
   ├─> PersistenceCoordinator.persistAgentMessage()
   │   ├─> EventStore.appendEvent()
   │   └─> MessageQueue
   │
   └─> AgentEventEmitter.emit({ type: 'message' })
       └─> WebSocket: mensaje completo con sequenceNumber

7. COMPLETION
   └─> AgentEventEmitter.emit({ type: 'complete' })
       └─> WebSocket: { stopReason, tokenUsage }
```

---

## Capa 1: Recepción WebSocket

**Archivo**: `backend/src/services/websocket/ChatMessageHandler.ts` (668 LOC)

### Responsabilidades

1. Recibir evento `chat:message` del cliente
2. Validar autenticación del socket (session middleware)
3. Validar propiedad de sesión (multi-tenant safety)
4. Delegar a `AgentOrchestrator`
5. Manejar errores y emitir a frontend

### Flujo de Autenticación

```typescript
// 1. Socket tiene userId de session middleware
const authSocket = socket as AuthenticatedSocket;
const authenticatedUserId = authSocket.userId;

// 2. CRITICAL: Cliente no puede suplantar userId
if (clientUserId && normalizeUUID(clientUserId) !== normalizeUUID(authenticatedUserId)) {
  socket.emit('agent:error', { error: 'User authentication mismatch' });
  return;
}

// 3. Validar propiedad de sesión (query a DB)
await validateSessionOwnership(sessionId, authenticatedUserId);

// 4. Delegar a orchestrator
await orchestrator.executeAgent(
  message,
  sessionId,
  (event: AgentEvent) => this.handleAgentEvent(event, io, sessionId, userId),
  userId,
  { enableThinking, thinkingBudget, attachments }
);
```

### Validaciones de Entrada

```typescript
// Mensaje vacío rechazado
if (!message || message.trim().length === 0) {
  socket.emit('agent:error', { error: 'Empty message not allowed' });
  return;
}

// thinkingBudget dentro de límites Anthropic (1024-100000)
if (thinkingBudget < 1024 || thinkingBudget > 100000) {
  socket.emit('agent:error', { error: 'Invalid thinkingBudget' });
  return;
}
```

### Manejo de Eventos

```typescript
private async handleAgentEvent(
  event: AgentEvent,
  io: Server,
  sessionId: string,
  userId: string
): Promise<void> {
  // 1. Emitir a WebSocket (siempre)
  io.to(sessionId).emit('agent:event', event);

  // 2. Persistencia según tipo de evento
  switch (event.type) {
    case 'message':
      // ✅ Ya persistido por AgentOrchestrator
      if (event.persistenceState !== 'persisted') {
        this.logger.error('CRITICAL: message NOT persisted by AgentOrchestrator');
      }
      break;

    case 'tool_use':
    case 'tool_result':
      // ✅ Ya persistido por AgentOrchestrator
      if (event.persistenceState !== 'persisted') {
        // ⚠️ FALLBACK: persistir aquí si no está
        await this.handleToolUse(event, sessionId, userId);
      }
      break;

    case 'thinking_chunk':
    case 'message_chunk':
      // ✅ Transient - no se persiste
      break;

    // ... otros casos
  }
}
```

**Contrato de Emisión**: Todos los eventos persistidos DEBEN tener `persistenceState: 'persisted'` antes de ser emitidos. Si no, es un bug crítico en `AgentOrchestrator`.

---

## Capa 2: Orquestación del Agente

**Archivo**: `backend/src/domains/agent/orchestration/AgentOrchestrator.ts` (367 LOC)

### Responsabilidades

1. Coordinar todas las fases de ejecución del agente
2. Preparar contexto de archivos
3. Persistir mensaje de usuario inmediatamente
4. Procesar streaming de LangGraph
5. Coordinar persistencia final

### Dependencias Inyectables

```typescript
export class AgentOrchestrator implements IAgentOrchestrator {
  constructor(
    private readonly fileContextPreparer = createFileContextPreparer(),
    private readonly persistenceCoordinator = getPersistenceCoordinator(),
    private readonly toolExecutionProcessor = createToolExecutionProcessor(),
    private readonly streamEventRouter = createStreamEventRouter(),
    private readonly graphStreamProcessor = createGraphStreamProcessor(),
    private readonly agentEventEmitter = createAgentEventEmitter(),
    private readonly usageTracker = createUsageTracker()
  ) {}
}
```

### Método Principal: executeAgent()

```typescript
async executeAgent(
  prompt: string,
  sessionId: string,
  onEvent?: (event: AgentEvent) => void,
  userId?: string,
  options?: ExecuteStreamingOptions
): Promise<AgentExecutionResult> {
  // 1. VALIDACIÓN
  if ((options?.attachments?.length || options?.enableAutoSemanticSearch) && !userId) {
    throw new Error('UserId required for file operations');
  }

  // 2. SETUP
  const adapter = StreamAdapterFactory.create('anthropic', sessionId);
  this.agentEventEmitter.setCallback(onEvent);
  this.usageTracker.reset();

  // 3. PREPARAR CONTEXTO DE ARCHIVOS
  const contextResult = await this.fileContextPreparer.prepare(userId, prompt, options);
  const enhancedPrompt = contextResult.contextText
    ? `${contextResult.contextText}\n\n${prompt}`
    : prompt;

  // 4. CONSTRUIR INPUTS PARA LANGGRAPH
  const inputs = {
    messages: [new HumanMessage(enhancedPrompt)],
    activeAgent: 'orchestrator',
    sessionId,
    context: {
      userId,
      fileContext: contextResult,
      options: {
        enableThinking: options?.enableThinking ?? false,
        thinkingBudget: options?.thinkingBudget ?? 10000,
      },
    },
  };

  // 5. PERSISTIR MENSAJE DE USUARIO (Phase 1: EventStore + Queue)
  const userMessageResult = await this.persistenceCoordinator.persistUserMessage(
    sessionId,
    prompt
  );

  // 6. EMITIR CONFIRMACIÓN
  this.agentEventEmitter.emitUserMessageConfirmed(sessionId, {
    messageId: userMessageResult.messageId,
    sequenceNumber: userMessageResult.sequenceNumber,
    eventId: userMessageResult.eventId,
    content: prompt,
    userId: userId ?? '',
  });

  // 7. STREAMING DE LANGGRAPH
  const eventStream = await orchestratorGraph.streamEvents(inputs, {
    version: 'v2',
    recursionLimit: 50,
  });

  // 8. PROCESAR STREAM
  const toolExecutionPromises: Promise<string[]>[] = [];

  // Generator que procesa eventos normalizados
  async function* createNormalizedEventStream() {
    for await (const routed of streamEventRouter.route(eventStream, adapter)) {
      if (routed.type === 'normalized') {
        yield routed.event;
      } else if (routed.type === 'tool_executions') {
        // Procesar herramientas en paralelo (no bloquear stream)
        const toolPromise = toolExecutionProcessor.processExecutions(
          routed.executions,
          { sessionId, onEvent: (event) => agentEventEmitter.emit(event) }
        );
        toolExecutionPromises.push(toolPromise);
      }
    }
  }

  // 9. PROCESAR EVENTOS NORMALIZADOS
  const processedEvents = this.graphStreamProcessor.process(
    createNormalizedEventStream(),
    { sessionId, userId: userId ?? '', enableThinking: options?.enableThinking }
  );

  let thinkingContent = '';
  let finalResponseContent = '';

  for await (const processed of processedEvents) {
    await this.handleProcessedEvent(processed, sessionId);

    if (processed.type === 'thinking_complete') {
      thinkingContent = processed.content;
    } else if (processed.type === 'final_response') {
      finalResponseContent = processed.content;
    }
  }

  // 10. ESPERAR HERRAMIENTAS
  await Promise.all(toolExecutionPromises);

  // 11. PERSISTIR THINKING (si hay)
  if (thinkingContent) {
    await this.persistenceCoordinator.persistThinking(sessionId, {
      messageId: agentMessageId,
      content: thinkingContent,
      tokenUsage: {
        inputTokens: this.usageTracker.getInputTokens(),
        outputTokens: this.usageTracker.getOutputTokens(),
      },
    });
  }

  // 12. PERSISTIR MENSAJE FINAL
  const persistResult = await this.persistenceCoordinator.persistAgentMessage(
    sessionId,
    {
      messageId: agentMessageId,
      content: finalResponseContent,
      stopReason: finalStopReason,
      model: 'claude-3-5-sonnet-20241022',
      tokenUsage: { ... },
    }
  );

  // 13. EMITIR MENSAJE COMPLETO
  this.agentEventEmitter.emit({
    type: 'message',
    content: finalResponseContent,
    messageId: agentMessageId,
    sequenceNumber: persistResult.sequenceNumber,
    eventId: persistResult.eventId,
    persistenceState: 'persisted',
    sessionId,
  });

  // 14. NORMALIZAR Y EMITIR COMPLETE
  // Usar adapter para normalizar stopReason (lógica centralizada en provider)
  const normalizedReason = adapter.normalizeStopReason(finalStopReason);

  this.agentEventEmitter.emit({
    type: 'complete',
    sessionId,
    stopReason: finalStopReason,  // Original del provider
    reason: normalizedReason,      // Normalizado (agnóstico al provider)
  });

  return { sessionId, response: finalResponseContent, ... };
}
```

**Contrato Crítico**: `AgentOrchestrator` es responsable de:
1. Persistir ANTES de emitir (eventos con `persistenceState: 'persisted'`)
2. Garantizar `sequenceNumber` en eventos persistidos
3. Emitir eventos transient sin persistencia (`thinking_chunk`, `message_chunk`)

---

## Capa 3: Pipeline de Streaming

### StreamEventRouter

**Archivo**: `backend/src/domains/agent/streaming/StreamEventRouter.ts` (102 LOC)

**Responsabilidad**: Enrutar eventos de LangGraph a procesadores específicos.

```typescript
async *route(
  eventStream: AsyncIterable<StreamEvent>,
  adapter: IStreamAdapter
): AsyncGenerator<RoutedEvent> {
  for await (const event of eventStream) {
    const eventType = event.event;

    switch (eventType) {
      case 'on_chat_model_stream':
        // Normalizar chunks de contenido
        yield { type: 'normalized', event: adapter.normalize(event) };
        break;

      case 'on_chat_model_end':
        // Usage y fin de thinking
        yield { type: 'normalized', event: adapter.normalize(event) };
        break;

      case 'on_chain_end':
        // Tool executions
        if (event.data?.output?.toolExecutions) {
          yield {
            type: 'tool_executions',
            executions: event.data.output.toolExecutions,
          };
        }
        break;

      // ... otros eventos
    }
  }
}
```

### GraphStreamProcessor

**Archivo**: `backend/src/domains/agent/streaming/GraphStreamProcessor.ts` (~200 LOC)

**Responsabilidad**: Procesar eventos normalizados y acumular contenido.

```typescript
export class GraphStreamProcessor implements IGraphStreamProcessor {
  constructor(
    private readonly thinkingAccumulator: IThinkingAccumulator,
    private readonly contentAccumulator: IContentAccumulator,
    private readonly toolEventDeduplicator?: IToolEventDeduplicator
  ) {}

  async *process(
    normalizedEvents: AsyncIterable<INormalizedStreamEvent>,
    context: StreamProcessorContext
  ): AsyncGenerator<ProcessedStreamEvent> {
    // Reset para nueva sesión
    this.thinkingAccumulator.reset();
    this.contentAccumulator.reset();

    for await (const event of normalizedEvents) {
      switch (event.type) {
        case 'reasoning_delta':
          // Acumular thinking
          this.thinkingAccumulator.append(event.reasoning);
          yield {
            type: 'thinking_chunk',
            content: event.reasoning,
            blockIndex: 0,
          };
          break;

        case 'content_delta':
          // Si hay thinking y no está completo, emitir thinking_complete
          if (this.thinkingAccumulator.hasContent() && !this.thinkingAccumulator.isComplete()) {
            yield {
              type: 'thinking_complete',
              content: this.thinkingAccumulator.getContent(),
            };
            this.thinkingAccumulator.markComplete();
          }

          // Acumular contenido
          this.contentAccumulator.append(event.content);
          yield {
            type: 'message_chunk',
            content: event.content,
            blockIndex: 1,
          };
          break;

        case 'usage':
          yield {
            type: 'usage',
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
          };
          break;

        case 'stream_end':
          yield {
            type: 'final_response',
            content: this.contentAccumulator.getContent(),
            stopReason: event.stopReason,
          };
          break;
      }
    }
  }
}
```

### Acumuladores

**ThinkingAccumulator** (~50 LOC):
```typescript
export class ThinkingAccumulator implements IThinkingAccumulator {
  private content = '';
  private complete = false;

  append(chunk: string): void {
    this.content += chunk;
  }

  getContent(): string {
    return this.content;
  }

  hasContent(): boolean {
    return this.content.length > 0;
  }

  isComplete(): boolean {
    return this.complete;
  }

  markComplete(): void {
    this.complete = true;
  }

  reset(): void {
    this.content = '';
    this.complete = false;
  }
}
```

**ContentAccumulator** (~50 LOC): Idéntico pero sin flag `complete`.

**Tipos de Eventos LangGraph**:
```typescript
// Eventos entrantes de LangGraph
- on_chat_model_stream     // Chunks de contenido (thinking + mensaje)
- on_chat_model_end         // Fin de modelo (usage, thinking completo)
- on_chain_start            // Inicio de cadena (metadata)
- on_chain_end              // Fin de cadena (tool executions)
- on_tool_start             // Inicio de herramienta
- on_tool_end               // Fin de herramienta
- on_chain_error            // Error de cadena
- on_llm_error              // Error de LLM
```

---

## Capa 4: Procesamiento de Herramientas

**Archivo**: `backend/src/domains/agent/tools/ToolExecutionProcessor.ts` (~150+ LOC)

### Responsabilidades

1. Deduplicar ejecuciones de herramientas (prevenir duplicados)
2. Emitir eventos a WebSocket inmediatamente (UX responsiva)
3. Delegar persistencia async a `PersistenceCoordinator`

### Patrón: Emit-First, Persist-Async

```typescript
export class ToolExecutionProcessor implements IToolExecutionProcessor {
  constructor(
    private readonly deduplicator: IToolEventDeduplicator = new ToolEventDeduplicator(),
    private readonly persistenceCoordinator: IPersistenceCoordinator = getPersistenceCoordinator()
  ) {}

  async processExecutions(
    executions: RawToolExecution[],
    context: ToolProcessorContext
  ): Promise<string[]> {
    const { sessionId, onEvent } = context;
    const toolsUsed: string[] = [];
    const executionsToPersist: ToolExecution[] = [];

    for (const exec of executions) {
      // 1. DEDUPLICACIÓN
      const dedupResult = this.deduplicator.checkAndMark(exec.toolUseId);
      if (dedupResult.isDuplicate) {
        this.logger.debug('Skipping duplicate tool event');
        continue;
      }

      // 2. CREAR EVENT IDs
      const toolUseEventId = randomUUID();
      const toolResultEventId = randomUUID();
      const timestamp = new Date().toISOString();

      // 3. EMITIR tool_use (INMEDIATO - no esperar persistencia)
      const toolUseEvent: ToolUseEvent = {
        type: 'tool_use',
        toolUseId: exec.toolUseId,
        toolName: exec.toolName,
        args: exec.toolInput,
        timestamp,
        eventId: toolUseEventId,
        persistenceState: 'pending', // Se persistirá después
        sessionId,
      };
      onEvent(toolUseEvent);

      // 4. EMITIR tool_result (INMEDIATO)
      const toolResultEvent: ToolResultEvent = {
        type: 'tool_result',
        toolUseId: exec.toolUseId,
        toolName: exec.toolName,
        result: exec.toolOutput,
        success: exec.success,
        error: exec.error,
        timestamp,
        eventId: toolResultEventId,
        persistenceState: 'pending',
        sessionId,
      };
      onEvent(toolResultEvent);

      // 5. ACUMULAR PARA PERSISTENCIA ASYNC
      executionsToPersist.push({
        toolUseId: exec.toolUseId,
        toolName: exec.toolName,
        toolInput: exec.toolInput,
        toolOutput: exec.toolOutput,
        success: exec.success,
        error: exec.error,
        timestamp,
      });

      toolsUsed.push(exec.toolName);
    }

    // 6. PERSISTIR ASYNC (fire-and-forget, no bloquea)
    if (executionsToPersist.length > 0) {
      this.persistenceCoordinator.persistToolEventsAsync(sessionId, executionsToPersist);
    }

    return toolsUsed;
  }
}
```

### ToolEventDeduplicator

**Archivo**: `backend/src/domains/agent/tools/ToolEventDeduplicator.ts` (~50 LOC)

```typescript
export class ToolEventDeduplicator implements IToolEventDeduplicator {
  private seenToolUseIds = new Map<string, string>(); // toolUseId → firstSeenAt

  checkAndMark(toolUseId: string): DeduplicationResult {
    if (this.seenToolUseIds.has(toolUseId)) {
      return {
        isDuplicate: true,
        firstSeenAt: this.seenToolUseIds.get(toolUseId),
      };
    }

    const timestamp = new Date().toISOString();
    this.seenToolUseIds.set(toolUseId, timestamp);

    return {
      isDuplicate: false,
      firstSeenAt: timestamp,
    };
  }

  reset(): void {
    this.seenToolUseIds.clear();
  }
}
```

**Contrato**: El deduplicador debe resetearse al inicio de cada sesión de agente para evitar falsos positivos entre ejecuciones.

---

## Capa 5: Persistencia Bifásica

**Archivo**: `backend/src/domains/agent/persistence/PersistenceCoordinator.ts` (556 LOC)

### Arquitectura de Dos Fases

```
┌──────────────────────────────────────────────────────────────┐
│ FASE 1: EventStore (SYNC ~10ms)                             │
│ ────────────────────────────────────────────────────────────│
│                                                              │
│  1. appendEvent(sessionId, eventType, data)                 │
│  2. Redis INCR key: `event:sequence:{sessionId}`            │
│  3. INSERT INTO message_events (sequence_number, ...)       │
│  4. COMMIT                                                   │
│  5. RETURN { eventId, sequence_number, timestamp }          │
│                                                              │
│  Latencia: ~10ms                                            │
│  Garantía: sequence_number atómico, único, monotónico       │
│  Tabla: message_events (append-only, source of truth)       │
│                                                              │
└──────────────────────────────────────────────────────────────┘
                         │
                         │ sequenceNumber + eventId
                         ▼
┌──────────────────────────────────────────────────────────────┐
│ FASE 2: MessageQueue (ASYNC ~600ms)                         │
│ ────────────────────────────────────────────────────────────│
│                                                              │
│  1. addMessagePersistence(job)                              │
│  2. BullMQ → Redis queue                                    │
│  3. Worker procesa job (concurrency: 10)                    │
│  4. INSERT INTO messages (...)                              │
│  5. Job completo                                            │
│                                                              │
│  Latencia: ~600ms (asíncrono, no percibida por usuario)    │
│  Garantía: eventual consistency                             │
│  Tabla: messages (materialized view, query-optimized)       │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### EventStore: Fase 1 (Síncrona)

**Archivo**: `backend/src/services/events/EventStore.ts` (~400 LOC)

```typescript
export class EventStore {
  async appendEvent(
    sessionId: string,
    eventType: EventType,
    data: Record<string, unknown>
  ): Promise<BaseEvent> {
    const eventId = randomUUID();

    // 1. GENERAR SEQUENCE NUMBER (Redis INCR - atómico)
    const redis = getRedis();
    const sequenceKey = `event:sequence:${sessionId}`;
    const sequenceNumber = await redis.incr(sequenceKey);

    // 2. SET TTL (7 días para limpieza automática)
    await redis.expire(sequenceKey, 7 * 24 * 60 * 60);

    // 3. INSERT A message_events (append-only)
    const query = `
      INSERT INTO message_events (
        id, session_id, event_type, sequence_number, data, timestamp, processed
      )
      VALUES (@id, @sessionId, @eventType, @sequenceNumber, @data, GETUTCDATE(), 0)
    `;

    const params: SqlParams = {
      id: eventId,
      sessionId,
      eventType,
      sequenceNumber,
      data: JSON.stringify(data),
    };

    await executeQuery(query, params);

    // 4. RETURN CON sequence_number
    return {
      id: eventId,
      session_id: sessionId,
      event_type: eventType,
      sequence_number: sequenceNumber,
      timestamp: new Date(),
      data,
      processed: false,
    };
  }
}
```

**Garantías de EventStore**:
1. **Atomicidad**: Redis INCR es atómico (thread-safe)
2. **Unicidad**: `sequence_number` único por sesión
3. **Monotonía**: Números crecientes sin gaps
4. **Durabilidad**: Escritura síncrona a Azure SQL
5. **Ordenamiento**: Cliente puede ordenar por `sequence_number`

### MessageQueue: Fase 2 (Asíncrona)

**Archivo**: `backend/src/infrastructure/queue/MessageQueue.ts` (~500 LOC)

```typescript
export class MessageQueue {
  async addMessagePersistence(job: MessagePersistenceJob): Promise<string> {
    // 1. RATE LIMITING (100 jobs/session/hora)
    const rateLimitKey = `rate:${QueueName.MESSAGE_PERSISTENCE}:${job.sessionId}`;
    const redis = getRedis();
    const count = await redis.incr(rateLimitKey);

    if (count === 1) {
      await redis.expire(rateLimitKey, 3600); // 1 hora
    }

    if (count > 100) {
      throw new Error(`Rate limit exceeded: ${count}/100 per hour`);
    }

    // 2. ENCOLAR JOB (BullMQ)
    const queue = this.getQueue(QueueName.MESSAGE_PERSISTENCE);
    const bullJob = await queue.add('persist-message', job, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
      removeOnFail: false,
    });

    return bullJob.id as string;
  }
}
```

**Worker de BullMQ**:
```typescript
// Worker para MESSAGE_PERSISTENCE queue
const worker = new Worker(
  QueueName.MESSAGE_PERSISTENCE,
  async (job: Job<MessagePersistenceJob>) => {
    const { sessionId, messageId, role, messageType, content, metadata, sequenceNumber, eventId } = job.data;

    // INSERT a tabla `messages` (materialized view)
    const query = `
      INSERT INTO messages (
        id, session_id, role, message_type, content,
        metadata, sequence_number, event_id, created_at
      )
      VALUES (@id, @sessionId, @role, @messageType, @content,
              @metadata, @sequenceNumber, @eventId, GETUTCDATE())
    `;

    await executeQuery(query, {
      id: messageId,
      sessionId,
      role,
      messageType,
      content,
      metadata: JSON.stringify(metadata),
      sequenceNumber,
      eventId,
    });

    logger.info({ messageId, sequenceNumber }, 'Message persisted to DB');
  },
  {
    connection: redis,
    concurrency: 10, // 10 workers en paralelo
  }
);
```

### PersistenceCoordinator: Interface Unificada

```typescript
export class PersistenceCoordinator implements IPersistenceCoordinator {
  constructor(
    private eventStore: EventStore = getEventStore(),
    private messageQueue: MessageQueue = getMessageQueue(),
    private errorAnalyzer: IPersistenceErrorAnalyzer = getPersistenceErrorAnalyzer()
  ) {}

  async persistUserMessage(sessionId: string, content: string): Promise<UserMessagePersistedEvent> {
    const messageId = uuidv4();

    // FASE 1: EventStore (sync)
    const dbEvent = await this.eventStore.appendEvent(sessionId, 'user_message_sent', {
      message_id: messageId,
      content,
      timestamp: new Date().toISOString(),
      persistenceState: 'persisted',
    });

    // VALIDACIÓN CRÍTICA: sequence_number debe existir
    if (dbEvent.sequence_number === undefined || dbEvent.sequence_number === null) {
      throw new Error(`Event persisted without sequence_number`);
    }

    // FASE 2: MessageQueue (async)
    await this.messageQueue.addMessagePersistence({
      sessionId,
      messageId,
      role: 'user',
      messageType: 'text',
      content,
      metadata: {},
      sequenceNumber: dbEvent.sequence_number,
      eventId: dbEvent.id,
    });

    // RETURN con sequence_number
    return {
      eventId: dbEvent.id,
      sequenceNumber: dbEvent.sequence_number,
      timestamp: dbEvent.timestamp.toISOString(),
      messageId,
    };
  }

  // Métodos similares para:
  // - persistAgentMessage()
  // - persistThinking()
  // - persistToolUse()
  // - persistToolResult()
  // - persistError()
}
```

**Patrón Crítico**: Todos los métodos `persist*()` siguen el mismo flujo:
1. EventStore primero (sync)
2. Validar `sequence_number`
3. MessageQueue después (async)
4. Return inmediato con `sequence_number`

---

## Capa 6: Emisión de Eventos

**Archivo**: `backend/src/domains/agent/emission/AgentEventEmitter.ts` (148 LOC)

### Responsabilidades

1. Canal unificado: `'agent:event'` con discriminación de tipo
2. Auto-incremento de `eventIndex` para ordenamiento frontend
3. Convenience methods para eventos comunes

### Arquitectura de Emisión

```typescript
export class AgentEventEmitter implements IAgentEventEmitter {
  private callback: EventEmitCallback | undefined;
  private indexTracker: IEventIndexTracker = new EventIndexTracker();

  setCallback(callback: EventEmitCallback | undefined): void {
    this.callback = callback;
  }

  emit(event: AgentEvent | null): void {
    if (event && this.callback) {
      // Augmentar con eventIndex (auto-incremental)
      const eventWithIndex = {
        ...event,
        eventIndex: this.indexTracker.next(),
      };
      this.callback(eventWithIndex);
    }
  }

  emitUserMessageConfirmed(sessionId: string, data: {...}): void {
    this.emit({
      type: 'user_message_confirmed',
      sessionId,
      messageId: data.messageId,
      sequenceNumber: data.sequenceNumber,
      eventId: data.eventId,
      content: data.content,
      userId: data.userId,
      timestamp: new Date().toISOString(),
      persistenceState: 'persisted',
    });
  }

  emitError(sessionId: string, error: string, code: string): void {
    this.emit({
      type: 'error',
      sessionId,
      timestamp: new Date().toISOString(),
      error,
      code,
    });
  }
}
```

### EventIndexTracker

```typescript
export class EventIndexTracker implements IEventIndexTracker {
  private currentIndex = 0;

  next(): number {
    return this.currentIndex++;
  }

  current(): number {
    return this.currentIndex;
  }

  reset(): void {
    this.currentIndex = 0;
  }
}
```

### Tipos de Eventos (17 en total)

```typescript
type AgentEventType =
  | 'session_start'           // Sesión de agente iniciada
  | 'thinking'                // Bloque de pensamiento (deprecated - usar thinking_chunk)
  | 'thinking_chunk'          // Chunk de pensamiento (Extended Thinking)
  | 'thinking_complete'       // Pensamiento completo
  | 'message_partial'         // Mensaje parcial (deprecated)
  | 'message_chunk'           // Chunk de mensaje (streaming)
  | 'message'                 // Mensaje completo del agente
  | 'tool_use'                // Herramienta invocada
  | 'tool_result'             // Resultado de herramienta
  | 'session_end'             // Sesión terminada
  | 'complete'                // Ejecución completa
  | 'approval_requested'      // Aprobación requerida (write ops)
  | 'approval_resolved'       // Aprobación resuelta
  | 'error'                   // Error ocurrido
  | 'user_message_confirmed'  // Mensaje de usuario persistido
  | 'turn_paused'             // Turno pausado (SDK 0.71)
  | 'content_refused';        // Contenido rechazado (SDK 0.71)
```

**Contrato de Eventos**:
- **Transient** (`thinking_chunk`, `message_chunk`): Sin `sequenceNumber`, solo `eventIndex`
- **Persisted** (`message`, `tool_use`, `tool_result`): Ambos `sequenceNumber` y `eventIndex`
- **Hybrid** (`complete`, `error`): Solo `eventIndex` (no requieren ordenamiento estricto)

---

## Garantías de Eventos (Provider-Agnostic)

Esta sección define las garantías de eventos que el sistema provee, independiente del proveedor de LLM utilizado (Claude, GPT-4, etc.). Los tests E2E deben verificar estos patrones, no secuencias específicas de eventos.

### Eventos Garantizados (SIEMPRE ocurren)

| Evento | Garantía | Condición |
|--------|----------|-----------|
| `user_message_confirmed` | SIEMPRE primero | Después de persistir mensaje de usuario |
| `message` o `error` | SIEMPRE terminal | Hay un evento de contenido final |
| `complete` | SIEMPRE último significativo | Último evento lógico de la sesión |

### Eventos Condicionales (Dependen del LLM)

| Evento | Condición |
|--------|-----------|
| `thinking_chunk` / `thinking_complete` | Solo si Extended Thinking está habilitado Y el LLM decide pensar |
| `tool_use` / `tool_result` | Solo si el LLM decide usar herramientas |
| `message_chunk` | Solo durante streaming (puede no haber con respuestas muy cortas) |

### Invariantes de Orden

1. **Tool pairing**: Si hay `tool_use`, DEBE seguir un `tool_result` con mismo `toolUseId`
2. **Thinking before message**: Si hay `thinking_chunk`, DEBE preceder a `message_chunk`
3. **Complete is terminal**: `complete` DEBE ser el último evento significativo
   - Eventos transient (`message_chunk`, `thinking_chunk`) pueden llegar después por buffering de WebSocket
   - Frontend debe ignorar chunks después de `complete`

### Implicaciones para Testing

```typescript
// ✅ CORRECTO: Verificar patrones, no secuencias exactas
it('should emit tool_result after tool_use if tools were used', () => {
  const toolUseIndex = events.findIndex(e => e.type === 'tool_use');
  const toolResultIndex = events.findIndex(e => e.type === 'tool_result');

  // Solo verificar orden si ambos existen
  if (toolUseIndex > -1 && toolResultIndex > -1) {
    expect(toolUseIndex).toBeLessThan(toolResultIndex);
  }
});

// ❌ INCORRECTO: Asumir que siempre habrá tool events
it('should emit tool_use event', () => {
  const toolUseEvent = events.find(e => e.type === 'tool_use');
  expect(toolUseEvent).toBeDefined(); // Falla si LLM no usa tools
});
```

### Normalización de Stop Reasons

El `stopReason` del proveedor se normaliza a valores canónicos:

| Provider Stop Reason | Normalized `reason` |
|---------------------|---------------------|
| `end_turn` | `success` |
| `tool_use` | `success` |
| `max_tokens` | `success` |
| `stop_sequence` | `success` |
| Error/exception | `error` |
| Max turns reached | `max_turns` |
| User cancelled | `user_cancelled` |

---

## Garantías de Ordenamiento

### Dos Sistemas de Ordenamiento

```
┌─────────────────────────────────────────────────────────────┐
│ SISTEMA 1: sequenceNumber (Redis INCR)                      │
│ ───────────────────────────────────────────────────────────│
│                                                              │
│  Propósito: Ordenamiento GLOBAL de eventos persistidos      │
│  Ámbito: Por sesión                                         │
│  Generación: Redis INCR (atómico)                           │
│  Almacenamiento: message_events.sequence_number             │
│  Garantía: Monotónico, sin gaps, único                      │
│                                                              │
│  Ejemplo:                                                    │
│    user_message_sent     → sequenceNumber: 1                │
│    agent_thinking_block  → sequenceNumber: 2                │
│    tool_use_requested    → sequenceNumber: 3                │
│    tool_use_completed    → sequenceNumber: 4                │
│    agent_message_sent    → sequenceNumber: 5                │
│                                                              │
│  Uso: Frontend puede ordenar TODOS los eventos persistidos  │
│       por sequenceNumber para reconstruir la conversación   │
│                                                              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ SISTEMA 2: eventIndex (EventIndexTracker)                   │
│ ───────────────────────────────────────────────────────────│
│                                                              │
│  Propósito: Ordenamiento LOCAL de eventos en streaming      │
│  Ámbito: Por ejecución de agente                            │
│  Generación: Contador en memoria (no persistido)            │
│  Almacenamiento: Solo en evento WebSocket                   │
│  Garantía: Monotónico dentro de una ejecución               │
│                                                              │
│  Ejemplo:                                                    │
│    user_message_confirmed → eventIndex: 0                   │
│    thinking_chunk         → eventIndex: 1 (transient)       │
│    thinking_chunk         → eventIndex: 2 (transient)       │
│    thinking_complete      → eventIndex: 3 (transient)       │
│    message_chunk          → eventIndex: 4 (transient)       │
│    message_chunk          → eventIndex: 5 (transient)       │
│    tool_use               → eventIndex: 6, sequenceNumber: 3│
│    tool_result            → eventIndex: 7, sequenceNumber: 4│
│    message                → eventIndex: 8, sequenceNumber: 5│
│    complete               → eventIndex: 9                   │
│                                                              │
│  Uso: Frontend ordena eventos DENTRO de una ejecución       │
│       (especialmente transients sin sequenceNumber)         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Validaciones

```typescript
// EventStore DEBE retornar sequence_number
if (dbEvent.sequence_number === undefined || dbEvent.sequence_number === null) {
  throw new Error(`Event persisted without sequence_number: ${dbEvent.sequence_number}`);
}

// Eventos persistidos DEBEN tener sequenceNumber antes de emisión
if (event.type === 'message' && event.persistenceState === 'persisted') {
  if (!event.sequenceNumber) {
    logger.error('CRITICAL: message event missing sequenceNumber');
  }
}
```

---

## Estados de Persistencia

```typescript
type PersistenceState = 'pending' | 'queued' | 'persisted' | 'failed' | 'transient';
```

### Tabla de Estados

| Estado       | Descripción                                    | Ejemplos                                   |
|--------------|------------------------------------------------|--------------------------------------------|
| `transient`  | Nunca se persiste (streaming chunks)          | `thinking_chunk`, `message_chunk`          |
| `pending`    | Aún no persistido (tool events inmediatos)    | `tool_use` antes de EventStore             |
| `queued`     | En cola de MessageQueue (raro emitir así)     | Job en BullMQ                              |
| `persisted`  | Persistido en EventStore + MessageQueue       | `message`, `tool_use`, `tool_result`       |
| `failed`     | Error de persistencia                          | Error de DB                                |

### Flujo de Estados

```
TRANSIENT EVENTS (nunca persisten):
  thinking_chunk → TRANSIENT (fin)
  message_chunk  → TRANSIENT (fin)
  thinking_complete → TRANSIENT (fin)

PERSISTED EVENTS (flujo completo):
  message → PENDING → EventStore.appendEvent() → PERSISTED → emit()

TOOL EVENTS (emit-first pattern):
  tool_use → PENDING → emit() → EventStore.appendEvent() → PERSISTED
```

### Contratos de Estado

```typescript
// 1. Eventos transient NUNCA tienen sequenceNumber
if (event.persistenceState === 'transient') {
  assert(event.sequenceNumber === undefined);
}

// 2. Eventos persisted SIEMPRE tienen sequenceNumber
if (event.persistenceState === 'persisted') {
  assert(event.sequenceNumber !== undefined);
}

// 3. AgentOrchestrator persiste ANTES de emitir
// (excepto tool events que usan emit-first pattern)
if (event.type === 'message' && event.persistenceState !== 'persisted') {
  logger.error('CRITICAL BUG: message not persisted before emit');
}
```

---

## Esquema de Base de Datos

### Tablas Principales

```sql
-- 1. message_events: Event sourcing log (append-only, source of truth)
CREATE TABLE message_events (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  session_id UNIQUEIDENTIFIER NOT NULL,
  event_type NVARCHAR(50) NOT NULL,
  sequence_number INT NOT NULL,              -- Atomic via Redis INCR
  data NVARCHAR(MAX) NOT NULL,               -- JSON payload
  timestamp DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
  processed BIT NOT NULL DEFAULT 0,
  INDEX IX_session_sequence (session_id, sequence_number)
);

-- 2. messages: Materialized messages (eventual consistency, query-optimized)
CREATE TABLE messages (
  id UNIQUEIDENTIFIER PRIMARY KEY,           -- Same as message_id from events
  session_id UNIQUEIDENTIFIER NOT NULL,
  role NVARCHAR(20) NOT NULL,                -- 'user' | 'assistant' | 'system'
  message_type NVARCHAR(20) NOT NULL,        -- 'text' | 'thinking' | 'tool_use' | 'tool_result'
  content NVARCHAR(MAX) NOT NULL,
  metadata NVARCHAR(MAX),                    -- JSON metadata
  sequence_number INT,                       -- From EventStore
  event_id UNIQUEIDENTIFIER,                 -- FK to message_events.id
  tool_use_id UNIQUEIDENTIFIER,              -- For tool correlation
  stop_reason NVARCHAR(50),                  -- Anthropic stop reason
  model NVARCHAR(100),                       -- Claude model name
  input_tokens INT,                          -- Token usage
  output_tokens INT,                         -- Token usage
  created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
  updated_at DATETIME2,
  FOREIGN KEY (session_id) REFERENCES sessions(id),
  INDEX IX_session_sequence (session_id, sequence_number),
  INDEX IX_session_created (session_id, created_at)
);

-- 3. sessions: Chat sessions
CREATE TABLE sessions (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  user_id UNIQUEIDENTIFIER NOT NULL,
  title NVARCHAR(200),
  created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
  updated_at DATETIME2,
  FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX IX_user_created (user_id, created_at DESC)
);

-- 4. users: User accounts
CREATE TABLE users (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  email NVARCHAR(255) NOT NULL UNIQUE,
  display_name NVARCHAR(255),
  microsoft_id NVARCHAR(255) UNIQUE,          -- Microsoft OAuth ID
  encrypted_bc_token NVARCHAR(MAX),           -- Encrypted BC access token
  created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
  updated_at DATETIME2
);
```

### Relaciones

```
users (1) ──────< (N) sessions
  │
  └──> User tiene múltiples sesiones de chat

sessions (1) ────< (N) message_events
  │
  └──> Sesión tiene múltiples eventos (append-only log)

sessions (1) ────< (N) messages
  │
  └──> Sesión tiene múltiples mensajes materializados

message_events (1) ──< (0..1) messages
  │
  └──> Evento puede tener mensaje materializado correspondiente
```

### Queries Comunes

```sql
-- 1. Obtener conversación completa (ordenada por sequenceNumber)
SELECT *
FROM messages
WHERE session_id = @sessionId
ORDER BY sequence_number ASC;

-- 2. Obtener eventos sin procesar (para background workers)
SELECT *
FROM message_events
WHERE processed = 0
ORDER BY timestamp ASC;

-- 3. Reconstruir estado desde eventos (event sourcing)
SELECT *
FROM message_events
WHERE session_id = @sessionId
ORDER BY sequence_number ASC;

-- 4. Correlacionar tool_use con tool_result
SELECT
  m1.id AS tool_use_id,
  m1.content AS tool_input,
  m2.id AS tool_result_id,
  m2.content AS tool_output,
  m2.metadata->>'$.success' AS success
FROM messages m1
INNER JOIN messages m2 ON m1.tool_use_id = m2.tool_use_id
WHERE m1.message_type = 'tool_use'
  AND m2.message_type = 'tool_result'
  AND m1.session_id = @sessionId;
```

---

## Patrones Arquitectónicos

### 1. Event Sourcing

**Definición**: Todos los cambios de estado se almacenan como eventos inmutables en un log append-only.

**Implementación**:
```typescript
// EventStore = Log append-only
await eventStore.appendEvent(sessionId, 'user_message_sent', { content });
await eventStore.appendEvent(sessionId, 'agent_message_sent', { content, stop_reason });

// Reconstruir estado desde eventos
const events = await eventStore.getEvents(sessionId);
const state = events.reduce((acc, event) => applyEvent(acc, event), initialState);
```

**Beneficios**:
- Auditoría completa (nunca se borra)
- Reproducibilidad (replay de eventos)
- Debugging temporal (ver estado en momento X)
- Escalabilidad horizontal (eventos inmutables)

### 2. Two-Phase Persistence

**Definición**: Separar persistencia rápida (EventStore) de persistencia lenta (MessageQueue).

**Implementación**:
```typescript
// FASE 1: SYNC (~10ms) - Obtener sequenceNumber
const event = await eventStore.appendEvent(sessionId, type, data);

// FASE 2: ASYNC (~600ms) - Materializar en tabla query-optimized
await messageQueue.addMessagePersistence({ ...event, sequenceNumber: event.sequence_number });
```

**Beneficios**:
- UX: Usuario obtiene sequenceNumber inmediatamente
- Escalabilidad: DB writes no bloquean el flujo principal
- Resiliencia: Queue retries automáticos si DB falla

### 3. Multi-Tenant Isolation

**Definición**: Todas las operaciones aisladas por `userId` + `sessionId`.

**Implementación**:
```typescript
// Validar propiedad de sesión ANTES de cualquier operación
await validateSessionOwnership(sessionId, userId);

// Query con filtro multi-tenant
const messages = await db.query(
  'SELECT * FROM messages WHERE session_id = @sessionId AND user_id = @userId',
  { sessionId, userId }
);

// Redis keys con prefijo de sesión
const sequenceKey = `event:sequence:${sessionId}`;
const rateLimitKey = `rate:message-persistence:${sessionId}`;
```

**Beneficios**:
- Seguridad: Previene acceso cross-tenant
- Escalabilidad: Partition by userId
- Compliance: GDPR/CCPA (data per user)

### 4. Streaming with Accumulators

**Definición**: Acumular chunks de contenido mientras se emite streaming al frontend.

**Implementación**:
```typescript
const thinkingAccumulator = new ThinkingAccumulator();
const contentAccumulator = new ContentAccumulator();

for await (const chunk of stream) {
  if (chunk.type === 'reasoning_delta') {
    thinkingAccumulator.append(chunk.content);
    emit({ type: 'thinking_chunk', content: chunk.content });
  } else if (chunk.type === 'content_delta') {
    contentAccumulator.append(chunk.content);
    emit({ type: 'message_chunk', content: chunk.content });
  }
}

// Al final, persistir contenido acumulado completo
await persist({ content: contentAccumulator.getContent() });
```

**Beneficios**:
- UX: Frontend ve texto escribiéndose en tiempo real
- Correctitud: Contenido completo se persiste (no chunks individuales)
- Flexibilidad: Frontend puede reconstruir chunks o usar contenido completo

### 5. Emit-First, Persist-Async (Tool Events)

**Definición**: Emitir eventos de herramientas al frontend inmediatamente, persistir después.

**Implementación**:
```typescript
// 1. EMITIR INMEDIATAMENTE (UX responsiva)
emit({ type: 'tool_use', toolUseId, toolName, args, persistenceState: 'pending' });
emit({ type: 'tool_result', toolUseId, result, persistenceState: 'pending' });

// 2. PERSISTIR ASYNC (fire-and-forget)
persistenceCoordinator.persistToolEventsAsync(sessionId, executions);
```

**Beneficios**:
- UX: Frontend ve herramientas ejecutándose sin delay
- Performance: No esperar a DB writes (~600ms)
- Confiabilidad: Persistencia eventual con retries

### 6. Dependency Injection for Testing

**Definición**: Inyectar dependencias vía constructor para permitir mocks en tests.

**Implementación**:
```typescript
export class AgentOrchestrator {
  constructor(
    private readonly fileContextPreparer = createFileContextPreparer(),
    private readonly persistenceCoordinator = getPersistenceCoordinator(),
    private readonly graphStreamProcessor = createGraphStreamProcessor()
  ) {}
}

// En tests:
const mockPersistence = new MockPersistenceCoordinator();
const orchestrator = new AgentOrchestrator(undefined, mockPersistence);
```

**Beneficios**:
- Testabilidad: No requiere mocks globales (sinon stubs)
- Aislamiento: Cada test controla sus dependencias
- Flexibilidad: Swap implementations (fake, mock, spy)

---

## Resumen de Contratos Críticos

### 1. ChatMessageHandler ⇄ AgentOrchestrator

```typescript
// INPUT:
await orchestrator.executeAgent(
  prompt: string,              // Mensaje del usuario
  sessionId: string,           // ID de sesión (validada previamente)
  onEvent: (event) => void,    // Callback para eventos
  userId: string,              // ID de usuario autenticado
  options: {
    enableThinking?: boolean,
    thinkingBudget?: number,
    attachments?: FileAttachment[],
    enableAutoSemanticSearch?: boolean
  }
);

// OUTPUT:
return {
  sessionId: string,
  response: string,            // Respuesta completa del agente
  messageId: string,           // ID del mensaje del agente
  tokenUsage: { inputTokens, outputTokens, totalTokens },
  toolsUsed: string[],
  success: boolean
};

// EVENTOS EMITIDOS (vía onEvent callback):
- user_message_confirmed: { messageId, sequenceNumber, eventId, content }
- thinking_chunk: { content, blockIndex: 0 } (transient)
- thinking_complete: { content } (transient)
- message_chunk: { content, blockIndex: 1 } (transient)
- tool_use: { toolUseId, toolName, args, sequenceNumber, eventId }
- tool_result: { toolUseId, result, success, sequenceNumber, eventId }
- message: { content, messageId, sequenceNumber, eventId, stopReason }
- complete: { stopReason, tokenUsage }
```

### 2. AgentOrchestrator ⇄ PersistenceCoordinator

```typescript
// CONTRATO:
// - TODAS las operaciones persist*() retornan INMEDIATAMENTE (sync EventStore)
// - TODOS los eventos persistidos tienen sequenceNumber garantizado
// - MessageQueue es async (fire-and-forget, no bloquea)

interface IPersistenceCoordinator {
  // USER MESSAGE
  persistUserMessage(
    sessionId: string,
    content: string
  ): Promise<{
    eventId: string,
    sequenceNumber: number,     // Redis INCR (atómico)
    timestamp: string,
    messageId: string
  }>;

  // AGENT MESSAGE
  persistAgentMessage(
    sessionId: string,
    data: {
      messageId: string,
      content: string,
      stopReason: string,
      model: string,
      tokenUsage?: { inputTokens, outputTokens }
    }
  ): Promise<{
    eventId: string,
    sequenceNumber: number,
    timestamp: string,
    jobId?: string              // BullMQ job ID (opcional)
  }>;

  // THINKING
  persistThinking(
    sessionId: string,
    data: { messageId, content, tokenUsage }
  ): Promise<{ eventId, sequenceNumber, timestamp }>;

  // TOOL USE
  persistToolUse(
    sessionId: string,
    data: { toolUseId, toolName, toolInput }
  ): Promise<{ eventId, sequenceNumber, timestamp }>;

  // TOOL RESULT
  persistToolResult(
    sessionId: string,
    data: { toolUseId, toolOutput, isError, errorMessage }
  ): Promise<{ eventId, sequenceNumber, timestamp }>;

  // TOOL EVENTS ASYNC (fire-and-forget)
  persistToolEventsAsync(
    sessionId: string,
    executions: ToolExecution[]
  ): void;  // No retorna Promise (async en background)
}
```

### 3. PersistenceCoordinator ⇄ EventStore

```typescript
interface IEventStore {
  appendEvent(
    sessionId: string,
    eventType: EventType,
    data: Record<string, unknown>
  ): Promise<{
    id: string,                 // Event ID (UUID)
    session_id: string,
    event_type: EventType,
    sequence_number: number,    // Redis INCR (MUST NOT BE NULL)
    timestamp: Date,
    data: Record<string, unknown>,
    processed: boolean
  }>;

  getEvents(sessionId: string): Promise<BaseEvent[]>;
  getUnprocessedEvents(): Promise<BaseEvent[]>;
}

// CONTRATO CRÍTICO:
// - appendEvent() SIEMPRE retorna sequence_number !== null
// - Si Redis falla, appendEvent() lanza error (no retorna null)
// - Sequence numbers son monotónicos por sesión (sin gaps)
```

### 4. PersistenceCoordinator ⇄ MessageQueue

```typescript
interface IMessageQueue {
  addMessagePersistence(
    job: MessagePersistenceJob
  ): Promise<string>;  // Retorna job ID

  // Rate limiting: 100 jobs/session/hora
  // Retry policy: 3 intentos, exponential backoff (2s base)
  // Concurrency: 10 workers paralelos
}

interface MessagePersistenceJob {
  sessionId: string,
  messageId: string,
  role: 'user' | 'assistant' | 'system',
  messageType: 'text' | 'thinking' | 'tool_use' | 'tool_result',
  content: string,
  metadata?: Record<string, unknown>,
  sequenceNumber?: number,      // De EventStore
  eventId?: string,             // De EventStore
  toolUseId?: string,           // Para correlación
  stopReason?: string,
  model?: string,
  inputTokens?: number,
  outputTokens?: number
}

// CONTRATO:
// - addMessagePersistence() encola job y retorna inmediatamente
// - Worker procesa job asincrónicamente (~600ms)
// - Si job falla, se reintenta 3 veces con exponential backoff
// - Jobs completados se eliminan (removeOnComplete: true)
```

### 5. AgentOrchestrator ⇄ GraphStreamProcessor

```typescript
interface IGraphStreamProcessor {
  process(
    normalizedEvents: AsyncIterable<INormalizedStreamEvent>,
    context: { sessionId, userId, enableThinking }
  ): AsyncGenerator<ProcessedStreamEvent>;
}

type ProcessedStreamEvent =
  | { type: 'thinking_chunk', content: string, blockIndex: 0 }
  | { type: 'thinking_complete', content: string }
  | { type: 'message_chunk', content: string, blockIndex: 1 }
  | { type: 'final_response', content: string, stopReason: string }
  | { type: 'usage', inputTokens: number, outputTokens: number }
  | { type: 'tool_execution', ... };

// CONTRATO:
// - GraphStreamProcessor acumula contenido en ThinkingAccumulator y ContentAccumulator
// - thinking_complete se emite cuando se detecta transición a content_delta
// - final_response contiene contenido acumulado completo (no chunks individuales)
// - Accumulators se resetean al inicio de cada sesión (process() call)
```

### 6. AgentOrchestrator ⇄ ToolExecutionProcessor

```typescript
interface IToolExecutionProcessor {
  processExecutions(
    executions: RawToolExecution[],
    context: { sessionId, onEvent }
  ): Promise<string[]>;  // Retorna toolNames usados
}

interface RawToolExecution {
  toolUseId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  toolOutput: string,
  success: boolean,
  error?: string,
  timestamp: string
}

// CONTRATO:
// - processExecutions() deduplica por toolUseId (ToolEventDeduplicator)
// - Emite tool_use y tool_result INMEDIATAMENTE (onEvent callback)
// - Delega persistencia ASYNC a PersistenceCoordinator (fire-and-forget)
// - Retorna Promise<string[]> con nombres de herramientas usadas
```

---

## Diagrama de Secuencia Completo

```
Usuario          ChatMessageHandler    AgentOrchestrator    PersistenceCoordinator    EventStore    MessageQueue    WebSocket
  │                      │                      │                     │                     │              │              │
  │ chat:message         │                      │                     │                     │              │              │
  ├─────────────────────>│                      │                     │                     │              │              │
  │                      │ validateSession()    │                     │                     │              │              │
  │                      │──────────────────────────────────────────────> (DB query)        │              │              │
  │                      │                      │                     │                     │              │              │
  │                      │ executeAgent()       │                     │                     │              │              │
  │                      ├─────────────────────>│                     │                     │              │              │
  │                      │                      │ persistUserMessage()│                     │              │              │
  │                      │                      ├────────────────────>│                     │              │              │
  │                      │                      │                     │ appendEvent()       │              │              │
  │                      │                      │                     ├────────────────────>│              │              │
  │                      │                      │                     │  Redis INCR         │              │              │
  │                      │                      │                     │  INSERT events      │              │              │
  │                      │                      │                     │<────────────────────┤              │              │
  │                      │                      │                     │ { sequenceNumber }  │              │              │
  │                      │                      │                     │                     │              │              │
  │                      │                      │                     │ addMessagePersistence()           │              │
  │                      │                      │                     ├──────────────────────────────────>│              │
  │                      │                      │                     │                     │     (enqueue)│              │
  │                      │                      │<────────────────────┤                     │              │              │
  │                      │                      │ { messageId, seq }  │                     │              │              │
  │                      │                      │                     │                     │              │              │
  │                      │ user_message_confirmed                     │                     │              │              │
  │                      │<─────────────────────┤                     │                     │              │              │
  │                      ├────────────────────────────────────────────────────────────────────────────────────────────────>│
  │                      │                      │                     │                     │              │              │
  │ user_message_confirmed                      │                     │                     │              │              │
  │<─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │                      │                      │                     │                     │              │              │
  │                      │                      │ streamEvents()      │                     │              │              │
  │                      │                      │ (LangGraph)         │                     │              │              │
  │                      │                      ├───────┐             │                     │              │              │
  │                      │                      │       │             │                     │              │              │
  │                      │                      │ thinking_chunk      │                     │              │              │
  │                      │<─────────────────────┤       │             │                     │              │              │
  │                      ├────────────────────────────────────────────────────────────────────────────────────────────────>│
  │ thinking_chunk       │                      │       │             │                     │              │              │
  │<─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │                      │                      │       │             │                     │              │              │
  │                      │                      │ message_chunk       │                     │              │              │
  │                      │<─────────────────────┤       │             │                     │              │              │
  │                      ├────────────────────────────────────────────────────────────────────────────────────────────────>│
  │ message_chunk        │                      │       │             │                     │              │              │
  │<─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │                      │                      │       │             │                     │              │              │
  │                      │                      │ tool_executions     │                     │              │              │
  │                      │                      │<──────┘             │                     │              │              │
  │                      │                      │ (ToolExecutionProcessor)                  │              │              │
  │                      │                      │                     │                     │              │              │
  │                      │ tool_use             │                     │                     │              │              │
  │                      │<─────────────────────┤                     │                     │              │              │
  │                      ├────────────────────────────────────────────────────────────────────────────────────────────────>│
  │ tool_use             │                      │                     │                     │              │              │
  │<─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │                      │                      │                     │                     │              │              │
  │                      │                      │ persistToolEventsAsync() (fire-forget)    │              │              │
  │                      │                      │────────────────────>│────────────────────>│──────────────>│              │
  │                      │                      │                     │                     │              │              │
  │                      │                      │ final_response      │                     │              │              │
  │                      │                      │<──────┐             │                     │              │              │
  │                      │                      │       │             │                     │              │              │
  │                      │                      │ persistAgentMessage()                     │              │              │
  │                      │                      ├────────────────────>│────────────────────>│──────────────>│              │
  │                      │                      │<────────────────────┤                     │              │              │
  │                      │                      │ { seq }             │                     │              │              │
  │                      │                      │                     │                     │              │              │
  │                      │ message (complete)   │                     │                     │              │              │
  │                      │<─────────────────────┤                     │                     │              │              │
  │                      ├────────────────────────────────────────────────────────────────────────────────────────────────>│
  │ message              │                      │                     │                     │              │              │
  │<─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │                      │                      │                     │                     │              │              │
  │                      │ complete             │                     │                     │              │              │
  │                      │<─────────────────────┤                     │                     │              │              │
  │                      ├────────────────────────────────────────────────────────────────────────────────────────────────>│
  │ complete             │                      │                     │                     │              │              │
  │<─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │                      │                      │                     │                     │              │              │
  │                      │                      │                     │                     │              │ (async worker)│
  │                      │                      │                     │                     │              │ INSERT messages
  │                      │                      │                     │                     │              │──────────────>│
  │                      │                      │                     │                     │              │      (DB)    │
```

---

## Glosario de Términos

- **Event Sourcing**: Patrón donde cambios de estado se almacenan como eventos inmutables
- **Two-Phase Persistence**: Separación de escritura rápida (EventStore) y lenta (MessageQueue)
- **Multi-Tenant Safe**: Operaciones aisladas por userId + sessionId
- **Append-Only Log**: Tabla donde solo se insertan registros (nunca UPDATE/DELETE)
- **Materialized View**: Tabla query-optimized construida desde eventos (eventual consistency)
- **Atomic Sequence**: Número de secuencia generado por Redis INCR (thread-safe)
- **Transient Event**: Evento que no se persiste (streaming chunks)
- **Persisted Event**: Evento almacenado en EventStore con sequenceNumber
- **Emit-First Pattern**: Emitir evento a WebSocket antes de persistir (UX responsiva)
- **Fire-and-Forget**: Operación asíncrona que no espera resultado (persistencia async)

---

*Última actualización: 2025-12-23*
