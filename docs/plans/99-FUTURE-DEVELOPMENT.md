# Deuda Técnica y Desarrollos Futuros

**Fecha**: 2025-12-22
**Estado**: Aprobado

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
| ~~D26~~ | ~~Multimodal RAG with Reranker & Image Captioning~~ | ~~Phase 6~~ | ~~CRÍTICA~~ | ~~3-4~~ | ✅ COMPLETADO |

| D8 | Dynamic model selection | Phase 6 | Media | 2 | Pendiente |
| D9 | WebSocket usage alerts | Phase 6 | Baja | 1 |
| D10 | Message replay | Phase 6 | Baja | 3 |
| D11 | Tool execution queue | Phase 6 | Media | 4 |
| D13 | Redis chaos tests | Phase 6 | Media | 2 |
| D14 | Unimplemented APIs (GDPR, billing, usage) | Phase 6+ | Media | 5-7 |
| D15 | Unimplemented Features (solo approval pending) | Phase 6+ | Media | 1-2 |


| D18 | Technical Issues (performance, websocket) | Phase 6+ | Media | 2-3 |
| **D19** | **Refactor E2E Tests - Nueva Filosofía** | **Phase 6** | **ALTA** | **5-7** |
| - | ApprovalManager completo | Phase 6 | Alta | 5 |
| - | Azure OpenAI support | Phase 7 | Alta | 10 |
| - | Google Gemini support | Phase 7 | Media | 10 |
| - | Prompt Caching | Phase 7 | Alta | 3 |
| - | Batch API | Phase 7 | Baja | 5 |
| - | Analytics Dashboard | Phase 8 | Media | 10 |
| **D21** | **File Deletion Cascade (actualizado)** | **Phase 6** | **ALTA** | **2-3** |
| **D22** | **Orphan Cleanup Job** | **Phase 6** | **Media** | **2** |
| D23 | Post-Delete Verification | Phase 6 | Baja | 1 |
| **D24** | **UserId Case Sensitivity (AI Search)** | **Phase 6** | **ALTA** | **0.5** |
| **D25** | **EmbeddingService Tests Env Injection** | **Phase 6** | **MEDIA** | **1-2** |
| **D27** | **MessageQueue Refactor - God File Decomposition** | **Phase 6** | **ALTA** | **3-5** |


**Total estimado Phase 6:** ~41-51 días (incluyendo D14, D15, D18, D19, D21-D25, D27)
**Total estimado Phase 7:** ~28 días
**Total estimado Phase 8:** ~10 días

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

## D20: Duplicate File Detection & Management (UX Critical)

**Fecha análisis:** 2026-01-06
**Estado:** Documentado - Pendiente Implementación
**Prioridad:** ALTA (UX + Cost Savings)
**Estimación:** 3-4 días

### Problema Actual

El sistema NO detecta archivos duplicados durante el upload:

```typescript
// FileUploadService.ts - línea 104-108
public generateBlobPath(userId: string, fileName: string): string {
  const timestamp = Date.now();  // ⚠️ Siempre genera path único
  return `users/${userId}/files/${timestamp}-${sanitizedFileName}`;
}

// FileService.ts - línea 215-264
public async createFileRecord(options: CreateFileOptions): Promise<string> {
  const fileId = randomUUID();  // ⚠️ Siempre crea nuevo registro
  // NO verifica si existe archivo con mismo nombre
  await executeQuery('INSERT INTO files...', params);
}
```

### Impacto

1. **Costos desperdiciados**: Mismo archivo subido N veces = N blobs + N embeddings
2. **UX confusa**: Usuario ve múltiples archivos con mismo nombre
3. **Búsqueda degradada**: Embeddings duplicados afectan relevancia
4. **Storage innecesario**: Azure Blob Storage cobra por GB

### Solución Propuesta

**Fase 1: Backend - Detección (1 día)**
```typescript
// FileService.ts - Nuevo método
async checkDuplicate(userId: string, fileName: string, folderId?: string): Promise<{
  isDuplicate: boolean;
  existingFile?: ParsedFile;
  sameSize?: boolean;
  sameHash?: boolean;
}> {
  const existing = await this.findByName(userId, fileName, folderId);
  if (!existing) return { isDuplicate: false };

  return {
    isDuplicate: true,
    existingFile: existing,
    sameSize: false,  // Future: compare sizes
    sameHash: false,  // Future: compare SHA-256
  };
}
```

**Fase 2: API - Endpoint (0.5 días)**
```typescript
// GET /api/files/check-duplicates
// Body: { files: [{ name: string, size: number }], folderId?: string }
// Response: { duplicates: [{ name, existingId, existingSize, action: 'replace'|'skip'|'keep_both' }] }
```

**Fase 3: Frontend - UX (1.5 días)**
```tsx
// DuplicateFileDialog.tsx
interface DuplicateDialogProps {
  duplicates: DuplicateFile[];
  onResolve: (resolutions: DuplicateResolution[]) => void;
}

// Opciones por archivo:
// - "Reemplazar" → DELETE existing + upload new
// - "Saltar" → Skip this file
// - "Conservar ambos" → Rename to "archivo (1).pdf"

// Checkbox: "Aplicar a todos los duplicados"
```

**Fase 4: Hash Verification (1 día - Future)**
```sql
-- Agregar columna a files table
ALTER TABLE files ADD content_hash NVARCHAR(64) NULL;

-- Index para búsqueda rápida
CREATE INDEX IX_files_content_hash ON files(user_id, content_hash);
```

### Archivos Afectados

| Archivo | Cambio |
|---------|--------|
| `backend/src/services/files/FileService.ts` | Método `checkDuplicate()`, `findByName()` |
| `backend/src/routes/files.ts` | Endpoint `/check-duplicates` |
| `frontend/components/files/DuplicateFileDialog.tsx` | NUEVO: Diálogo de resolución |
| `frontend/components/files/FileUploadZone.tsx` | Integrar verificación pre-upload |
| `packages/shared/src/constants/files.ts` | Agregar `DuplicateResolution` type |

---

## D21: File Deletion Cascade Completeness

**Fecha análisis:** 2026-01-06
**Estado:** Documentado - ACTUALIZADO con auditoría 2026-01-06
**Prioridad:** ALTA (Data Integrity + GDPR)
**Estimación:** 2-3 días

### Inventario Completo de Storage Points (Auditoría 2026-01-06)

| Storage | Tabla/Índice | Cascade | Estado | Archivo Responsable |
|---------|-------------|---------|--------|---------------------|
| SQL Server | `files` | N/A (source of truth) | OK | - |
| SQL Server | `file_chunks` | FK CASCADE | ✅ OK | `migrations/003-create-files-tables.sql:64` |
| SQL Server | `message_file_attachments` | FK CASCADE | ✅ OK | `migrations/003-create-files-tables.sql:87` |
| SQL Server | `image_embeddings` | FK CASCADE | ✅ OK | `migrations/007-create-image-embeddings.sql:28-29` |
| Azure AI Search | `file-chunks-index` (text) | Manual | ✅ `deleteChunksForFile()` | `services/search/VectorSearchService.ts:301-317` |
| Azure AI Search | `file-chunks-index` (images) | Manual | ✅ Usa mismo filtro (fileId+userId) | `services/search/VectorSearchService.ts:312` |
| Azure Blob Storage | `users/{userId}/files/` | Manual | ✅ Route handler | `routes/files.ts:862-926` |
| Redis Cache | N/A | N/A | ❌ NO implementado | - |

### Gaps Identificados

1. **Eventual Consistency en AI Search**: Si Azure AI Search está caído durante eliminación, los documentos quedan huérfanos
   - Código menciona "orphan cleanup job" pero NO existe (`FileService.ts:606`)
2. **No hay verificación post-delete**: No se confirma que AI Search realmente eliminó los documentos
3. **UserId Case Sensitivity**: AI Search almacena userId en MAYÚSCULAS, posible mismatch con consultas
4. **Redis Cache no se limpia**: Campo `deleted_from_cache` en audit siempre es false

### Auditoría Realizada 2026-01-06

Se encontraron y eliminaron **139 documentos huérfanos** en Azure AI Search:
- 5 fileIds huérfanos de archivos eliminados previamente
- Causa: Archivos eliminados antes de implementar `cleanupAISearchEmbeddings()`
- Limpieza manual via Azure CLI

### Solución Propuesta

Ver D22 (Orphan Cleanup Job) y D23 (Post-Delete Verification)

---

## D22: Orphan Cleanup Job

**Fecha análisis:** 2026-01-06
**Estado:** Nuevo - Documentado
**Prioridad:** MEDIA
**Estimación:** 2 días

### Descripción

Job programado para detectar y eliminar documentos huérfanos en Azure AI Search.

### Requisitos

1. Ejecutar semanalmente o bajo demanda
2. Para cada usuario con documentos en AI Search:
   - Obtener lista de `fileId` únicos de AI Search
   - Comparar con `files` tabla en SQL
   - Eliminar documentos cuyo `fileId` no existe en SQL
3. Logging de documentos eliminados para auditoría

### Implementación Propuesta

```typescript
// backend/src/jobs/OrphanCleanupJob.ts
async cleanOrphans(userId: string): Promise<number> {
  // 1. Get fileIds from AI Search
  const searchFileIds = await vectorSearchService.getUniqueFileIds(userId);

  // 2. Get fileIds from SQL
  const sqlFileIds = await fileRepository.getFileIdsByUser(userId);

  // 3. Find orphans (in AI Search but not in SQL)
  const orphanFileIds = searchFileIds.filter(id => !sqlFileIds.includes(id));

  // 4. Delete orphans
  for (const fileId of orphanFileIds) {
    await vectorSearchService.deleteChunksForFile(fileId, userId);
  }

  return orphanFileIds.length;
}
```

### Archivos a Crear/Modificar

- `backend/src/jobs/OrphanCleanupJob.ts` - NUEVO
- `backend/src/services/search/VectorSearchService.ts` - Agregar `getUniqueFileIds()`

---

## D23: Post-Delete Verification

**Fecha análisis:** 2026-01-06
**Estado:** Nuevo - Documentado
**Prioridad:** BAJA
**Estimación:** 1 día

### Descripción

Verificar que los documentos fueron realmente eliminados de Azure AI Search después de `deleteChunksForFile()`.

### Requisitos

1. Después de eliminar, consultar AI Search para confirmar 0 documentos con ese `fileId`
2. Si hay documentos restantes, reintentar eliminación (max 3 intentos)
3. Si persisten, loggear warning y actualizar audit status a `partial`

### Implementación Propuesta

```typescript
// En VectorSearchService.deleteChunksForFile()
async deleteChunksForFile(fileId: string, userId: string): Promise<void> {
  await this.deleteByQuery(options);

  // Verify deletion
  const remaining = await this.countDocuments(fileId, userId);
  if (remaining > 0) {
    logger.warn({ fileId, userId, remaining }, 'Documents still exist after deletion');
    // Retry or alert
  }
}
```

---

## D24: UserId Case Sensitivity in AI Search

**Fecha análisis:** 2026-01-06
**Estado:** Nuevo - Documentado
**Prioridad:** ALTA (Bug potencial)
**Estimación:** 0.5 días

### Descripción

Azure AI Search almacena `userId` en MAYÚSCULAS (ej: `BCD5A31B-C560-40D5-972F-50E134A8389D`), pero las consultas pueden usar minúsculas (ej: `bcd5a31b-c560-40d5-972f-50e134a8389d`). Esto causa que el filtro `userId eq '...'` no encuentre documentos.

### Evidencia

- Auditoría 2026-01-06: Consulta con minúsculas retornó 0 docs, con mayúsculas retornó 141 docs
- SQL Server retorna UUIDs en mayúsculas, pero sesión de usuario puede normalizar a minúsculas

### Solución Propuesta

Normalizar `userId` a mayúsculas antes de:
1. Indexar documentos (`indexChunk`, `indexImageEmbedding`)
2. Buscar documentos (`search`, `searchImages`, `deleteChunksForFile`)

```typescript
// En VectorSearchService
private normalizeUserId(userId: string): string {
  return userId.toUpperCase();
}
```

### Archivos a Modificar

- `backend/src/services/search/VectorSearchService.ts` - Todas las operaciones que usan `userId`

---

## D25: EmbeddingService Integration Tests - Environment Variable Injection

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

*Última actualización: 2026-01-13*
