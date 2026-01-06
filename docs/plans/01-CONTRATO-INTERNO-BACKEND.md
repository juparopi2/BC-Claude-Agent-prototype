# Contrato Interno del Backend - BC Agent

> **Fecha**: 2026-01-04
> **Versión**: 1.0
> **Propósito**: Documentar la arquitectura, módulos, responsabilidades y flujo de procesamiento de mensajes del backend.

---

## 1. Arquitectura General (Screaming Architecture)

El backend sigue una **Screaming Architecture** donde la estructura de carpetas comunica claramente qué hace el sistema.

### 1.1 Estructura de Directorios

```
backend/src/
├── domains/                    # Lógica de negocio pura (agnóstica de frameworks)
│   ├── agent/                  # Dominio principal del agente
│   │   ├── orchestration/      # Coordinación de ejecución
│   │   ├── streaming/          # Procesamiento de streams (legacy)
│   │   ├── persistence/        # Persistencia coordinada
│   │   ├── context/            # Preparación de contexto (archivos)
│   │   ├── emission/           # Emisión de eventos (tracking de índices)
│   │   ├── tools/              # Procesamiento de herramientas
│   │   └── usage/              # Tracking de uso de tokens
│   ├── approval/               # Flujo Human-in-the-Loop
│   ├── auth/                   # Autenticación y middleware
│   ├── billing/                # Billing y tracking de costos
│   ├── business-central/       # Integración con BC (auth, client, tools)
│   ├── chat/                   # Mensajes y sesiones
│   ├── files/                  # Procesamiento de archivos
│   └── search/                 # Búsqueda semántica
│
├── modules/                    # Implementaciones concretas de agentes (LangGraph)
│   └── agents/
│       ├── orchestrator/       # Grafo principal y routing
│       │   ├── graph.ts        # Definición del StateGraph
│       │   ├── router.ts       # Lógica de routing de intents
│       │   └── state.ts        # Estado compartido (AgentState)
│       ├── business-central/   # BC Agent y sus herramientas
│       │   ├── bc-agent.ts     # Implementación del agente
│       │   └── tools.ts        # 7 meta-tools de BC
│       ├── rag-knowledge/      # RAG Agent
│       └── core/               # Factory de agentes base
│
├── services/                   # Servicios de infraestructura
│   ├── websocket/              # ChatMessageHandler (punto de entrada)
│   ├── events/                 # EventStore (Event Sourcing)
│   ├── files/                  # FileService, ContextRetrieval
│   ├── messages/               # MessageService
│   ├── sessions/               # SessionService
│   └── search/                 # SemanticSearch
│
├── shared/                     # Código compartido
│   ├── providers/              # Adaptadores de proveedores LLM
│   │   ├── adapters/           # AnthropicStreamAdapter, Factory
│   │   └── interfaces/         # INormalizedStreamEvent, IStreamAdapter
│   ├── constants/              # Constantes globales
│   ├── middleware/             # Middleware HTTP
│   ├── types/                  # Tipos TypeScript
│   └── utils/                  # Utilidades (logger, SQL, UUID)
│
├── infrastructure/             # Infraestructura técnica
│   ├── config/                 # Configuración de modelos
│   ├── database/               # Conexión SQL Server
│   ├── redis/                  # Cliente Redis
│   ├── queue/                  # MessageQueue (BullMQ)
│   └── keyvault/               # Azure Key Vault
│
├── routes/                     # Rutas HTTP (REST)
├── schemas/                    # Schemas Zod
└── types/                      # Tipos globales
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
└────────┬────────────────────┼────────────────────┬──────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
┌────────────────┐   ┌────────────────┐   ┌────────────────────┐
│ domains/agent/ │   │ modules/agents │   │  domains/agent/    │
│   context/     │   │  orchestrator/ │   │   persistence/     │
│ FileContext    │   │   (graph.ts)   │   │ PersistenceCoord.  │
│  Preparer      │   │  LangGraph     │   │  EventStore+Queue  │
└────────────────┘   └───────┬────────┘   └────────────────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
     ┌────────────┐  ┌────────────┐  ┌────────────┐
     │  router.ts │  │ bc-agent   │  │ rag-agent  │
     │  (Routing) │  │   .ts      │  │   .ts      │
     └────────────┘  └────────────┘  └────────────┘
```

---

## 2. Flujo de Procesamiento de Mensajes

### 2.1 Diagrama de Secuencia Completo

```
┌─────────┐     ┌──────────────────┐     ┌─────────────────┐     ┌──────────────┐
│Frontend │     │ChatMessageHandler│     │AgentOrchestrator│     │orchestrator  │
│Socket.IO│     │(WebSocket Layer) │     │(Orchestration)  │     │Graph.invoke()│
└────┬────┘     └────────┬─────────┘     └───────┬─────────┘     └──────┬───────┘
     │                   │                       │                       │
     │ chat:message      │                       │                       │
     │──────────────────>│                       │                       │
     │                   │                       │                       │
     │                   │ 1. Validate Auth      │                       │
     │                   │    (userId from       │                       │
     │                   │     session)          │                       │
     │                   │                       │                       │
     │                   │ 2. Validate Session   │                       │
     │                   │    Ownership          │                       │
     │                   │                       │                       │
     │                   │ executeAgentSync()    │                       │
     │                   │──────────────────────>│                       │
     │                   │                       │                       │
     │                   │                       │ 3. Create             │
     │                   │                       │    ExecutionContextSync
     │                   │                       │                       │
     │                   │                       │ 4. Prepare File       │
     │                   │                       │    Context            │
     │                   │                       │    (FileContextPreparer)
     │                   │                       │                       │
     │ session_start     │                       │                       │
     │<──────────────────│<──────────────────────│                       │
     │                   │                       │                       │
     │                   │                       │ 5. Persist User Msg   │
     │                   │                       │    (PersistenceCoord) │
     │                   │                       │                       │
     │ user_message_     │                       │                       │
     │ confirmed         │                       │                       │
     │<──────────────────│<──────────────────────│                       │
     │                   │                       │                       │
     │                   │                       │ 6. graph.invoke()     │
     │                   │                       │──────────────────────>│
     │                   │                       │                       │
     │                   │                       │    [Router Node]      │
     │                   │                       │    [Agent Node]       │
     │                   │                       │    [ReAct Loop]       │
     │                   │                       │                       │
     │                   │                       │<──────────────────────│
     │                   │                       │ AgentState (final)    │
     │                   │                       │                       │
     │                   │                       │ 7. extractContent()   │
     │                   │                       │    (ResultExtractor)  │
     │                   │                       │                       │
     │ thinking_complete │                       │                       │
     │<──────────────────│<──────────────────────│ 8. Emit if thinking  │
     │                   │                       │                       │
     │ tool_use          │                       │                       │
     │<──────────────────│<──────────────────────│ 9. Emit tool events  │
     │ tool_result       │                       │    (+ persist async)  │
     │<──────────────────│<──────────────────────│                       │
     │                   │                       │                       │
     │                   │                       │ 10. Persist Agent Msg │
     │                   │                       │     (PersistenceCoord)│
     │                   │                       │                       │
     │ message           │                       │                       │
     │<──────────────────│<──────────────────────│ 11. Emit complete msg │
     │                   │                       │                       │
     │ complete          │                       │                       │
     │<──────────────────│<──────────────────────│ 12. Emit completion   │
     │                   │                       │                       │
```

### 2.2 El Stack de 6 Capas

El procesamiento de mensajes atraviesa 6 capas estrictas:

| Capa | Módulo | Responsabilidad |
|------|--------|-----------------|
| **1. WebSocket** | `ChatMessageHandler.ts` | Validación de auth, sesión, delegación |
| **2. Orquestación** | `AgentOrchestrator.ts` | Contexto, persistencia inicial, coordinación |
| **3. Routing** | `router.ts` | Decidir qué agente procesa (BC, RAG, Orchestrator) |
| **4. Ejecución** | `graph.ts` + Agentes | LangGraph StateGraph con nodos de agentes |
| **5. Extracción** | `ResultExtractor.ts` | Extraer thinking, content, tools del resultado |
| **6. Persistencia** | `PersistenceCoordinator.ts` | EventStore + MessageQueue (Two-Phase) |

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
    adapter = StreamAdapterFactory.create('anthropic', sessionId)

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
    // 4. EMITIR SESSION_START
    // ========================================
    emitEventSync(ctx, { type: 'session_start', ... })

    // ========================================
    // 5. PERSISTIR MENSAJE DEL USUARIO
    // ========================================
    userMessageResult = persistenceCoordinator.persistUserMessage(sessionId, prompt)
    emitEventSync(ctx, { type: 'user_message_confirmed', ... })

    // ========================================
    // 6. EJECUTAR GRAFO (SÍNCRONO)
    // ========================================
    result = orchestratorGraph.invoke(inputs, {
        recursionLimit: 50,
        signal: AbortSignal.timeout(ctx.timeoutMs)
    })

    // ========================================
    // 7. EXTRAER CONTENIDO
    // ========================================
    { thinking, content, toolExecutions, stopReason, usage } = extractContent(result)
    setUsageSync(ctx, usage)

    // ========================================
    // 8. EMITIR EVENTOS EN ORDEN ESTRICTO
    // ========================================

    // 8.1 Thinking (si existe)
    IF thinking:
        persistenceCoordinator.persistThinking(sessionId, {...})
        emitEventSync(ctx, { type: 'thinking_complete', content: thinking })

    // 8.2 Tools (pares tool_use + tool_result)
    FOR exec IN toolExecutions:
        IF markToolSeenSync(ctx, exec.toolUseId).isDuplicate:
            CONTINUE
        emitEventSync(ctx, { type: 'tool_use', ... })
        emitEventSync(ctx, { type: 'tool_result', ... })
        persistenceCoordinator.persistToolEventsAsync(...)  // Fire-and-forget

    // ========================================
    // 9. PERSISTIR MENSAJE DEL AGENTE
    // ========================================
    persistResult = persistenceCoordinator.persistAgentMessage(sessionId, {...})
    awaitPersistence(persistResult.jobId, 10000)  // Esperar BullMQ

    // 8.3 Mensaje final
    emitEventSync(ctx, { type: 'message', content, ... })

    // 8.4 Complete
    emitEventSync(ctx, { type: 'complete', ... })

    RETURN { sessionId, response: content, messageId, tokenUsage, toolsUsed, success: true }
```

**Dependencias**:
- `FileContextPreparer` - Preparación de contexto de archivos
- `PersistenceCoordinator` - Persistencia coordinada
- `orchestratorGraph` - Grafo LangGraph
- `StreamAdapterFactory` - Para normalización de stop_reason
- `ExecutionContextSync` - Estado mutable por ejecución

---

### 3.3 ExecutionContextSync (Estado por Ejecución)

**Ubicación**: `backend/src/domains/agent/orchestration/ExecutionContextSync.ts`

**Responsabilidad Única**: Contener todo el estado mutable de una ejecución.

**Estructura**:
```typescript
interface ExecutionContextSync {
    // Identity (inmutables)
    executionId: string;      // UUID único
    sessionId: string;        // ID de sesión
    userId: string;           // ID de usuario (multi-tenant)

    // Event Emission (mutables)
    callback: EventEmitCallback;  // Función para emitir eventos
    eventIndex: number;           // Índice auto-incrementante

    // Tool Deduplication (mutable)
    seenToolIds: Map<string, string>;  // toolUseId → timestamp

    // Usage Tracking (mutables)
    totalInputTokens: number;
    totalOutputTokens: number;

    // Options (inmutables)
    enableThinking: boolean;
    thinkingBudget: number;
    timeoutMs: number;
}
```

**Funciones Helper**:
- `createExecutionContextSync()` - Factory
- `markToolSeenSync(ctx, toolUseId)` - Marcar herramienta vista (deduplicación)
- `getNextEventIndex(ctx)` - Obtener y auto-incrementar índice
- `setUsageSync(ctx, usage)` - Actualizar tokens

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

### 3.8 ResultExtractor (Extracción de Contenido)

**Ubicación**: `backend/src/domains/agent/orchestration/ResultExtractor.ts`

**Responsabilidad Única**: Extraer contenido estructurado del resultado de LangGraph.

**Pseudocódigo**:
```
extractContent(state: AgentState) → ExtractedContent:
    messages = state.messages
    lastMessage = findLastAIMessage(messages)

    IF !lastMessage:
        RETURN { thinking: null, content: '', stopReason: 'end_turn', ... }

    // Buscar thinking en TODOS los mensajes AI (ReAct loop)
    thinking = findThinkingInAllMessages(messages)

    // Extraer texto del ÚLTIMO mensaje
    { text } = extractContentBlocks(lastMessage)

    // Extraer metadata
    stopReason = extractStopReason(lastMessage)  // response_metadata.stop_reason
    usage = extractUsage(lastMessage)            // usage_metadata

    RETURN {
        thinking,
        content: text,
        stopReason,
        toolExecutions: state.toolExecutions,
        usage
    }

extractContentBlocks(message):
    content = message.content

    IF typeof content == 'string':
        RETURN { thinking: '', text: content }

    IF Array.isArray(content):
        FOR block IN content:
            IF block.type == 'thinking':
                thinking += block.thinking
            ELSE IF block.type == 'text':
                text += block.text
        RETURN { thinking, text }
```

---

### 3.9 PersistenceCoordinator (Persistencia)

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
```

---

### 3.10 EventStore (Event Sourcing)

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

### 3.12 AnthropicStreamAdapter (Normalización)

**Ubicación**: `backend/src/shared/providers/adapters/AnthropicStreamAdapter.ts`

**Responsabilidad Única**: Normalizar eventos de Anthropic a formato canónico.

**Pseudocódigo**:
```
processChunk(event: StreamEvent) → INormalizedStreamEvent | null:
    IF event.event == 'on_chat_model_stream':
        RETURN handleStreamChunk(event)
    IF event.event == 'on_chat_model_end':
        RETURN handleStreamEnd(event)
    RETURN null

handleStreamChunk(event):
    chunk = event.data.chunk

    IF Array.isArray(chunk.content):
        FOR block IN chunk.content:
            IF block.type == 'thinking':
                RETURN createEvent('reasoning_delta', { reasoning: block.thinking })
            IF block.type == 'text':
                RETURN createEvent('content_delta', { content: block.text })
            IF block.type == 'tool_use':
                RETURN createEvent('tool_call', { toolCall: {...} })

    IF typeof chunk.content == 'string':
        RETURN createEvent('content_delta', { content: chunk.content })

normalizeStopReason(stopReason) → NormalizedStopReason:
    mapping = {
        'end_turn': 'success',
        'max_tokens': 'max_turns',
        'tool_use': 'success',
        'stop_sequence': 'success'
    }
    RETURN mapping[stopReason] ?? 'success'
```

**Tipos Normalizados**:
```typescript
type NormalizedEventType =
    | 'stream_start'
    | 'reasoning_delta'   // Thinking
    | 'content_delta'     // Texto visible
    | 'tool_call'         // Tool use
    | 'citation'          // RAG
    | 'usage'             // Tokens
    | 'stream_end';

type NormalizedStopReason = 'success' | 'error' | 'max_turns' | 'user_cancelled';
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
| `ResultExtractor` | Extracción de contenido | **SÍ** | Solo extrae del resultado |
| `PersistenceCoordinator` | Persistencia coordinada | **SÍ** | Solo coordina ES+MQ |
| `EventStore` | Event log | **SÍ** | Solo append-only log |
| `FileContextPreparer` | Preparación contexto | **SÍ** | Solo prepara archivos |
| `AnthropicStreamAdapter` | Normalización Anthropic | **SÍ** | Solo normaliza eventos |

### 5.2 Agnosticismo de Proveedor

| Módulo | Agnóstico? | Dependencias de Proveedor |
|--------|------------|---------------------------|
| `ChatMessageHandler` | **SÍ** | Ninguna |
| `AgentOrchestrator` | **PARCIAL** | Usa `StreamAdapterFactory('anthropic')` |
| `Router` | **SÍ** | Usa ModelFactory (abstracción) |
| `BCAgent` | **SÍ** | Usa ModelFactory |
| `PersistenceCoordinator` | **SÍ** | Ninguna |
| `EventStore` | **SÍ** | Ninguna |
| `AnthropicStreamAdapter` | **NO** | Específico para Anthropic |
| `StreamAdapterFactory` | **SÍ** | Factory pattern |

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
| Stop reason desconocido | `AnthropicStreamAdapter` | Normalización | Log warn, default 'success' |

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

### B. INormalizedStreamEvent (Interno)

```typescript
interface INormalizedStreamEvent {
    type: NormalizedEventType;
    provider: ProviderType;
    timestamp: Date;
    content?: string;
    reasoning?: string;
    toolCall?: NormalizedToolCall;
    usage?: NormalizedUsage;
    metadata: {
        blockIndex: number;
        messageId?: string;
        isStreaming: boolean;
        isFinal: boolean;
    };
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

## 9. Conclusiones

### Fortalezas del Diseño Actual

1. **Clara separación de responsabilidades** - Cada módulo hace una cosa
2. **Arquitectura multi-tenant segura** - `userId` validado en cada capa
3. **Persistencia robusta** - Two-phase con atomicidad en sequence_number
4. **Agnosticismo de proveedor** - StreamAdapterFactory permite cambiar LLM
5. **Stateless components** - ExecutionContext pattern para scalability

### Áreas de Mejora Potencial

1. **Fallback de Redis no atómico** - Race condition en secuencias
2. **Hardcoded 'anthropic'** en AgentOrchestrator - Debería ser configurable
3. **No hay retry automático** para persistencia fallida
4. **Timeout fijo** (5 min) - Podría ser configurable por request

---

*Documento generado automáticamente. Última actualización: 2026-01-04*
