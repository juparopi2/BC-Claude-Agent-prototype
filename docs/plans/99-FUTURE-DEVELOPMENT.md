# Deuda Técnica y Desarrollos Futuros

**Fecha**: 2026-01-14
**Estado**: Aprobado (Limpiado)

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

## Posponer para Fases Futuras (Phase 6)

### D8: Dynamic Model Selection

**Descripción:**
Permitir al usuario elegir entre diferentes modelos de Claude (Opus, Sonnet, Haiku).

**Requisitos:**
- Frontend: Dropdown de selección de modelo
- Backend: Pasar model ID a orchestratorGraph
- DB: Guardar model usado en message_events

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
    await orchestrator.runGraph(...);
    await redisClient.quit();
    await orchestrator.runGraph(...);
    const events = await getEventsFromDB();
    expect(events.map(e => e.sequence_number)).toEqual([0, 1, 2, 3]);
  });
});
```

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
  cleanupExpiredApprovals(): Promise<number>;
}
```

**Requisitos:**
- DB table: `pending_approvals` (TTL 5 minutos)
- Cron job para cleanup cada minuto
- WebSocket event: `approval_expired`

**Prioridad:** Alta
**Estimación:** 5 días

---

### D19: Refactor E2E Tests - Nueva Filosofía

**Estado:** Documentado - Pendiente Implementación
**Prioridad:** ALTA
**Estimación:** 5-7 días

#### Contexto del Problema

Los E2E tests actuales tienen **56 failures** al ejecutar con `E2E_USE_REAL_API=true`.
Esto NO son bugs del sistema - son diferencias entre expectations hardcoded y comportamiento real de Claude API.

#### Nueva Filosofía de Tests E2E

1. **NO Verificar Contenido Específico** - Verificar estructura y consistencia
2. **Capturar Respuesta Real como Ground Truth** - Golden files desde API real
3. **Verificar Flujo Completo End-to-End** - API → Normalización → Persistencia → WebSocket → Reconstrucción

#### Qué Verificar vs Qué NO Verificar

| Verificar (BUENO) | NO Verificar (MALO) |
|-------------------|---------------------|
| Orden de eventos | Contenido de texto |
| Cantidad de tools | Mensaje específico |
| Presencia de thinking | Texto de thinking |
| Tokens consumidos | Valores exactos |
| Sequence numbers | IDs específicos |
| Stop reasons | Timestamps exactos |

#### Gaps Identificados

1. **Gap #1:** No hay Ground Truth de Anthropic (CRÍTICO)
2. **Gap #2:** Sin Validación de Reconstrucción (CRÍTICO)
3. **Gap #3:** Hardcoded Session IDs (ALTA)
4. **Gap #4:** Token Tracking No Implementado (ALTA)
5. **Gap #5:** Thinking Content Sin Validación Real (MEDIA)

#### Plan de Implementación

- **Fase 1 (2 días):** Foundation - Crear golden files, fix sessionIds
- **Fase 2 (2 días):** Reconstruction - Implementar `reconstructMessageFromEvents()`
- **Fase 3 (2 días):** Validation - Token tracking, validación de estructura
- **Fase 4 (1 día):** Cleanup - Eliminar assertions de contenido específico

---

### D26-A: EmbeddingService Tests Env Injection

**Estado:** Documentado - Workaround Aplicado
**Prioridad:** MEDIA
**Estimación:** 1-2 días

#### Problema Actual

Los tests de integración de `EmbeddingService` se saltan silenciosamente cuando se ejecuta la suite completa debido a cómo vitest con `pool: 'forks'` maneja las variables de entorno.

**6 tests NO se ejecutan en suite completa:**
- `should generate real embeddings from Azure OpenAI`
- `should batch generate embeddings`
- `should generate 1024-dimensional embedding for text query`
- `should generate embeddings in same vector space as image embeddings`
- `should handle different text queries correctly`
- `should cache embeddings for repeated queries`

#### Solución Recomendada

Implementar **Opción B** (pasar env via poolOptions):
```typescript
// vitest.integration.config.ts
pool: 'forks',
poolOptions: {
  forks: {
    env: {
      ...process.env,
      AZURE_OPENAI_KEY: process.env.AZURE_OPENAI_KEY,
      REDIS_PASSWORD: process.env.REDIS_PASSWORD,
    }
  }
}
```

---

### D27: MessageQueue Refactor - God File Decomposition

**Estado:** Documentado - Pendiente Implementación
**Prioridad:** ALTA (Architectural Debt)
**Estimación:** 3-5 días

#### Problema Actual

El archivo `MessageQueue.ts` tiene **2039 líneas** y viola múltiples principios de diseño:
- **Violación de SRP**: 12 responsabilidades distintas
- **God File Anti-Pattern**: Concentra demasiada lógica
- **Lógica de negocio en infraestructura**: Procesadores contienen lógica de dominio

#### Estructura Propuesta

```
backend/src/infrastructure/queue/
├── index.ts
├── MessageQueue.ts              # Core (~400 líneas)
├── QueueConfig.ts
├── WorkerRegistry.ts
├── types/
│   ├── QueueName.ts
│   └── jobs/*.ts
├── processors/
│   ├── IJobProcessor.ts
│   └── *Processor.ts
├── scheduling/
│   └── ScheduledJobsInitializer.ts
├── rate-limiting/
│   └── SessionRateLimiter.ts
└── utils/
    └── TimeHelpers.ts
```

#### Plan de Implementación

- **Fase 1 (0.5 días):** Extracción de Tipos
- **Fase 2 (1.5 días):** Extracción de Procesadores
- **Fase 3 (0.5 días):** Extracción de Rate Limiting
- **Fase 4 (0.5 días):** Extracción de Configuración
- **Fase 5 (0.5-1 día):** Verificación

---

### D28: WebSocket Event Constants Centralization

**Estado:** PARCIALMENTE COMPLETADO (File events done)
**Prioridad:** MEDIA
**Estimación:** 2-3 días

#### Progreso

✅ **File Events** completados en D25 Sprint 3
⏳ **Pendientes:** Session, Agent, Approval, Chat, Todo, Connection events

#### Estructura Propuesta

```typescript
// packages/shared/src/constants/websocket-events.ts
export const SESSION_WS_EVENTS = { JOIN, LEAVE, JOINED, LEFT, ERROR, READY } as const;
export const AGENT_WS_EVENTS = { EVENT, ERROR, THINKING, MESSAGE_COMPLETE, TOOL_USE, COMPLETE } as const;
export const APPROVAL_WS_EVENTS = { RESPONSE, ERROR, RESOLVED } as const;
export const CHAT_WS_EVENTS = { MESSAGE } as const;
export const TODO_WS_EVENTS = { CREATED, COMPLETED, UPDATED } as const;
```

---

## Tests Skipped - Pendientes de Implementación

### D14: UNIMPLEMENTED APIs (3 tests) - MANTENER SKIP

| Archivo | Descripción |
|---------|-------------|
| `gdpr.api.test.ts` | GDPR compliance endpoints |
| `billing.api.test.ts` | Billing/subscription management |
| `usage.api.test.ts` | Usage dashboard analytics |

**Justificación:** Placeholder tests para features futuras. Los endpoints NO existen aún.
**Estimación:** 5-7 días (cuando se implementen)

### D15: UNIMPLEMENTED Features (1 test) - PARCIALMENTE RESUELTO

| Archivo | Descripción |
|---------|-------------|
| `approval-flow.e2e.test.ts` | Full approval flow E2E con WebSocket |

**Estimación:** 3-5 días (post-refactor ApprovalManager)

### D18: Technical Issues (1 test) - PENDIENTE

| Archivo | Descripción |
|---------|-------------|
| `performance.test.ts` | Tests de carga (100+ requests, P95/P99 latency) |

**Justificación:** Tests resource-intensive para entorno de benchmark dedicado.
**Estimación:** 1 día (infraestructura de benchmark)

---

## Desarrollos Multi-Provider (Phase 7)

### Azure OpenAI Support

**Descripción:** Agregar soporte para Azure OpenAI como provider alternativo.

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

**Prioridad:** Alta
**Estimación:** 10 días

---

### Google Gemini Support

**Descripción:** Agregar soporte para Google Gemini.

**Prioridad:** Media
**Estimación:** 10 días

---

### Prompt Caching

**Descripción:** Usar Anthropic Prompt Caching para reducir costos y latencia.

**Beneficios:**
- 90% reducción de costos en input tokens cacheados
- 50% reducción de latencia en requests con cache hit

**Prioridad:** Alta
**Estimación:** 3 días

---

### Batch API Support

**Descripción:** Para operaciones no interactivas (e.g., análisis bulk de documentos).

**Use case:** Usuario sube 100 documentos y pide "analizar todos".

**Prioridad:** Baja
**Estimación:** 5 días

---

## Analytics Dashboard (Phase 8)

### Métricas Avanzadas

**Descripción:** Dashboard de analytics para admins.

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

**Prioridad:** Media
**Estimación:** 10 días

---

## Registro de Deuda Técnica

| ID | Descripción | Fase | Prioridad | Días | Estado |
|----|-------------|------|-----------|------|--------|
| **D1** | Race condition EventStore | Phase 5C | Alta | 1-2 | Pendiente |
| D8 | Dynamic model selection | Phase 6 | Media | 2 | Pendiente |
| D9 | WebSocket usage alerts | Phase 6 | Baja | 1 | Pendiente |
| D10 | Message replay | Phase 6 | Baja | 3 | Pendiente |
| D11 | Tool execution queue | Phase 6 | Media | 4 | Pendiente |
| D13 | Redis chaos tests | Phase 6 | Media | 2 | Pendiente |
| D14 | Unimplemented APIs | Phase 6+ | Media | 5-7 | Pendiente |
| D15 | Approval E2E tests | Phase 6+ | Media | 1-2 | Pendiente |
| D18 | Performance tests infra | Phase 6+ | Media | 1 | Pendiente |
| **D19** | Refactor E2E Tests | Phase 6 | ALTA | 5-7 | Pendiente |
| - | ApprovalManager completo | Phase 6 | Alta | 5 | Pendiente |
| **D26-A** | EmbeddingService env injection | Phase 6 | Media | 1-2 | Pendiente |
| **D27** | MessageQueue refactor | Phase 6 | ALTA | 3-5 | Pendiente |
| **D28** | WebSocket constants | Phase 6 | Media | 2-3 | Parcial |
| - | Azure OpenAI support | Phase 7 | Alta | 10 | Pendiente |
| - | Google Gemini support | Phase 7 | Media | 10 | Pendiente |
| - | Prompt Caching | Phase 7 | Alta | 3 | Pendiente |
| - | Batch API | Phase 7 | Baja | 5 | Pendiente |
| - | Analytics Dashboard | Phase 8 | Media | 10 | Pendiente |

**Total estimado Phase 6:** ~25-30 días
**Total estimado Phase 7:** ~28 días
**Total estimado Phase 8:** ~10 días

---

## Desarrollos Completados (Historial)

Los siguientes desarrollos han sido completados y removidos de este documento:

| ID | Descripción | Fecha Completado |
|----|-------------|------------------|
| D20 | Duplicate File Detection & Management | 2026-01-13 |
| D21 | File Deletion Cascade (3/4 gaps, Redis opcional) | 2026-01-13 |
| D22 | Orphan Cleanup Job | 2026-01-13 |
| D23 | Post-Delete Verification (BY DESIGN via D22) | 2026-01-13 |
| D24 | UserId Case Sensitivity in AI Search | 2026-01-13 |
| D25 | Robust File Processing System (Sprints 1-4) | 2026-01-14 |
| D26 | Multimodal RAG with Reranker & Image Captioning | 2026-01-13 |

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
