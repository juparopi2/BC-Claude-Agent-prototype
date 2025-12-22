# Estado Actual del Proyecto

**Fecha**: 2025-12-22
**Estado**: En Progreso - Fase A Completada ✅

---

## Resumen de Trabajo Completado

| Fase | Descripción | Estado |
|------|-------------|--------|
| Phase 1 | Autenticación OAuth2, Event Sourcing | ✅ |
| Phase 1A | Token Usage Tracking | ✅ |
| Phase 1F | Extended Thinking | ✅ |
| Phase 2 | Semantic Search, File Attachments | ✅ |
| Phase 3 | LangGraph Orchestrator, Multi-agent | ✅ |
| Phase 4 | E2E Testing Framework | ✅ |
| Phase 4.7 | Technical Debt Cleanup | ✅ |
| Phase 5 | Screaming Architecture (Bloques A, B) | ✅ |
| **Phase 5C** | **Refactor DirectAgentService** | ⏳ **Este plan** |

## Componentes Core Actuales

| Componente | LOC | Problema |
|------------|-----|----------|
| **DirectAgentService** | 1,471 | GOD OBJECT - 15 dependencias |
| **EventStore** | 697 | Race condition en fallback DB |
| **MessageService** | 600 | Acoplado a EventStore |
| **ChatMessageHandler** | 717 | Mezcla validación + ejecución |

## Flujo Actual de Datos

```
WebSocket: chat:message
    ↓
ChatMessageHandler.handle()
├─ Valida socket + sesión
├─ MessageService.saveUserMessage() → EventStore → Redis INCR
├─ Emite 'user_message_confirmed'
    ↓
DirectAgentService.runGraph() [1,100 LOC en un método]
├─ Prepara contexto archivos (líneas 160-413)
├─ orchestratorGraph.streamEvents() (líneas 501-1136)
│     ├─ on_chat_model_stream → emit chunks
│     ├─ on_chain_end → persist tools
│     └─ on_chat_model_end → usage
├─ Persiste thinking + message final (líneas 1172-1330)
└─ Emite 'complete'
    ↓
MessageQueue (async) → INSERT INTO messages
```

## Problemas Identificados

### DirectAgentService (1,471 LOC)

**Responsabilidades mezcladas:**

1. **Preparación de contexto** (líneas 160-413)
   - Validación de archivos adjuntos
   - Búsqueda semántica automática
   - Construcción de contexto de archivos

2. **Streaming de eventos** (líneas 501-1136)
   - Procesamiento de 8 tipos de eventos de LangGraph
   - Acumulación de chunks (thinking + mensaje)
   - Deduplicación de tool_use_id
   - Emisión de eventos WebSocket

3. **Persistencia** (líneas 1172-1330)
   - Guardado de thinking
   - Guardado de mensaje final
   - Manejo de errores de persistencia

4. **Tracking de uso** (disperso)
   - Token usage tracking
   - Rate limiting
   - Métricas

**Dependencias:**
- EventStore
- MessageService
- MessageQueue
- ApprovalManager
- SemanticSearchService
- BCToolManager
- UsageTrackingService
- createOrchestratorGraph
- Logger (5 instancias)
- Y más...

### EventStore (697 LOC)

**Problema principal:**
```typescript
// Race condition en fallback a DB si Redis falla
const [prevSeq] = await Promise.all([
  this.getLatestSequenceFromDB(sessionId),
  this.saveToEventLog(...)  // Puede causar gaps
]);
```

**Solución propuesta:**
- Usar transacción SERIALIZABLE
- O usar MERGE statement en SQL Server

### MessageService (600 LOC)

**Acoplamiento:**
- Depende fuertemente de EventStore
- Mezcla lógica de negocio con persistencia
- Dificulta testing aislado

### ChatMessageHandler (717 LOC)

**Responsabilidades mezcladas:**
- Validación de WebSocket
- Validación de sesión/usuario
- Ejecución de agente
- Manejo de errores

---

## Archivos Críticos Actuales

| Archivo | LOC | Estado |
|---------|-----|--------|
| `backend/src/services/agent/DirectAgentService.ts` | 1,471 | A refactorizar |
| `backend/src/services/events/EventStore.ts` | 697 | Race condition pendiente |
| `backend/src/services/messages/MessageService.ts` | 600 | Estable |
| `backend/src/websocket/ChatMessageHandler.ts` | 717 | Estable |

## Tests Actuales

| Test File | Cobertura | Estado |
|-----------|-----------|--------|
| `DirectAgentService.persistence-errors.test.ts` | ~66% | A migrar a PersistenceErrorAnalyzer |
| `DirectAgentService.integration.test.ts` | ~60% | A actualizar a AgentOrchestrator |
| `DirectAgentService.attachments.integration.test.ts` | ~50% | A split a FileContextPreparer |

**Cobertura global actual:** ~10% (bajó después de Phase 3 por nuevo código sin tests)

---

## Progreso del Refactor (Fase A Completada)

### Nuevas Clases Implementadas

| Clase | Ubicación | Tests | LOC |
|-------|-----------|-------|-----|
| **PersistenceErrorAnalyzer** | `domains/agent/persistence/` | 27 ✅ | ~60 |
| **EventIndexTracker** | `domains/agent/emission/` | 13 ✅ | ~30 |
| **ThinkingAccumulator** | `domains/agent/streaming/` | 24 ✅ | ~60 |
| **ContentAccumulator** | `domains/agent/streaming/` | 21 ✅ | ~45 |
| **ToolEventDeduplicator** | `domains/agent/tools/` | 30 ✅ | ~50 |
| **AgentEventEmitter** | `domains/agent/emission/` | 32 ✅ | ~80 |
| **UsageTracker** | `domains/agent/usage/` | 35 ✅ | ~70 |

**Total:** 7 clases, 182 tests, ~395 LOC

### Estructura de Carpetas Creada

```
backend/src/domains/agent/
├── context/          # Para FileContextPreparer, SemanticSearchHandler
├── emission/         # EventIndexTracker, AgentEventEmitter ✅
├── orchestration/    # Para AgentOrchestrator
├── persistence/      # PersistenceErrorAnalyzer ✅
├── streaming/        # ThinkingAccumulator, ContentAccumulator ✅
├── tools/            # ToolEventDeduplicator ✅
└── usage/            # UsageTracker ✅
```

### Verificaciones Pasadas

- ✅ `npm run lint` - 0 errores (30 warnings preexistentes)
- ✅ `npm run type-check` - Sin errores de tipos
- ✅ `npm run build` - 345 archivos compilados
- ✅ `npm test` - 2,031 tests pasando

---

*Última actualización: 2025-12-22 13:30 UTC-5*
