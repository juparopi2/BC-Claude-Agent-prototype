# Contrato Interno del Backend - BC Agent

> **Fecha**: 2026-01-13
> **Versión**: 2.1
> **Propósito**: Documentar la arquitectura, módulos, responsabilidades y flujo de procesamiento de mensajes del backend.

---

## 1. Arquitectura General (Screaming Architecture)

El backend sigue una **Screaming Architecture** donde la estructura de carpetas comunica claramente qué hace el sistema.

### 1.1 Estructura de Directorios

```
backend/src/
├── core/                       # Utilidades centrales de LangChain
│   └── langchain/
│       └── ModelFactory.ts     # Factory para crear modelos LLM
│
├── domains/                    # Lógica de negocio pura (agnóstica de frameworks)
│   ├── agent/                  # Dominio principal del agente
│   │   ├── orchestration/      # AgentOrchestrator, ExecutionContextSync
│   │   ├── persistence/        # PersistenceCoordinator (Two-Phase)
│   │   ├── context/            # FileContextPreparer, SemanticSearchHandler
│   │   ├── citations/          # CitationExtractor (extracción de citas de RAG)
│   │   ├── emission/           # EventIndexTracker
│   │   ├── tools/              # ToolLifecycleManager, ToolEventDeduplicator
│   │   └── usage/              # UsageTracker
│   ├── approval/               # Flujo Human-in-the-Loop (ApprovalManager)
│   ├── auth/                   # Autenticación y middleware
│   │   ├── middleware/         # Express middleware
│   │   └── oauth/              # MicrosoftOAuthService
│   ├── billing/                # Billing y tracking de costos
│   │   └── tracking/           # UsageTrackingService, QuotaValidatorService
│   ├── business-central/       # (Placeholder - estructura reservada)
│   ├── chat/                   # (Placeholder - estructura reservada)
│   ├── files/                  # (Placeholder - estructura reservada)
│   └── search/                 # (Placeholder - estructura reservada)
│
├── modules/                    # Implementaciones concretas de agentes (LangGraph)
│   └── agents/
│       ├── orchestrator/       # Grafo principal y routing
│       │   ├── graph.ts        # Definición del StateGraph
│       │   ├── router.ts       # Lógica de routing de intents
│       │   ├── state.ts        # Estado compartido (AgentState)
│       │   └── check_graph.ts  # Validación del grafo
│       ├── business-central/   # BC Agent y sus herramientas
│       │   ├── bc-agent.ts     # Implementación del agente
│       │   └── tools.ts        # 7 meta-tools de BC
│       ├── rag-knowledge/      # RAG Agent
│       │   ├── rag-agent.ts    # Implementación del agente RAG
│       │   ├── tools.ts        # search_knowledge_base tool
│       │   └── schemas/        # searchResult.schema.ts (Zod)
│       └── core/               # AgentFactory
│
├── services/                   # Servicios de infraestructura
│   ├── websocket/              # ChatMessageHandler, SocketService
│   ├── events/                 # EventStore (Event Sourcing)
│   ├── files/                  # FileService, FileUploadService
│   │   ├── citations/          # CitationParser
│   │   ├── context/            # ContextRetrievalService, ContextStrategyFactory
│   │   └── processors/         # PDF, DOCX, Excel, Text, Image processors
│   ├── chunking/               # ChunkingStrategyFactory (3 estrategias)
│   ├── citations/              # CitationService (recuperación de citas)
│   ├── embeddings/             # EmbeddingService
│   ├── messages/               # MessageService
│   ├── sessions/               # SessionTitleGenerator
│   ├── search/                 # Search services
│   │   ├── semantic/           # SemanticSearchService
│   │   └── VectorSearchService.ts # Azure AI Search client
│   ├── cache/                  # ToolUseTracker
│   ├── todo/                   # TodoManager
│   ├── token-usage/            # TokenUsageService
│   ├── auth/                   # BCTokenManager
│   └── bc/                     # BCClient, BCValidator
│
├── repositories/               # Data Access Layer
│   └── ImageEmbeddingRepository.ts # Gestión de embeddings de imágenes
│
├── shared/                     # Código compartido
│   ├── providers/              # Adaptadores de proveedores LLM
│   │   ├── adapters/           # AnthropicAdapter
│   │   ├── interfaces/         # IProviderAdapter, IBatchResultNormalizer
│   │   └── normalizers/        # BatchResultNormalizer
│   ├── constants/              # errors, queue, tools
│   ├── middleware/             # logging middleware
│   ├── types/                  # Tipos compartidos
│   └── utils/                  # logger, retry, session-ownership, uuid
│       └── sql/                # QueryBuilder, validators
│
├── infrastructure/             # Infraestructura técnica
│   ├── config/                 # EnvironmentFacade, feature-flags, pricing.config
│   ├── database/               # database.ts, migrations/
│   ├── redis/                  # redis.ts, redis-client.ts
│   ├── queue/                  # MessageQueue (BullMQ)
│   └── keyvault/               # Azure Key Vault
│
├── routes/                     # Rutas HTTP (REST)
│   ├── auth-oauth.ts           # OAuth login endpoints
│   ├── files.ts                # File upload/download/search
│   ├── sessions.ts             # Session CRUD
│   ├── billing.ts              # Billing queries
│   ├── gdpr.ts                 # Data deletion (GDPR)
│   ├── token-usage.ts          # Token usage queries
│   ├── usage.ts                # Usage aggregation
│   └── logs.ts                 # Log endpoints
│
├── schemas/                    # Schemas Zod para validación
│   └── request.schemas.ts
│
├── types/                      # Tipos TypeScript centralizados
│   └── index.ts                # Barrel exports
│
└── server.ts                   # Main Express server
```

### 1.2 Jerarquía de Dependencias

```
┌─────────────────────────────────────────────────────────────────┐
│                        services/websocket                        │
│                     (ChatMessageHandler)                         │
│                   PUNTO DE ENTRADA WEBSOCKET                     │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    domains/agent/orchestration                   │
│                      (AgentOrchestrator)                         │
│                   COORDINADOR PRINCIPAL                          │
└───┬──────────┬────────────────┬───────────────┬────────────────┘
    │          │                │               │
    ▼          ▼                ▼               ▼
┌────────┐ ┌───────────┐ ┌───────────────┐ ┌────────────────────┐
│context/│ │  modules/ │ │ persistence/  │ │shared/providers/   │
│ File   │ │  agents/  │ │Persistence    │ │                    │
│Context │ │  graph.ts │ │Coordinator    │ │AnthropicAdapter    │
│Preparer│ │ LangGraph │ │EventStore+MQ  │ │BatchResultNormaliz.│
└────────┘ └─────┬─────┘ └───────────────┘ └────────────────────┘
                 │
    ┌────────────┼────────────┐
    ▼            ▼            ▼
┌────────┐ ┌──────────┐ ┌──────────┐
│router  │ │bc-agent  │ │rag-agent │
│.ts     │ │.ts       │ │.ts       │
└────────┘ └──────────┘ └──────────┘
                 │
      ┌──────────┴──────────┐
      ▼                     ▼
┌─────────────────┐ ┌─────────────────────────────────────────────┐
│domains/agent/   │ │                domains/agent/citations       │
│tools/           │ │                (CitationExtractor)           │
│ToolLifecycle    │ │        EXTRACCIÓN DE CITAS DE RAG RESULTS    │
│Manager          │ └─────────────────────────────────────────────┘
└─────────────────┘
```

---

## 2. Flujo de Procesamiento de Mensajes

### 2.1 Diagrama de Secuencia Completo

```
┌─────────┐  ┌────────────────┐  ┌────────────────┐  ┌────────────┐  ┌─────────────────┐
│Frontend │  │ChatMessage     │  │AgentOrchestrator│ │orchestrator│  │BatchResult      │
│Socket.IO│  │Handler         │  │                │  │Graph       │  │Normalizer       │
└────┬────┘  └───────┬────────┘  └───────┬────────┘  └─────┬──────┘  └────────┬────────┘
     │               │                   │                 │                  │
     │ chat:message  │                   │                 │                  │
     │──────────────>│                   │                 │                  │
     │               │                   │                 │                  │
     │               │ 1. Validate Auth  │                 │                  │
     │               │ 2. Validate Owner │                 │                  │
     │               │                   │                 │                  │
     │               │ executeAgentSync()│                 │                  │
     │               │──────────────────>│                 │                  │
     │               │                   │                 │                  │
     │               │                   │ 3. Create       │                  │
     │               │                   │ ExecutionContext│                  │
     │               │                   │ Sync            │                  │
     │               │                   │                 │                  │
     │               │                   │ 4. FileContext  │                  │
     │               │                   │    Preparer     │                  │
     │               │                   │                 │                  │
     │ session_start │                   │                 │                  │
     │<──────────────│<──────────────────│                 │                  │
     │               │                   │                 │                  │
     │               │                   │ 5. Persist User │                  │
     │               │                   │    Message      │                  │
     │               │                   │                 │                  │
     │ user_message_ │                   │                 │                  │
     │ confirmed     │                   │                 │                  │
     │<──────────────│<──────────────────│                 │                  │
     │               │                   │                 │                  │
     │               │                   │ 6. graph.invoke │                  │
     │               │                   │────────────────>│                  │
     │               │                   │                 │                  │
     │               │                   │                 │ [Router Node]    │
     │               │                   │                 │ [Agent Node]     │
     │               │                   │                 │ [ReAct Loop]     │
     │               │                   │                 │                  │
     │               │                   │<────────────────│                  │
     │               │                   │ AgentState      │                  │
     │               │                   │                 │                  │
     │               │                   │ 7. BatchResultNormalizer.normalize()
     │               │                   │─────────────────────────────────────>
     │               │                   │                 │                  │
     │               │                   │<─────────────────────────────────────
     │               │                   │ NormalizedAgentEvent[]             │
     │               │                   │                 │                  │
     │               │                   │ 8. Pre-Allocate │                  │
     │               │                   │    Sequences    │                  │
     │               │                   │    (Redis INCRBY)                  │
     │               │                   │                 │                  │
     │               │                   │ 9. Process Events Loop             │
     │               │                   │    ┌────────────────────────────┐  │
     │               │                   │    │ FOR event IN normalized:   │  │
     │               │                   │    │   IF sync_required:        │  │
     │               │                   │    │     persistSyncEvent()     │  │
     │               │                   │    │   IF tool_request:         │  │
     │               │                   │    │     ToolLifecycleMgr.onReq │  │
     │               │                   │    │   IF tool_response:        │  │
     │               │                   │    │     ToolLifecycleMgr.onComp│  │
     │               │                   │    │     persistToolAsync()     │  │
     │               │                   │    │   emitEvent()              │  │
     │               │                   │    └────────────────────────────┘  │
     │               │                   │                 │                  │
     │thinking_compl │                   │                 │                  │
     │<──────────────│<──────────────────│                 │                  │
     │               │                   │                 │                  │
     │ tool_use      │                   │                 │                  │
     │<──────────────│<──────────────────│                 │                  │
     │ tool_result   │                   │                 │                  │
     │<──────────────│<──────────────────│                 │                  │
     │               │                   │                 │                  │
     │ message       │                   │                 │                  │
     │<──────────────│<──────────────────│                 │                  │
     │               │                   │                 │                  │
     │               │                   │ 10. Finalize    │                  │
     │               │                   │     Orphan Tools│                  │
     │               │                   │                 │                  │
     │ complete      │                   │                 │                  │
     │<──────────────│<──────────────────│                 │                  │
     │               │                   │                 │                  │
```

### 2.2 El Stack de 8 Capas

El procesamiento de mensajes atraviesa 8 capas estrictas:

| Capa | Módulo | Responsabilidad |
|------|--------|-----------------|
| **1. WebSocket** | `ChatMessageHandler.ts` | Validación de auth, sesión, delegación |
| **2. Orquestación** | `AgentOrchestrator.ts` | Contexto, coordinación, flujo principal |
| **3. Routing** | `router.ts` | Decidir qué agente procesa (BC, RAG, Orchestrator) |
| **4. Ejecución** | `graph.ts` + Agentes | LangGraph StateGraph con nodos de agentes |
| **5. Normalización** | `BatchResultNormalizer.ts` | Convertir AgentState a NormalizedAgentEvent[] |
| **6. Pre-allocation** | `EventStore.reserveSequenceNumbers()` | Reservar sequence numbers atómicamente |
| **7. Tool Lifecycle** | `ToolLifecycleManager.ts` | Coordinar tool_request + tool_response |
| **8. Persistencia** | `PersistenceCoordinator.ts` | EventStore + MessageQueue (Two-Phase) |

> **Nota**: El sistema usa ejecución **síncrona** (`graph.invoke()`), no streaming. Los eventos se emiten después de que el grafo complete.

---

## 3. Módulos y Responsabilidades

### 3.1 ChatMessageHandler (Capa WebSocket)

**Ubicación**: `backend/src/services/websocket/ChatMessageHandler.ts`

**Responsabilidad Única**: Punto de entrada WebSocket. Validación y delegación.

**Pseudocódigo**:
```
handle(data, socket, io):
    // 1. Validar autenticación
    authenticatedUserId = socket.userId  // Del middleware de sesión
    IF !authenticatedUserId:
        emit('agent:error', 'Not authenticated')
        RETURN

    // 2. Validar que userId del cliente coincide (anti-impersonation)
    IF clientUserId AND clientUserId != authenticatedUserId:
        emit('agent:error', 'User mismatch')
        RETURN

    // 3. Validar ownership de sesión (multi-tenant)
    validateSessionOwnership(sessionId, userId)

    // 4. Delegar a AgentOrchestrator
    orchestrator.executeAgentSync(
        message,
        sessionId,
        (event) => this.handleAgentEvent(event, io, sessionId, userId),
        userId,
        { enableThinking, thinkingBudget }
    )

handleAgentEvent(event, io, sessionId, userId):
    // Emitir evento al frontend
    io.to(sessionId).emit('agent:event', event)

    // Log según tipo de evento
    SWITCH event.type:
        CASE 'message':
            IF persistenceState != 'persisted':
                LOG ERROR "Message not persisted"
        CASE 'tool_use', 'tool_result':
            IF persistenceState == 'transient':
                LOG "Transient tool event"
        // ... otros casos
```

**Dependencias**:
- `getAgentOrchestrator()` - Singleton del orquestador
- `validateSessionOwnership()` - Validación multi-tenant
- `getMessageService()` - Para fallback de tool persistence

---

### 3.9 Arquitectura RAG y Procesamiento de Archivos

**Ubicación**: `backend/src/services/files/` y `backend/src/services/search/semantic/`

**Concepto**: Sistema de RAG Multimodal con "Dual-Vector Architecture".

#### 3.9.1 Processors y Estrategias de Extracción

El sistema soporta múltiples tipos de archivo mediante procesadores especializados (`DocumentProcessor`):

| Tipo Archivo | Procesador | Estrategia de Extracción | Embeddings |
|--------------|------------|--------------------------|------------|
| **PDF** | `PdfProcessor` | Azure Document Intelligence (Prebuilt-Read). Extrae texto y estructura (OCR). | Texto (1536d) |
| **DOCX** | `DocxProcessor` | Mammoth. Extrae raw text. | Texto (1536d) |
| **Excel** | `ExcelProcessor` | XLSX. Convierte cada hoja a formato CSV. | Texto (1536d) |
| **TXT/CSV** | `TextProcessor` | Decodificación UTF-8 directa. | Texto (1536d) |
| **Imágenes** | `ImageProcessor` | **No extrae texto**. Genera embedding visual semántico usando Azure Computer Vision. | Imagen (1024d) |

#### 3.9.2 Dual-Vector Architecture

Para soportar búsquedas que encuentren tanto documentos de texto relevante como imágenes visualmente similares, se utilizan dos espacios vectoriales distintos en paralelo:

1.  **Espacio Semántico de Texto (1536 dimensiones)**:
    *   **Modelo**: OpenAI `text-embedding-3-small`.
    *   **Uso**: Todos los documentos de texto (PDF, DOCX, etc.) se fragmentan (Chunking) y se vectorizan aquí.
    *   **Búsqueda**: El query del usuario se vectoriza con el mismo modelo.

2.  **Espacio Semántico Visual (1024 dimensiones)**:
    *   **Modelo**: Azure Computer Vision (`vectorizeImage` / `vectorizeText`).
    *   **Uso**:
        *   **Indexación**: Las imágenes se vectorizan visualmente usando `vectorizeImage`.
        *   **Búsqueda**: El query del usuario (texto) se proyecta al espacio visual usando `vectorizeText`.
    *   **Resultado**: Permite encontrar imágenes (ej. "atardecer") que coincidan semánticamente con el texto, aunque la imagen no tenga metadata.

#### 3.9.3 Flujo de Búsqueda Unificada (`SemanticSearchService`)

La búsqueda RAG combina ambos mundos:

```typescript
searchRelevantFiles(query):
    // 1. Generación Paralela de Embeddings del Query
    [textVec, imageQueryVec] = Promise.all([
        OpenAI.embed(query), // 1536d
        AzureVision.embedText(query) // 1024d
    ])

    // 2. Ejecución Paralela de Búsquedas (Azure AI Search)
    [textResults, imageResults] = Promise.all([
        searchIndex.search(textVec, fields: ['contentVector']),
        searchIndex.search(imageQueryVec, fields: ['imageVector'])
    ])

    // 3. Fusión de Resultados
    results = [...textResults, ...imageResults]

    // 4. Ordenamiento (Naive)
    // ADVERTENCIA: Los scores de OpenAI y Azure Vision no son directamente comparables.
    // Esto puede causar que un tipo de resultado domine sobre el otro.
    results.sort((a, b) => b.score - a.score)

    RETURN results
```

---

### 3.2 AgentOrchestrator (Capa de Orquestación)

**Ubicación**: `backend/src/domains/agent/orchestration/AgentOrchestrator.ts`

**Responsabilidad Única**: Coordinación central de la ejecución del agente.

**Pseudocódigo**:
```
executeAgentSync(prompt, sessionId, onEvent, userId, options):
    // ========================================
    // 1. CREAR CONTEXTO DE EJECUCIÓN
    // ========================================
    ctx = createExecutionContextSync(sessionId, userId, onEvent, options)
    ctx.toolLifecycleManager = createToolLifecycleManager()

    // ========================================
    // 2. PREPARAR CONTEXTO DE ARCHIVOS
    // ========================================
    contextResult = fileContextPreparer.prepare(userId, prompt, {
        attachments: options.attachments,
        enableAutoSemanticSearch: options.enableAutoSemanticSearch
    })
    enhancedPrompt = contextResult.contextText + prompt

    // ========================================
    // 3. CONSTRUIR INPUTS DEL GRAFO
    // ========================================
    inputs = {
        messages: [HumanMessage(enhancedPrompt)],
        activeAgent: 'orchestrator',
        context: { userId, sessionId, fileContext, options }
    }

    // ========================================
    // 4. EMITIR SESSION_START (transient)
    // ========================================
    emitEventSync(ctx, { type: 'session_start', ... })

    // ========================================
    // 5. PERSISTIR MENSAJE DEL USUARIO
    // ========================================
    userMessageResult = persistenceCoordinator.persistUserMessage(sessionId, prompt)
    emitEventSync(ctx, { type: 'user_message_confirmed', sequenceNumber, ... })

    // ========================================
    // 6. EJECUTAR GRAFO (SÍNCRONO)
    // ========================================
    result = orchestratorGraph.invoke(inputs, {
        recursionLimit: 50,
        signal: AbortSignal.timeout(ctx.timeoutMs)
    })

    // ========================================
    // 7. NORMALIZAR RESULTADO (BATCH)
    // ========================================
    adapter = createAnthropicAdapter(sessionId)
    normalizedEvents = batchResultNormalizer.normalize(result, adapter, {
        includeComplete: true
    })
    // Resultado: NormalizedAgentEvent[] ordenados por originalIndex
    // Tipos: thinking, assistant_message, tool_request, tool_response, complete

    // ========================================
    // 8. PRE-ALLOCAR SEQUENCE NUMBERS
    // ========================================
    // Contar eventos que requieren persistencia
    persistedEventCount = normalizedEvents.filter(
        e => e.persistenceStrategy !== 'transient'
    ).length

    // Reservar secuencias atómicamente via Redis INCRBY
    startSeq = eventStore.reserveSequenceNumbers(sessionId, persistedEventCount)

    // Asignar secuencias pre-reservadas
    seqIndex = 0
    FOR event IN normalizedEvents:
        IF event.persistenceStrategy !== 'transient':
            event.preAllocatedSequenceNumber = startSeq + seqIndex
            seqIndex++

    // ========================================
    // 9. PROCESAR EVENTOS EN ORDEN
    // ========================================
    FOR event IN normalizedEvents:
        SWITCH event.type:
            CASE 'thinking':
                // Persist sync (sync_required)
                persistenceCoordinator.persistThinking(sessionId, event, event.preAllocatedSequenceNumber)
                emitEventSync(ctx, convertToAgentEvent(event))

            CASE 'assistant_message':
                // Persist sync (sync_required)
                persistenceCoordinator.persistAgentMessage(sessionId, event, event.preAllocatedSequenceNumber)
                emitEventSync(ctx, { type: 'message', ... })

            CASE 'tool_request':
                // Registrar en ToolLifecycleManager (NO persistir aún)
                ctx.toolLifecycleManager.onToolRequested(
                    sessionId,
                    event.toolUseId,
                    event.toolName,
                    event.args,
                    event.preAllocatedSequenceNumber  // Para tool_use_requested
                )
                emitEventSync(ctx, { type: 'tool_use', ... })

            CASE 'tool_response':
                // Completar ciclo en ToolLifecycleManager
                toolState = ctx.toolLifecycleManager.onToolCompleted(
                    sessionId,
                    event.toolUseId,
                    event.result,
                    event.success,
                    event.error,
                    event.preAllocatedSequenceNumber  // Para tool_use_completed
                )
                IF toolState:
                    // Persistir ambos eventos juntos (fire-and-forget)
                    persistenceCoordinator.persistToolEventsAsync(sessionId, [{
                        toolUseId: toolState.toolUseId,
                        toolName: toolState.toolName,
                        args: toolState.args,
                        result: toolState.result,
                        success: toolState.state === 'completed',
                        toolUseSeq: toolState.preAllocatedToolUseSeq,
                        toolResultSeq: toolState.preAllocatedToolResultSeq
                    }])
                emitEventSync(ctx, { type: 'tool_result', ... })

            CASE 'complete':
                emitEventSync(ctx, { type: 'complete', ... })

    // ========================================
    // 10. FINALIZAR TOOLS HUÉRFANOS
    // ========================================
    // Persiste tools que nunca recibieron response
    ctx.toolLifecycleManager.finalizeAndPersistOrphans(sessionId, persistenceCoordinator)

    RETURN {
        sessionId,
        response: extractedContent,
        messageId,
        tokenUsage: { input: ctx.totalInputTokens, output: ctx.totalOutputTokens },
        toolsUsed: toolExecutions.map(t => t.toolName),
        success: true
    }
```

**Dependencias**:
- `FileContextPreparer` - Preparación de contexto de archivos
- `PersistenceCoordinator` - Persistencia coordinada (Two-Phase)
- `BatchResultNormalizer` - Normalización de AgentState a eventos
- `ToolLifecycleManager` - Coordinación de ciclo de vida de tools
- `AnthropicAdapter` - Normalización específica de Anthropic
- `orchestratorGraph` - Grafo LangGraph
- `ExecutionContextSync` - Estado mutable por ejecución

---

### 3.3 ExecutionContextSync (Estado por Ejecución)

**Ubicación**: `backend/src/domains/agent/orchestration/ExecutionContextSync.ts`

**Responsabilidad Única**: Contener todo el estado mutable de una ejecución síncrona.

**Estructura**:
```typescript
interface ExecutionContextSync {
    // Identity (inmutables)
    executionId: string;      // UUID único para tracing
    sessionId: string;        // ID de sesión
    userId: string;           // ID de usuario (multi-tenant)

    // Event Emission (mutables)
    callback: EventEmitCallback;  // Función para emitir eventos
    eventIndex: number;           // Índice auto-incrementante

    // Tool Management (mutable)
    seenToolIds: Map<string, string>;           // toolUseId → timestamp
    toolLifecycleManager: ToolLifecycleManager; // Coordinación de tools (per-execution)

    // Citation Tracking (mutables)
    citedSources: CitedFile[];        // Citas acumuladas de resultados RAG
    lastAssistantMessageId: string | null;  // Para asociar citas con mensaje

    // Usage Tracking (mutables)
    totalInputTokens: number;
    totalOutputTokens: number;

    // Options (inmutables)
    enableThinking: boolean;
    thinkingBudget: number;
    timeoutMs: number;
}
```

**Memoria Eficiente**:
- Base overhead: ~250 bytes
- Identity fields: 3 UUIDs (~108 bytes)
- Mutable tracking: seenToolIds Map + token counters
- Nueva instancia creada por ejecución

**Funciones Helper**:
- `createExecutionContextSync()` - Factory
- `getNextEventIndex(ctx)` - Obtener y auto-incrementar índice
- `setUsageSync(ctx, usage)` - Actualizar tokens
- `isToolSeenSync(ctx, toolUseId)` - Verificar deduplicación
- `markToolSeenSync(ctx, toolUseId)` - Registrar tool como visto
- `getTotalTokensSync(ctx)` - Obtener total de tokens

---

### 3.4 Router (Capa de Routing)

**Ubicación**: `backend/src/modules/agents/orchestrator/router.ts`

**Responsabilidad Única**: Decidir qué agente procesa el mensaje.

**Pseudocódigo**:
```
routeIntent(state: AgentState) → Partial<AgentState>:
    input = lastMessage.content

    // 1. SLASH COMMANDS (máxima prioridad)
    IF input.startsWith('/bc'):
        RETURN { activeAgent: 'business-central' }
    IF input.startsWith('/search') OR input.startsWith('/rag'):
        RETURN { activeAgent: 'rag-knowledge' }

    // 2. KEYWORDS DETERMINÍSTICOS (BC)
    bcDomainWords = ['customer', 'invoice', 'vendor', 'inventory', ...]
    IF input.includes('business central') OR
       (input.includes('bc') AND hasDomainWord):
        RETURN { activeAgent: 'business-central' }

    // 3. ARCHIVOS ADJUNTOS → RAG
    IF hasAttachments OR hasFileContext:
        RETURN { activeAgent: 'rag-knowledge' }

    // 4. LLM ROUTER (casos ambiguos)
    model = ModelFactory.create(routerConfig).withStructuredOutput(schema)
    result = model.invoke([systemPrompt, lastMessage])
    RETURN { activeAgent: result.target_agent }
```

**Agentes Disponibles**:
| Agente | Descripción | Triggers |
|--------|-------------|----------|
| `business-central` | ERP Expert | `/bc`, keywords BC, "customer", "invoice" |
| `rag-knowledge` | Semantic Search | `/search`, archivos adjuntos, "files", "documents" |
| `orchestrator` | General/Clarification | Default, "hello", "help" |

---

### 3.5 LangGraph State (Estado del Grafo)

**Ubicación**: `backend/src/modules/agents/orchestrator/state.ts`

**Pseudocódigo**:
```typescript
AgentStateAnnotation = Annotation.Root({
    messages: Annotation<BaseMessage[]>({
        reducer: messagesStateReducer,  // Concatena mensajes
        default: () => []
    }),

    activeAgent: Annotation<string>({
        reducer: (x, y) => y ?? x ?? "orchestrator",
        default: () => "orchestrator"
    }),

    context: Annotation<{
        userId, sessionId, modelPreferences,
        options: { enableThinking, thinkingBudget, attachments },
        fileContext
    }>({
        reducer: (x, y) => ({ ...x, ...y }),
        default: () => ({})
    }),

    toolExecutions: Annotation<ToolExecution[]>({
        reducer: (existing, incoming) => [...existing, ...incoming],
        default: () => []
    })
});
```

**ToolExecution**:
```typescript
interface ToolExecution {
    toolUseId: string;    // ID único del tool call
    toolName: string;     // Nombre de la herramienta
    args: Record<string, unknown>;  // Argumentos
    result: string;       // Resultado
    success: boolean;     // Éxito/fallo
    error?: string;       // Mensaje de error si falló
}
```

---

### 3.6 Graph (Grafo LangGraph)

**Ubicación**: `backend/src/modules/agents/orchestrator/graph.ts`

**Pseudocódigo**:
```
orchestratorGraph = StateGraph(AgentStateAnnotation)
    .addNode("router", routeIntent)
    .addNode("orchestrator", orchestratorNode)
    .addNode("business-central", bcAgentNode)
    .addNode("rag-knowledge", ragAgentNode)

    .addEdge(START, "router")

    .addConditionalEdges("router",
        (state) => state.activeAgent,
        {
            "business-central": "business-central",
            "rag-knowledge": "rag-knowledge",
            "orchestrator": "orchestrator"
        }
    )

    .addEdge("business-central", END)
    .addEdge("rag-knowledge", END)
    .addEdge("orchestrator", END)

    .compile();
```

**Diagrama del Grafo**:
```
    START
      │
      ▼
  ┌───────┐
  │router │
  └───┬───┘
      │ (activeAgent)
      ├──────────────────┬──────────────────┐
      ▼                  ▼                  ▼
┌─────────────┐  ┌──────────────┐  ┌────────────┐
│business-    │  │rag-knowledge │  │orchestrator│
│central      │  │              │  │            │
└──────┬──────┘  └──────┬───────┘  └─────┬──────┘
       │                │                │
       ▼                ▼                ▼
      END              END              END
```

---

### 3.7 BC Agent (Business Central)

**Ubicación**: `backend/src/modules/agents/business-central/bc-agent.ts`

**Responsabilidad**: Agente especializado en Microsoft Business Central.

**Pseudocódigo**:
```
invoke(state, config) → Partial<AgentState>:
    // 1. Configurar modelo con thinking
    enableThinking = state.context?.options?.enableThinking
    model = ModelFactory.create({ ...bcConfig, enableThinking })

    // 2. Bind 7 meta-tools
    tools = [
        listAllEntitiesTool,
        searchEntityOperationsTool,
        getEntityDetailsTool,
        getEntityRelationshipsTool,
        validateWorkflowStructureTool,
        buildKnowledgeBaseWorkflowTool,
        getEndpointDocumentationTool
    ]
    modelWithTools = model.bindTools(tools)

    // 3. ReAct Loop
    MAX_ITERATIONS = 10
    FOR iteration = 1 TO MAX_ITERATIONS:
        response = modelWithTools.invoke(currentMessages)
        newMessages.push(response)

        toolCalls = response.tool_calls
        IF !toolCalls OR toolCalls.length == 0:
            BREAK  // No más tools, terminar

        FOR toolCall IN toolCalls:
            tool = toolsMap.get(toolCall.name)
            result = tool.invoke(toolCall.args)

            // Trackear para emisión de eventos
            toolExecutions.push({
                toolUseId: toolCall.id,
                toolName: toolCall.name,
                args: toolCall.args,
                result,
                success: true
            })

            // Agregar ToolMessage para el siguiente turn
            newMessages.push(ToolMessage({ content: result, tool_call_id }))

    RETURN { messages: newMessages, toolExecutions }
```

**7 Meta-Tools**:
| Tool | Descripción |
|------|-------------|
| `list_all_entities` | Lista todas las entidades BC |
| `search_entity_operations` | Busca operaciones por keyword |
| `get_entity_details` | Detalles de una entidad específica |
| `get_entity_relationships` | Relaciones entre entidades |
| `validate_workflow_structure` | Valida workflows multi-paso |
| `build_knowledge_base_workflow` | Construye documentación de workflow |
| `get_endpoint_documentation` | Documentación de API |

---

### 3.8 BatchResultNormalizer (Normalización Batch)

**Ubicación**: `backend/src/shared/providers/normalizers/BatchResultNormalizer.ts`

**Responsabilidad Única**: Convertir AgentState de LangGraph a NormalizedAgentEvent[].

**Características**:
- Procesa TODOS los AI messages (soporte para ReAct loops multi-turn)
- Interleaves tool_request con tool_response (usa state.toolExecutions)
- Mantiene orden via `originalIndex`
- Soporta extended thinking

**Pseudocódigo**:
```
normalize(state: AgentState, adapter: IProviderAdapter, options) → NormalizedAgentEvent[]:
    events = []
    messageIndex = 0

    // 1. PROCESAR TODOS LOS AI MESSAGES
    FOR message IN state.messages:
        IF message.type !== 'ai':
            CONTINUE

        // Usar adapter para normalizar cada mensaje
        messageEvents = adapter.normalizeMessage(message, messageIndex)
        events.push(...messageEvents)
        messageIndex++

    // 2. CREAR TOOL_RESPONSE EVENTS
    toolResponses = []
    FOR exec IN state.toolExecutions:
        toolResponses.push({
            type: 'tool_response',
            toolUseId: exec.toolUseId,
            result: exec.result,
            success: exec.success,
            error: exec.error,
            originalIndex: findOriginalIndex(exec.toolUseId, events)
        })

    // 3. INTERLEAVE RESPONSES CON REQUESTS
    // Inserta tool_response inmediatamente después de su tool_request
    FOR response IN toolResponses:
        requestIndex = events.findIndex(e =>
            e.type === 'tool_request' && e.toolUseId === response.toolUseId
        )
        IF requestIndex >= 0:
            events.splice(requestIndex + 1, 0, response)

    // 4. ORDENAR POR originalIndex
    events.sort((a, b) => a.originalIndex - b.originalIndex)

    // 5. AGREGAR COMPLETE EVENT (opcional)
    IF options.includeComplete:
        events.push({
            type: 'complete',
            stopReason: extractStopReason(state),
            usage: extractUsage(state),
            persistenceStrategy: 'transient'
        })

    // 6. ASIGNAR PERSISTENCE STRATEGIES
    FOR event IN events:
        event.persistenceStrategy = determinePersistenceStrategy(event.type)

    RETURN events

determinePersistenceStrategy(type):
    IF type IN ['thinking', 'assistant_message']:
        RETURN 'sync_required'
    IF type IN ['tool_request', 'tool_response']:
        RETURN 'async_allowed'
    RETURN 'transient'  // session_start, complete
```

**Tipos de Eventos Normalizados**:
```typescript
type NormalizedAgentEvent =
    | NormalizedThinkingEvent       // thinking content
    | NormalizedAssistantMessageEvent  // text content
    | NormalizedToolRequestEvent    // tool_use block
    | NormalizedToolResponseEvent   // tool result
    | NormalizedCompleteEvent;      // stream/session end

interface NormalizedAgentEvent {
    type: string;
    eventId: string;
    sessionId: string;
    timestamp: string;
    originalIndex: number;
    persistenceStrategy: 'sync_required' | 'async_allowed' | 'transient';
    provider: 'anthropic';
    preAllocatedSequenceNumber?: number;  // Asignado en paso 8
}
```

**Ejemplo de Procesamiento**:
```
Input: AgentState con 2 AI messages, 3 tool executions
  Message 1: [thinking, text, tool_use_1, tool_use_2]
  Message 2: [tool_use_3, text]
  ToolExecutions: [result_1, result_2, result_3]

Output (ordenado):
  1. thinking (from msg 1, originalIndex=0)
  2. text (from msg 1, originalIndex=1)
  3. tool_request (tool_use_1, originalIndex=2)
  4. tool_response (result_1, insertado)
  5. tool_request (tool_use_2, originalIndex=3)
  6. tool_response (result_2, insertado)
  7. tool_request (tool_use_3, from msg 2, originalIndex=4)
  8. tool_response (result_3, insertado)
  9. text (from msg 2, originalIndex=5)
  10. complete (transient)
```

---

### 3.9 ToolLifecycleManager (Ciclo de Vida de Tools)

**Ubicación**: `backend/src/domains/agent/tools/ToolLifecycleManager.ts`

**Responsabilidad Única**: Coordinar tool_request + tool_response para persistencia unificada.

**Problema que Resuelve**:
- Antes: 5+ eventos por tool (request, múltiples results, status updates)
- Ahora: 2 eventos por tool (tool_use_requested + tool_use_completed)

**Scope**: Per-execution (creado fresco para cada ejecución)

**Pseudocódigo**:
```
// Creado fresco para cada ejecución
createToolLifecycleManager() → ToolLifecycleManager

class ToolLifecycleManager {
    private pendingTools: Map<string, ToolState> = new Map()
    private stats: ToolLifecycleStats = { pending: 0, completed: 0, failed: 0, orphaned: 0 }

    onToolRequested(sessionId, toolUseId, toolName, args, preAllocatedSeq?):
        // NO persiste - solo almacena en memoria
        state = {
            toolUseId,
            sessionId,
            toolName,
            args,
            state: 'requested',
            requestedAt: new Date(),
            preAllocatedToolUseSeq: preAllocatedSeq
        }
        this.pendingTools.set(toolUseId, state)
        this.stats.pending++

    onToolCompleted(sessionId, toolUseId, result, success, error?, preAllocatedSeq?) → ToolState | null:
        state = this.pendingTools.get(toolUseId)

        IF !state:
            LOG WARN "Orphan tool response: no matching request"
            RETURN null  // Orphan response

        // Completar el estado
        state.result = result
        state.success = success
        state.error = error
        state.completedAt = new Date()
        state.state = success ? 'completed' : 'failed'
        state.preAllocatedToolResultSeq = preAllocatedSeq

        this.pendingTools.delete(toolUseId)
        this.stats.pending--
        IF success:
            this.stats.completed++
        ELSE:
            this.stats.failed++

        RETURN state  // Caller persiste ambos eventos juntos

    finalizeAndPersistOrphans(sessionId, persistenceCoordinator):
        // Llamado al final de la ejecución
        FOR [toolUseId, state] IN this.pendingTools:
            // Persiste como tool_incomplete
            state.state = 'incomplete'
            persistenceCoordinator.persistToolEventsAsync(sessionId, [{
                ...state,
                result: '[Tool execution incomplete]',
                success: false
            }])
            this.stats.orphaned++

        this.pendingTools.clear()

    getStats() → ToolLifecycleStats:
        RETURN this.stats
}
```

**ToolState**:
```typescript
interface ToolState {
    toolUseId: string;
    sessionId: string;
    toolName: string;
    state: 'requested' | 'completed' | 'failed' | 'incomplete';
    args: Record<string, unknown>;
    result?: string;
    error?: string;
    requestedAt: Date;
    completedAt?: Date;
    preAllocatedToolUseSeq?: number;      // Para evento tool_use_requested
    preAllocatedToolResultSeq?: number;   // Para evento tool_use_completed
}

interface ToolLifecycleStats {
    pending: number;    // Esperando response
    completed: number;  // Exitosos
    failed: number;     // Fallidos con error
    orphaned: number;   // Persistidos como incomplete
}
```

**Beneficios**:
1. **Reducción de eventos en DB**: De 5+ a 2 eventos por tool
2. **Audit trail completo**: Input + output juntos
3. **Manejo de orphans**: Tools sin response se persisten al final
4. **Pre-allocated sequences**: Garantiza orden determinístico

---

### 3.10 CitationExtractor (Extracción de Citas)

**Ubicación**: `backend/src/domains/agent/citations/CitationExtractor.ts`

**Responsabilidad Única**: Extraer `CitedFile[]` de resultados de herramientas RAG.

**Problema que Resuelve**:
- Las herramientas RAG (como `search_knowledge_base`) devuelven JSON estructurado con información de archivos.
- El frontend necesita `CitedFile[]` para renderizar el `SourceCarousel`.
- La extracción debe ser robusta y manejar errores gracefully.

**Herramientas que Producen Citas**:
```typescript
const CITATION_PRODUCING_TOOLS = ['search_knowledge_base'] as const;
```

**Pseudocódigo**:
```
class CitationExtractor {
    producesCitations(toolName: string): boolean
        RETURN toolName IN CITATION_PRODUCING_TOOLS

    extract(toolName: string, resultJson: string): CitedFile[]
        IF !producesCitations(toolName):
            RETURN []

        IF !resultJson OR typeof resultJson !== 'string':
            RETURN []

        TRY:
            // Validar con schema Zod
            parseResult = parseStructuredSearchResult(resultJson)

            IF !parseResult.success:
                LOG WARN "Schema mismatch"
                RETURN []

            sources = parseResult.data.sources
            IF !sources OR sources.length == 0:
                RETURN []

            // Mapear a CitedFile[]
            RETURN sources.map(source => ({
                fileName: source.fileName,
                fileId: source.fileId,
                sourceType: source.sourceType,
                mimeType: source.mimeType,
                relevanceScore: source.relevanceScore,
                isImage: source.isImage,
                fetchStrategy: getFetchStrategy(source.sourceType)
            }))
        CATCH:
            RETURN []  // Graceful degradation
}
```

**Flujo de Integración en AgentOrchestrator**:
```
1. tool_response event procesado
2. CitationExtractor.producesCitations(toolName)? → extract()
3. Citas añadidas a ctx.citedSources
4. Al emitir CompleteEvent:
   - Incluir citedFiles: ctx.citedSources
   - Incluir messageId: ctx.lastAssistantMessageId
5. PersistenceCoordinator.persistCitationsAsync() (fire-and-forget)
```

**CitedFile Interface** (desde `@bc-agent/shared`):
```typescript
interface CitedFile {
    fileName: string;           // Nombre del archivo
    fileId: string | null;      // ID para lookup (null si tombstone)
    sourceType: SourceType;     // 'blob_storage' | 'sharepoint' | etc.
    mimeType: string;           // Para renderizado de iconos
    relevanceScore: number;     // Score de búsqueda (0-1)
    isImage: boolean;           // Para renderizado especial
    fetchStrategy: FetchStrategy; // 'internal_api' | 'oauth_proxy' | 'external'
}
```

---

### 3.11 PersistenceCoordinator (Persistencia)

**Ubicación**: `backend/src/domains/agent/persistence/PersistenceCoordinator.ts`

**Responsabilidad Única**: Coordinar EventStore + MessageQueue (Two-Phase Persistence).

**Patrón Two-Phase**:
```
┌──────────────────┐         ┌──────────────────┐
│  Phase 1 (Sync)  │────────>│ Phase 2 (Async)  │
│    EventStore    │         │   MessageQueue   │
│   Redis INCR     │         │     BullMQ       │
│    ~10ms         │         │    ~600ms        │
└──────────────────┘         └──────────────────┘
         │                            │
         ▼                            ▼
   sequence_number              SQL DB Write
   (atomic ordering)          (deferred, reliable)
```

**Pseudocódigo**:
```
persistUserMessage(sessionId, content) → UserMessagePersistedEvent:
    messageId = uuid()

    // Phase 1: EventStore (obtiene sequence_number atómico)
    dbEvent = eventStore.appendEvent(sessionId, 'user_message_sent', {
        message_id: messageId,
        content,
        timestamp
    })

    // CRÍTICO: Validar sequence_number
    IF dbEvent.sequence_number == null:
        THROW Error("Event without sequence_number")

    // Phase 2: MessageQueue (async DB write)
    messageQueue.addMessagePersistence({
        sessionId, messageId, role: 'user',
        content, sequenceNumber, eventId
    })

    RETURN { eventId, sequenceNumber, timestamp, messageId }

persistAgentMessage(sessionId, data) → PersistedEvent:
    // Similar: EventStore → MessageQueue
    dbEvent = eventStore.appendEvent(sessionId, 'agent_message_sent', {...})
    jobId = messageQueue.addMessagePersistence({...})
    RETURN { eventId, sequenceNumber, timestamp, jobId }

persistToolEventsAsync(sessionId, executions):
    // Fire-and-forget (no bloquea)
    FOR exec IN executions:
        eventStore.appendEvent(sessionId, 'tool_use_requested', {...})
        eventStore.appendEvent(sessionId, 'tool_use_completed', {...})
        messageQueue.addMessagePersistence({...})

awaitPersistence(jobId, timeoutMs):
    job = messageQueue.getJob(jobId)
    job.waitUntilFinished(queueEvents, timeoutMs)

persistCitationsAsync(sessionId, messageId, citations):
    // Fire-and-forget (no bloquea)
    IF citations.length == 0:
        RETURN

    // Deduplicar por fileName
    uniqueCitations = deduplicate(citations, by: 'fileName')

    // Append evento de auditoría
    eventStore.appendEvent(sessionId, 'citations_created', {
        message_id: messageId,
        citation_count: uniqueCitations.length,
        file_names: uniqueCitations.map(c => c.fileName)
    })

    // Encolar persistencia a DB
    messageQueue.addCitationPersistence({
        sessionId,
        messageId,
        citations: uniqueCitations
    })
```

---

### 3.11 CitationService (Recuperación de Citas)

**Ubicación**: `backend/src/services/citations/CitationService.ts`

**Responsabilidad Única**: Recuperar citas persistidas de la tabla `message_citations`.

**Pseudocódigo**:
```
getCitationsForMessages(messageIds: string[]) → Map<messageId, CitedFile[]>:
    IF messageIds.length == 0:
        RETURN new Map()

    // Query batch para eficiencia
    result = executeQuery(`
        SELECT message_id, file_id, file_name, source_type,
               mime_type, relevance_score, is_image
        FROM message_citations
        WHERE message_id IN (@messageIds)
        ORDER BY message_id, relevance_score DESC
    `, { messageIds })

    // Agrupar por message_id
    citationMap = new Map()
    FOR row IN result.recordset:
        citations = citationMap.get(row.message_id) ?? []
        citations.push({
            fileName: row.file_name,
            fileId: row.file_id,
            sourceType: row.source_type,
            mimeType: row.mime_type,
            relevanceScore: row.relevance_score,
            isImage: row.is_image,
            fetchStrategy: getFetchStrategy(row.source_type)
        })
        citationMap.set(row.message_id, citations)

    RETURN citationMap
```

**Flujo de Datos (Citations)**:
```
PERSISTENCIA (durante streaming):
┌────────────────────────────────────────────────────────────────┐
│ 1. RAG Tool → CitationExtractor → ctx.citedSources[]          │
│ 2. CompleteEvent emitido con citedFiles + messageId           │
│ 3. PersistenceCoordinator.persistCitationsAsync()             │
│ 4. MessageQueue → INSERT INTO message_citations               │
└────────────────────────────────────────────────────────────────┘

RECUPERACIÓN (al cargar página):
┌────────────────────────────────────────────────────────────────┐
│ 1. GET /api/chat/sessions/:id/messages                        │
│ 2. CitationService.getCitationsForMessages()                  │
│ 3. Messages devueltos con citations[] field                   │
│ 4. Frontend: citationStore.hydrateFromMessages()              │
│ 5. SourceCarousel renderiza correctamente                     │
└────────────────────────────────────────────────────────────────┘
```

---

### 3.12 EventStore (Event Sourcing)

**Ubicación**: `backend/src/services/events/EventStore.ts`

**Responsabilidad Única**: Log inmutable de eventos con sequence_number atómico.

**Pseudocódigo**:
```
appendEvent(sessionId, eventType, data) → BaseEvent:
    eventId = uuid()
    timestamp = now()

    // Obtener sequence_number atómico vía Redis
    TRY:
        sequenceNumber = redis.incr(`event:sequence:${sessionId}`)
        redis.expire(key, 7_DAYS)
    CATCH:
        sequenceNumber = fallbackToDatabase(sessionId)  // MAX + 1

    // Insertar en SQL
    executeQuery(`
        INSERT INTO message_events (id, session_id, event_type,
                                    sequence_number, timestamp, data)
        VALUES (...)
    `)

    RETURN { id: eventId, session_id, event_type, sequence_number, timestamp, data }

getNextSequenceNumber(sessionId):
    redis = getRedis()
    IF redis:
        RETURN redis.incr(`event:sequence:${sessionId}`)
    ELSE:
        RETURN fallbackToDatabase(sessionId)  // SELECT MAX(seq) + 1
```

**Tipos de Eventos**:
```typescript
type EventType =
    | 'user_message_sent'
    | 'agent_message_sent'
    | 'agent_thinking_block'
    | 'tool_use_requested'
    | 'tool_use_completed'
    | 'citations_created'    // NEW: Citation persistence audit event
    | 'error_occurred'
    | ...
```

---

### 3.11 FileContextPreparer (Contexto de Archivos)

**Ubicación**: `backend/src/domains/agent/context/FileContextPreparer.ts`

**Responsabilidad Única**: Preparar contexto de archivos para inyección en prompts.

**Pseudocódigo**:
```
prepare(userId, prompt, options) → FileContextPreparationResult:
    attachmentIds = options.attachments ?? []
    enableSemanticSearch = options.enableAutoSemanticSearch ?? false

    // 1. Validar archivos adjuntos explícitos
    attachedFiles = validateAttachments(userId, attachmentIds)

    // 2. Búsqueda semántica (si habilitada)
    searchResults = []
    IF enableSemanticSearch:
        searchResults = searchHandler.search(userId, prompt, {...})

    // 3. Combinar y deduplicar
    allFiles = combineFiles(attachedFiles, searchResults)

    IF allFiles.length == 0:
        RETURN { contextText: '', filesIncluded: [], ... }

    // 4. Recuperar contenido
    retrievalResult = contextRetrieval.retrieveMultiple(userId, parsedFiles)

    // 5. Construir XML de contexto
    contextText = promptBuilder.buildDocumentContext(retrievalResult.contents)

    RETURN { contextText, filesIncluded, semanticSearchUsed, totalFilesProcessed }
```

---

### 3.13 AnthropicAdapter (Normalización de Proveedor)

**Ubicación**: `backend/src/shared/providers/adapters/AnthropicAdapter.ts`

**Responsabilidad Única**: Normalizar estructuras de mensaje de Anthropic a eventos normalizados.

**Interfaz**:
```typescript
interface IProviderAdapter {
    readonly provider: 'anthropic' | 'azure-openai' | 'openai' | 'google';
    readonly sessionId: string;

    normalizeMessage(message: BaseMessage, messageIndex: number): NormalizedAgentEvent[];
    detectBlockType(block: unknown): ContentBlockType | null;
    normalizeStopReason(stopReason?: string): NormalizedStopReason;
    extractUsage(message: BaseMessage): NormalizedTokenUsage | null;
    extractMessageId(message: BaseMessage): string;
}
```

**Pseudocódigo**:
```
normalizeMessage(message: BaseMessage, messageIndex: number) → NormalizedAgentEvent[]:
    events = []

    // 1. EXTRAER THINKING BLOCKS (primero)
    FOR block IN message.content:
        IF isThinkingBlock(block):
            events.push({
                type: 'thinking',
                content: block.thinking,
                originalIndex: events.length,
                persistenceStrategy: 'sync_required'
            })

    // 2. EXTRAER TEXTO (acumular en un solo evento)
    text = ''
    FOR block IN message.content:
        IF isTextBlock(block):
            text += block.text

    IF text:
        events.push({
            type: 'assistant_message',
            content: text,
            originalIndex: events.length,
            persistenceStrategy: 'sync_required'
        })

    // 3. EXTRAER TOOL_USE BLOCKS (último)
    FOR block IN message.content:
        IF isToolUseBlock(block):
            events.push({
                type: 'tool_request',
                toolUseId: block.id,
                toolName: block.name,
                args: block.input,
                originalIndex: events.length,
                persistenceStrategy: 'async_allowed'
            })

    RETURN events  // Orden: thinking → text → tools

// Type Guards
isThinkingBlock(block):
    RETURN block.type === 'thinking' && 'thinking' IN block

isTextBlock(block):
    RETURN block.type IN ['text', 'text_delta'] && 'text' IN block

isToolUseBlock(block):
    RETURN block.type === 'tool_use' && 'id' IN block && 'name' IN block

// Stop Reason Normalization
normalizeStopReason(stopReason) → NormalizedStopReason:
    mapping = {
        'end_turn': 'end_turn',
        'max_tokens': 'max_tokens',
        'tool_use': 'tool_use',
        'stop_sequence': 'end_turn'
    }
    RETURN mapping[stopReason] ?? 'end_turn'

// Token Usage Extraction
extractUsage(message) → NormalizedTokenUsage | null:
    // Primary: response_metadata.usage
    IF message.response_metadata?.usage:
        RETURN {
            inputTokens: usage.input_tokens,
            outputTokens: usage.output_tokens
        }

    // Fallback: usage_metadata (LangChain 0.3+)
    IF message.usage_metadata:
        RETURN {
            inputTokens: usage_metadata.input_tokens,
            outputTokens: usage_metadata.output_tokens
        }

    RETURN null

// Message ID Extraction
extractMessageId(message) → string:
    // Primary: message.id
    IF message.id:
        RETURN message.id

    // Fallback: response_metadata.id
    IF message.response_metadata?.id:
        RETURN message.response_metadata.id

    // Last resort: generate UUID (with warning)
    LOG WARN "No message ID found, generating UUID"
    RETURN uuid()
```

**Stop Reasons Normalizados**:
```typescript
type NormalizedStopReason =
    | 'end_turn'       // Respuesta completa
    | 'max_tokens'     // Límite de tokens alcanzado
    | 'tool_use'       // Requiere ejecución de herramienta
    | 'stop_sequence'  // Secuencia de parada encontrada
```

---

## 4. Tipos de Eventos (Contrato Frontend)

### 4.1 Eventos Válidos (Arquitectura Síncrona)

| Evento | Descripción | persistenceState |
|--------|-------------|------------------|
| `session_start` | Inicio de sesión | `transient` |
| `user_message_confirmed` | Mensaje usuario persistido | `persisted` |
| `thinking_complete` | Pensamiento extendido completo | `transient` |
| `tool_use` | Uso de herramienta | `transient` → async persist |
| `tool_result` | Resultado de herramienta | `transient` → async persist |
| `message` | Respuesta completa del agente | `persisted` |
| `complete` | Ejecución completada | `transient` |
| `error` | Error ocurrido | `transient` |
| `approval_requested` | Solicitud de aprobación | `persisted` |
| `approval_resolved` | Aprobación resuelta | `persisted` |
| `turn_paused` | Turno pausado (SDK 0.71+) | `persisted` |
| `content_refused` | Contenido rechazado | `persisted` |

### 4.2 Eventos ELIMINADOS (NO USAR)

> **IMPORTANTE**: La arquitectura actual es SÍNCRONA. Los siguientes tipos de eventos fueron eliminados:

- `thinking_chunk` → Usar `thinking_complete`
- `message_chunk` → Usar `message`
- `message_partial` → Usar `message`

---

## 5. Evaluación de Módulos

### 5.1 Responsabilidad Única (SRP)

| Módulo | Responsabilidad | Cumple SRP? | Notas |
|--------|-----------------|-------------|-------|
| `ChatMessageHandler` | Validación + Delegación | **SÍ** | Solo valida y delega |
| `AgentOrchestrator` | Coordinación central | **SÍ** | Orquesta sin implementar lógica |
| `ExecutionContextSync` | Estado por ejecución | **SÍ** | Solo contiene estado |
| `Router` | Routing de intents | **SÍ** | Solo decide agente |
| `BCAgent` | Ejecución BC | **SÍ** | Solo ejecuta BC tools |
| `PersistenceCoordinator` | Persistencia coordinada | **SÍ** | Solo coordina ES+MQ |
| `EventStore` | Event log | **SÍ** | Solo append-only log |
| `FileContextPreparer` | Preparación contexto | **SÍ** | Solo prepara archivos |
| `AnthropicAdapter` | Normalización Anthropic | **SÍ** | Solo normaliza eventos |
| `BatchResultNormalizer` | Batch normalization | **SÍ** | Convierte AgentState a eventos |
| `ToolLifecycleManager` | Tool coordination | **SÍ** | Gestiona ciclo de vida de tools |

### 5.2 Agnosticismo de Proveedor

| Módulo | Agnóstico? | Dependencias de Proveedor |
|--------|------------|---------------------------|
| `ChatMessageHandler` | **SÍ** | Ninguna |
| `AgentOrchestrator` | **PARCIAL** | Usa `createAnthropicAdapter()` (hardcoded) |
| `Router` | **SÍ** | Usa ModelFactory (abstracción) |
| `BCAgent` | **SÍ** | Usa ModelFactory |
| `PersistenceCoordinator` | **SÍ** | Ninguna |
| `EventStore` | **SÍ** | Ninguna |
| `AnthropicAdapter` | **NO** | Específico para Anthropic |
| `BatchResultNormalizer` | **SÍ** | Usa IProviderAdapter interface |
| `ToolLifecycleManager` | **SÍ** | Ninguna |

### 5.3 Desacoplamiento

```
┌──────────────────────────────────────────────────────────────┐
│                      ALTA COHESIÓN                            │
│                                                              │
│   ChatMessageHandler ────────> AgentOrchestrator             │
│         │                           │                        │
│         │ (solo delega)             │ (solo coordina)        │
│         ▼                           ▼                        │
│   [Validación]              [FileContext, Persist, Graph]    │
│                                                              │
│                      BAJO ACOPLAMIENTO                        │
│                                                              │
│   - Comunicación vía interfaces                              │
│   - Dependency Injection en constructores                    │
│   - Singletons con getters                                   │
│   - ExecutionContext como estado transportable               │
└──────────────────────────────────────────────────────────────┘
```

---

## 6. Matriz de Responsabilidad de Fallos

### 6.1 Por Tipo de Fallo

| Fallo | Módulo Responsable | Capa | Diagnóstico |
|-------|-------------------|------|-------------|
| Socket no autenticado | `ChatMessageHandler` | WebSocket | `socket.userId undefined` |
| Sesión no encontrada | `ChatMessageHandler` | WebSocket | `validateSessionOwnership` |
| Usuario no es owner | `ChatMessageHandler` | WebSocket | Multi-tenant violation |
| Mensaje vacío | `ChatMessageHandler` | WebSocket | Input validation |
| Timeout de ejecución | `AgentOrchestrator` | Orquestación | `AbortSignal.timeout` |
| Error en graph.invoke | `AgentOrchestrator` | Orquestación | LangGraph error |
| Error en persistencia | `PersistenceCoordinator` | Persistencia | `PersistenceErrorAnalyzer` |
| sequence_number null | `EventStore` | Persistencia | Redis fallback failure |
| Tool execution error | `BCAgent` / `RAGAgent` | Agente | `toolExecutions.error` |
| Archivo no encontrado | `FileContextPreparer` | Contexto | `getFile` returns null |
| Búsqueda semántica falla | `FileContextPreparer` | Contexto | Graceful degradation |
| Stop reason desconocido | `AnthropicAdapter` | Normalización | Log warn, default 'end_turn' |
| Normalización falla | `BatchResultNormalizer` | Normalización | Event extraction error |
| Tool huérfano | `ToolLifecycleManager` | Tools | Tool sin response al final |
| Pre-allocation falla | `EventStore.reserveSequenceNumbers` | Persistencia | Redis INCRBY error |
| File processing falla | `FileProcessingService` | Files | Processor exception |
| Chunking falla | `FileChunkingService` | Files | Strategy exception |
| Embedding falla | `EmbeddingService` | Files | Azure OpenAI error |
| Vector indexing falla | `VectorSearchService` | Files | AI Search error |

### 6.2 Flujo de Errores

```
┌─────────────────────────────────────────────────────────────┐
│                    ERROR HANDLING FLOW                       │
│                                                             │
│   1. Catch en AgentOrchestrator.executeAgentSync            │
│      │                                                      │
│      ▼                                                      │
│   2. Log estructurado con errorInfo                         │
│      │                                                      │
│      ▼                                                      │
│   3. Emit evento 'error' al frontend                        │
│      │                                                      │
│      ▼                                                      │
│   4. Re-throw para que ChatMessageHandler capture           │
│      │                                                      │
│      ▼                                                      │
│   5. ChatMessageHandler emite 'agent:event' { type: 'error' }│
│                                                             │
│   NOTA: Los errores de persistencia se loguean pero         │
│   NO bloquean la respuesta al usuario (fire-and-forget)     │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. Decisiones de Diseño Clave

### 7.1 Arquitectura Síncrona vs Streaming

El sistema usa **`graph.invoke()`** (síncrono) en lugar de **`streamEvents()`** (streaming).

**Razones**:
1. Simplifica la lógica de ordenamiento de eventos
2. Garantiza que todos los datos están disponibles antes de emitir
3. Evita complejidad de acumuladores y buffers
4. Facilita la persistencia en orden correcto

**Trade-off**: Mayor latencia percibida (sin streaming progresivo).

### 7.2 Two-Phase Persistence

**Fase 1 (EventStore/Redis)**: Obtiene `sequence_number` atómico (~10ms)
**Fase 2 (MessageQueue/BullMQ)**: Escribe a SQL de forma asíncrona (~600ms)

**Beneficios**:
- Ordenamiento garantizado por `sequence_number`
- No bloquea la respuesta al usuario
- Recuperación de fallos vía MessageQueue

### 7.3 ExecutionContext Pattern

Todo estado mutable vive en `ExecutionContextSync`, no en singletons.

**Beneficios**:
- Multi-tenant safe (no data leaks entre usuarios)
- Horizontally scalable (sin sticky sessions)
- Thread-safe (no race conditions)

### 7.4 Fire-and-Forget para Tools

`persistToolEventsAsync()` es fire-and-forget:
- No bloquea la respuesta
- Errores se loguean pero no fallan
- Tools ya fueron ejecutados, solo persistimos para auditoría

### 7.5 Pre-Allocated Sequence Numbers

**Problema**: Persistencia async podía crear race conditions en sequence_number cuando múltiples eventos se procesan concurrentemente.

**Solución**:
1. Contar todos los eventos que requieren persistencia
2. Reservar secuencias atómicamente: `Redis INCRBY event:sequence:{sessionId} count`
3. Asignar secuencias pre-reservadas a cada evento
4. Usar `appendEventWithSequence()` para garantizar orden

**Beneficios**:
- Elimina race conditions en ordenamiento
- Orden determinístico garantizado
- Sin gaps en sequence_number

### 7.6 Batch Normalization

**Problema**: Extraer eventos de AgentState era frágil y dependía del orden de iteración.

**Solución**: `BatchResultNormalizer` con pipeline de 6 pasos:
1. Procesar todos los AI messages
2. Crear tool_response events
3. Interleave responses con requests
4. Ordenar por originalIndex
5. Agregar evento complete
6. Asignar persistence strategies

**Beneficios**:
- Soporta ReAct loops multi-turn
- Garantiza orden correcto de tool_request → tool_response
- Provider-agnostic via `IProviderAdapter`

### 7.7 Unified Tool Persistence

**Problema**: Antes se persistían 5+ eventos por tool (request, múltiples results, status updates).

**Solución**: `ToolLifecycleManager`:
- tool_request almacenado en memoria (no persistido)
- Al llegar tool_response, combina ambos
- Persiste 2 eventos: `tool_use_requested` + `tool_use_completed`
- Tools huérfanos (sin response) se persisten al final como `tool_incomplete`

**Beneficios**:
- Reducción de 5+ a 2 eventos por tool
- Audit trail completo (input + output juntos)
- Manejo explícito de tools incompletos

---

## 8. Apéndice: Tipos Clave

### A. AgentEvent (Contrato WebSocket)

```typescript
type AgentEvent =
    | SessionStartEvent
    | UserMessageConfirmedEvent
    | ThinkingCompleteEvent
    | ToolUseEvent
    | ToolResultEvent
    | MessageEvent
    | CompleteEvent
    | ErrorEvent
    | ApprovalRequestedEvent
    | ApprovalResolvedEvent
    | TurnPausedEvent
    | ContentRefusedEvent;
```

### B. NormalizedAgentEvent (Normalización Interna)

```typescript
// Tipo union para todos los eventos normalizados
type NormalizedAgentEvent =
    | NormalizedThinkingEvent
    | NormalizedAssistantMessageEvent
    | NormalizedToolRequestEvent
    | NormalizedToolResponseEvent
    | NormalizedCompleteEvent;

// Base común para todos los eventos
interface NormalizedEventBase {
    type: string;
    eventId: string;
    sessionId: string;
    timestamp: string;
    originalIndex: number;
    persistenceStrategy: 'sync_required' | 'async_allowed' | 'transient';
    provider: 'anthropic';
    preAllocatedSequenceNumber?: number;
}

// Evento de thinking (extended reasoning)
interface NormalizedThinkingEvent extends NormalizedEventBase {
    type: 'thinking';
    content: string;
    tokenUsage?: { thinkingTokens: number };
}

// Evento de mensaje del asistente
interface NormalizedAssistantMessageEvent extends NormalizedEventBase {
    type: 'assistant_message';
    content: string;
    stopReason?: NormalizedStopReason;
    tokenUsage?: { inputTokens: number; outputTokens: number };
}

// Evento de tool request
interface NormalizedToolRequestEvent extends NormalizedEventBase {
    type: 'tool_request';
    toolUseId: string;
    toolName: string;
    args: Record<string, unknown>;
}

// Evento de tool response
interface NormalizedToolResponseEvent extends NormalizedEventBase {
    type: 'tool_response';
    toolUseId: string;
    result: string;
    success: boolean;
    error?: string;
}
```

### C. ToolExecution (Estado del Grafo)

```typescript
interface ToolExecution {
    toolUseId: string;
    toolName: string;
    args: Record<string, unknown>;
    result: string;
    success: boolean;
    error?: string;
}
```

---

## 9. File Services (Flujo Completo)

Esta sección documenta el pipeline completo de procesamiento de archivos, desde upload hasta contexto para agentes.

### 9.1 Arquitectura General

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         FILE PROCESSING PIPELINE                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   UPLOAD → PROCESS → CHUNK → EMBED → INDEX → SEARCH → CONTEXT               │
│                                                                              │
│   FileUpload   FileProcessing  FileChunking  Embedding  VectorSearch  FileContext
│   Service      Service         Service       Service    Service       Preparer
│                                                                              │
│   (services/) (services/)     (services/)   (services/) (services/)  (domains/)
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 9.2 File Upload Flow

**Ubicación**: `backend/src/services/files/FileUploadService.ts`

**Endpoint**: `POST /api/files/upload`

**Pipeline**:
```
1. Multer Middleware
   ├── In-memory storage
   ├── Max 100MB por archivo
   ├── Max 20 archivos por request
   └── Fix mojibake en filenames (UTF-8)

2. FileUploadService.uploadFile()
   ├── Validación MIME whitelist (29 tipos)
   ├── Size limits: 100MB general, 30MB images
   ├── Blob path: users/{userId}/files/{timestamp}-{sanitized-filename}
   │   └── Sanitización: ASCII only (DB guarda nombre original Unicode)
   └── Smart upload strategy:
       ├── < 256MB: Single-put (1 API call)
       └── >= 256MB: Block-upload (4MB chunks, parallel)

3. FileService.createFile()
   ├── DB record con processing_status='pending'
   ├── embedding_status='pending'
   └── Multi-tenant: scoped by user_id

4. MessageQueue.addFileProcessingJob()
   └── Fire-and-forget → Background worker
```

**MIME Types Soportados**:
| Categoría | Tipos |
|-----------|-------|
| Documents | PDF, DOCX, XLSX, PPTX, TXT, MD |
| Images | JPEG, PNG, GIF, WebP, BMP, TIFF |
| Code | JS, TS, PY, JSON, XML, YAML, HTML, CSS |
| Data | CSV |

### 9.3 File Processing

**Ubicación**: `backend/src/services/files/FileProcessingService.ts`

**Triggered by**: BullMQ background worker

**Processor Registry**:
| MIME Type | Processor | Backend |
|-----------|-----------|---------|
| `application/pdf` | PdfProcessor | Azure Document Intelligence (prebuilt-read) |
| `application/vnd.openxmlformats...docx` | DocxProcessor | mammoth.js |
| `application/vnd.openxmlformats...xlsx` | ExcelProcessor | xlsx → markdown tables |
| `text/*`, `application/json` | TextProcessor | UTF-8 decode |
| `image/*` | ImageProcessor | Azure Computer Vision |

**Pipeline**:
```
1. Download blob from Azure Storage (emit 20% progress)
2. Select processor by MIME type
3. Extract text → DB.extracted_text (emit 70% progress)
4. Update processing_status='completed'
5. Enqueue FileChunkingJob (fire-and-forget)
6. Emit WebSocket progress events
```

**WebSocket Events**:
- `file:processing_progress` - 0-100%
- `file:processing_completed` - with stats
- `file:processing_failed` - error details

### 9.4 Image Processing (Especial)

**Ubicación**: `backend/src/services/files/processors/ImageProcessor.ts`

**Diferencia con texto**: Las imágenes NO tienen texto extraíble.

**Pipeline**:
```
1. Detectar formato (JPEG, PNG, GIF, WebP) via magic bytes
2. Verificar Azure Vision configurado
3. Generar embedding vía Azure Computer Vision
   └── Endpoint: /computervision/retrieval:vectorizeImage
   └── Returns: 1024-dimensional vector
4. Retornar metadata:
   ├── embeddingGenerated: true
   ├── imageFormat: "jpeg"
   └── embeddingDimensions: 1024
```

**Limitación Actual**: Las imágenes solo tienen embeddings visuales.
- NO hay OCR para texto visible en imágenes
- NO hay captions/descripciones automáticas
- Ver D2 en 99-FUTURE-DEVELOPMENT.md para roadmap de mejoras

### 9.5 File Chunking

**Ubicación**: `backend/src/services/files/FileChunkingService.ts`

**Triggered by**: FileProcessingService enqueues `addFileChunkingJob()`

**Estrategias** (via ChunkingStrategyFactory):
| Tipo de archivo | Estrategia | Descripción |
|-----------------|------------|-------------|
| PDF, DOCX, Código | `RecursiveChunkingStrategy` | Jerárquico, respeta estructura |
| Markdown, Plain text | `SemanticChunkingStrategy` | Sentence-aware |
| CSV | `RowBasedChunkingStrategy` | Preserva filas completas |

**Parámetros Default**:
- `maxTokens: 512` - Óptimo para embeddings
- `overlapTokens: 50` - Continuidad de contexto

**Pipeline**:
```
1. Get file con extracted_text de DB
2. Validar processing_status='completed'
3. Select chunking strategy
4. Split en chunks de 512 tokens
5. Insert chunks en file_chunks table:
   ├── id, file_id, user_id (multi-tenant)
   ├── chunk_index, chunk_text, chunk_tokens
   └── metadata (JSON)
6. Update embedding_status='queued'
7. Enqueue EmbeddingGenerationJob
```

**Caso Especial - Imágenes**:
- Skip chunking (images no tienen chunks)
- Set embedding_status='completed' (ImageProcessor ya generó embedding)
- Return 0 chunks

### 9.6 Embedding Generation

**Ubicación**: `backend/src/services/embeddings/EmbeddingService.ts`

**Text Embeddings**:
```
- Model: Azure OpenAI text-embedding-3-small (configurable)
- Dimensions: 1536
- Redis cache: 7-day TTL
- Batch optimization: Check cache first, generate only missing
```

**Image Embeddings**:
```
- Model: Azure Computer Vision
- Dimensions: 1024
- Generated during ImageProcessor (not in this service)
```

**Pipeline**:
```
1. generateTextEmbeddingsBatch(texts)
2. Check Redis cache (mget)
3. Generate missing via Azure OpenAI
4. Cache results (7-day TTL)
5. Track usage for billing
6. Return embeddings array
```

### 9.7 Vector Search

**Ubicación**: `backend/src/services/search/VectorSearchService.ts`

**Index**: Azure AI Search

**Operaciones**:
```typescript
// Indexar chunks (Texto)
indexChunksBatch(chunks: ChunkWithEmbedding[]): Promise<void>

// Indexar embeddings de imágenes (Nuevo)
indexImageEmbedding(params: ImageIndexParams): Promise<string>

// Buscar por similaridad (Multimodal)
search(query: string, userId: string, options?: SearchOptions): Promise<SearchResult[]>
searchImages(query: ImageSearchQuery): Promise<ImageSearchResult[]>

// GDPR deletion
deleteChunksForUser(userId: string): Promise<void>
deleteChunksForFile(fileId: string): Promise<void>
```

**Seguridad Multi-Tenant**:
- Todos los queries incluyen: `userId eq '{userId}'`
- Previene acceso cross-user
- Filtros adicionales opcionales (fileId, etc.)

### 9.8 Semantic Search

**Ubicación**: `backend/src/services/search/semantic/SemanticSearchService.ts`

**High-Level Search (File Granularity)**:
```
1. Generar embedding del query
2. Vector search en todos los chunks
3. Agrupar chunks por fileId
4. Get top N chunks per file (default 5)
5. Get file names de FileService
6. Retornar top M files (default 3) ordenados por relevancia
```

**Resultado**:
```typescript
interface SemanticSearchResult {
    fileId: string;
    fileName: string;
    relevanceScore: number;  // Max score de top chunks
    topChunks: Array<{
        chunkId: string;
        content: string;
        score: number;
        chunkIndex: number;
    }>;
}
```

### 9.9 Context Retrieval

**Ubicación**: `backend/src/services/files/context/ContextRetrievalService.ts`

**3 Estrategias de Recuperación**:

| Estrategia | Descripción | Uso |
|------------|-------------|-----|
| `DIRECT_CONTENT` | Descarga completa del blob | Imágenes, archivos < 30MB |
| `EXTRACTED_TEXT` | Texto pre-extraído de DB | Documentos procesados |
| `RAG_CHUNKS` | Top-k chunks via vector search | Archivos grandes con embeddings |

**Strategy Selection** (ContextStrategyFactory):
```
Rule 1: Images → DIRECT_CONTENT (Claude Vision)
Rule 2: Large (≥30MB) + embeddings → RAG_CHUNKS
Rule 3: Has extracted_text → EXTRACTED_TEXT
Rule 4: Small (<30MB) + native type → DIRECT_CONTENT
Rule 5: Fallback → DIRECT_CONTENT
```

**Token Estimation**:
- Text: ~4 characters per token
- Chunks: sum of chunk text estimates
- Base64 images: 0 (separate budget in Claude)

### 9.10 FileContextPreparer (Integración con Agent)

**Ubicación**: `backend/src/domains/agent/context/FileContextPreparer.ts`

**Flujo Completo**:
```
1. VALIDAR ATTACHMENTS EXPLÍCITOS
   ├── User adjunta fileIds explícitamente
   ├── Validar ownership (user_id = userId)
   └── Throws error si no encontrado

2. SEMANTIC SEARCH AUTOMÁTICA (opcional)
   ├── Si enableAutoSemanticSearch=true
   ├── Graceful degradation on error
   ├── Excluir archivos ya adjuntos
   └── Retornar top N files (default 3)

3. DEDUPLICACIÓN
   ├── Combinar attached + searched files
   ├── Attachments tienen prioridad
   └── Track source ('attachment' vs 'semantic_search')

4. RECUPERAR CONTENIDO
   └── ContextRetrievalService.retrieveMultiple()

5. CONSTRUIR XML CONTEXT
   └── <documents>
         <document source="attachment" file="report.pdf">
           ...content...
         </document>
       </documents>

6. INYECTAR EN PROMPT
   └── {contextText}\n\n{userPrompt}
```

**Resultado**:
```typescript
interface FileContextPreparationResult {
    contextText: string;         // <documents>...</documents>
    filesIncluded: FileReference[];
    semanticSearchUsed: boolean;
    totalFilesProcessed: number;
    executionTimeMs: number;
}
```

### 9.11 Image Search Service

**Ubicación**: `backend/src/services/search/ImageSearchService.ts`

**Responsabilidad**: Búsqueda semántica de imágenes (Texto -> Imagen).

**Funcionalidad**:
1. Recibe query de texto.
2. Genera embedding de texto usando `Azure Vision VectorizeText` (mismo espacio vectorial que imágenes).
3. Busca en Azure AI Search usando `searchImages` (filtro `isImage eq true`).
4. Enriquece resultados con metadatos del archivo.

**Repositorio de Apoyo**: `ImageEmbeddingRepository.ts`
- Gestiona la tabla `image_embeddings`.
- Almacena metadatos del embedding (modelo, dimensiones) para gestión de versiones.
- Soporta operaciones CRUD y upsert para evitar duplicados.

### 9.12 Gaps Actuales (D2 en Future Development)

| Gap | Descripción | Impacto |
|-----|-------------|---------|
| **No OCR en imágenes** | Texto visible no extraído | No busca "50x30cm" en fotos |
| **No captions** | Sin descripciones automáticas | No busca "caja metálica" |
| **Índice único** | textVector + imageVector mezclados | No fusion search |

**Roadmap de Mejoras** (ver `99-FUTURE-DEVELOPMENT.md` D2):
1. Fase 1: Image OCR via Azure Computer Vision Read API
2. Fase 2: Image Captions via Description API
3. Fase 3: Dual-Index Architecture (text 1536d + image 1024d)
4. Fase 4: Fusion Search (OCR + caption + visual)

---

## 10. Database Migrations (Citation System)

### 10.1 Applied Migrations

| Migration | Purpose |
|-----------|---------|
| `008-add-citations-event-type.sql` | Added `citations_created` to `CK_message_events_valid_type` CHECK constraint |
| `009-fix-citation-message-id-type.sql` | Changed `message_citations.message_id` from `uniqueidentifier` to `nvarchar(255)` |

### 10.2 Type Inference Fix

**File**: `backend/src/infrastructure/database/database.ts`

Added `messageId` (camelCase) to `PARAMETER_TYPE_MAP`:

```typescript
const PARAMETER_TYPE_MAP = {
  // ... existing entries ...
  'messageId': sql.NVarChar(255),  // Anthropic message IDs (msg_01...)
};
```

**Reason**: Anthropic message IDs (e.g., `msg_01BRsWtSA9yhWYRX6SGB3BvC`) are NOT UUIDs. The `inferSqlType` function was detecting `messageId` as a UUID parameter (because it ends with `Id`) and failing validation.

---

## 11. Conclusiones

### Fortalezas del Diseño Actual

1. **Clara separación de responsabilidades** - Cada módulo hace una cosa
2. **Arquitectura multi-tenant segura** - `userId` validado en cada capa
3. **Persistencia robusta** - Two-phase con atomicidad en sequence_number
4. **Normalización batch** - BatchResultNormalizer garantiza orden de eventos
5. **Tool lifecycle unificado** - ToolLifecycleManager reduce eventos de 5+ a 2 por tool
6. **Pre-allocated sequences** - Elimina race conditions en ordenamiento
7. **Stateless components** - ExecutionContextSync pattern para scalability
8. **File pipeline completo** - Upload → Process → Chunk → Embed → Search → Context
9. **Citation tracking** - CitationExtractor para asociar citas RAG con mensajes
10. **Ejecución síncrona** - `graph.invoke()` simplifica el flujo de eventos

### Áreas de Mejora Identificadas

1. **Fallback de Redis no atómico** - Race condition en secuencias (D1 en Future Development)
2. **Hardcoded 'anthropic'** en AgentOrchestrator - Debería ser configurable via factory
3. **No hay retry automático** para persistencia fallida
4. **Image search limitado** - No OCR, no captions (D2 en Future Development)
5. **Timeout fijo** (5 min) - Podría ser configurable por request
6. **Placeholder directories vacíos** - domains/business-central, chat, files, search

---

*Documento actualizado: 2026-01-13 v2.2 (CitationExtractor, ExecutionContextSync updates, pre-allocation)*
