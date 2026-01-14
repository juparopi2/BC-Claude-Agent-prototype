# Changelog - D25 Robust File Processing

Registro detallado de cambios por fecha y sprint.

---

## [Sprint 1] - 2026-01-14

### Added

#### Domain Layer
- **`backend/src/domains/files/status/ReadinessStateComputer.ts`**
  - Clase singleton para computar `FileReadinessState`
  - Método `compute(processingStatus, embeddingStatus): FileReadinessState`
  - Lógica: `failed` > `processing` > `ready`

- **`backend/src/domains/files/status/index.ts`**
  - Barrel export para el módulo status

- **`backend/src/domains/files/index.ts`**
  - Barrel export para el dominio files

#### Types (Shared Package)
- **`packages/shared/src/types/file.types.ts`**
  - Nuevo tipo: `FileReadinessState = 'uploading' | 'processing' | 'ready' | 'failed'`
  - Nuevos campos en `ParsedFile`:
    - `readinessState: FileReadinessState`
    - `processingRetryCount: number`
    - `embeddingRetryCount: number`
    - `lastError: string | null`
    - `failedAt: string | null`

#### Database
- **`backend/migrations/012-add-file-retry-tracking.sql`**
  - Columna `processing_retry_count INT NOT NULL DEFAULT 0`
  - Columna `embedding_retry_count INT NOT NULL DEFAULT 0`
  - Columna `last_processing_error NVARCHAR(1000) NULL`
  - Columna `last_embedding_error NVARCHAR(1000) NULL`
  - Columna `failed_at DATETIME2 NULL`
  - Índice `IX_files_failed_at` (filtrado)
  - Índice `IX_files_processing_status_pending` (filtrado)
  - Índice `IX_files_embedding_status_failed` (filtrado)

#### FileService Methods
- **`backend/src/services/files/FileService.ts`**
  - `incrementProcessingRetryCount(userId, fileId)` - Retorna count actualizado
  - `incrementEmbeddingRetryCount(userId, fileId)` - Retorna count actualizado
  - `setLastProcessingError(userId, fileId, errorMessage)` - Trunca a 1000 chars
  - `setLastEmbeddingError(userId, fileId, errorMessage)` - Trunca a 1000 chars
  - `markAsPermanentlyFailed(userId, fileId)` - Sets `failed_at = GETUTCDATE()`
  - `clearFailedStatus(userId, fileId, scope)` - Reset para retry
  - `updateEmbeddingStatus(userId, fileId, status)` - Actualiza embedding_status

#### Tests
- **`backend/src/__tests__/unit/domains/files/ReadinessStateComputer.test.ts`**
  - 32 unit tests cubriendo todas las combinaciones de estados
  - Tests para singleton pattern
  - Tests para edge cases

### Modified

#### Backend Types
- **`backend/src/types/file.types.ts`**
  - Agregado `FileReadinessState` type
  - Agregados campos retry a `FileDbRecord`
  - Agregados campos retry a `ParsedFile`
  - Nueva función `computeReadinessState()`
  - Modificado `parseFile()` para incluir `readinessState`

#### Shared Package Exports
- **`packages/shared/src/types/index.ts`**
  - Export de `FileReadinessState`

- **`packages/shared/src/index.ts`**
  - Export de `FileReadinessState`

#### Test Fixtures
- **`backend/src/__tests__/fixtures/FileFixture.ts`**
  - Agregados campos default para retry tracking en `createFileDbRecord()`
  - Agregados campos default para retry tracking en `createParsedFile()`

- **`frontend/__tests__/fixtures/FileFixture.ts`**
  - Agregados campos default para nuevos campos de `ParsedFile`

- **`frontend/__tests__/mocks/handlers.ts`**
  - Actualizado mock data con nuevos campos

- **`frontend/__tests__/services/fileApi.test.ts`**
  - Actualizado mock data con nuevos campos

#### Unit Tests
- **`backend/src/__tests__/unit/file-types.test.ts`**
  - Actualizado expected output de `parseFile()` con nuevos campos

### Verification

```
✅ Migration executed successfully (9 batches)
✅ Type verification passing (npm run verify:types)
✅ Backend unit tests: 2111 passing, 12 skipped
✅ Frontend tests: All passing with updated fixtures
```

---

## [Sprint 2] - 2026-01-14 ✅ COMPLETADO

### Objetivo
Implementar lógica de retry automático con exponential backoff y cleanup de datos parciales cuando se agotan los reintentos.

### Added - Tipos Compartidos
- **`packages/shared/src/types/file.types.ts`**
  - `RetryPhase = 'processing' | 'embedding'`
  - `RetryScope = 'full' | 'embedding_only'`
  - `RetryDecisionReason = 'within_limit' | 'max_retries_exceeded' | 'not_failed'`
  - `RetryDecisionResult` - Resultado de decisión de retry
  - `ManualRetryResult` - Resultado de retry manual
  - `CleanupResult` - Estadísticas de cleanup
  - `BatchCleanupResult` - Estadísticas de cleanup en batch
  - `RetryProcessingRequest` - Request para endpoint de retry
  - `RetryProcessingResponse` - Response del endpoint

### Added - Configuration
- **`backend/src/domains/files/config/file-processing.config.ts`**
  - Configuración centralizada con Zod schema
  - `maxProcessingRetries: 2`, `maxEmbeddingRetries: 3`
  - `baseDelayMs: 5000`, `maxDelayMs: 60000`, `backoffMultiplier: 2`, `jitterFactor: 0.1`
  - `failedFileRetentionDays: 30`, `orphanedChunkRetentionDays: 7`
  - `maxManualRetriesPerHour: 10`
  - Singleton pattern con `getFileProcessingConfig()`

- **`backend/src/domains/files/config/index.ts`**
  - Barrel export para módulo config

### Added - Domain Layer (Retry)
- **`backend/src/domains/files/retry/IProcessingRetryManager.ts`**
  - Interface para ProcessingRetryManager
  - Dependency injection support

- **`backend/src/domains/files/retry/ProcessingRetryManager.ts`**
  - `shouldRetry(userId, fileId, phase)` - Decide si reintentar
  - `executeManualRetry(userId, fileId, scope)` - Retry manual desde UI
  - `handlePermanentFailure(userId, fileId, errorMessage)` - Marca como fallido y cleanup
  - `calculateBackoffDelay(retryCount)` - Exponential backoff con jitter
  - Singleton pattern con `getProcessingRetryManager()` y `__resetProcessingRetryManager()`
  - Dynamic imports para evitar circular dependencies

### Added - Domain Layer (Cleanup)
- **`backend/src/domains/files/cleanup/IPartialDataCleaner.ts`**
  - Interface para PartialDataCleaner
  - Tipos CleanupResult, BatchCleanupResult

- **`backend/src/domains/files/cleanup/PartialDataCleaner.ts`**
  - `cleanupForFile(userId, fileId)` - Limpia chunks y search docs de un archivo
  - `cleanupOrphanedChunks(olderThanDays?)` - Chunks huérfanos (opera globalmente)
  - `cleanupOrphanedSearchDocs()` - Docs de AI Search huérfanos (delega a OrphanCleanupJob)
  - `cleanupOldFailedFiles(olderThanDays)` - Batch cleanup de archivos viejos
  - Integra con `VectorSearchService.deleteChunksForFile()`
  - Singleton pattern con `getPartialDataCleaner()` y `__resetPartialDataCleaner()`

- **`backend/src/domains/files/cleanup/index.ts`**
  - Barrel export para módulo cleanup

### Added - API Endpoint
- **`backend/src/routes/files.ts`**
  - `POST /api/files/:id/retry-processing` endpoint
  - Validación con Zod (`retryProcessingRequestSchema`)
  - Rate limiting soporte (10 retries/hora)
  - Respuestas: 200 OK, 400 Not Failed, 404 Not Found, 429 Too Many Requests

### Added - Queue Infrastructure
- **`backend/src/infrastructure/queue/MessageQueue.ts`**
  - `QueueName.FILE_CLEANUP = 'file-cleanup'` - Nueva cola
  - `FileCleanupJob` interface para job data
  - Worker para procesar cleanup jobs
  - Cron job `scheduled-daily-cleanup` (3 AM UTC diario)
  - Método `processFileCleanupJob()` para ejecutar cleanup

### Modified - BullMQ Worker Integration
- **`backend/src/infrastructure/queue/MessageQueue.ts`**
  - `processFileProcessingJob()` - Integra ProcessingRetryManager en catch
  - `processEmbeddingGeneration()` - Integra ProcessingRetryManager en catch
  - `processFileChunkingJob()` - Integra ProcessingRetryManager en catch
  - Patrón: `shouldRetry()` -> throw para retry BullMQ o `handlePermanentFailure()`

### Added - Unit Tests
- **`backend/src/__tests__/unit/domains/files/ProcessingRetryManager.test.ts`**
  - 21 tests cubriendo retry decisions, manual retry, permanent failure, backoff
  - Tests para singleton pattern y DI support

- **`backend/src/__tests__/unit/domains/files/PartialDataCleaner.test.ts`**
  - 19 tests cubriendo cleanup single file, orphaned chunks, batch cleanup
  - Tests para error handling y multi-tenant isolation

### Added - Integration Tests
- **`backend/src/__tests__/integration/files/file-retry-processing.test.ts`**
  - 18 tests de integración con service-level mocking
  - Scenario 1: Retry Decision Flow (within_limit, max_retries_exceeded)
  - Scenario 2: Permanent Failure Handling (cleanup triggered)
  - Scenario 3: Manual Retry Flow (full, embedding_only)
  - Scenario 4: Cleanup Operations (orphaned chunks, batch)
  - Scenario 5: Exponential Backoff Calculation
  - Scenario 6: Multi-tenant Isolation
  - Scenario 7: Service Singleton Behavior

### Modified - Existing Tests
- **`backend/src/__tests__/unit/services/queue/MessageQueue.close.test.ts`**
  - Actualizado de 8 queues a 9 queues (FILE_CLEANUP agregado)
  - Assertions actualizadas: 27 items (9 workers + 9 queueEvents + 9 queues)

### Verification

```
✅ Type verification passing (npm run verify:types)
✅ Backend unit tests: 2233 passing, 12 skipped
✅ Integration tests: 18 passing (file-retry-processing)
✅ All Sprint 2 objectives completed
```

---

## [Sprint 3] - 2026-01-14 ✅ COMPLETADO

### Objetivo
Centralizar la emisión de eventos WebSocket para file processing usando `FileEventEmitter`.

### Added - Domain Layer (Event Emission)
- **`backend/src/domains/files/emission/IFileEventEmitter.ts`**
  - Interface para dependency injection
  - `FileEventContext` type para contexto de eventos
  - `ReadinessChangedPayload`, `PermanentlyFailedPayload`, `ProcessingProgressPayload`, `CompletionStats`
  - Métodos: `emitReadinessChanged()`, `emitPermanentlyFailed()`, `emitProgress()`, `emitCompletion()`, `emitError()`

- **`backend/src/domains/files/emission/FileEventEmitter.ts`**
  - Singleton implementation para emisión centralizada de eventos
  - Canales: `file:status` (readiness changes), `file:processing` (progress/completion/error)
  - Never throws - errores de WebSocket se loguean pero no fallan operaciones
  - Verifica `isSocketServiceInitialized()` antes de emitir
  - Skip silencioso si no hay sessionId
  - Singleton pattern con `getFileEventEmitter()` y `__resetFileEventEmitter()`

- **`backend/src/domains/files/emission/index.ts`**
  - Barrel export para módulo emission

### Added - Types (Shared Package)
- **`packages/shared/src/types/file.types.ts`**
  - `BaseFileWebSocketEvent` - Base interface con fileId y timestamp
  - `FileReadinessChangedEvent` - Cambios de readiness state
  - `FilePermanentlyFailedEvent` - Fallo permanente con retry counts
  - `FileProcessingProgressEvent` - Progreso con attemptNumber/maxAttempts
  - `FileProcessingCompletedEvent` - Completado con stats
  - `FileProcessingFailedEvent` - Error con mensaje
  - `FileWebSocketEvent` - Union type de todos los eventos

### Added - Unit Tests
- **`backend/src/__tests__/unit/domains/files/FileEventEmitter.test.ts`**
  - 29 tests cubriendo:
    - Singleton pattern (getInstance, resetInstance)
    - `emitReadinessChanged()` - emite a canal `file:status`
    - `emitPermanentlyFailed()` - emite con detalles de fallo
    - `emitProgress()` - incluye attemptNumber/maxAttempts
    - `emitCompletion()` - stats con textLength, pageCount, ocrUsed
    - `emitError()` - emite mensaje de error
    - Skip si no hay sessionId
    - Skip si Socket.IO no inicializado
    - No lanzar error si emit falla (error swallowing)

### Modified - ProcessingRetryManager
- **`backend/src/domains/files/retry/IProcessingRetryManager.ts`**
  - Agregado `sessionId?: string` a `handlePermanentFailure()` para WebSocket routing

- **`backend/src/domains/files/retry/ProcessingRetryManager.ts`**
  - Integra `IFileEventEmitter` como dependency
  - `handlePermanentFailure()` ahora emite:
    - `file:permanently_failed` con retry counts y canRetryManually flag
    - `file:readiness_changed` con transición a 'failed'
  - Constructor inyecta `getFileEventEmitter()` por defecto

### Modified - MessageQueue Workers
- **`backend/src/infrastructure/queue/MessageQueue.ts`**
  - Agregado `sessionId` a `EmbeddingGenerationJob` interface
  - Workers pasan `sessionId` a `handlePermanentFailure()`:
    - `processFileProcessingJob()` - pasa sessionId del job
    - `processEmbeddingGeneration()` - pasa sessionId del job
    - `processFileChunkingJob()` - pasa sessionId del job
  - Al completar embedding exitosamente, emite:
    - `file:readiness_changed` con transición 'processing' → 'ready'

### Modified - FileProcessingService
- **`backend/src/services/files/FileProcessingService.ts`**
  - Reemplazado emisión directa de Socket.IO con `FileEventEmitter`
  - `emitProgress()` ahora delega a `eventEmitter.emitProgress()`
  - `emitCompletion()` ahora delega a `eventEmitter.emitCompletion()`
  - `emitError()` ahora delega a `eventEmitter.emitError()`
  - Eventos de progreso incluyen `attemptNumber` y `maxAttempts` del job

### Modified - Test Updates
- **`backend/src/__tests__/unit/services/files/FileProcessingService.test.ts`**
  - Agregado mock para `FileEventEmitter`
  - Tests de WebSocket Events actualizados para verificar:
    - Llamadas a `mockEmitProgress()` con context y payload
    - Llamadas a `mockEmitCompletion()` con stats
    - Llamadas a `mockEmitError()` con mensaje
    - Delegación correcta de sessionId (emitter maneja skip)
    - Delegación correcta independiente de estado de Socket.IO (emitter maneja check)

### Added - Constants (Shared Package)
- **`packages/shared/src/constants/file-processing.ts`**
  - `PROCESSING_STATUS` - Constantes: `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`
  - `EMBEDDING_STATUS` - Constantes: `PENDING`, `QUEUED`, `PROCESSING`, `COMPLETED`, `FAILED`
  - `FILE_READINESS_STATE` - Constantes: `UPLOADING`, `PROCESSING`, `READY`, `FAILED`
  - Tipos derivados: `ProcessingStatusValue`, `EmbeddingStatusValue`, `FileReadinessStateValue`

- **`packages/shared/src/constants/websocket-events.ts`**
  - `FILE_WS_CHANNELS` - Canales: `STATUS = 'file:status'`, `PROCESSING = 'file:processing'`
  - `FILE_WS_EVENTS` - Eventos: `READINESS_CHANGED`, `PERMANENTLY_FAILED`, `PROCESSING_PROGRESS`, `PROCESSING_COMPLETED`, `PROCESSING_FAILED`
  - Tipos derivados: `FileWsChannel`, `FileWsEventType`

- **`packages/shared/src/constants/index.ts`**
  - Barrel exports para file-processing y websocket-events

### Modified - Magic String Elimination
- **`backend/src/infrastructure/queue/MessageQueue.ts`**
  - Reemplazado `'pending'` → `EMBEDDING_STATUS.PENDING` (línea 1896)
  - Reemplazado `'failed'` → `EMBEDDING_STATUS.FAILED` (línea 1926)
  - Import agregado: `import { EMBEDDING_STATUS } from '@bc-agent/shared'`

- **`backend/src/services/files/FileProcessingService.ts`**
  - Reemplazado 7x `'processing'` → `PROCESSING_STATUS.PROCESSING`
  - Reemplazado 1x `'completed'` → `PROCESSING_STATUS.COMPLETED`
  - Reemplazado 1x `'failed'` → `PROCESSING_STATUS.FAILED`
  - Actualizado tipo de parámetro: `status: string` → `status: ProcessingStatus`
  - Import agregado: `import { PROCESSING_STATUS } from '@bc-agent/shared'`

- **`backend/src/domains/files/emission/FileEventEmitter.ts`**
  - Usa `FILE_WS_CHANNELS.STATUS` y `FILE_WS_CHANNELS.PROCESSING` en lugar de strings
  - Usa `FILE_WS_EVENTS.*` para tipos de evento
  - Usa `PROCESSING_STATUS.COMPLETED` y `PROCESSING_STATUS.FAILED` en emisiones

### Verification

```
✅ Type verification passing (npm run verify:types)
✅ Backend unit tests: 2262 passing, 12 skipped
✅ FileEventEmitter tests: 29 passing
✅ Lint: 0 errors, 38 warnings (pre-existing)
✅ No magic strings restantes en file processing status
```

---

## [Unreleased]

### Sprint 4 - Frontend (Pending)
- [ ] `fileProcessingStore` (Zustand)
- [ ] `useFileProcessingEvents` hook
- [ ] `FileStatusIndicator` component
- [ ] Integration in `FileItem`

### Sprint 5 - Refactoring (Optional)
- [ ] Extract `QueueManager` from `MessageQueue`
- [ ] Separate workers into individual files
- [ ] Separate file routes
