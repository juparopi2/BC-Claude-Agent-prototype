# PRD: Sistema Robusto de Procesamiento de Archivos

> **Identificador**: D25
> **Versión**: 2.0
> **Fecha Inicio**: 2026-01-14
> **Última Actualización**: 2026-01-14
> **Autor**: Claude (CTO/Arquitecto)
> **Estado**: En Progreso (Sprint 1 Completado)

---

## Tabla de Contenidos

1. [Resumen Ejecutivo](#1-resumen-ejecutivo)
2. [Problema](#2-problema)
3. [Solución Propuesta](#3-solución-propuesta)
4. [Filosofía de Implementación](#4-filosofía-de-implementación)
5. [Diseño Técnico](#5-diseño-técnico)
6. [Plan de Sprints](#6-plan-de-sprints)
7. [Registro de Cambios](#7-registro-de-cambios)
8. [Métricas de Éxito](#8-métricas-de-éxito)
9. [Riesgos y Mitigaciones](#9-riesgos-y-mitigaciones)

---

## 1. Resumen Ejecutivo

### 1.1 Objetivo

Implementar un sistema de procesamiento de archivos robusto que proporcione:
- **Visibilidad clara** del estado de procesamiento al usuario
- **Retry automático** con backoff exponencial via BullMQ
- **Cleanup automático** de datos parciales al agotar reintentos
- **Retry manual** para archivos fallidos permanentemente

### 1.2 Alcance

| Componente | Descripción |
|------------|-------------|
| **4 Estados Visuales** | `uploading` → `processing` → `ready` / `failed` |
| **Retry Automático** | BullMQ con backoff exponencial (2 intentos por defecto) |
| **Cleanup Automático** | Rollback de chunks y documentos de búsqueda huérfanos |
| **Retry Manual** | Endpoint POST `/api/files/:id/retry-processing` |
| **Logging Estructurado** | Contexto completo para debugging |

### 1.3 Deuda Técnica Identificada

Durante el análisis se identificaron **God Files** que violan SRP:

| Archivo | Líneas | Problema | Sprint |
|---------|--------|----------|--------|
| `MessageQueue.ts` | 2,061 | 8+ responsabilidades | Sprint 5 (Opcional) |
| `files.ts` (routes) | 1,015 | Lógica de negocio en routes | Sprint 5 (Opcional) |
| `FileService.ts` | 967 | CRUD + búsqueda + procesamiento | Parcial en Sprint 1 |

---

## 2. Problema

### 2.1 UX Actual (Deficiente)

```
┌──────────────────────────────────────────────────────────────┐
│                    PROBLEMA ACTUAL                            │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Usuario sube archivo                                        │
│         │                                                    │
│         ▼                                                    │
│  [Upload completo] ← Usuario ve "archivo listo"              │
│         │                                                    │
│   ┌─────┴─────┐                                              │
│   │ PERO...   │  El backend aún está procesando:             │
│   │ NO ESTÁ   │  • Extracción de texto (10-30s)              │
│   │ LISTO     │  • Chunking (5-10s)                          │
│   │ PARA RAG  │  • Generación de embeddings (10-30s)         │
│   └───────────┘  • Indexación en Azure AI Search             │
│                                                              │
│  ❌ Gap: Usuario piensa que puede usar RAG inmediatamente    │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 Robustez Actual (Deficiente)

- **Sin cleanup**: Cuando el procesamiento falla, quedan datos huérfanos:
  - Chunks sin embeddings
  - Documentos de búsqueda parciales
  - Blobs sin metadata completa

- **Sin retry tracking**: No hay forma de saber cuántas veces ha fallado un archivo

- **Sin retry manual**: El usuario no puede reintentar archivos fallidos

### 2.3 Diagnóstico Actual (Deficiente)

- Logs sin contexto suficiente para debugging
- No hay correlación entre intentos de procesamiento
- Difícil rastrear el ciclo de vida completo de un archivo

---

## 3. Solución Propuesta

### 3.1 Flujo Propuesto

```
┌──────────────────────────────────────────────────────────────┐
│                    FLUJO PROPUESTO                            │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Frontend                    Backend                         │
│  ────────                    ───────                         │
│                                                              │
│  [State: UPLOADING]          Upload to Blob                  │
│  [Progress 0-100%]                │                          │
│         │                         ▼                          │
│         │ ◄──────────────── Insert DB (pending)              │
│         ▼                         │                          │
│  [State: PROCESSING]              ▼                          │
│  [Spinner + opacity]         Enqueue processing              │
│         │                         │                          │
│         │ ◄──────────────── WebSocket: readiness_changed     │
│         │                         │                          │
│         │                    Worker: Process (attempt 1/2)   │
│         │                         │                          │
│         │ ◄──────────────── WebSocket: progress (20%, 50%)   │
│         │                         │                          │
│    ┌────┴────┐               ┌────┴────┐                     │
│    │ SUCCESS │               │ FAILURE │                     │
│    └────┬────┘               └────┬────┘                     │
│         │                         │                          │
│         ▼                         ▼                          │
│  [State: READY]              Retry with backoff              │
│  [Checkmark verde]                │                          │
│                                   ▼                          │
│                              [After max retries]             │
│                                   │                          │
│                                   ▼                          │
│  [State: FAILED]  ◄──────── Cleanup + permanently_failed     │
│  [Error + Retry btn]              │                          │
│         │                         │                          │
│         │ ────────────────► POST /retry-processing           │
│         ▼                         │                          │
│  [State: PROCESSING]              ▼                          │
│                              Reset + re-enqueue              │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 Estado Unificado: `readinessState`

El frontend NO debe calcular el estado basado en `processing_status` + `embedding_status`.
El backend computa un único campo `readinessState` que simplifica la lógica de UI.

```typescript
type FileReadinessState = 'uploading' | 'processing' | 'ready' | 'failed';

// Lógica de computación (backend)
function computeReadinessState(
  processingStatus: ProcessingStatus,
  embeddingStatus: EmbeddingStatus
): FileReadinessState {
  // failed tiene prioridad
  if (processingStatus === 'failed' || embeddingStatus === 'failed') {
    return 'failed';
  }
  // processing si cualquiera no está completado
  if (processingStatus !== 'completed' || embeddingStatus !== 'completed') {
    return 'processing';
  }
  return 'ready';
}
```

---

## 4. Filosofía de Implementación

### 4.1 Test-Driven Development (TDD)

Orden estricto de implementación:

1. **RED**: Escribir tests que fallen
2. **GREEN**: Implementar código mínimo para pasar tests
3. **REFACTOR**: Mejorar sin romper tests

```
tests/
├── unit/                    ← Escribir PRIMERO
│   └── domains/files/
│       ├── ReadinessStateComputer.test.ts
│       ├── ProcessingRetryManager.test.ts
│       └── PartialDataCleaner.test.ts
├── integration/             ← Después de unit tests
│   └── file-processing-pipeline.test.ts
└── e2e/                     ← Al final
    └── file-visual-states.spec.ts
```

### 4.2 Single Responsibility Principle (SRP)

Cada módulo tiene **una sola razón para cambiar**:

| Módulo | Responsabilidad | Razón de Cambio |
|--------|----------------|-----------------|
| `ReadinessStateComputer` | Calcular estado UI | Cambios en lógica de estados |
| `ProcessingRetryManager` | Gestionar reintentos | Cambios en política de retry |
| `PartialDataCleaner` | Limpiar datos huérfanos | Cambios en estrategia de cleanup |

### 4.3 Dependency Injection (DI)

Todos los servicios aceptan dependencias por constructor:

```typescript
// ✅ CORRECTO
export class ProcessingRetryManager {
  constructor(
    private readonly fileService: IFileService,
    private readonly queueManager: IQueueManager,
    private readonly logger: ILogger
  ) {}
}

// ❌ INCORRECTO
export class ProcessingRetryManager {
  private fileService = FileService.getInstance(); // Acoplamiento!
}
```

### 4.4 Event-Driven Architecture

Los cambios de estado emiten eventos para desacoplar componentes:

```typescript
interface FileProcessingEvent {
  type: 'FILE_READINESS_CHANGED' | 'FILE_PROCESSING_FAILED' | ...;
  fileId: string;
  userId: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

// Emisión
eventBus.emit<FileProcessingEvent>({
  type: 'FILE_READINESS_CHANGED',
  fileId,
  userId,
  timestamp: new Date().toISOString(),
  payload: { previousState: 'processing', newState: 'ready' }
});
```

### 4.5 Screaming Architecture

La estructura de carpetas "grita" qué hace el sistema:

```
backend/src/
├── domains/                    # Lógica de negocio pura
│   └── files/
│       ├── status/             # Computación de estados
│       │   └── ReadinessStateComputer.ts
│       ├── processing/         # Orquestación de procesamiento
│       │   └── ProcessingRetryManager.ts
│       ├── cleanup/            # Limpieza de datos
│       │   └── PartialDataCleaner.ts
│       └── events/             # Eventos de dominio
│           └── FileProcessingEvents.ts
│
├── services/                   # Servicios de infraestructura
│   └── files/
│       └── FileService.ts      # CRUD + retry tracking
│
└── infrastructure/
    └── queue/
        └── workers/            # Workers de BullMQ
```

### 4.6 Fail-Fast & Graceful Degradation

```typescript
async processFile(job: FileProcessingJob): Promise<void> {
  // 1. Validar inputs PRIMERO (fail-fast)
  if (!job.fileId) throw new ValidationError('fileId is required');

  // 2. Verificar precondiciones
  const file = await this.fileService.getFile(job.userId, job.fileId);
  if (!file) throw new NotFoundError(`File ${job.fileId} not found`);

  // 3. Graceful degradation para casos edge
  if (file.processingStatus === 'completed') {
    this.logger.warn({ fileId }, 'File already processed, skipping');
    return; // No fallar, simplemente skip
  }

  // 4. Procesar con contexto completo
  // ...
}
```

### 4.7 Logging Estructurado

```typescript
this.logger.info({
  // Identidad
  fileId, userId, jobId: job.id,

  // Contexto
  attemptNumber: job.attemptsMade + 1,
  maxAttempts: job.opts?.attempts ?? 2,
  mimeType, fileName,

  // Timing
  processingStartedAt: new Date().toISOString(),

  // Correlación
  correlationId: job.data.correlationId,
}, 'Starting file processing');
```

---

## 5. Diseño Técnico

### 5.1 Database Schema (Migration)

```sql
-- Migration: 012-add-file-retry-tracking.sql
-- Ejecutada: 2026-01-14 ✅

ALTER TABLE files ADD processing_retry_count INT NOT NULL DEFAULT 0;
ALTER TABLE files ADD embedding_retry_count INT NOT NULL DEFAULT 0;
ALTER TABLE files ADD last_processing_error NVARCHAR(1000) NULL;
ALTER TABLE files ADD last_embedding_error NVARCHAR(1000) NULL;
ALTER TABLE files ADD failed_at DATETIME2 NULL;

-- Índices filtrados para performance
CREATE INDEX IX_files_failed_at ON files(failed_at) WHERE failed_at IS NOT NULL;
CREATE INDEX IX_files_processing_status_pending ON files(user_id, processing_status, created_at)
  WHERE processing_status IN ('pending', 'processing');
CREATE INDEX IX_files_embedding_status_failed ON files(user_id, embedding_status)
  WHERE embedding_status = 'failed';
```

### 5.2 Tipos Actualizados

```typescript
// packages/shared/src/types/file.types.ts

export type FileReadinessState = 'uploading' | 'processing' | 'ready' | 'failed';

export interface ParsedFile {
  // ... campos existentes ...

  // Nuevos campos (D25)
  readinessState: FileReadinessState;
  processingRetryCount: number;
  embeddingRetryCount: number;
  lastError: string | null;
  failedAt: string | null;
}
```

### 5.3 WebSocket Events

```typescript
// Eventos modificados
interface FileProcessingProgressEvent {
  type: 'file:processing_progress';
  fileId: string;
  progress: number;
  attemptNumber: number;    // NUEVO
  maxAttempts: number;      // NUEVO
}

// Eventos nuevos
interface FileReadinessChangedEvent {
  type: 'file:readiness_changed';
  fileId: string;
  readinessState: FileReadinessState;
  processingStatus: ProcessingStatus;
  embeddingStatus: EmbeddingStatus;
}

interface FilePermanentlyFailedEvent {
  type: 'file:permanently_failed';
  fileId: string;
  error: string;
  canRetryManually: boolean;
}
```

### 5.4 API Endpoints

```
POST /api/files/:id/retry-processing
  Body: { scope?: 'full' | 'embedding_only' }
  Response: { file: ParsedFile, jobId: string }
  Errors: 400 (not failed), 404 (not found), 429 (rate limit)
```

---

## 6. Plan de Sprints

### Sprint 1: Backend Foundation ✅ COMPLETADO

**Duración**: 2026-01-14
**Estado**: ✅ Completado

| Tarea | Estado | Archivos |
|-------|--------|----------|
| Tests ReadinessStateComputer (TDD RED) | ✅ | `__tests__/unit/domains/files/ReadinessStateComputer.test.ts` |
| Implementar ReadinessStateComputer | ✅ | `domains/files/status/ReadinessStateComputer.ts` |
| Migration retry tracking | ✅ | `migrations/012-add-file-retry-tracking.sql` |
| Agregar FileReadinessState a shared | ✅ | `packages/shared/src/types/file.types.ts` |
| Modificar parseFile() | ✅ | `backend/src/types/file.types.ts` |
| Agregar métodos retry a FileService | ✅ | `backend/src/services/files/FileService.ts` |
| Type verification | ✅ | `npm run verify:types` |
| Unit tests | ✅ | 2111 tests passing |

**Archivos Creados**:
- `backend/src/domains/files/status/ReadinessStateComputer.ts`
- `backend/src/domains/files/status/index.ts`
- `backend/src/domains/files/index.ts`
- `backend/src/__tests__/unit/domains/files/ReadinessStateComputer.test.ts`
- `backend/migrations/012-add-file-retry-tracking.sql`

**Archivos Modificados**:
- `packages/shared/src/types/file.types.ts` - Agregado `FileReadinessState`
- `packages/shared/src/types/index.ts` - Export de `FileReadinessState`
- `packages/shared/src/index.ts` - Export de `FileReadinessState`
- `backend/src/types/file.types.ts` - Agregado campos retry + `computeReadinessState()`
- `backend/src/services/files/FileService.ts` - 7 nuevos métodos de retry tracking
- `backend/src/__tests__/fixtures/FileFixture.ts` - Actualizado con nuevos campos
- `frontend/__tests__/fixtures/FileFixture.ts` - Actualizado con nuevos campos
- `frontend/__tests__/mocks/handlers.ts` - Actualizado mock data
- `frontend/__tests__/services/fileApi.test.ts` - Actualizado mock data

**Métodos Agregados a FileService**:
```typescript
incrementProcessingRetryCount(userId, fileId): Promise<number>
incrementEmbeddingRetryCount(userId, fileId): Promise<number>
setLastProcessingError(userId, fileId, error): Promise<void>
setLastEmbeddingError(userId, fileId, error): Promise<void>
markAsPermanentlyFailed(userId, fileId): Promise<void>
clearFailedStatus(userId, fileId, scope): Promise<void>
updateEmbeddingStatus(userId, fileId, status): Promise<void>
```

---

### Sprint 2: Retry & Cleanup ⏳ PENDIENTE

**Duración Estimada**: 2-3 días
**Estado**: Pendiente

| Tarea | Estado | Archivos |
|-------|--------|----------|
| Tests ProcessingRetryManager (TDD RED) | ⬜ | `__tests__/unit/domains/files/ProcessingRetryManager.test.ts` |
| Implementar ProcessingRetryManager | ⬜ | `domains/files/processing/ProcessingRetryManager.ts` |
| Tests PartialDataCleaner (TDD RED) | ⬜ | `__tests__/unit/domains/files/PartialDataCleaner.test.ts` |
| Implementar PartialDataCleaner | ⬜ | `domains/files/cleanup/PartialDataCleaner.ts` |
| Integrar cleanup en workers | ⬜ | `infrastructure/queue/MessageQueue.ts` |
| Crear endpoint retry-processing | ⬜ | `routes/files/retry.route.ts` |
| Integration tests | ⬜ | `__tests__/integration/file-retry.test.ts` |

**Dependencias**: Sprint 1 ✅

---

### Sprint 3: WebSocket Events ⏳ PENDIENTE

**Duración Estimada**: 1-2 días
**Estado**: Pendiente

| Tarea | Estado | Archivos |
|-------|--------|----------|
| Modificar eventos con attempt info | ⬜ | `services/files/FileProcessingService.ts` |
| Agregar evento readiness_changed | ⬜ | `services/files/FileProcessingService.ts` |
| Agregar evento permanently_failed | ⬜ | `infrastructure/queue/workers/` |
| Actualizar tipos WebSocket en shared | ⬜ | `packages/shared/src/types/websocket.types.ts` |

**Dependencias**: Sprint 2

---

### Sprint 4: Frontend ⏳ PENDIENTE

**Duración Estimada**: 3-4 días
**Estado**: Pendiente

| Tarea | Estado | Archivos |
|-------|--------|----------|
| Crear fileProcessingStore (Zustand) | ⬜ | `frontend/src/stores/fileProcessingStore.ts` |
| Crear useFileProcessingEvents hook | ⬜ | `frontend/src/hooks/useFileProcessingEvents.ts` |
| Crear FileStatusIndicator component | ⬜ | `frontend/components/files/FileStatusIndicator.tsx` |
| Integrar en FileItem | ⬜ | `frontend/components/files/FileItem.tsx` |
| Agregar API client retry | ⬜ | `frontend/src/infrastructure/api/fileApiClient.ts` |
| E2E tests estados visuales | ⬜ | `tests/e2e/file-visual-states.spec.ts` |

**Dependencias**: Sprint 3

---

### Sprint 5: Refactorización (Opcional) ⏳ PENDIENTE

**Duración Estimada**: 3-5 días
**Estado**: Opcional - Deuda técnica

| Tarea | Estado | Archivos |
|-------|--------|----------|
| Extraer QueueManager de MessageQueue | ⬜ | `infrastructure/queue/QueueManager.ts` |
| Separar workers en archivos | ⬜ | `infrastructure/queue/workers/` |
| Separar routes de files | ⬜ | `routes/files/` |

**Dependencias**: Sprint 4 (puede hacerse en paralelo)

---

## 7. Registro de Cambios

### 2026-01-14

#### Sprint 1 Completado

**Cambios de Base de Datos**:
- ✅ Ejecutada migration `012-add-file-retry-tracking.sql`
- Nuevas columnas: `processing_retry_count`, `embedding_retry_count`, `last_processing_error`, `last_embedding_error`, `failed_at`
- Índices filtrados para performance en queries de cleanup

**Cambios de Tipos**:
- ✅ Nuevo tipo `FileReadinessState` en shared package
- ✅ `ParsedFile` extendido con campos de retry
- ✅ `FileDbRecord` extendido con campos de retry

**Cambios de Lógica**:
- ✅ `computeReadinessState()` implementado como función pura
- ✅ `parseFile()` ahora calcula `readinessState` automáticamente
- ✅ `ReadinessStateComputer` clase de dominio con singleton

**Cambios de FileService**:
- ✅ 7 nuevos métodos para gestión de retry tracking

**Tests**:
- ✅ 32 unit tests para ReadinessStateComputer
- ✅ 2111 tests totales pasando
- ✅ Type verification exitosa

---

## 8. Métricas de Éxito

| Métrica | Antes | Target | Actual |
|---------|-------|--------|--------|
| Archivos en estado "processing" visible | 0% | 100% | - |
| Tiempo para detectar fallo | ∞ | < 30s | - |
| Retry success rate | N/A | > 80% | - |
| Cleanup automático de orphans | 0% | 100% | - |
| Usuarios que entienden estado | ~40% | > 90% | - |

---

## 9. Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| Refactorización MessageQueue introduce bugs | Media | Alto | Tests de integración exhaustivos |
| WebSocket events perdidos | Baja | Medio | Polling fallback, DB como source of truth |
| Cleanup elimina datos válidos | Baja | Alto | Dry-run mode, audit log |
| Performance con nuevos índices | Baja | Bajo | Índices filtrados |

---

## Apéndice A: Comandos de Verificación

```bash
# Ejecutar tests unitarios del dominio files
npm run -w backend test:unit -- --grep "ReadinessState|Retry|Cleanup"

# Ejecutar todos los tests unitarios
npm run -w backend test:unit

# Verificación de tipos completa
npm run verify:types

# Lint
npm run -w backend lint
npm run -w bc-agent-frontend lint

# Ejecutar migration (desarrollo)
npm run -w backend db:migrate
```

---

## Apéndice B: Diagramas de Estado

### Estado de Procesamiento (Backend)

```
┌─────────┐
│ pending │
└────┬────┘
     │ job started
     ▼
┌────────────┐
│ processing │◄────┐
└─────┬──────┘     │
      │            │ error (retry < max)
  ┌───┴───┐        │
  │       │        │
  ▼       ▼        │
┌─────┐ ┌──────┐   │
│done │ │error │───┘
└──┬──┘ └──┬───┘
   │       │ max retries exceeded
   ▼       ▼
┌─────────┐ ┌────────┐
│completed│ │ failed │
└─────────┘ └────────┘
```

### Estado Visual (Frontend)

```
┌───────────┐   upload OK   ┌────────────┐
│ uploading │──────────────►│ processing │
│  (0-100%) │               │ (spinner)  │
└───────────┘               └─────┬──────┘
                                  │
                    ┌─────────────┼─────────────┐
                    │             │             │
                    ▼             ▼             ▼
              ┌─────────┐  ┌──────────┐  ┌─────────┐
              │  ready  │  │  failed  │◄►│  retry  │
              │   ✓     │  │    ✗     │  │         │
              └─────────┘  └──────────┘  └─────────┘
```
