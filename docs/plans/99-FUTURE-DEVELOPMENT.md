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

## URGENTE - Siguiente Prioridad

### D2: Semantic Image Search (Core Feature) - SIMPLIFICADO

**Prioridad:** CRÍTICA
**Estimación:** 4-5 días
**Impacto:** Búsqueda semántica de imágenes por concepto visual (funcionalidad core del negocio)

> **PRD Completo:** Ver `/docs/plans/image-search/` para documentación detallada con TDD specs.

**Problema Actual:**

El sistema RAG tiene un GAP CRÍTICO en el pipeline de imágenes:
- ✅ `ImageProcessor.ts` genera embedding 1024d via Azure Computer Vision
- ❌ El embedding **NO se persiste** en BD ni en Azure AI Search
- ❌ `FileChunkingService.ts` marca imágenes como "completed" pero **NO las indexa**
- ❌ `schema.ts` solo soporta 1536d (text embeddings)

```typescript
// FileChunkingService.ts - línea ~114-128
if (IMAGE_MIME_TYPES.has(mimeType)) {
  await this.updateEmbeddingStatus(fileId, 'completed');  // ⚠️ FALSO POSITIVO
  return { fileId, chunkCount: 0, totalTokens: 0 };       // ⚠️ EMBEDDING PERDIDO
}
```

**Caso de Uso Real:**
- Cliente vende cajas de metal y piezas de camión (10,000+ imágenes)
- Usuario busca "cajas metálicas" o "acoplamientos" por concepto visual
- Sistema debe devolver imágenes visualmente similares **SIN depender de OCR**

**Solución: Multimodal RAG Simplificado**

Usar Azure Computer Vision Multimodal Embeddings que proyecta **imágenes y texto al mismo espacio vectorial 1024d**:

```
┌─────────────────────────────────────────────────────────┐
│                    Azure Vision API                      │
│  ┌─────────────────┐      ┌─────────────────────────┐  │
│  │ VectorizeImage  │      │    VectorizeText        │  │
│  │  (imagen.jpg)   │      │ ("cajas metálicas")     │  │
│  └────────┬────────┘      └───────────┬─────────────┘  │
│           │                           │                 │
│           ▼                           ▼                 │
│    [embedding 1024d]          [embedding 1024d]         │
│           │                           │                 │
│           └────────── MISMO ──────────┘                 │
│                    ESPACIO VECTORIAL                    │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│              Azure AI Search (Cosine Similarity)         │
│         Encuentra imágenes similares a query texto       │
└─────────────────────────────────────────────────────────┘
```

**Implementación en 3 Fases:**

| Fase | Días | Entregable |
|------|------|------------|
| **1: Persistencia** | 1.5 | Nueva tabla `image_embeddings`, actualizar `ImageProcessor` |
| **2: Indexación** | 2 | Nuevo campo `imageVector` en Azure AI Search (1024d), `ImageSearchService` |
| **3: Query** | 1 | Endpoint `/api/files/search/images`, integración con RAG Agent |

**Por Qué NO OCR:**
- OCR es para texto en imágenes → No aplica a productos visuales
- El cliente necesita **similitud visual**, no extracción de texto
- OCR puede agregarse en fase futura si se requiere (complementario)

**Costos:**
- Image embedding: $0.0001/imagen (ya definido en `pricing.config.ts`)
- Text query embedding: $0.0001/query
- Azure AI Search: Ya incluido en tier Basic

**Archivos a Modificar:**
- `backend/src/services/files/processors/ImageProcessor.ts` - Persistir embedding
- `backend/src/services/search/schema.ts` - Agregar imageVector 1024d
- `backend/src/services/embeddings/EmbeddingService.ts` - Método `generateQueryEmbedding`
- `backend/src/services/search/VectorSearchService.ts` - Método `searchImages`
- `backend/migrations/00X-create-image-embeddings.sql` - Nueva tabla

**Infraestructura Verificada (AZ CLI):**
- ✅ `cv-bcagent-dev` (Computer Vision S1) → VectorizeImage API
- ✅ `search-bcagent-dev` (Basic) → Soporta múltiples campos vectoriales
- ✅ `models.ts` ya define `image_embedding` role (1024d)
- ✅ `pricing.config.ts` ya tiene costo de image_embedding

---

## Posponer para Fases Futuras

### D3: ~~FakeAnthropicClient - Extended Thinking~~ ✅ OBSOLETO

**Estado:** ELIMINADO - Fase 8 (2025-12-22)

**Motivo:**
`FakeAnthropicClient` fue eliminado durante la migración de Fase 8 (Part 2).
Reemplazado por `FakeAgentOrchestrator` que trabaja a nivel de orquestación y soporta
thinking mediante `FakeScenario.thinkingContent`.

**Nuevo enfoque:**
```typescript
// FakeAgentOrchestrator.setResponse()
fakeOrchestrator.setResponse({
  thinkingContent: 'Let me analyze this...',
  textBlocks: ['Here is my response'],
  stopReason: 'end_turn',
});
```

**Archivos eliminados:**
- `backend/src/services/agent/FakeAnthropicClient.ts`
- `backend/src/services/agent/IAnthropicClient.ts`

**Archivos nuevos:**
- `backend/src/domains/agent/orchestration/FakeAgentOrchestrator.ts` (38 tests)

---

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

### D15: UNIMPLEMENTED Features (3 tests) - ✅ PARCIALMENTE RESUELTO

| Archivo | Descripción | Estado |
|---------|-------------|--------|
| `approval-flow.e2e.test.ts` | Full approval flow E2E con WebSocket | ⏸️ Pendiente refactor |
| `max-tokens.scenario.test.ts` | Manejo de stop_reason: max_tokens | ✅ Habilitado |
| `error-tool.scenario.test.ts` | Manejo de errores en tool execution | ✅ Habilitado |

**Actualización 2025-12-22 (Fase 8 Part 2):**
- `max-tokens.scenario.test.ts`: Skip removido, migrado a FakeAgentOrchestrator
- `error-tool.scenario.test.ts`: Skip removido, migrado a FakeAgentOrchestrator

**Actualización 2025-12-23:**
- `approval-flow.e2e.test.ts`: Mantener skip - ApprovalManager recibirá un refactor significativo.
  El servicio existe pero será reestructurado antes de habilitar estos E2E tests.

**Fase restante:** Phase 6 o posterior (post-refactor ApprovalManager)
**Estimación restante:** 3-5 días (refactor + tests)

### D16: DEPRECATED Tests (3 tests) ✅ ELIMINADOS

Tests eliminados 2025-12-22 por usar API obsoleta `executeQueryStreaming`:
- `DirectAgentService.attachments.integration.test.ts`
- `DirectAgentService.integration.test.ts`
- `thinking-state-transitions.integration.test.ts`

**Estado:** RESUELTO - archivos eliminados del codebase

### D17: TDD RED - Orchestrator Integration (1 test) ✅ COMPLETADO

| Archivo | Descripción | Estado |
|---------|-------------|--------|
| `AgentOrchestrator.integration.test.ts` | Tests de orquestación para nueva arquitectura | ✅ 8 tests pasando |

**Estado:** RESUELTO - AgentOrchestrator implementado en Fase 7 con 38 tests (30 unit + 8 integration)
**Fecha completado:** 2025-12-22

### D18: Technical Issues (2 tests) - PARCIALMENTE RESUELTO

| Archivo | Descripción | Estado |
|---------|-------------|--------|
| `performance.test.ts` | Tests de carga (100+ requests concurrentes, P95/P99 latency) | ⏸️ Skip INTENCIONAL |
| `message-flow.integration.test.ts:186` | WebSocket reliability issue | ✅ RESUELTO 2025-12-23 |

**Actualización 2025-12-23:**
- `message-flow.integration.test.ts`: Corregido - usaba API incorrecta de TestSocketClient
- `performance.test.ts`: **Mantener skip** - Son tests de carga resource-intensive:
  - 100+ requests concurrentes
  - Medición de latencia P95/P99
  - Detección de memory leaks (100MB heap threshold)
  - Deben ejecutarse en entorno de benchmark dedicado, NO en CI/CD

**Fase:** Phase 6 (infrastructure) o posterior
**Estimación:** 1 día (solo infraestructura de benchmark)

---

## Registro de Deuda Técnica

| ID | Descripción | Fase | Prioridad | Días |
|----|-------------|------|-----------|------|
| **D1** | **Race condition EventStore** | **Phase 5C** | **Alta** | **1-2** |
| **D2** | **Semantic Image Search** | **URGENTE** | **CRÍTICA** | **4-5** |
| D3 | ~~FakeAnthropicClient thinking~~ | ~~Phase 6~~ | ✅ | ~~OBSOLETO~~ |
| D8 | Dynamic model selection | Phase 6 | Media | 2 |
| D9 | WebSocket usage alerts | Phase 6 | Baja | 1 |
| D10 | Message replay | Phase 6 | Baja | 3 |
| D11 | Tool execution queue | Phase 6 | Media | 4 |
| D13 | Redis chaos tests | Phase 6 | Media | 2 |
| D14 | Unimplemented APIs (GDPR, billing, usage) | Phase 6+ | Media | 5-7 |
| D15 | ~~Unimplemented Features~~ (solo approval pending) | Phase 6+ | Media | 1-2 |
| D16 | ~~Deprecated Tests~~ | ~~N/A~~ | ✅ | ~~Eliminados~~ |
| D17 | ~~TDD RED - Orchestrator Integration~~ | ~~Phase 7~~ | ✅ | ~~Completado~~ |
| D18 | Technical Issues (performance, websocket) | Phase 6+ | Media | 2-3 |
| **D19** | **Refactor E2E Tests - Nueva Filosofía** | **Phase 6** | **ALTA** | **5-7** |
| - | ApprovalManager completo | Phase 6 | Alta | 5 |
| - | Azure OpenAI support | Phase 7 | Alta | 10 |
| - | Google Gemini support | Phase 7 | Media | 10 |
| - | Prompt Caching | Phase 7 | Alta | 3 |
| - | Batch API | Phase 7 | Baja | 5 |
| - | Analytics Dashboard | Phase 8 | Media | 10 |

**Total estimado URGENTE (D2):** ~4-5 días (1 semana)
**Total estimado Phase 6:** ~32.5-39 días (incluyendo D14, D15, D18, D19)
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
**Estado:** Documentado - Pendiente junto con D2
**Prioridad:** MEDIA (Data Integrity)
**Estimación:** 0.5 días (incluido en D2)

### Estado Actual de Cascadas

| Tabla/Storage | ON DELETE | Implementado |
|---------------|-----------|--------------|
| `files` → `file_chunks` | CASCADE | ✅ DB |
| `files` → `message_file_attachments` | CASCADE | ✅ DB |
| `files` → `image_embeddings` | N/A | ❌ Tabla no existe |
| Azure AI Search (text) | Manual | ✅ `cleanupAISearchEmbeddings()` |
| Azure AI Search (images) | Manual | ❌ No implementado |
| Azure Blob Storage | Manual | ✅ Route handler |

### Gap Crítico

Cuando se implemente `image_embeddings` (D2), debe incluir:

```sql
-- En migración 00X-create-image-embeddings.sql
CONSTRAINT FK_image_embeddings_files
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
```

Y actualizar `FileService.cleanupAISearchEmbeddings()` para:
1. Eliminar de `image_embeddings` table (si no CASCADE)
2. Eliminar documentos de Azure AI Search con `isImage=true`

### Solución

Incluir en PRD de Image Search (`docs/plans/image-search/02-DATABASE-SCHEMA.md`):
- ✅ Ya documentado FK CASCADE en schema propuesto
- Pendiente: Actualizar `FileService.deleteFile()` para cleanup de image embeddings

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

*Última actualización: 2026-01-06 - D2 simplificado: Semantic Image Search (4-5 días vs 6-8 semanas). PRD detallado en `/docs/plans/image-search/`. Enfoque en similitud visual multimodal, NO OCR.*
