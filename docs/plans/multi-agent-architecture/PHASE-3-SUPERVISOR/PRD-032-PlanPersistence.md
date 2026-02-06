# PRD-032: Durable Persistence + Agent Analytics

**Estado**: ✅ COMPLETADO (2026-02-06)
**Prioridad**: Alta
**Dependencias**: PRD-030 (Supervisor Integration)
**Desbloquea**: PRD-040 (Handoffs), PRD-050 (Graphing Agent), PRD-060/061 (UI)

---

## 1. Objetivo

Reemplazar `MemorySaver` (in-memory, volátil) con persistencia durable usando un **checkpointer custom para MSSQL** (`MSSQLSaver`), ya que el proyecto usa Azure SQL y no PostgreSQL. Adicionalmente, implementar un servicio de analytics para tracking de uso de agentes.

**Problema resuelto**: Conversaciones se perdían al reiniciar el servidor. Ahora el estado del grafo persiste en Azure SQL y puede resumirse entre reinicios.

---

## 2. Arquitectura Implementada

```
┌─────────────────────────────────────────────────┐
│              Supervisor Graph                   │
│                                                 │
│  invoke() ─────► state changes ─────► events   │
│                       │                         │
└───────────────────────┼─────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────┐
│        MSSQLSaver (Custom Checkpointer)         │
│                                                 │
│  Extends BaseCheckpointSaver from               │
│  @langchain/langgraph-checkpoint                │
│                                                 │
│  - Prisma Client for database access            │
│  - Envelope serialization (type + data)         │
│  - v<4 checkpoint migration support             │
│  - Idempotent writes                            │
│                                                 │
│  Tables (via Prisma schema):                    │
│  - langgraph_checkpoints (composite PK)         │
│  - langgraph_checkpoint_writes (composite PK)   │
└─────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────┐
│        AgentAnalyticsService                    │
│                                                 │
│  - MERGE upsert for atomic increments           │
│  - Fire-and-forget (never blocks main flow)     │
│  - Prisma $executeRaw for MSSQL MERGE           │
│                                                 │
│  Table: agent_usage_analytics                   │
│  API: GET /api/analytics/agents                 │
│       GET /api/analytics/agents/:id/daily       │
└─────────────────────────────────────────────────┘
```

---

## 3. Decisión: Custom MSSQL vs PostgresSaver

El PRD original proponía `PostgresSaver` de `@langchain/langgraph-checkpoint-postgres`, pero:
- El proyecto usa **Azure SQL (MSSQL)**, no PostgreSQL
- No existe un checkpointer oficial de LangGraph para MSSQL
- Se implementó `MSSQLSaver` extendiendo `BaseCheckpointSaver` de `@langchain/langgraph-checkpoint`

**No se requirió instalar ningún paquete nuevo** - `@langchain/langgraph-checkpoint` ya estaba instalado como dependencia transitiva de `@langchain/langgraph`.

---

## 4. MSSQLSaver - Implementación

### 4.1 Archivo: `backend/src/infrastructure/checkpointer/MSSQLSaver.ts`

Extiende `BaseCheckpointSaver` con los 5 métodos abstractos:

| Método | Descripción |
|--------|-------------|
| `getTuple(config)` | Recupera checkpoint por thread_id + checkpoint_id (o el más reciente) |
| `list(config, options)` | AsyncGenerator de checkpoints con filtrado y paginación |
| `put(config, checkpoint, metadata, versions)` | Almacena checkpoint con upsert |
| `putWrites(config, writes, taskId)` | Almacena pending writes (idempotente) |
| `deleteThread(threadId)` | Elimina todos los datos de un thread |

### 4.2 Serialización

Formato envelope custom: `[4 bytes longitud][tipo UTF-8][datos serializados]`
- Usa `this.serde.dumpsTyped()` / `this.serde.loadsTyped()` (heredado de BaseCheckpointSaver)
- Almacena como `VarBinary(Max)` en MSSQL via Prisma `Bytes`

### 4.3 Migración v<4

Soporte para `_migratePendingSends()` que carga writes TASKS del checkpoint padre para compatibilidad con checkpoints antiguos.

### 4.4 Barrel Export: `backend/src/infrastructure/checkpointer/index.ts`

```typescript
export async function initializeCheckpointer(): Promise<MSSQLSaver>
export function getCheckpointer(): MSSQLSaver
```

---

## 5. AgentAnalyticsService - Implementación

### 5.1 Archivo: `backend/src/domains/analytics/AgentAnalyticsService.ts`

| Método | Descripción |
|--------|-------------|
| `recordInvocation(metrics)` | Fire-and-forget; MERGE upsert atómico vía `$executeRaw` |
| `getUsageSummary(start, end)` | Agregación por agente con `groupBy` |
| `getDailyUsage(agentId, days)` | Uso diario con `findMany` + date filter |

### 5.2 MERGE Upsert

Prisma no soporta increment atómico en upsert. Se usa `$executeRaw` con MERGE:

```sql
MERGE agent_usage_analytics AS target
USING (SELECT @date AS date, @agentId AS agent_id) AS source
ON target.date = source.date AND target.agent_id = source.agent_id
WHEN MATCHED THEN UPDATE SET invocation_count = invocation_count + 1, ...
WHEN NOT MATCHED THEN INSERT (...) VALUES (...)
```

---

## 6. API Endpoints

### `GET /api/analytics/agents`
- **Auth**: `authenticateMicrosoft`
- **Query**: `startDate`, `endDate` (ISO date strings, requeridos)
- **Response**: `{ summary: AgentUsageSummary[] }`

### `GET /api/analytics/agents/:id/daily`
- **Auth**: `authenticateMicrosoft`
- **Query**: `days` (default: 30, max: 365)
- **Response**: `{ agentId, usage: DailyUsage[] }`

---

## 7. Prisma Schema Changes

### Eliminado
- `checkpoints` model (legacy, no usado por ningún código)
- `checkpoints checkpoints[]` relation en `sessions`

### Agregado

```prisma
model langgraph_checkpoints {
  thread_id            String   @db.NVarChar(255)
  checkpoint_ns        String   @default("") @db.NVarChar(255)
  checkpoint_id        String   @db.NVarChar(255)
  parent_checkpoint_id String?  @db.NVarChar(255)
  checkpoint_data      Bytes    @db.VarBinary(Max)
  metadata             Bytes    @db.VarBinary(Max)
  created_at           DateTime @default(dbgenerated("getutcdate()"))
  @@id([thread_id, checkpoint_ns, checkpoint_id])
  @@index([thread_id, checkpoint_ns, created_at(sort: Desc)])
}

model langgraph_checkpoint_writes {
  thread_id     String @db.NVarChar(255)
  checkpoint_ns String @default("") @db.NVarChar(255)
  checkpoint_id String @db.NVarChar(255)
  task_id       String @db.NVarChar(255)
  idx           Int
  channel       String @db.NVarChar(255)
  type          String @db.NVarChar(255)
  value         Bytes  @db.VarBinary(Max)
  @@id([thread_id, checkpoint_ns, checkpoint_id, task_id, idx])
}

model agent_usage_analytics {
  id                  String   @id @default(dbgenerated("newid()")) @db.UniqueIdentifier
  date                DateTime @db.Date
  agent_id            String   @db.NVarChar(100)
  invocation_count    Int      @default(0)
  success_count       Int      @default(0)
  error_count         Int      @default(0)
  total_input_tokens  BigInt   @default(0)
  total_output_tokens BigInt   @default(0)
  total_latency_ms    BigInt   @default(0)
  min_latency_ms      Int?
  max_latency_ms      Int?
  created_at          DateTime @default(dbgenerated("getutcdate()"))
  updated_at          DateTime @default(dbgenerated("getutcdate()"))
  @@unique([date, agent_id])
  @@index([date])
  @@index([agent_id])
}
```

---

## 8. Integration con Supervisor Graph

### supervisor-graph.ts Changes
- `MemorySaver` import eliminado, reemplazado por `getCheckpointer()` de `@/infrastructure/checkpointer`
- Analytics recording añadido alrededor de `compiledSupervisor.invoke()`:
  - Mide `latencyMs` con `Date.now()` antes/después
  - Detecta `agentId` via `detectAgentIdentity(result.messages)`
  - Fire-and-forget: `getAgentAnalyticsService().recordInvocation({...})`
  - Registra tanto invocaciones exitosas como fallidas

### server.ts Changes
- `initializeCheckpointer()` se ejecuta **antes** de `initializeSupervisorGraph()`
- Route `/api/analytics` registrado (requiere database)

### Startup Order
```
1. initializeCheckpointer()    ← NEW
2. registerAgents()            (existing)
3. initializeSupervisorGraph() (existing, now uses MSSQLSaver)
```

---

## 9. Archivos

### Nuevos (7)
| Archivo | Propósito |
|---------|-----------|
| `backend/src/infrastructure/checkpointer/MSSQLSaver.ts` | Custom LangGraph checkpointer para MSSQL |
| `backend/src/infrastructure/checkpointer/index.ts` | Inicialización + singleton |
| `backend/src/domains/analytics/AgentAnalyticsService.ts` | Servicio de tracking de uso |
| `backend/src/domains/analytics/index.ts` | Barrel export + singleton |
| `backend/src/routes/analytics.ts` | REST API para analytics |
| `backend/src/__tests__/unit/infrastructure/MSSQLSaver.test.ts` | 21 tests unitarios |
| `backend/src/__tests__/unit/domains/analytics/AgentAnalyticsService.test.ts` | 13 tests unitarios |

### Modificados (4)
| Archivo | Cambio |
|---------|--------|
| `backend/prisma/schema.prisma` | -1 modelo (checkpoints), +3 modelos nuevos |
| `backend/src/modules/agents/supervisor/supervisor-graph.ts` | MemorySaver → MSSQLSaver + analytics |
| `backend/src/server.ts` | +initializeCheckpointer() + analytics route |
| `backend/src/__tests__/unit/agents/supervisor/supervisor-graph.test.ts` | +mocks para checkpointer y analytics |

---

## 10. Tests

| Suite | Tests | Descripción |
|-------|-------|-------------|
| MSSQLSaver | 21 | put, getTuple, list, putWrites, deleteThread, serialization round-trip, idempotency, error handling |
| AgentAnalyticsService | 13 | recordInvocation, getUsageSummary, getDailyUsage, fire-and-forget, BigInt handling |
| **Total nuevos** | **34** | |

### Verificación completa
```bash
npm run verify:types              # ✅ Pasa
npm run -w backend lint           # ✅ 0 errors (59 warnings pre-existentes)
npm run -w backend test:unit      # ✅ 3020 tests, 125 files, 0 failures
```

---

## 11. Criterios de Aceptación ✅

- [x] MSSQLSaver inicializa y persiste checkpoints en Azure SQL
- [x] Estado de conversación persiste entre reinicios del servidor
- [x] Tabla `agent_usage_analytics` registra invocaciones
- [x] API de usage summary funciona correctamente
- [x] Fallos de analytics NO bloquean el flujo principal
- [x] `npm run verify:types` pasa sin errores
- [x] `npm run -w backend test:unit` pasa (3020 tests)
- [x] `npm run -w backend lint` sin errores

---

## 12. Downstream Dependencies Desbloqueadas

| PRD | Qué Necesita de PRD-032 |
|-----|------------------------|
| PRD-040 (Handoffs) | Checkpointer durable para `Command(goto=...)` handoffs |
| PRD-050 (Graphing Agent) | Checkpointer persistente al registrar nuevo agente |
| PRD-060/061 (UI) | API de analytics para dashboards de uso de agentes |

---

## 13. Changelog

| Fecha | Versión | Cambios |
|-------|---------|---------|
| 2026-02-02 | 1.0 | Initial draft con PostgresSaver + analytics |
| 2026-02-06 | 1.1 | Corrección: Import de `createSupervisor` corregido a `@langchain/langgraph-supervisor` |
| 2026-02-06 | 1.2 | PRD-030 completado. Nota: proyecto usa MSSQL, no PostgreSQL. PostgresSaver incompatible. |
| 2026-02-06 | 2.0 | **COMPLETADO**. Implementado `MSSQLSaver` custom checkpointer (extiende `BaseCheckpointSaver`). `AgentAnalyticsService` con MERGE upsert. API endpoints. 34 tests nuevos. 3 tablas Prisma nuevas. `MemorySaver` reemplazado. GAP-002 resuelto. |
