# D25 - Robust File Processing System

Sistema robusto de procesamiento de archivos con estados visuales claros, retry automático, y cleanup de datos parciales.

## Estado del Proyecto

| Sprint | Estado | Descripción |
|--------|--------|-------------|
| Sprint 1 | ✅ Completado | Backend Foundation - Tipos, migration, ReadinessStateComputer, FileRetryService |
| Sprint 2 | ✅ Completado | Retry & Cleanup - ProcessingRetryManager, PartialDataCleaner, API Endpoint, Cron Job, Worker Integration |
| Sprint 3 | ✅ Completado | WebSocket Events - FileEventEmitter centralizado, eventos con attemptNumber/maxAttempts |
| Sprint 4 | ⏳ Pendiente | Frontend - Store, hooks, componentes visuales |
| Sprint 5 | ⏳ Opcional | Refactorización - God files cleanup |

## Documentos

| Archivo | Descripción |
|---------|-------------|
| [PRD.md](./PRD.md) | Product Requirements Document completo |
| [CHANGELOG.md](./CHANGELOG.md) | Registro detallado de cambios por fecha |

## Quick Start

### Verificar Estado Actual

```bash
# Verificar tipos
npm run verify:types

# Ejecutar tests del dominio
npm run -w backend test:unit -- -t "ReadinessState"
npm run -w backend test:unit -- -t "FileEventEmitter"
npm run -w backend test:unit -- -t "ProcessingRetryManager"

# Ejecutar todos los tests
npm run -w backend test:unit
```

### Archivos Clave

**Domain Layer (Sprint 1)**:
- `backend/src/domains/files/status/ReadinessStateComputer.ts` - Computa estado de readiness
- `backend/src/domains/files/retry/FileRetryService.ts` - Tracking de reintentos

**Domain Layer (Sprint 2)**:
- `backend/src/domains/files/config/file-processing.config.ts` - Config centralizada (Zod schema)
- `backend/src/domains/files/retry/ProcessingRetryManager.ts` - Orquestación de retries
- `backend/src/domains/files/cleanup/PartialDataCleaner.ts` - Cleanup de datos parciales

**Domain Layer (Sprint 3)**:
- `backend/src/domains/files/emission/IFileEventEmitter.ts` - Interface para DI
- `backend/src/domains/files/emission/FileEventEmitter.ts` - Singleton para emisión WebSocket centralizada
- `backend/src/domains/files/emission/index.ts` - Barrel export

**Constants (Sprint 3)**:
- `packages/shared/src/constants/file-processing.ts` - `PROCESSING_STATUS`, `EMBEDDING_STATUS`, `FILE_READINESS_STATE`
- `packages/shared/src/constants/websocket-events.ts` - `FILE_WS_CHANNELS`, `FILE_WS_EVENTS`

**API (Sprint 2)**:
- `backend/src/routes/files.ts` - `POST /api/files/:id/retry-processing` endpoint

**Queue Infrastructure (Sprint 2)**:
- `backend/src/infrastructure/queue/MessageQueue.ts` - FILE_CLEANUP queue, cron job, worker integration

**Types & Constants**:
- `packages/shared/src/types/file.types.ts` (FileReadinessState, RetryDecisionResult, CleanupResult, WebSocket events)
- `packages/shared/src/constants/file-processing.ts` (PROCESSING_STATUS, EMBEDDING_STATUS, FILE_READINESS_STATE)
- `packages/shared/src/constants/websocket-events.ts` (FILE_WS_CHANNELS, FILE_WS_EVENTS)
- `backend/src/types/file.types.ts` (parseFile con readinessState)

**Database**:
- `backend/migrations/012-add-file-retry-tracking.sql`

**Service**:
- `backend/src/services/files/FileService.ts` (métodos de retry tracking - delegados a FileRetryService)

**Jobs (D22)**:
- `backend/src/jobs/OrphanCleanupJob.ts` - Cleanup de documentos huérfanos en AI Search

**Tests (Sprint 2)**:
- `backend/src/__tests__/unit/domains/files/ProcessingRetryManager.test.ts` - 21 tests
- `backend/src/__tests__/unit/domains/files/PartialDataCleaner.test.ts` - 19 tests
- `backend/src/__tests__/integration/files/file-retry-processing.test.ts` - 18 tests de integración

**Tests (Sprint 3)**:
- `backend/src/__tests__/unit/domains/files/FileEventEmitter.test.ts` - 29 tests

## Filosofía de Trabajo

1. **TDD**: Tests primero (RED → GREEN → REFACTOR)
2. **SRP**: Una responsabilidad por módulo
3. **DI**: Dependencias inyectadas, no hardcodeadas
4. **Event-Driven**: Cambios emiten eventos
5. **Screaming Architecture**: Estructura que explica el negocio
6. **Single Source of Truth**: Constantes centralizadas en `@bc-agent/shared`, no magic strings
