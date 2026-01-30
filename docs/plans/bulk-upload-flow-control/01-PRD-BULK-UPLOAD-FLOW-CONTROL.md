# PRD: Sistema de Flow Control para Bulk Upload

**Versión**: 1.0
**Fecha**: 2025-01-30
**Autor**: Claude AI
**Estado**: Draft

---

## 1. Resumen Ejecutivo

### 1.1 Problema
El sistema actual de bulk upload experimenta errores de sincronización en BullMQ cuando se procesan grandes volúmenes de archivos simultáneamente. Los errores de lock (`Missing lock`, `Lock mismatch`, `could not renew lock`) indican que el sistema excede la capacidad de Redis Azure Basic C0, causando:

- Pérdida de jobs silenciosa
- Archivos que quedan en estados inconsistentes (`processing` permanente)
- Saturación de conexiones Redis (256 máximo en Basic tier)
- Timeouts de lock antes de renovación

### 1.2 Objetivo
Implementar un sistema de **Flow Control con Backpressure** que garantice:

1. **Resiliencia**: Ningún archivo se pierde, todos alcanzan estado terminal (`ready` o `failed`)
2. **Observabilidad**: Estado visible en tiempo real de todo el pipeline
3. **Escalabilidad**: Funciona con Azure Redis Basic y escala a tiers superiores
4. **Recuperabilidad**: Mecanismos automáticos de retry y recovery

### 1.3 Métricas de Éxito
| Métrica | Estado Actual | Objetivo |
|---------|---------------|----------|
| Tasa de éxito bulk upload | ~70-80% | ≥99% |
| Archivos en estado `processing` > 30min | Variable | 0 |
| Errores de lock por hora | >50 | <5 |
| Tiempo máximo de procesamiento/archivo | Sin límite | 5 min |

---

## 2. Análisis del Problema

### 2.1 Síntomas Observados

```
Error: Missing lock for job <id>. moveToFinished (código -2)
Error: Missing lock for job <id>. moveToDelayed (código -2)
Error: could not renew lock for job <id>
Error: Lock mismatch for job <id>. Cmd moveToFinished from active (código -6)
```

### 2.2 Causas Raíz Identificadas

#### 2.2.1 Saturación de Redis (Causa Principal)
- **Azure Redis Basic C0**: 256 conexiones máximas, 250MB memoria
- **Sistema actual**: 11 workers con múltiples conexiones cada uno
- **Bajo carga**: Conexiones se saturan → comandos fallan → locks expiran

#### 2.2.2 Arquitectura Sin Backpressure
```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  Frontend   │───▶│   Backend   │───▶│    Redis    │
│ (sin límite)│    │ (sin límite)│    │ (saturado)  │
└─────────────┘    └─────────────┘    └─────────────┘
        │                  │                  │
        │    100 archivos  │   300 jobs      │  256 conexiones
        │    simultáneos   │   inmediatos    │  máximo
        ▼                  ▼                  ▼
   Sin throttling     Sin rate limit     OVERFLOW
```

#### 2.2.3 Ausencia de Estado Intermedio
- Archivos pasan directamente de `uploading` a `pending` (en cola)
- No hay buffer entre upload completado y enqueue
- No hay mecanismo de retry si el enqueue falla

### 2.3 Pipeline Actual (Problemático)

```
1. Frontend envía N archivos simultáneamente
2. Backend crea N registros en DB con status='pending'
3. Backend encola N jobs FILE_BULK_UPLOAD inmediatamente
4. Worker procesa → encola FILE_PROCESSING → ...
5. Si Redis saturado → lock expira → job "perdido"
6. Archivo queda en estado intermedio permanente
```

---

## 3. Solución Propuesta

### 3.1 Arquitectura de Flow Control

```
┌─────────────────────────────────────────────────────────────────────┐
│                    ARQUITECTURA CON FLOW CONTROL                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────┐    ┌──────────────┐    ┌─────────────┐    ┌────────┐ │
│  │ Frontend │───▶│ Upload API   │───▶│  Scheduler  │───▶│ Queues │ │
│  │ Throttle │    │ (Phase 1)    │    │  (Phase 2)  │    │        │ │
│  └──────────┘    └──────────────┘    └─────────────┘    └────────┘ │
│       │                │                    │                │      │
│       │                │                    │                │      │
│       ▼                ▼                    ▼                ▼      │
│   10 files/s      DB: pending_        Batch enqueue      Rate       │
│   max             processing          10-20 jobs/batch   limited    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 Componentes del Sistema

#### 3.2.1 Frontend: Upload Throttle
- **Responsabilidad**: Limitar velocidad de upload
- **Implementación**: Chunks de 10 archivos con delay de 2s entre chunks
- **Ubicación**: `frontend/src/domains/files/hooks/useFolderUpload.ts`

#### 3.2.2 Backend Phase 1: Upload Rápido
- **Responsabilidad**: Persistir archivo rápidamente
- **Estado inicial**: `pending_processing` (nuevo estado)
- **Confirmación**: Inmediata al usuario
- **Ubicación**: `backend/src/services/files/BulkUploadProcessor.ts`

#### 3.2.3 Backend Phase 2: Scheduler
- **Responsabilidad**: Encolar jobs en batches controlados
- **Lógica**: Verificar carga de Redis antes de encolar
- **Frecuencia**: Cada 5 segundos
- **Ubicación**: `backend/src/services/files/FileProcessingScheduler.ts` (NUEVO)

#### 3.2.4 Queue: Rate Limiting Mejorado
- **Responsabilidad**: Controlar throughput por cola
- **Configuración**: Centralizada en constantes
- **Ubicación**: `backend/src/infrastructure/queue/constants/queue.constants.ts`

### 3.3 Nuevo Estado: `pending_processing`

```typescript
// packages/shared/src/constants/file-processing.ts
export const PROCESSING_STATUS = {
  PENDING_PROCESSING: 'pending_processing',  // NUEVO: Upload OK, esperando scheduler
  PENDING: 'pending',                        // En cola BullMQ
  PROCESSING: 'processing',                  // Worker activo
  COMPLETED: 'completed',
  FAILED: 'failed',
};
```

**Transiciones de Estado**:
```
                    ┌──────────────────┐
                    │ pending_processing│ ◄── Upload completado
                    └────────┬─────────┘
                             │ Scheduler encola
                             ▼
                    ┌──────────────────┐
                    │     pending      │ ◄── En cola BullMQ
                    └────────┬─────────┘
                             │ Worker toma job
                             ▼
                    ┌──────────────────┐
                    │   processing     │
                    └────────┬─────────┘
                             │
              ┌──────────────┴──────────────┐
              ▼                              ▼
     ┌──────────────┐              ┌──────────────┐
     │  completed   │              │    failed    │
     └──────────────┘              └──────────────┘
```

---

## 4. Fase de Diagnóstico Profundo

Antes de implementar, se requiere un diagnóstico exhaustivo del estado actual.

### 4.1 Scripts de Diagnóstico (Ya Implementados)

| Script | Propósito | Comando |
|--------|-----------|---------|
| `find-user.ts` | Obtener userId | `npx tsx scripts/find-user.ts "nombre"` |
| `verify-file-integrity.ts` | Estado de archivos | `npx tsx scripts/verify-file-integrity.ts --userId <ID>` |
| `queue-status.ts` | Estado de colas | `npx tsx scripts/queue-status.ts --verbose` |
| `diagnose-redis.ts` | Métricas Redis | `npx tsx scripts/diagnose-redis.ts --memory-analysis` |

### 4.2 Diagnóstico Adicional Requerido

#### 4.2.1 Análisis de Patrones de Carga
```bash
# Crear script: scripts/analyze-load-patterns.ts
# Objetivo: Identificar picos de carga y correlacionar con errores
```

**Métricas a recopilar**:
- Jobs encolados por minuto (últimas 24h)
- Conexiones Redis por minuto
- Errores de lock por minuto
- Archivos en `processing` por usuario

#### 4.2.2 Test de Estrés Controlado
```bash
# Crear script: scripts/stress-test-upload.ts
# Objetivo: Reproducir el problema de forma controlada
```

**Escenarios a probar**:
1. 10 archivos simultáneos (baseline)
2. 50 archivos simultáneos (carga media)
3. 100 archivos simultáneos (carga alta)
4. 200+ archivos simultáneos (estrés)

#### 4.2.3 Monitoreo de Conexiones Redis
```bash
# Crear script: scripts/monitor-redis-connections.ts
# Objetivo: Tracking en tiempo real de conexiones
```

### 4.3 Checklist de Diagnóstico

- [ ] Ejecutar `diagnose-redis.ts` y documentar tier actual
- [ ] Ejecutar `queue-status.ts` y contar jobs fallidos
- [ ] Ejecutar `verify-file-integrity.ts` para usuario afectado
- [ ] Identificar archivos stuck en `processing` > 30 min
- [ ] Revisar logs de errores de lock (últimas 48h)
- [ ] Documentar configuración actual de workers (concurrency)
- [ ] Medir tiempo promedio de procesamiento por tipo de archivo

---

## 5. Especificaciones Técnicas

### 5.1 Principios de Diseño

#### 5.1.1 Screaming Architecture
La estructura de carpetas debe comunicar claramente la intención:

```
backend/src/
├── domains/
│   └── files/
│       ├── scheduling/           # NUEVO: Flow control
│       │   ├── FileProcessingScheduler.ts
│       │   ├── SchedulerConfig.ts
│       │   └── index.ts
│       └── ...
├── infrastructure/
│   └── queue/
│       ├── constants/
│       │   ├── queue.constants.ts      # Configuración centralizada
│       │   └── flow-control.constants.ts  # NUEVO
│       └── ...
```

#### 5.1.2 Single Responsibility Principle
Cada archivo tiene UNA responsabilidad:

| Archivo | Responsabilidad |
|---------|-----------------|
| `FileProcessingScheduler.ts` | Decidir CUÁNDO encolar |
| `SchedulerConfig.ts` | Configuración del scheduler |
| `flow-control.constants.ts` | Constantes de flow control |
| `RateLimiter.ts` | Aplicar rate limiting |

#### 5.1.3 Configuración Centralizada
Todas las constantes en archivos dedicados:

```typescript
// backend/src/infrastructure/queue/constants/flow-control.constants.ts
export const FLOW_CONTROL = {
  /** Archivos máximos por batch de scheduling */
  SCHEDULER_BATCH_SIZE: 20,

  /** Intervalo del scheduler en ms */
  SCHEDULER_INTERVAL_MS: 5000,

  /** Máximo de jobs en espera antes de pausar */
  MAX_WAITING_JOBS: 100,

  /** Tiempo máximo en pending_processing antes de alerta */
  MAX_PENDING_PROCESSING_MS: 15 * 60 * 1000,  // 15 min
} as const;
```

### 5.2 Contratos de API

#### 5.2.1 Nuevo Endpoint: Queue Health Check
```typescript
// GET /api/files/queue/health
interface QueueHealthResponse {
  status: 'healthy' | 'degraded' | 'overloaded';
  queues: {
    name: string;
    waiting: number;
    active: number;
    failed: number;
  }[];
  canAcceptUploads: boolean;
  recommendedBatchSize: number;
}
```

#### 5.2.2 WebSocket: Upload Progress Mejorado
```typescript
// Evento: file:scheduling_status
interface FileSchedulingStatusEvent {
  fileId: string;
  status: 'pending_processing' | 'queued' | 'processing' | 'completed' | 'failed';
  queuePosition?: number;
  estimatedWaitTime?: number;
}
```

### 5.3 Base de Datos

#### 5.3.1 Nuevo Índice para Scheduler
```sql
-- Índice para queries del scheduler
CREATE INDEX IX_files_pending_processing
ON files (user_id, processing_status, created_at)
WHERE processing_status = 'pending_processing';
```

#### 5.3.2 Tracking de Scheduling
```sql
-- Opcional: Tabla para auditoría de scheduling
CREATE TABLE file_scheduling_history (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  file_id UNIQUEIDENTIFIER NOT NULL,
  event_type VARCHAR(50) NOT NULL,  -- 'enqueued', 'retried', 'failed'
  queue_name VARCHAR(100),
  created_at DATETIME2 DEFAULT GETUTCDATE(),
  metadata NVARCHAR(MAX)  -- JSON con detalles
);
```

---

## 6. Plan de Implementación (TDD)

### 6.1 Fase 1: Tests Primero

#### 6.1.1 Tests Unitarios a Crear

```typescript
// backend/src/domains/files/scheduling/__tests__/FileProcessingScheduler.test.ts
describe('FileProcessingScheduler', () => {
  describe('getFilesToSchedule', () => {
    it('should return files in pending_processing status');
    it('should respect batch size limit');
    it('should order by created_at ASC (FIFO)');
    it('should filter by userId when provided');
  });

  describe('checkQueueCapacity', () => {
    it('should return true when queue has capacity');
    it('should return false when queue is overloaded');
    it('should consider all file processing queues');
  });

  describe('scheduleFiles', () => {
    it('should transition status to pending');
    it('should enqueue job to FILE_PROCESSING queue');
    it('should handle partial failures gracefully');
    it('should not enqueue when queue is overloaded');
  });
});
```

#### 6.1.2 Tests de Integración

```typescript
// backend/src/__tests__/integration/files/flow-control.integration.test.ts
describe('Flow Control Integration', () => {
  it('should process 100 files without lock errors');
  it('should respect rate limits under load');
  it('should recover from Redis connection issues');
  it('should not lose files during processing');
});
```

### 6.2 Fase 2: Implementación por Componente

#### Sprint 1: Fundamentos (3-5 días)
1. [ ] Crear constantes en `flow-control.constants.ts`
2. [ ] Agregar estado `pending_processing` a shared types
3. [ ] Crear migración de DB para nuevo índice
4. [ ] Tests unitarios para scheduler (RED)

#### Sprint 2: Scheduler Core (3-5 días)
5. [ ] Implementar `FileProcessingScheduler.ts`
6. [ ] Implementar `SchedulerConfig.ts`
7. [ ] Tests unitarios pasan (GREEN)
8. [ ] Refactor si necesario

#### Sprint 3: Integración Backend (3-5 días)
9. [ ] Modificar `BulkUploadProcessor` para usar nuevo estado
10. [ ] Integrar scheduler con startup del servidor
11. [ ] Crear endpoint `/queue/health`
12. [ ] Tests de integración

#### Sprint 4: Frontend Throttling (2-3 días)
13. [ ] Modificar `useFolderUpload.ts` con throttling
14. [ ] Agregar indicadores de progreso de scheduling
15. [ ] Tests E2E

#### Sprint 5: Observabilidad (2-3 días)
16. [ ] Logging estructurado del scheduler
17. [ ] Métricas para Application Insights
18. [ ] Dashboard de monitoreo (opcional)

### 6.3 Criterios de Aceptación por Feature

#### F1: Estado pending_processing
- [ ] Archivos se crean con `processing_status = 'pending_processing'`
- [ ] UI muestra estado "Esperando procesamiento"
- [ ] Script de diagnóstico detecta archivos en este estado

#### F2: Scheduler
- [ ] Corre cada 5 segundos (configurable)
- [ ] Respeta batch size de 20 (configurable)
- [ ] Pausa cuando `waiting_jobs > 100`
- [ ] Logs de cada batch procesado

#### F3: Frontend Throttle
- [ ] Máximo 10 archivos por segundo
- [ ] Delay de 2s entre chunks
- [ ] Progress bar muestra estado real

#### F4: Recovery
- [ ] Archivos en `pending_processing` > 15min generan alerta
- [ ] Job cleanup automático para jobs huérfanos
- [ ] Retry automático de jobs fallidos por lock

---

## 7. Riesgos y Mitigaciones

| Riesgo | Impacto | Probabilidad | Mitigación |
|--------|---------|--------------|------------|
| Scheduler introduce latencia | Medio | Alta | Intervalo configurable, batch size ajustable |
| Conflicto con jobs existentes | Alto | Media | Migración gradual, feature flag |
| Redis tier insuficiente | Alto | Media | Diagnóstico previo, plan de upgrade |
| Tests insuficientes | Alto | Baja | TDD estricto, cobertura >80% |

---

## 8. Entregables

### 8.1 Código
- [ ] `FileProcessingScheduler.ts` + tests
- [ ] `flow-control.constants.ts`
- [ ] Modificaciones a `BulkUploadProcessor.ts`
- [ ] Modificaciones a `useFolderUpload.ts`
- [ ] Scripts de diagnóstico adicionales
- [ ] Migración de base de datos

### 8.2 Documentación
- [ ] Actualizar CLAUDE.md con nuevo flow
- [ ] Runbook de operaciones para scheduling
- [ ] Documentación de troubleshooting

### 8.3 Monitoreo
- [ ] Alertas para archivos stuck
- [ ] Dashboard de métricas de cola
- [ ] Logs estructurados para debugging

---

## 9. Apéndice

### A. Configuración Recomendada de Redis

| Tier | Conexiones | Memoria | Costo/mes | Recomendado para |
|------|------------|---------|-----------|------------------|
| Basic C0 | 256 | 250MB | ~$16 | Dev/Test |
| Standard C0 | 256 | 250MB | ~$40 | Producción pequeña |
| **Standard C1** | 1000 | 1GB | ~$50 | **Producción (recomendado)** |
| Standard C2 | 2000 | 2.5GB | ~$100 | Alta carga |

### B. Checklist Pre-Implementación

- [ ] Diagnóstico completo ejecutado
- [ ] Tier de Redis documentado
- [ ] Backup de configuración actual
- [ ] Feature flags preparados
- [ ] Tests de regresión identificados
- [ ] Plan de rollback definido

### C. Referencias

- [BullMQ Best Practices](https://docs.bullmq.io/guide/going-to-production)
- [Azure Redis Tiers](https://azure.microsoft.com/pricing/details/cache/)
- [Backpressure Patterns](https://mechanical-sympathy.blogspot.com/2012/05/apply-back-pressure-when-overloaded.html)
