# Arquitectura del Backend - Dominio Agent

**Fecha**: 2026-01-13
**Estado**: Implementado
**Versión**: 2.0 (Arquitectura Síncrona)

---

## Arquitectura:Síncrono
> Se implementó una **arquitectura síncrona** usando `graph.invoke()` por simplicidad y para garantizar ordenamiento determinístico de eventos.

---

## Estructura de Carpetas

```
backend/src/domains/agent/
├── orchestration/
│   ├── AgentOrchestrator.ts          # ~770 LOC - Coordinador principal (síncrono)
│   ├── ExecutionContextSync.ts       # ~325 LOC - Estado per-execution
│   ├── FakeAgentOrchestrator.ts      # Testing mock
│   ├── types.ts                      # Tipos de orquestación
│   └── index.ts
├── context/
│   ├── FileContextPreparer.ts        # ~200 LOC - Contexto de archivos
│   ├── SemanticSearchHandler.ts      # ~100 LOC - Búsqueda automática
│   ├── types.ts
│   └── index.ts
├── citations/
│   ├── CitationExtractor.ts          # ~150 LOC - Extracción de citas RAG
│   ├── types.ts
│   └── index.ts
├── tools/
│   ├── ToolLifecycleManager.ts       # ~280 LOC - Ciclo de vida tools
│   ├── ToolEventDeduplicator.ts      # ~50 LOC - Deduplicación
│   ├── normalizeToolArgs.ts          # ~30 LOC - Normalización de args
│   ├── types.ts
│   └── index.ts
├── persistence/
│   ├── PersistenceCoordinator.ts     # ~650 LOC - EventStore + Queue
│   ├── PersistenceErrorAnalyzer.ts   # ~100 LOC - Categorización errores
│   ├── types.ts
│   └── index.ts
├── emission/
│   ├── EventIndexTracker.ts          # ~50 LOC - Contador de índices
│   ├── types.ts
│   └── index.ts
└── usage/
    ├── UsageTracker.ts               # ~100 LOC - Tracking de tokens
    ├── types.ts
    └── index.ts

backend/src/jobs/
├── index.ts                          # Job exports
└── OrphanCleanupJob.ts               # ~200 LOC - AI Search orphan cleanup
```

---

## Las 12 Clases Implementadas

| # | Clase | LOC | Responsabilidad |
|---|-------|-----|-----------------|
| 1 | **AgentOrchestrator** | ~770 | Coordinador principal, ejecución síncrona |
| 2 | **ExecutionContextSync** | ~325 | Estado mutable per-execution |
| 3 | **FileContextPreparer** | ~200 | Preparación de contexto de archivos |
| 4 | **SemanticSearchHandler** | ~100 | Búsqueda semántica automática |
| 5 | **CitationExtractor** | ~150 | Extracción de citas de RAG tools |
| 6 | **ToolLifecycleManager** | ~280 | Ciclo de vida tool_request → tool_response |
| 7 | **ToolEventDeduplicator** | ~50 | Prevención de duplicados |
| 8 | **PersistenceCoordinator** | ~650 | Two-phase persistence (EventStore + BullMQ) |
| 9 | **PersistenceErrorAnalyzer** | ~100 | Categorización de errores |
| 10 | **EventIndexTracker** | ~50 | Contador monotónico de eventIndex |
| 11 | **UsageTracker** | ~100 | Tracking de tokens |
| 12 | **OrphanCleanupJob** | ~200 | Limpieza de documentos huérfanos en AI Search |

**Total**: ~3,005 LOC en dominio agent + jobs

**Componentes adicionales en shared/providers**:
- **BatchResultNormalizer** (~327 LOC) - Normalización de AgentState a eventos
- **AnthropicAdapter** (~200 LOC) - Normalización específica de Anthropic

---

## Descripción de Clases Implementadas

### 1. AgentOrchestrator (~770 LOC)

**Responsabilidad:**
- Entry point para ejecución de agentes
- Usa `graph.invoke()` (síncrono, NO streaming)
- Coordina normalización, pre-allocation de sequences, y persistencia

**Dependencias:**
- FileContextPreparer
- PersistenceCoordinator
- BatchResultNormalizer
- AnthropicAdapter
- EventStore
- CitationExtractor

**Flujo de Ejecución**:
```typescript
async executeAgentSync(prompt, sessionId, onEvent, userId, options) {
  // 1. Crear ExecutionContextSync
  const ctx = createExecutionContextSync(sessionId, userId, onEvent, options);

  // 2. Preparar contexto de archivos
  const contextResult = await fileContextPreparer.prepare(userId, prompt, options);

  // 3. Emitir session_start
  emitEventSync(ctx, { type: 'session_start', ... });

  // 4. Persistir mensaje de usuario
  const userMsgResult = await persistenceCoordinator.persistUserMessage(...);
  emitEventSync(ctx, { type: 'user_message_confirmed', ... });

  // 5. Ejecutar grafo SINCRÓNICAMENTE
  const result = await orchestratorGraph.invoke(inputs);

  // 6. Normalizar resultado a eventos
  const normalizedEvents = normalizer.normalize(result, adapter);

  // 7. Pre-allocar sequence numbers (atómico via Redis INCRBY)
  const reservedSeqs = await eventStore.reserveSequenceNumbers(sessionId, count);

  // 8. Procesar eventos en orden
  for (const event of normalizedEvents) {
    await processNormalizedEvent(ctx, event);
  }

  // 9. Finalizar tools huérfanos
  await ctx.toolLifecycleManager.finalizeAndPersistOrphans(sessionId, ...);

  return result;
}
```

---

### 2. ExecutionContextSync (~325 LOC)

**Responsabilidad:**
- Contener TODO el estado mutable de una ejecución
- Habilitar componentes stateless
- Garantizar aislamiento multi-tenant

**Campos principales:**
```typescript
interface ExecutionContextSync {
  // Identity
  executionId: string;
  sessionId: string;
  userId: string;

  // Event Emission
  callback: EventEmitCallback;
  eventIndex: number;

  // Tool Management
  seenToolIds: Map<string, string>;
  toolLifecycleManager: ToolLifecycleManager;

  // Citation Tracking
  citedSources: CitedFile[];
  lastAssistantMessageId: string | null;

  // Usage
  totalInputTokens: number;
  totalOutputTokens: number;

  // Options
  enableThinking: boolean;
  thinkingBudget: number;
  timeoutMs: number;
}
```

---

### 3. FileContextPreparer (~200 LOC)

**Responsabilidad:**
- Validar archivos adjuntos
- Invocar búsqueda semántica automática
- Construir XML de contexto para prompts

**Dependencias:**
- SemanticSearchHandler
- ContextRetrievalService

---

### 4. SemanticSearchHandler (~100 LOC)

**Responsabilidad:**
- Ejecutar búsqueda semántica si `enableAutoSemanticSearch=true`
- Filtrar por threshold de relevancia
- Limitar número de archivos

---

### 5. CitationExtractor (~150 LOC)

**Responsabilidad:**
- Extraer `CitedFile[]` de resultados de herramientas RAG
- Parsear JSON estructurado con schema Zod
- Graceful degradation en caso de errores

**Herramientas soportadas:**
- `search_knowledge_base`

---

### 6. ToolLifecycleManager (~280 LOC)

**Responsabilidad:**
- Coordinar tool_request → tool_response
- Almacenar request en memoria hasta recibir response
- Persistir ambos eventos juntos con sequences pre-allocated

**Estados:**
```typescript
type ToolStateStatus = 'requested' | 'completed' | 'failed' | 'incomplete';
```

---

### 7. ToolEventDeduplicator (~50 LOC)

**Responsabilidad:**
- Mantener Set de tool_use_id ya procesados
- Prevenir emisión duplicada

---

### 8. PersistenceCoordinator (~650 LOC)

**Responsabilidad:**
- Two-phase persistence (EventStore → MessageQueue)
- Persistencia síncrona para thinking, assistant_message
- Persistencia asíncrona para tools (fire-and-forget)
- Persistencia de citas (fire-and-forget)

**Métodos principales:**
```typescript
persistUserMessage(sessionId, content): Promise<UserMessagePersistedEvent>
persistAgentMessage(sessionId, data, preAllocatedSeq?): Promise<PersistedEvent>
persistThinking(sessionId, data, preAllocatedSeq?): Promise<PersistedEvent>
persistToolEventsAsync(sessionId, executions): void  // Fire-and-forget
persistCitationsAsync(sessionId, messageId, citations): void  // Fire-and-forget
awaitPersistence(jobId, timeoutMs): Promise<void>
```

---

### 9. PersistenceErrorAnalyzer (~100 LOC)

**Responsabilidad:**
- Categorizar errores de persistencia
- Determinar recuperabilidad

**Categorías:**
- `redis_connection`
- `db_connection`
- `db_constraint`
- `serialization`
- `unknown`

---

### 10. EventIndexTracker (~50 LOC)

**Responsabilidad:**
- Contador monotónico de eventIndex
- Para ordenamiento local durante emisión

---

### 11. UsageTracker (~100 LOC)

**Responsabilidad:**
- Tracking de tokens por ejecución
- Integración con UsageTrackingService

---

## Componentes en shared/providers

### BatchResultNormalizer (~327 LOC)

**Ubicación:** `backend/src/shared/providers/normalizers/BatchResultNormalizer.ts`

**Responsabilidad:**
- Convertir `AgentState` de LangGraph a `NormalizedAgentEvent[]`
- Interleave tool_request con tool_response
- Ordenar eventos por `originalIndex`

### AnthropicAdapter (~200 LOC)

**Ubicación:** `backend/src/shared/providers/adapters/AnthropicAdapter.ts`

**Responsabilidad:**
- Normalizar mensajes de Anthropic a eventos estándar
- Extraer thinking blocks, tool_use blocks, text content
- Mapear stop reasons a formato normalizado

---

## Diagrama de Dependencias (Actual)

```
AgentOrchestrator
├── ExecutionContextSync (factory)
│   └── ToolLifecycleManager (per-execution)
├── FileContextPreparer
│   └── SemanticSearchHandler
├── BatchResultNormalizer
│   └── AnthropicAdapter
├── PersistenceCoordinator
│   └── PersistenceErrorAnalyzer
├── EventStore
└── CitationExtractor
```

**Niveles de dependencia:**
- Nivel 0 (sin deps): EventIndexTracker, ToolEventDeduplicator, PersistenceErrorAnalyzer
- Nivel 1: ToolLifecycleManager, SemanticSearchHandler, UsageTracker, CitationExtractor
- Nivel 2: ExecutionContextSync, FileContextPreparer, AnthropicAdapter
- Nivel 3: BatchResultNormalizer, PersistenceCoordinator
- Nivel 4: AgentOrchestrator

---

### 12. OrphanCleanupJob (~200 LOC)

**Ubicación**: `backend/src/jobs/OrphanCleanupJob.ts`

**Responsabilidad:**
- Detectar documentos huérfanos en Azure AI Search
- Comparar fileIds en AI Search vs SQL
- Eliminar documentos que no tienen correspondencia en SQL

**Métodos principales:**
```typescript
// Limpieza para un usuario específico
async cleanOrphansForUser(userId: string): Promise<CleanupResult>

// Limpieza completa para todos los usuarios
async runFullCleanup(): Promise<FullCleanupSummary>
```

**Dependencias:**
- VectorSearchService (getUniqueFileIds, deleteChunksForFile)
- FileService (getFileIdsByUser)

**Acceso:**
- Via endpoint: `POST /api/admin/jobs/orphan-cleanup`
- Via script: `npx tsx scripts/run-orphan-cleanup.ts`

---

*Última actualización: 2026-01-13 (v2.1 - OrphanCleanupJob)*
