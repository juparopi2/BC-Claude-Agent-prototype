# Deuda Técnica y Desarrollos Futuros

**Fecha**: 2026-01-13
**Estado**: Aprobado (Actualizado)

---

## Incluir en Este Refactor

### D1: Race Condition en EventStore DB Fallback

**Descripción:**
Actualmente el EventStore tiene una race condition cuando Redis falla y se usa DB como fallback:

```typescript
// EventStore.ts (línea ~450)
const [prevSeq] = await Promise.all([
  this.getLatestSequenceFromDB(sessionId),  // Read
  this.saveToEventLog(...)                  // Write
]);
// Gap puede ocurrir entre read y write
```

**Problema:**
Dos requests concurrentes pueden leer el mismo `prevSeq` y crear gaps en sequence numbers.

**Solución propuesta:**
```typescript
// Opción A: SERIALIZABLE transaction
await sql.transaction(async (tx) => {
  await tx.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
  const prevSeq = await getLatestSequenceFromDB(sessionId, tx);
  const newSeq = prevSeq + 1;
  await saveToEventLog({ sequenceNumber: newSeq }, tx);
});

// Opción B: MERGE statement (SQL Server)
MERGE INTO message_events WITH (HOLDLOCK) AS target
USING (SELECT @sessionId AS session_id) AS source
ON target.session_id = source.session_id
WHEN MATCHED THEN
  INSERT (sequence_number, ...) VALUES (target.max_seq + 1, ...)
```

**Fase:** Incluir en PersistenceCoordinator durante el refactor

**Prioridad:** Alta

**Estimación:** 1-2 días

---

### D26: Multimodal RAG with Reranker & Image Captioning - COMPLETADO

**Estado:** ✅ COMPLETADO (2026-01-13)

**Descripción Original:**
La arquitectura "Dual-Vector" (Text 1536d + Image 1024d) tenía problemas de relevancia porque los scores de similitud de OpenAI y Azure Vision no eran comparables directamente.

**Solución Implementada (Cross-Encoder Strategy):**

#### Fase 1: Image Captioning en Upload ✅
- Implementado `EmbeddingService.generateImageCaption()` que usa Azure AI Vision Analyze Image API
- Las imágenes ahora generan captions AI durante el procesamiento de upload
- Los captions se almacenan en `image_embeddings.caption` y `image_embeddings.caption_confidence`
- El caption se incluye en el campo `content` del índice Azure AI Search para mejor búsqueda semántica

#### Fase 2: Semantic Ranker Configuration ✅
- Actualizado `schema.ts` con configuración semántica (`semantic-config`)
- Campos priorizados para reranking: `content`, `chunkIndex`
- Script `update-search-semantic-config.sh` para actualizar índice existente

#### Fase 3: Reranking en Búsqueda ✅
- Implementado `VectorSearchService.semanticSearch()` que combina:
  - Vector search (texto 1536d + imagen 1024d)
  - Azure AI Search Semantic Ranker para reranking unificado
- Score normalization: rerankerScore (0-4) → normalized score (0-1)
- `SemanticSearchService.searchRelevantFiles()` ahora usa `semanticSearch()` para búsqueda unificada

#### Fase 4: Testing ✅
- **Unit Tests (21 nuevos tests):**
  - `EmbeddingService.generateImageCaption` (6 tests)
  - `VectorSearchService.semanticSearch` (11 tests)
  - `ImageEmbeddingRepository` caption storage (4 tests)
- **Tests Existentes Actualizados:**
  - `SemanticSearchService.test.ts` - Actualizado para usar `semanticSearch()` mock
- **Todos los unit tests pasan:** 2026 tests passing
- **Todos los integration tests pasan:** 147 tests passing

**Archivos Modificados/Creados:**

| Archivo | Cambio |
|---------|--------|
| `backend/src/services/embeddings/EmbeddingService.ts` | Nuevo método `generateImageCaption()` |
| `backend/src/services/search/VectorSearchService.ts` | Nuevo método `semanticSearch()` |
| `backend/src/services/search/schema.ts` | Configuración semántica agregada |
| `backend/src/services/search/semantic/SemanticSearchService.ts` | Usa `semanticSearch()` unificado |
| `backend/src/services/search/types.ts` | Nuevos tipos `SemanticSearchQuery`, `SemanticSearchResult` |
| `backend/src/services/files/ImageProcessor.ts` | Integración de captioning |
| `backend/src/repositories/ImageEmbeddingRepository.ts` | Campos `caption`, `captionConfidence` |
| `backend/src/migrations/010-add-image-caption-fields.sql` | Migración para campos de caption |
| `backend/scripts/update-search-semantic-config.sh` | Script para configurar Semantic Ranker |
| `backend/src/__tests__/unit/services/embeddings/EmbeddingService.test.ts` | Tests de caption |
| `backend/src/__tests__/unit/services/search/VectorSearchService.test.ts` | Tests de semanticSearch |
| `backend/src/__tests__/unit/services/search/SemanticSearchService.test.ts` | Tests actualizados |
| `backend/src/__tests__/unit/repositories/ImageEmbeddingRepository.test.ts` | Tests de caption storage |

**Logros:**
1. ✅ Imágenes ahora tienen descripciones AI automáticas (captions)
2. ✅ Búsqueda unificada text + image con scores comparables
3. ✅ Azure AI Search Semantic Ranker normaliza relevancia
4. ✅ Score range unificado (0-1) para todos los resultados
5. ✅ Cobertura de tests completa para nuevas funcionalidades

---

## Posponer para Fases Futuras



### D8: Dynamic Model Selection

**Descripción:**
Permitir al usuario elegir entre diferentes modelos de Claude (Opus, Sonnet, Haiku).

**Requisitos:**
- Frontend: Dropdown de selección de modelo
- Backend: Pasar model ID a orchestratorGraph
- DB: Guardar model usado en message_events

**Fase:** Phase 6

**Prioridad:** Media

**Estimación:** 2 días

---

### D9: WebSocket Usage Alerts

**Descripción:**
Notificar al usuario en tiempo real cuando se acerca al límite de tokens/sesión.

**Requisitos:**
- UsageTracker emite evento 'usage_warning' al 80% del límite
- Frontend muestra toast notification
- Rate limiter en Redis trackea por sesión

**Fase:** Phase 6

**Prioridad:** Baja

**Estimación:** 1 día

---

### D10: Message Replay

**Descripción:**
Permitir "replay" de mensajes desde event log para debugging.

**Use case:**
Un usuario reporta un bug. Admin puede replay el event log de esa sesión para reproducir el issue.

**Requisitos:**
- Endpoint `/api/sessions/:id/replay`
- Lee events desde `message_events`
- Re-emite eventos via WebSocket
- No ejecuta LangGraph (solo replay de eventos ya ocurridos)

**Fase:** Phase 6

**Prioridad:** Baja

**Estimación:** 3 días

---

### D11: Tool Execution Queue

**Descripción:**
Actualmente tools se ejecutan inline durante streaming. Para tools lentos (>5s), mejor usar cola.

**Propuesta:**
```typescript
interface ToolExecutionQueue {
  enqueue(toolExecution: ToolExecution): Promise<string>; // Returns job ID
  waitForResult(jobId: string): Promise<ToolResult>;
}
```

**Beneficios:**
- No bloquea streaming
- Permite retries automáticos
- Mejor observabilidad

**Fase:** Phase 6

**Prioridad:** Media

**Estimación:** 4 días

---

### D13: Redis Chaos Tests

**Descripción:**
Simular fallos de Redis durante tests para validar fallback a DB.

**Propuesta:**
```typescript
describe('Chaos: Redis failures', () => {
  it('should fallback to DB when Redis crashes mid-session', async () => {
    // Iniciar sesión con Redis OK
    await orchestrator.runGraph(...);

    // Crashear Redis
    await redisClient.quit();

    // Continuar sesión (debe usar DB)
    await orchestrator.runGraph(...);

    // Verificar sequence numbers sin gaps
    const events = await getEventsFromDB();
    expect(events.map(e => e.sequence_number)).toEqual([0, 1, 2, 3]);
  });
});
```

**Fase:** Phase 6

**Prioridad:** Media

**Estimación:** 2 días

---

### ApprovalManager Completo

**Descripción:**
Actualmente ApprovalManager tiene deuda técnica:
- Timeouts no limpian Promises en memoria
- No hay persistencia de aprobaciones pendientes
- No hay API para listar aprobaciones pendientes

**Propuesta:**
```typescript
interface IApprovalManager {
  requestApproval(data: ApprovalRequestData): Promise<ApprovalResponse>;
  listPendingApprovals(userId: string): Promise<ApprovalRequest[]>;
  cancelApproval(approvalId: string): Promise<void>;
  cleanupExpiredApprovals(): Promise<number>; // Returns count cleaned
}
```

**Requisitos:**
- DB table: `pending_approvals` (TTL 5 minutos)
- Cron job para cleanup cada minuto
- WebSocket event: `approval_expired`

**Fase:** Phase 6

**Prioridad:** Alta

**Estimación:** 5 días

---

## Desarrollos Multi-Provider (Phase 7)

### Azure OpenAI Support

**Descripción:**
Agregar soporte para Azure OpenAI como provider alternativo.

**Requisitos:**
```typescript
interface ILLMProvider {
  createStream(params: LLMParams): AsyncGenerator<LLMEvent>;
  supportsThinking(): boolean;
  supportsTools(): boolean;
}

class AnthropicProvider implements ILLMProvider { ... }
class AzureOpenAIProvider implements ILLMProvider { ... }
```

**Configuración:**
```env
LLM_PROVIDER=anthropic|azure_openai
AZURE_OPENAI_ENDPOINT=...
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_DEPLOYMENT=gpt-4
```

**Fase:** Phase 7

**Prioridad:** Alta

**Estimación:** 10 días

---

### Google Gemini Support

**Descripción:**
Agregar soporte para Google Gemini.

**Fase:** Phase 7

**Prioridad:** Media

**Estimación:** 10 días

---

## Optimizaciones Avanzadas (Phase 7)

### Prompt Caching

**Descripción:**
Usar Anthropic Prompt Caching para reducir costos y latencia.

**Requisitos:**
- Marcar "file context" como cacheable
- Trackear cache hits/misses
- Dashboard de métricas de caching

**Beneficios:**
- 90% reducción de costos en input tokens cacheados
- 50% reducción de latencia en requests con cache hit

**Fase:** Phase 7

**Prioridad:** Alta

**Estimación:** 3 días

---

### Batch API Support

**Descripción:**
Para operaciones no interactivas (e.g., análisis bulk de documentos), usar Batch API.

**Use case:**
Usuario sube 100 documentos y pide "analizar todos".

**Fase:** Phase 7

**Prioridad:** Baja

**Estimación:** 5 días

---

## Analytics Dashboard (Phase 8)

### Métricas Avanzadas

**Descripción:**
Dashboard de analytics para admins.

**Métricas:**
- Token usage por usuario/día/mes
- Latencia promedio de requests
- Rate de errores
- Tool execution success rate
- Approval acceptance rate
- Cache hit rate (si Prompt Caching implementado)

**Tecnología:**
- Frontend: Chart.js o Recharts
- Backend: Queries agregados en SQL
- Caching: Redis (TTL 5 minutos)

**Fase:** Phase 8

**Prioridad:** Media

**Estimación:** 10 días

---

## Tests Skipped - Pendientes de Implementación

**Fecha análisis:** 2025-12-22
**Total:** 12 tests skipped (justificados)

### D14: UNIMPLEMENTED APIs (3 tests) - MANTENER SKIP

| Archivo | Descripción | Estado |
|---------|-------------|--------|
| `gdpr.api.test.ts` | GDPR compliance endpoints (delete user data, export) | ⏸️ Skip intencional |
| `billing.api.test.ts` | Billing/subscription management endpoints | ⏸️ Skip intencional |
| `usage.api.test.ts` | Usage dashboard analytics endpoints | ⏸️ Skip intencional |

**Justificación:** Estos tests son **placeholder tests** para features futuras. Los endpoints NO existen aún.
Los tests documentan el comportamiento esperado para cuando se implementen.

**Fase:** Phase 6 o posterior
**Estimación:** 5-7 días total (cuando se implementen los endpoints)

### D15: UNIMPLEMENTED Features (1 test) - PARCIALMENTE RESUELTO

| Archivo | Descripción | Estado |
|---------|-------------|--------|
| `approval-flow.e2e.test.ts` | Full approval flow E2E con WebSocket | ⏸️ Pendiente refactor |

**Actualización 2025-12-23:**
- `approval-flow.e2e.test.ts`: Mantener skip - ApprovalManager recibirá un refactor significativo.
  El servicio existe pero será reestructurado antes de habilitar estos E2E tests.

**Fase restante:** Phase 6 o posterior (post-refactor ApprovalManager)
**Estimación restante:** 3-5 días (refactor + tests)




### D18: Technical Issues (1 test) - PENDIENTE

| Archivo | Descripción | Estado |
|---------|-------------|--------|
| `performance.test.ts` | Tests de carga (100+ requests concurrentes, P95/P99 latency) | ⏸️ Skip INTENCIONAL |

**Actualización 2025-12-23:**
- `performance.test.ts`: **Mantener skip** - Son tests de carga resource-intensive:
  - 100+ requests concurrentes
  - Medición de latencia P95/P99
  - Detección de memory leaks (100MB heap threshold)
  - Deben ejecutarse en entorno de benchmark dedicado, NO en CI/CD

**Fase:** Phase 6 (infrastructure) o posterior
**Estimación:** 1 día (solo infraestructura de benchmark)


---

## Registro de Deuda Técnica

| ID | Descripción | Fase | Prioridad | Días | Estado |
|----|-------------|------|-----------|------|--------|
| **D1** | **Race condition EventStore** | **Phase 5C** | **Alta** | **1-2** | Pendiente |
| ~~D20~~ | ~~Duplicate File Detection & Management~~ | ~~Phase 6~~ | ~~ALTA~~ | ~~3-4~~ | ✅ COMPLETADO |
| ~~D22~~ | ~~Orphan Cleanup Job~~ | ~~Phase 6~~ | ~~Media~~ | ~~2~~ | ✅ COMPLETADO |
| ~~D26~~ | ~~Multimodal RAG with Reranker & Image Captioning~~ | ~~Phase 6~~ | ~~CRÍTICA~~ | ~~3-4~~ | ✅ COMPLETADO |

| D8 | Dynamic model selection | Phase 6 | Media | 2 | Pendiente |
| D9 | WebSocket usage alerts | Phase 6 | Baja | 1 | Pendiente |
| D10 | Message replay | Phase 6 | Baja | 3 | Pendiente |
| D11 | Tool execution queue | Phase 6 | Media | 4 | Pendiente |
| D13 | Redis chaos tests | Phase 6 | Media | 2 | Pendiente |
| D14 | Unimplemented APIs (GDPR, billing, usage) | Phase 6+ | Media | 5-7 | Pendiente |
| D15 | Unimplemented Features (solo approval pending) | Phase 6+ | Media | 1-2 | Pendiente |
| D18 | Technical Issues (performance, websocket) | Phase 6+ | Media | 2-3 | Pendiente |
| **D19** | **Refactor E2E Tests - Nueva Filosofía** | **Phase 6** | **ALTA** | **5-7** | Pendiente |
| - | ApprovalManager completo | Phase 6 | Alta | 5 | Pendiente |
| - | Azure OpenAI support | Phase 7 | Alta | 10 | Pendiente |
| - | Google Gemini support | Phase 7 | Media | 10 | Pendiente |
| - | Prompt Caching | Phase 7 | Alta | 3 | Pendiente |
| - | Batch API | Phase 7 | Baja | 5 | Pendiente |
| - | Analytics Dashboard | Phase 8 | Media | 10 | Pendiente |
| ~~D21~~ | ~~File Deletion Cascade~~ | ~~Phase 6~~ | ~~Media~~ | ~~1~~ | ✅ 3/4 gaps (Redis opcional) |
| ~~D23~~ | ~~Post-Delete Verification~~ | ~~Phase 6~~ | ~~Baja~~ | ~~0.5~~ | ✅ BY DESIGN (via D22) |
| ~~D24~~ | ~~UserId Case Sensitivity (AI Search)~~ | ~~Phase 6~~ | ~~ALTA~~ | ~~0.5~~ | ✅ COMPLETADO |
| ~~D25~~ | ~~Robust File Processing System~~ | ~~Phase 6~~ | ~~ALTA~~ | ~~5-7~~ | ✅ COMPLETADO (Sprints 1-4) |
| **D25-S5** | **D25-Sprint5: MessageQueue Workers Extraction** | **Phase 6** | **BAJA** | **3-5** | Pendiente (Opcional) |
| **D26-A** | **EmbeddingService Tests Env Injection** | **Phase 6** | **MEDIA** | **1-2** | Pendiente |
| **D27** | **MessageQueue Refactor - God File Decomposition** | **Phase 6** | **ALTA** | **3-5** | Pendiente |
| **D28** | **WebSocket Event Constants Centralization** | **Phase 6** | **MEDIA** | **2-3** | Parcial (File events ✅) |


**Total estimado Phase 6:** ~25-30 días (ajustado - D20, D21, D22, D23, D24, D25, D26 completados)
**Total estimado Phase 7:** ~28 días
**Total estimado Phase 8:** ~10 días

*Última actualización: 2026-01-14 (D25 Robust File Processing completado, Sprint 5 documentado como D29)*

---

## D19: Refactor E2E Tests - Nueva Filosofía (CRÍTICO)

**Fecha análisis:** 2025-12-23
**Estado:** Documentado - Pendiente Implementación
**Prioridad:** ALTA
**Estimación:** 5-7 días

### Contexto del Problema

Los E2E tests actuales tienen **56 failures** al ejecutar con `E2E_USE_REAL_API=true`.
Esto NO son bugs del sistema - son diferencias entre:
- **Expectations hardcoded** (basadas en mocks determinísticos)
- **Comportamiento real de Claude API** (no determinístico)

### Nueva Filosofía de Tests E2E

Los E2E tests deben seguir estos principios:

#### 1. NO Verificar Contenido Específico

```typescript
// ❌ MALO - Verificar contenido específico
expect(response.content).toBe('Hello! I am Claude...');

// ✅ BUENO - Verificar estructura y consistencia
expect(response.stopReason).toBe('end_turn');
expect(response.hasTools).toBe(true);
expect(response.toolCount).toBeGreaterThan(0);
```

#### 2. Capturar Respuesta Real como Ground Truth

```typescript
// Flujo propuesto:
// 1. Llamar API real de Anthropic
// 2. Capturar respuesta como "golden file" (una vez)
// 3. Usar golden file para validar pipeline completo
const realResponse = await captureFromAnthropic(prompt);
const normalizedEvents = normalize(realResponse);
const persistedEvents = await persist(normalizedEvents);
const reconstructed = reconstruct(persistedEvents);

// Validar que reconstrucción preserva estructura
expect(reconstructed.toolCallCount).toBe(realResponse.toolCallCount);
expect(reconstructed.hasThinking).toBe(realResponse.hasThinking);
```

#### 3. Verificar Flujo Completo End-to-End

```
API Anthropic → Normalización → Persistencia → WebSocket → Reconstrucción
     │              │              │              │              │
     │              │              │              │              └── Frontend puede
     │              │              │              │                  renderizar correctamente
     │              │              │              │
     │              │              │              └── Eventos transmitidos
     │              │              │                  son completos
     │              │              │
     │              │              └── DB contiene toda
     │              │                  la información
     │              │
     │              └── Eventos normalizados
     │                  preservan estructura
     │
     └── Respuesta capturada
         como ground truth
```

#### 4. Qué Verificar vs Qué NO Verificar

| Verificar (BUENO) | NO Verificar (MALO) |
|-------------------|---------------------|
| Orden de eventos | Contenido de texto |
| Cantidad de tools | Mensaje específico |
| Presencia de thinking | Texto de thinking |
| Tokens consumidos | Valores exactos |
| Sequence numbers | IDs específicos |
| Stop reasons | Timestamps exactos |
| Reconstrucción posible | Formato de fechas |

### Gaps Identificados

#### Gap #1: No hay Ground Truth de Anthropic (CRÍTICO)

**Problema:** Tests usan `FakeScenario` con contenido hardcoded en lugar de respuestas reales.

**Ubicación:**
- `backend/src/__tests__/e2e/helpers/GoldenResponses.ts`
- `backend/src/__tests__/e2e/helpers/ResponseScenarioRegistry.ts`

**Solución propuesta:**
1. Crear script `capture-golden-responses.ts` que llama API real una vez
2. Guardar respuestas en `__fixtures__/golden/` como JSON
3. Usar golden files como baseline para validación

#### Gap #2: Sin Validación de Reconstrucción (CRÍTICO)

**Problema:** No hay test que valide que eventos persistidos pueden reconstruir mensaje original.

**Solución propuesta:**
```typescript
// Nuevo helper: reconstructMessageFromEvents()
function reconstructMessageFromEvents(events: DBEvent[]): ReconstructedMessage {
  const chunks = events.filter(e => e.type === 'message_chunk');
  const content = chunks.map(c => c.data.content).join('');
  const tools = events.filter(e => e.type === 'tool_use');
  return { content, toolCount: tools.length, ... };
}

// Test nuevo:
it('should reconstruct response from persisted events', () => {
  const reconstructed = reconstructMessageFromEvents(scenarioResult.dbEvents);
  expect(reconstructed.stopReason).toBe(goldenResponse.stopReason);
  expect(reconstructed.toolCount).toBe(goldenResponse.toolCount);
});
```

#### Gap #3: Hardcoded Session IDs (ALTA)

**Problema:** Potencial colisión si tests corren en paralelo.

**Ubicación:**
- `logs.api.test.ts:49,126` - `'test_session_123'`
- `token-usage.api.test.ts:124` - `'test_session_123'`

**Solución:** Reemplazar con IDs generados dinámicamente via `TestSessionFactory`.

#### Gap #4: Token Tracking No Implementado (ALTA)

**Problema:** `CapturedResponseValidator.ts:211` tiene `// TODO: Implement when adding multi-provider support`

**Solución:** Implementar validación de tokens en cada evento del stream.

#### Gap #5: Thinking Content Sin Validación Real (MEDIA)

**Problema:** Solo verifica que `data` existe, no que es thinking real vs fake.

**Solución:** Validar estructura de thinking blocks, no contenido.

### Archivos a Modificar

```
backend/src/__tests__/e2e/helpers/
├── ResponseScenarioRegistry.ts  → Agregar captura de golden responses
├── CapturedResponseValidator.ts → Implementar token tracking
├── GoldenResponses.ts           → Reemplazar con golden files reales
└── ReconstructionHelper.ts      → NUEVO: reconstruir desde eventos

backend/src/__tests__/e2e/scenarios/patterns/
├── *.scenario.test.ts           → Cambiar assertions a estructura

backend/src/__tests__/e2e/api/
├── logs.api.test.ts             → Fix hardcoded sessionIds
└── token-usage.api.test.ts      → Fix hardcoded sessionIds
```

### Plan de Implementación

**Fase 1: Foundation (2 días)**
1. Crear `capture-golden-responses.ts` script
2. Capturar golden files para todos los scenarios
3. Fix hardcoded sessionIds

**Fase 2: Reconstruction (2 días)**
1. Implementar `reconstructMessageFromEvents()`
2. Agregar tests de reconstrucción
3. Validar flujo API→DB→Reconstruct

**Fase 3: Validation (2 días)**
1. Implementar token tracking en `CapturedResponseValidator`
2. Agregar validación de estructura (no contenido)
3. Tests de normalización

**Fase 4: Cleanup (1 día)**
1. Eliminar assertions de contenido específico
2. Actualizar documentación
3. Verificar 0 failures con Real API

---

## D20: Duplicate File Detection & Management - COMPLETADO

**Fecha análisis:** 2026-01-06
**Estado:** ✅ COMPLETADO (2026-01-13)
**Prioridad:** ALTA (UX + Cost Savings)
**Estimación original:** 3-4 días

### Solución Implementada (SHA-256 Hash Detection)

#### Fase 1: Backend - Hash-Based Detection ✅
- Implementado `FileService.findByContentHash()` para buscar archivos por hash
- Implementado `FileService.checkDuplicatesByHash()` para verificación batch
- Endpoint `POST /api/files/check-duplicates` con validación Zod

#### Fase 2: Database Migration ✅
```sql
-- Migration: 011-add-content-hash.sql
ALTER TABLE files ADD content_hash CHAR(64) NULL;

CREATE NONCLUSTERED INDEX IX_files_user_content_hash
ON files(user_id, content_hash)
WHERE content_hash IS NOT NULL AND is_folder = 0;
```

#### Fase 3: Frontend - Complete UX ✅
- `computeFileSha256()` - Web Crypto API para hash en cliente
- `duplicateStore.ts` - Zustand store para manejo de conflictos
- `DuplicateFileModal.tsx` - Modal con opciones Replace/Skip/Cancel
- `useFileUpload.ts` - Hook modificado con flujo completo de detección
- `MultiFileContextMenu.tsx` - Context menu para eliminación múltiple

#### Fase 4: Tipos Compartidos ✅
- Tipos añadidos a `@bc-agent/shared`:
  - `DuplicateCheckItem`, `CheckDuplicatesRequest`
  - `DuplicateResult`, `CheckDuplicatesResponse`
  - `DuplicateAction`

**Archivos Modificados/Creados:**

| Archivo | Cambio |
|---------|--------|
| `backend/migrations/011-add-content-hash.sql` | Nueva migración |
| `backend/src/services/files/FileService.ts` | Métodos findByContentHash, checkDuplicatesByHash, createFileRecord |
| `backend/src/routes/files.ts` | Endpoint check-duplicates, upload con hash |
| `backend/src/shared/utils/hash.ts` | Utilidad SHA-256 |
| `packages/shared/src/types/file.types.ts` | Tipos de duplicados |
| `packages/shared/src/index.ts` | Exports de tipos |
| `frontend/src/lib/utils/hash.ts` | Web Crypto SHA-256 |
| `frontend/src/domains/files/stores/duplicateStore.ts` | Estado Zustand |
| `frontend/components/modals/DuplicateFileModal.tsx` | Modal de conflictos |
| `frontend/src/domains/files/hooks/useFileUpload.ts` | Flujo completo |
| `frontend/src/infrastructure/api/fileApiClient.ts` | Método checkDuplicates |
| `frontend/components/files/MultiFileContextMenu.tsx` | Multi-selección |
| `frontend/components/files/FileList.tsx` | Integración multi-select |

**Decisiones del Usuario:**
- Scope de duplicados: **Todo el repositorio** del usuario (no solo carpeta actual)
- Archivos legacy sin hash: **No participan** en detección

---

## D21: File Deletion Cascade Completeness - ACTUALIZADO 2026-01-13

**Fecha análisis:** 2026-01-06
**Estado:** ✅ MAYORMENTE RESUELTO - 3 de 4 gaps cerrados
**Prioridad:** BAJA (solo Redis cache pendiente)
**Estimación restante:** 0.5 días (opcional)

### Inventario Completo de Storage Points (Auditoría 2026-01-13)

| Storage | Tabla/Índice | Cascade | Estado | Archivo Responsable |
|---------|-------------|---------|--------|---------------------|
| SQL Server | `files` | N/A (source of truth) | ✅ OK | - |
| SQL Server | `file_chunks` | FK CASCADE | ✅ OK | `migrations/003-create-files-tables.sql:64` |
| SQL Server | `message_file_attachments` | FK CASCADE | ✅ OK | `migrations/003-create-files-tables.sql:87` |
| SQL Server | `image_embeddings` | FK CASCADE | ✅ OK | `migrations/007-create-image-embeddings.sql:28-29` |
| Azure AI Search | `file-chunks-index` (text) | Manual | ✅ `deleteChunksForFile()` | `services/search/VectorSearchService.ts:303-319` |
| Azure AI Search | `file-chunks-index` (images) | Manual | ✅ Usa mismo filtro (fileId+userId) | `services/search/VectorSearchService.ts:314` |
| Azure Blob Storage | `users/{userId}/files/` | Manual | ✅ Route handler | `routes/files.ts:862-926` |
| Redis Cache | N/A | N/A | ❌ NO implementado | - |

### Gaps - Estado Actualizado (2026-01-13)

| Gap | Descripción | Estado | Notas |
|-----|-------------|--------|-------|
| Gap 1 | Eventual Consistency en AI Search | ✅ RESUELTO | OrphanCleanupJob implementado (D22) |
| Gap 2 | No hay verificación post-delete | ✅ BY DESIGN | `countDocumentsForFile()` existe; OrphanCleanupJob para cleanup eventual |
| Gap 3 | UserId Case Sensitivity | ✅ RESUELTO | D24 completado - todos los métodos normalizan userId |
| Gap 4 | Redis Cache no se limpia | ❌ PENDIENTE | Baja prioridad - TTL de 7 días maneja limpieza automática |

### Tests de Integración Implementados (Staged)

**Archivo:** `backend/src/__tests__/integration/files/FileDeletionCascade.integration.test.ts`

Tests implementados:
- ✅ Database cascade (FK delete)
- ✅ Audit trail creation
- ✅ Text embeddings deletion from AI Search
- ✅ Image embeddings deletion from AI Search
- ✅ Folder cascade (children embeddings)
- ✅ Idempotent deletion (no embeddings case)
- ✅ Multi-tenant isolation

### Trabajo Restante

1. **Redis Cache cleanup** (baja prioridad, opcional) - TTL de 7 días ya maneja limpieza automática

### Auditoría Realizada 2026-01-06

Se encontraron y eliminaron **139 documentos huérfanos** en Azure AI Search.
**Resultado 2026-01-13:** OrphanCleanupJob ejecutado, sistema limpio (1 huérfano eliminado).

---

## D22: Orphan Cleanup Job - COMPLETADO

**Fecha análisis:** 2026-01-06
**Estado:** ✅ COMPLETADO (2026-01-13)
**Prioridad:** MEDIA
**Estimación original:** 2 días

### Solución Implementada

#### Backend Job ✅
- `OrphanCleanupJob.ts` implementado con:
  - `cleanOrphansForUser(userId)` - Limpieza por usuario
  - `runFullCleanup()` - Limpieza de todos los usuarios
  - Detailed logging y estadísticas

#### VectorSearchService Extensions ✅
- `getUniqueFileIds(userId)` - Obtener fileIds de AI Search
- `getAllUserIdsWithDocuments()` - Listar usuarios con documentos

#### Admin Endpoint ✅
```typescript
POST /api/admin/jobs/orphan-cleanup
Query params:
  - userId?: string (cleanup for specific user)
  - dryRun?: boolean (report without deleting)
```

#### Manual Script ✅
```bash
# Cleanup para todos los usuarios
npx tsx scripts/run-orphan-cleanup.ts

# Cleanup para usuario específico
npx tsx scripts/run-orphan-cleanup.ts --userId <uuid>
```

**Archivos Creados:**

| Archivo | Descripción |
|---------|-------------|
| `backend/src/jobs/OrphanCleanupJob.ts` | Job principal (~200 LOC) |
| `backend/src/jobs/index.ts` | Exports |
| `backend/src/routes/admin.ts` | Endpoint admin |
| `backend/scripts/run-orphan-cleanup.ts` | Script CLI |

**Verificación Inicial:**
- Ejecutado cleanup inicial: 1 documento huérfano encontrado y eliminado
- Sistema verificado sin huérfanos restantes

---

## D23: Post-Delete Verification - BY DESIGN

**Fecha análisis:** 2026-01-06
**Estado:** ✅ BY DESIGN (2026-01-13) - Confiar en OrphanCleanupJob
**Prioridad:** N/A (cerrado)
**Decisión:** Eventual consistency via D22

### Infraestructura Disponible

1. **`VectorSearchService.countDocumentsForFile()`** - Método implementado
   - Normaliza userId a mayúsculas (D24 completo)
   - Retorna count de documentos para fileId+userId
   - Disponible para verificación manual si se necesita

2. **Tests de Integración** - Verifican eliminación
   - Tests usan `countDocumentsForFile()` para validar count === 0 post-delete
   - Cubren: text embeddings, image embeddings, folder cascade, multi-tenant

### Decisión Final

**Opción elegida:** Confiar en OrphanCleanupJob (D22) para cleanup eventual.

**Justificación:**
1. `countDocumentsForFile()` existe y funciona correctamente
2. Los integration tests ya verifican que la eliminación funciona
3. OrphanCleanupJob (D22) detecta y limpia huérfanos periódicamente
4. Agregar retry logic complica innecesariamente el código
5. Eventual consistency es aceptable para este caso de uso

---

## D24: UserId Case Sensitivity in AI Search - COMPLETADO

**Fecha análisis:** 2026-01-06
**Estado:** ✅ COMPLETADO (2026-01-13)
**Prioridad:** ALTA (Bug potencial en eliminación)
**Estimación original:** 0.5 días

### Descripción

Azure AI Search almacena `userId` en MAYÚSCULAS, pero las consultas pueden usar minúsculas, causando mismatches.

### Solución Implementada

**Archivo:** `backend/src/services/search/VectorSearchService.ts`

Se implementó método helper `normalizeUserId()` y se aplicó a TODOS los métodos que usan filtros de userId:

```typescript
/**
 * Normalizes userId to uppercase for Azure AI Search compatibility.
 * AI Search stores userId in uppercase, so queries must match.
 * See D24 in docs/plans/99-FUTURE-DEVELOPMENT.md
 */
private normalizeUserId(userId: string): string {
  return userId.toUpperCase();
}
```

#### ✅ Métodos CON Normalización (8/8 - 100%)

| Método | Estado |
|--------|--------|
| `search()` | ✅ Normalizado |
| `hybridSearch()` | ✅ Normalizado |
| `deleteChunksForFile()` | ✅ Normalizado |
| `deleteChunksForUser()` | ✅ Normalizado |
| `searchImages()` | ✅ Normalizado |
| `semanticSearch()` | ✅ Normalizado |
| `getUniqueFileIds()` | ✅ Normalizado |
| `countDocumentsForFile()` | ✅ Normalizado |

### Tests Implementados

**Archivo:** `backend/src/__tests__/unit/services/search/VectorSearchService.test.ts`

- Nueva sección "D24 UserId Normalization" con tests para cada método
- Tests de `searchImages()` agregados (faltaban)
- Tests existentes actualizados para esperar userId en mayúsculas

**Total nuevos tests:** 11 tests específicos para D24

---

## D26-A: EmbeddingService Integration Tests - Environment Variable Injection

**Fecha análisis:** 2026-01-06
**Estado:** Documentado - Workaround Aplicado
**Prioridad:** MEDIA
**Estimación:** 1-2 días

### Problema Actual

Los tests de integración de `EmbeddingService` se **saltan silenciosamente** cuando se ejecuta la suite completa (`npm run test:integration`), a pesar de que las credenciales existen en el `.env`.

```
stdout | EmbeddingService.integration.test.ts
Skipping EmbeddingService tests: missing Azure OpenAI or Redis credentials
Test skipped: missing credentials
```

**Sin embargo**, cuando se ejecuta el test directamente (`npm run test:integration -- EmbeddingService`), los tests **SÍ se ejecutan correctamente**.

### Causa Raíz

El problema está en cómo vitest con `pool: 'forks'` maneja las variables de entorno:

1. **globalSetup.ts** se ejecuta en el proceso principal
2. Carga el `.env` y configura variables de entorno
3. Pero los **workers de vitest son procesos fork** que NO heredan las variables modificadas en globalSetup de manera consistente
4. El archivo `setup.env.ts` (setupFiles) se ejecuta EN el worker, pero DESPUÉS de que los módulos del test se importan
5. Cuando `EmbeddingService.integration.test.ts` importa `EmbeddingService`, este carga `environment.ts` que lee `process.env` ANTES de que setupFiles haya ejecutado

### Orden de Ejecución Problemático

```
┌─────────────────────────────────────────────────────────────┐
│ PROCESO PRINCIPAL                                           │
│  1. globalSetup.ts ejecuta y carga .env ✅                  │
│  2. Spawn worker process                                    │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ WORKER PROCESS (fork)                                       │
│  3. Importa módulos del test (EmbeddingService)             │
│     → environment.ts lee process.env (VACÍO) ❌             │
│  4. setupFiles ejecuta setup.env.ts                         │
│     → Carga .env (YA ES TARDE) ❌                           │
│  5. beforeAll() verifica credenciales → FALTAN ❌           │
└─────────────────────────────────────────────────────────────┘
```

### Workaround Actual (2026-01-06)

Se modificó `globalSetup.ts` para NO sobrescribir `REDIS_PASSWORD` cuando `REDIS_TEST_PASSWORD` está vacío:

```typescript
// globalSetup.ts
if (REDIS_TEST_CONFIG.hasExplicitPassword) {
  process.env.REDIS_PASSWORD = REDIS_TEST_CONFIG.password || '';
} else {
  // Preservar original - pero esto NO se hereda a workers
}
```

**Esto soluciona parcialmente** el problema para ejecuciones individuales, pero NO para la suite completa.

### Solución Propuesta

**Opción A: Usar `singleThread: true`** (Simple pero lento)
```typescript
// vitest.integration.config.ts
pool: 'threads',
poolOptions: {
  threads: { singleThread: true }
}
```
- Pro: Workers heredan process.env del main process
- Contra: Tests más lentos (no paralelos)

**Opción B: Pasar env via poolOptions** (Recomendado)
```typescript
// vitest.integration.config.ts
pool: 'forks',
poolOptions: {
  forks: {
    singleFork: true,
    execArgv: [],
    // Pasar env explícitamente
    env: {
      ...process.env,
      AZURE_OPENAI_KEY: process.env.AZURE_OPENAI_KEY,
      REDIS_PASSWORD: process.env.REDIS_PASSWORD,
    }
  }
}
```

**Opción C: Cargar .env en el test file directamente** (Workaround)
```typescript
// EmbeddingService.integration.test.ts
import { config } from 'dotenv';
config({ path: path.resolve(__dirname, '../../../../.env') });

describe('EmbeddingService', () => { ... });
```

### Archivos Afectados

| Archivo | Estado |
|---------|--------|
| `backend/vitest.integration.config.ts` | Requiere modificación |
| `backend/src/__tests__/integration/globalSetup.ts` | Workaround aplicado |
| `backend/src/__tests__/integration/setup.env.ts` | Funciona pero tarde |
| `backend/src/__tests__/integration/embeddings/EmbeddingService.integration.test.ts` | Tests se saltan |

### Tests Afectados

- `should generate real embeddings from Azure OpenAI`
- `should batch generate embeddings`
- `should generate 1024-dimensional embedding for text query`
- `should generate embeddings in same vector space as image embeddings`
- `should handle different text queries correctly`
- `should cache embeddings for repeated queries`

**Total: 6 tests que NO se ejecutan en suite completa**

### Impacto

- **Cobertura reducida**: Tests de embedding NO validan funcionalidad real en CI
- **Falsa confianza**: Suite muestra "147 passed" pero 6 tests no corren
- **Debugging difícil**: Solo descubierto por inspección manual de logs

### Recomendación

Implementar **Opción B** (pasar env via poolOptions) para asegurar que:
1. Los tests se ejecutan con las credenciales correctas
2. La suite de integración completa valida EmbeddingService
3. CI/CD detecta regresiones en embeddings

---

## D27: MessageQueue Refactor - God File Decomposition (ALTA)

**Fecha análisis:** 2026-01-13
**Estado:** Documentado - Pendiente Implementación
**Prioridad:** ALTA (Architectural Debt)
**Estimación:** 3-5 días

### Problema Actual

El archivo `MessageQueue.ts` tiene **2039 líneas** y viola múltiples principios de diseño:

1. **Violación de SRP (Single Responsibility Principle)**: El archivo tiene **12 responsabilidades distintas**
2. **Violación de Screaming Architecture**: El código no "grita" qué hace el sistema
3. **God File Anti-Pattern**: Concentra demasiada lógica en un solo lugar
4. **Lógica de negocio en infraestructura**: Los procesadores de jobs contienen lógica de dominio

### Análisis de Responsabilidades

| Responsabilidad | Líneas Aprox | Problema |
|-----------------|--------------|----------|
| Tipos/Interfaces de Jobs | ~160 | Deberían estar en archivos separados |
| Gestión Redis | ~90 | OK en este archivo |
| Inicialización de Colas | ~170 | Puede extraerse a config |
| Inicialización de Workers | ~130 | Puede extraerse a registry |
| Event Listeners | ~25 | OK en este archivo |
| Scheduled Jobs | ~65 | Debería estar separado |
| Rate Limiting | ~80 | Debería ser un servicio separado |
| Métodos add* públicos | ~270 | OK en este archivo |
| **Procesadores de Jobs** | **~550** | **CRÍTICO: Lógica de negocio mezclada** |
| Utilidades de tiempo | ~30 | Debería estar en utils |
| Gestión de colas | ~100 | OK en este archivo |
| Shutdown/cleanup | ~90 | OK en este archivo |

### Estructura Propuesta

```
backend/src/infrastructure/queue/
├── index.ts                          # Re-exports públicos
├── MessageQueue.ts                   # Core: singleton, métodos add* (~400 líneas)
├── QueueConfig.ts                    # Configuración de colas (~200 líneas)
├── WorkerRegistry.ts                 # Registro de workers (~150 líneas)
├── IMessageQueueDependencies.ts      # Ya existe (mantener)
│
├── types/
│   ├── index.ts
│   ├── QueueName.ts
│   └── jobs/
│       ├── index.ts
│       ├── MessagePersistenceJob.ts
│       ├── ToolExecutionJob.ts
│       ├── EventProcessingJob.ts
│       ├── UsageAggregationJob.ts
│       ├── FileProcessingJob.ts
│       ├── FileChunkingJob.ts
│       ├── EmbeddingGenerationJob.ts
│       └── CitationPersistenceJob.ts
│
├── processors/                        # Lógica de procesamiento
│   ├── index.ts
│   ├── IJobProcessor.ts              # Interface común
│   ├── MessagePersistenceProcessor.ts
│   ├── ToolExecutionProcessor.ts     # (stub - no implementado)
│   ├── EventProcessor.ts
│   ├── UsageAggregationProcessor.ts
│   ├── FileProcessingProcessor.ts
│   ├── FileChunkingProcessor.ts
│   ├── EmbeddingGenerationProcessor.ts
│   └── CitationPersistenceProcessor.ts
│
├── scheduling/
│   └── ScheduledJobsInitializer.ts   # Jobs programados
│
├── rate-limiting/
│   └── SessionRateLimiter.ts         # Rate limiting multi-tenant
│
└── utils/
    └── TimeHelpers.ts                # getLastHourStart, etc.
```

### Beneficios del Refactor

1. **Screaming Architecture**: La estructura de carpetas "grita" qué hace cada parte
2. **Testabilidad**: Cada procesador puede testearse independientemente
3. **Mantenibilidad**: Archivos de ~100-200 líneas vs 2000+ líneas
4. **Extensibilidad**: Agregar nueva cola = nuevo archivo en `types/jobs/` + `processors/`
5. **Separación de concerns**: Infraestructura vs Lógica de procesamiento

### Tests Afectados

**Unit Tests Existentes (3 archivos):**
- `MessageQueue.rateLimit.test.ts` - Deberá migrar a testear `SessionRateLimiter`
- `MessageQueue.close.test.ts` - Se mantiene en `MessageQueue.ts`
- `MessageQueue.embedding.test.ts` - Deberá migrar a testear `EmbeddingGenerationProcessor`

**Integration Tests (2 archivos):**
- `MessageQueue.integration.test.ts` - Se mantiene, testea flujo completo
- `pipeline.integration.test.ts` - Se mantiene, testea embedding pipeline

**Nuevos Tests Requeridos:**
- `SessionRateLimiter.test.ts` - Unit tests de rate limiting
- `*Processor.test.ts` - Unit tests de cada procesador
- `QueueConfig.test.ts` - Verificar configuración de colas
- `WorkerRegistry.test.ts` - Verificar registro de workers

### Archivos que Importan MessageQueue

| Archivo | Impacto |
|---------|---------|
| `server.ts` | Bajo - Solo usa `getMessageQueue()` y `close()` |
| `PersistenceCoordinator.ts` | Bajo - Solo usa métodos `add*` |
| `files.ts` (routes) | Bajo - Solo usa `addFileProcessingJob()` |
| `FileProcessingService.ts` | Bajo - Solo usa métodos `add*` |
| `FileChunkingService.ts` | Bajo - Solo usa métodos `add*` |
| `MessageService.ts` | Bajo - Solo usa métodos `add*` |

**Nota:** Todos los consumidores solo usan la API pública (`getMessageQueue()` + métodos `add*`), que se mantendrá intacta.

### Plan de Implementación

**Fase 1: Extracción de Tipos (0.5 días)**
1. Crear estructura de carpetas `types/` y `types/jobs/`
2. Mover `QueueName` enum a `types/QueueName.ts`
3. Mover interfaces de jobs a archivos individuales
4. Actualizar imports en `MessageQueue.ts`
5. Verificar que tests existentes pasan

**Fase 2: Extracción de Procesadores (1.5 días)**
1. Crear interface `IJobProcessor` en `processors/`
2. Extraer cada método `process*` a su propio archivo
3. Inyectar dependencias via constructor (executeQuery, logger, etc.)
4. Crear unit tests para cada procesador
5. Integrar procesadores en `MessageQueue.ts` via registry

**Fase 3: Extracción de Rate Limiting (0.5 días)**
1. Crear `SessionRateLimiter` en `rate-limiting/`
2. Mover `checkRateLimit` y `getRateLimitStatus`
3. Inyectar en `MessageQueue` via constructor
4. Crear unit tests

**Fase 4: Extracción de Configuración (0.5 días)**
1. Crear `QueueConfig.ts` con definiciones de colas
2. Crear `WorkerRegistry.ts` con configuración de workers
3. Extraer `ScheduledJobsInitializer` a `scheduling/`
4. Extraer utilidades de tiempo a `utils/TimeHelpers.ts`

**Fase 5: Verificación (0.5-1 día)**
1. Ejecutar suite completa de tests
2. Verificar integration tests
3. Verificar que `MessageQueue.ts` queda en ~400 líneas
4. Actualizar documentación

### Estrategia de Migración Segura

1. **No cambiar API pública**: `getMessageQueue()` y métodos `add*` mantienen firma
2. **Refactor incremental**: Una fase a la vez, tests después de cada fase
3. **Feature flags NO necesarios**: Cambio interno, API externa intacta
4. **Rollback fácil**: Git permite revertir si algo falla

### Riesgos y Mitigaciones

| Riesgo | Probabilidad | Mitigación |
|--------|--------------|------------|
| Tests de integración fallan | Media | Ejecutar después de cada fase |
| Imports circulares | Baja | Estructura de dependencias clara |
| Performance degradation | Muy Baja | No hay cambio de lógica, solo organización |
| Merge conflicts | Media | Hacer en branch dedicado, mergear rápido |

---

## D25-S5: D25-Sprint5 - MessageQueue Workers Extraction (OPCIONAL)

**Fecha análisis:** 2026-01-14
**Estado:** Documentado - Opcional (Sprints 1-4 de D25 completados)
**Prioridad:** BAJA (No bloquea funcionalidad)
**Estimación:** 3-5 días

### Contexto

El plan D25 (Robust File Processing) fue implementado exitosamente en 4 sprints:
- **Sprint 1**: Domain Layer Foundation (ReadinessStateComputer, FileRetryService, migration)
- **Sprint 2**: Retry & Cleanup (ProcessingRetryManager, PartialDataCleaner, API endpoint, queue integration)
- **Sprint 3**: WebSocket Events (FileEventEmitter, constantes centralizadas)
- **Sprint 4**: Frontend (fileProcessingStore, useFileProcessingEvents, FileStatusIndicator)

El **Sprint 5 es opcional** y consiste en refactorización de "god files" que no bloquean la funcionalidad pero representan deuda técnica arquitectónica.

### God Files Identificados

| Archivo | Líneas | Responsabilidades | Problema |
|---------|--------|-------------------|----------|
| `MessageQueue.ts` | ~2,061 | 8+ responsabilidades | Viola SRP severamente |
| `files.ts` (routes) | ~1,015 | CRUD + upload + search + retry | Lógica de negocio en routes |
| `FileService.ts` | ~967 | CRUD + búsqueda + procesamiento | Múltiples dominios mezclados |

### Plan de Refactorización para MessageQueue.ts

**Estructura Propuesta:**
```
backend/src/infrastructure/queue/
├── index.ts                          # Re-exports públicos
├── MessageQueue.ts                   # Core: singleton, métodos add* (~400 líneas)
├── QueueConfig.ts                    # Configuración de colas (~200 líneas)
├── WorkerRegistry.ts                 # Registro de workers (~150 líneas)
│
├── types/
│   ├── index.ts
│   ├── QueueName.ts
│   └── jobs/
│       ├── MessagePersistenceJob.ts
│       ├── FileProcessingJob.ts
│       ├── FileChunkingJob.ts
│       ├── EmbeddingGenerationJob.ts
│       ├── FileCleanupJob.ts
│       └── CitationPersistenceJob.ts
│
├── processors/                        # Lógica de procesamiento
│   ├── index.ts
│   ├── IJobProcessor.ts              # Interface común
│   ├── MessagePersistenceProcessor.ts
│   ├── FileProcessingProcessor.ts
│   ├── FileChunkingProcessor.ts
│   ├── EmbeddingGenerationProcessor.ts
│   ├── FileCleanupProcessor.ts
│   └── CitationPersistenceProcessor.ts
│
├── scheduling/
│   └── ScheduledJobsInitializer.ts   # Jobs programados
│
├── rate-limiting/
│   └── SessionRateLimiter.ts         # Rate limiting multi-tenant
│
└── utils/
    └── TimeHelpers.ts                # getLastHourStart, etc.
```

### Beneficios

1. **Screaming Architecture**: La estructura de carpetas "grita" qué hace cada parte
2. **Testabilidad**: Cada procesador puede testearse independientemente
3. **Mantenibilidad**: Archivos de ~100-200 líneas vs 2000+ líneas
4. **Extensibilidad**: Agregar nueva cola = nuevo archivo en `types/jobs/` + `processors/`
5. **Separación de concerns**: Infraestructura vs Lógica de procesamiento

### Plan de Implementación

**Fase 1: Extracción de Tipos (0.5 días)**
- Crear estructura de carpetas `types/` y `types/jobs/`
- Mover `QueueName` enum a `types/QueueName.ts`
- Mover interfaces de jobs a archivos individuales

**Fase 2: Extracción de Procesadores (1.5 días)**
- Crear interface `IJobProcessor` en `processors/`
- Extraer cada método `process*` a su propio archivo
- Inyectar dependencias via constructor

**Fase 3: Extracción de Rate Limiting (0.5 días)**
- Crear `SessionRateLimiter` en `rate-limiting/`
- Mover `checkRateLimit` y `getRateLimitStatus`

**Fase 4: Extracción de Configuración (0.5 días)**
- Crear `QueueConfig.ts` con definiciones de colas
- Crear `WorkerRegistry.ts` con configuración de workers
- Extraer `ScheduledJobsInitializer` a `scheduling/`

**Fase 5: Verificación (1 día)**
- Ejecutar suite completa de tests
- Verificar que `MessageQueue.ts` queda en ~400 líneas
- Actualizar documentación

### Estrategia de Migración Segura

1. **No cambiar API pública**: `getMessageQueue()` y métodos `add*` mantienen firma
2. **Refactor incremental**: Una fase a la vez, tests después de cada fase
3. **Feature flags NO necesarios**: Cambio interno, API externa intacta

### Riesgos

| Riesgo | Probabilidad | Mitigación |
|--------|--------------|------------|
| Tests de integración fallan | Media | Ejecutar después de cada fase |
| Imports circulares | Baja | Estructura de dependencias clara |
| Merge conflicts | Media | Hacer en branch dedicado, mergear rápido |

### Decisión

**Estado**: OPCIONAL - La funcionalidad de D25 está completamente implementada sin este refactor.

Se recomienda completar este refactor cuando:
- Haya tiempo disponible sin presión de features nuevas
- Se necesite agregar nuevas colas/workers
- El equipo quiera mejorar la mantenibilidad del código

---

## D28: WebSocket Event Constants Centralization

**Fecha análisis:** 2026-01-14
**Estado:** PARCIALMENTE COMPLETADO (File events done, others pending)
**Prioridad:** MEDIA
**Estimación:** 2-3 días

### Descripción

Los eventos WebSocket están hardcodeados como magic strings en múltiples archivos. Esto dificulta:
1. Refactoring seguro (renombrar eventos requiere buscar strings)
2. Autocompletado de IDE
3. Type safety en discriminated unions

### Progreso

✅ **File Events** (D25 Sprint 3 - 2026-01-14):
- Creado `packages/shared/src/constants/websocket-events.ts`
- `FILE_WS_CHANNELS`: `file:status`, `file:processing`
- `FILE_WS_EVENTS`: `file:readiness_changed`, `file:permanently_failed`, `file:processing_progress`, `file:processing_completed`, `file:processing_failed`
- Actualizado `FileEventEmitter.ts`, `file.types.ts`, y tests

⏳ **Pendientes** (por categoría):

#### Session Events
| Evento | Dirección | Archivos |
|--------|-----------|----------|
| `session:join` | Client → Server | server.ts, tests |
| `session:leave` | Client → Server | server.ts, tests |
| `session:joined` | Server → Client | server.ts, tests |
| `session:left` | Server → Client | server.ts, tests |
| `session:error` | Server → Client | server.ts, tests |
| `session:ready` | Server → Client | server.ts |

#### Agent Events
| Evento | Dirección | Archivos |
|--------|-----------|----------|
| `agent:event` | Server → Client | ChatMessageHandler.ts, ApprovalManager.ts, tests |
| `agent:error` | Server → Client | ChatMessageHandler.ts, tests |
| `agent:thinking` | Server → Client | server.socket.test.ts |
| `agent:message_complete` | Server → Client | server.socket.test.ts |
| `agent:tool_use` | Server → Client | server.socket.test.ts |
| `agent:complete` | Server → Client | server.socket.test.ts |

#### Approval Events
| Evento | Dirección | Archivos |
|--------|-----------|----------|
| `approval:response` | Client → Server | tests |
| `approval:error` | Server → Client | server.ts, tests |
| `approval:resolved` | Server → Client | server.socket.test.ts |

#### Chat Events
| Evento | Dirección | Archivos |
|--------|-----------|----------|
| `chat:message` | Client → Server | tests |

#### Todo Events
| Evento | Dirección | Archivos |
|--------|-----------|----------|
| `todo:created` | Server → Client | TodoManager.ts |
| `todo:completed` | Server → Client | TodoManager.ts |
| `todo:updated` | Server → Client | TodoManager.ts |

#### Connection Events
| Evento | Dirección | Archivos |
|--------|-----------|----------|
| `connected` | Server → Client | SocketIOServerFactory.ts |
| `pong` | Server → Client | SocketIOServerFactory.ts |

### Estructura Propuesta

```typescript
// packages/shared/src/constants/websocket-events.ts

// Ya implementado:
export const FILE_WS_CHANNELS = { ... };
export const FILE_WS_EVENTS = { ... };

// Por implementar:
export const SESSION_WS_EVENTS = {
  JOIN: 'session:join',
  LEAVE: 'session:leave',
  JOINED: 'session:joined',
  LEFT: 'session:left',
  ERROR: 'session:error',
  READY: 'session:ready',
} as const;

export const AGENT_WS_EVENTS = {
  EVENT: 'agent:event',
  ERROR: 'agent:error',
  THINKING: 'agent:thinking',
  MESSAGE_COMPLETE: 'agent:message_complete',
  TOOL_USE: 'agent:tool_use',
  COMPLETE: 'agent:complete',
} as const;

export const APPROVAL_WS_EVENTS = {
  RESPONSE: 'approval:response',
  ERROR: 'approval:error',
  RESOLVED: 'approval:resolved',
} as const;

export const CHAT_WS_EVENTS = {
  MESSAGE: 'chat:message',
} as const;

export const TODO_WS_EVENTS = {
  CREATED: 'todo:created',
  COMPLETED: 'todo:completed',
  UPDATED: 'todo:updated',
} as const;
```

### Plan de Implementación

1. **Fase 1**: Agregar constantes para cada categoría
2. **Fase 2**: Actualizar server.ts (session events)
3. **Fase 3**: Actualizar ChatMessageHandler.ts y ApprovalManager.ts (agent events)
4. **Fase 4**: Actualizar TodoManager.ts (todo events)
5. **Fase 5**: Actualizar todos los tests

---

## Criterios de Priorización

### Alta Prioridad
- Bugs críticos (race conditions, memory leaks)
- Seguridad (auth, encryption)
- Bloqueadores para producción

### Media Prioridad
- Features que mejoran UX significativamente
- Optimizaciones con ROI claro
- Technical debt con riesgo moderado

### Baja Prioridad
- Nice-to-have features
- Optimizaciones especulativas
- Technical debt con workaround viable

---

*Última actualización: 2026-01-14*
