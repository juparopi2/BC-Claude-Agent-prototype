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

### D2: Multimodal RAG Search (Core Feature)

**Prioridad:** CRÍTICA
**Estimación:** 6-8 semanas
**Impacto:** Búsqueda de imágenes por contenido (funcionalidad core del negocio)

**Problema Actual:**

El sistema RAG actualmente tiene un GAP CRÍTICO:
- ✅ Documentos de texto (PDF, DOCX, XLSX) → embeddings 1536d → búsqueda funcional
- ❌ Imágenes → embeddings 1024d generados pero **NO indexados**
- ❌ No hay OCR para texto visible en imágenes
- ❌ No hay captions/descripciones automáticas
- ❌ Búsqueda semántica **SOLO funciona para texto**

```typescript
// FileChunkingService.ts - línea ~114
if (IMAGE_MIME_TYPES.has(mimeType)) {
  logger.info('Skipping text chunking for image file');
  return { fileId, chunkCount: 0, totalTokens: 0 };
  // ⚠️ Embedding de imagen generado pero NO indexado!
}
```

**Impacto en Usuarios:**
- Cliente con 10,000 imágenes de productos (cajas de metal, etc.)
- Usuario busca "cajas de 50x30cm" → NO encuentra imágenes relevantes
- Las imágenes tienen texto visible (dimensiones, códigos) pero no es extraído

**Solución Propuesta en 4 Fases:**

```
Fase 1: Image OCR (2 semanas)
├── Agregar Azure Computer Vision Read API en ImageProcessor
├── Extraer texto OCR y almacenar en extracted_text
├── Crear chunks del OCR e indexarlos
└── Resultado: Imágenes con texto visible ahora buscables

Fase 2: Image Captions (1 semana)
├── Agregar Azure Computer Vision Description API
├── Generar descripciones automáticas ("metal box with label")
├── Indexar captions como texto buscable
└── Resultado: Búsqueda semántica por contenido visual

Fase 3: Dual-Index Architecture (2 semanas)
├── Separar índices: textVector (1536d) + imageVector (1024d)
├── Agregar campos: ocrText, imageCaption, detectedObjects
├── Actualizar Azure AI Search schema
└── Resultado: Arquitectura preparada para fusion search

Fase 4: Fusion Search (2 semanas)
├── Implementar algoritmo de fusion ranking
├── Combinar: OCR matches + caption matches + visual similarity
├── Configurar weights (text: 0.4, caption: 0.3, visual: 0.3)
└── Resultado: Búsqueda multimodal completa
```

**Costos Adicionales:**

| Servicio | Costo Actual | Costo Nuevo | Incremento |
|----------|--------------|-------------|------------|
| Por imagen | $0.001 (embedding) | $0.004 (+ OCR + caption) | 4x |
| 10K imágenes | $10 | $40 | +$30 |

**Archivos Afectados:**
- `backend/src/services/files/processors/ImageProcessor.ts`
- `backend/src/services/search/VectorSearchService.ts`
- `backend/src/services/files/FileChunkingService.ts`
- `backend/src/infrastructure/config/models.ts`
- Azure AI Search index schema

**Nota:** Las 3 técnicas (OCR, Captions, Visual) **NO entran en conflicto** - se complementan:
- OCR: Encuentra texto exacto ("50x30cm", "MX-5030")
- Captions: Encuentra contexto semántico ("caja de metal plateada")
- Visual: Encuentra imágenes visualmente similares

---

## Posponer para Fases Futuras

### D3: FakeAnthropicClient - Extended Thinking

**Descripción:**
El `FakeAnthropicClient` actual no soporta extended thinking (blockIndex 0).

**Estado actual:**
```typescript
// FakeAnthropicClient.ts
async *createMessage(params) {
  // Solo emite blockIndex 1 (mensaje)
  yield { type: 'content_block_delta', content: 'response' };
}
```

**Solución propuesta:**
```typescript
async *createMessage(params) {
  // Primero thinking (blockIndex 0)
  yield { type: 'content_block_start', blockIndex: 0, blockType: 'thinking' };
  yield { type: 'content_block_delta', blockIndex: 0, delta: { text: 'Thinking...' } };
  yield { type: 'content_block_stop', blockIndex: 0 };

  // Luego mensaje (blockIndex 1)
  yield { type: 'content_block_start', blockIndex: 1, blockType: 'text' };
  yield { type: 'content_block_delta', blockIndex: 1, delta: { text: 'Response' } };
  yield { type: 'content_block_stop', blockIndex: 1 };
}
```

**Fase:** Phase 6 (testing improvements)

**Prioridad:** Media

**Estimación:** 0.5 días

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

### D14: UNIMPLEMENTED APIs (3 tests)

| Archivo | Descripción | Prioridad |
|---------|-------------|-----------|
| `gdpr.api.test.ts` | GDPR compliance endpoints (delete user data, export) | Media |
| `billing.api.test.ts` | Billing/subscription management endpoints | Media |
| `usage.api.test.ts` | Usage dashboard analytics endpoints | Media |

**Fase:** Phase 6 o posterior
**Estimación:** 5-7 días total

### D15: UNIMPLEMENTED Features (3 tests)

| Archivo | Descripción | Prioridad |
|---------|-------------|-----------|
| `approval-flow.e2e.test.ts` | Full approval flow E2E con WebSocket | Alta |
| `max-tokens.scenario.test.ts` | Manejo de stop_reason: max_tokens | Media |
| `error-tool.scenario.test.ts` | Manejo de errores en tool execution | Media |

**Fase:** Phase 6 o posterior
**Estimación:** 3-4 días total

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

### D18: Technical Issues (3 tests)

| Archivo | Descripción | Prioridad |
|---------|-------------|-----------|
| `performance.test.ts` | Requires benchmark infrastructure | Baja |
| `message-flow.integration.test.ts:186` | WebSocket reliability issue | Media |
| `orchestrator.integration.test.ts` | Counted in D17 | - |

**Fase:** Phase 6 (infrastructure) o posterior
**Estimación:** 2-3 días

---

## Registro de Deuda Técnica

| ID | Descripción | Fase | Prioridad | Días |
|----|-------------|------|-----------|------|
| **D1** | **Race condition EventStore** | **Phase 5C** | **Alta** | **1-2** |
| **D2** | **Multimodal RAG Search** | **URGENTE** | **CRÍTICA** | **30-40** |
| D3 | FakeAnthropicClient thinking | Phase 6 | Media | 0.5 |
| D8 | Dynamic model selection | Phase 6 | Media | 2 |
| D9 | WebSocket usage alerts | Phase 6 | Baja | 1 |
| D10 | Message replay | Phase 6 | Baja | 3 |
| D11 | Tool execution queue | Phase 6 | Media | 4 |
| D13 | Redis chaos tests | Phase 6 | Media | 2 |
| D14 | Unimplemented APIs (GDPR, billing, usage) | Phase 6+ | Media | 5-7 |
| D15 | Unimplemented Features (approval, max-tokens) | Phase 6+ | Alta | 3-4 |
| D16 | ~~Deprecated Tests~~ | ~~N/A~~ | ✅ | ~~Eliminados~~ |
| D17 | ~~TDD RED - Orchestrator Integration~~ | ~~Phase 7~~ | ✅ | ~~Completado~~ |
| D18 | Technical Issues (performance, websocket) | Phase 6+ | Media | 2-3 |
| - | ApprovalManager completo | Phase 6 | Alta | 5 |
| - | Azure OpenAI support | Phase 7 | Alta | 10 |
| - | Google Gemini support | Phase 7 | Media | 10 |
| - | Prompt Caching | Phase 7 | Alta | 3 |
| - | Batch API | Phase 7 | Baja | 5 |
| - | Analytics Dashboard | Phase 8 | Media | 10 |

**Total estimado URGENTE (D2):** ~30-40 días (6-8 semanas)
**Total estimado Phase 6:** ~27.5-32 días (incluyendo D14, D15, D18)
**Total estimado Phase 7:** ~28 días
**Total estimado Phase 8:** ~10 días

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

*Última actualización: 2025-12-22 - Fase 7 Completada, D16 y D17 Resueltos*
