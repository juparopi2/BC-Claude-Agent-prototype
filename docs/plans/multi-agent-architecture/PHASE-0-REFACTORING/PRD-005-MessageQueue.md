# PRD-005: MessageQueue Refactoring

**Estado**: Completado ✅
**Fecha de Completado**: 2026-01-23
**Prioridad**: Alta
**Dependencias**: PRD-001, PRD-002, PRD-003, PRD-004
**Bloquea**: Fase 1 (TDD Foundation)

---

## 1. Objetivo

Descomponer `MessageQueue.ts` (2,817 líneas) en módulos especializados:
- Queue management (creation, configuration)
- Worker implementations (por tipo de job)
- Job processors (lógica de procesamiento)
- Scheduled jobs
- Health/status monitoring

---

## 2. Contexto

### 2.1 Estado Previo

`backend/src/infrastructure/queue/MessageQueue.ts` manejaba todas las responsabilidades en un solo archivo de ~2,800 líneas, mezclando lógica de infraestructura (Redis, BullMQ) con lógica de negocio (procesamiento de archivos, embeddings).

### 2.2 Problemas Resueltos

1. **God File**: Reducido de 2,817 líneas a un Facade de ~700 líneas.
2. **Responsabilidades Mezcladas**: Infraestructura separada en `core/` y lógica de negocio delegada a Servicios.
3. **Escalabilidad**: Nuevos workers se añaden como archivos individuales en `workers/`.
4. **Testing**: Componentes aislados permitiendo tests unitarios más sencillos.

---

## 3. Diseño Implementado

### 3.1 Estructura Final

```
backend/src/infrastructure/queue/
├── MessageQueue.ts              # Facade (699 líneas)
├── core/
│   ├── QueueManager.ts          # Queue management (211 líneas)
│   ├── WorkerRegistry.ts        # Worker registration (162 líneas)
│   ├── RedisConnectionManager.ts # Redis connection (233 líneas)
│   ├── QueueEventManager.ts     # Event handling (232 líneas)
│   ├── ScheduledJobManager.ts   # Cron jobs (151 líneas)
│   └── RateLimiter.ts           # Rate limiting (152 líneas)
├── workers/
│   ├── MessagePersistenceWorker.ts (154 líneas)
│   ├── FileProcessingWorker.ts     (146 líneas)
│   ├── EmbeddingGenerationWorker.ts (231 líneas)
│   └── ... (otros 9 workers)
└── index.ts
```

**Nota sobre Processors**: La lógica de procesamiento de archivos (`FileTextExtractor`, etc.) se movió a `backend/src/services/files/processors/` y `FileProcessingService.ts` en lugar de `infrastructure/queue/processors/`, para mejor separación de capas (Domain Services vs Infrastructure).

### 3.2 Componentes Clave

#### MessageQueue.ts (Facade)
Mantiene la API pública original para asegurar retrocompatibilidad. Coordina los componentes del núcleo e inicializa los workers.

#### Workers
Ahora son clases ligeras que:
1. Reciben dependencias inyectadas.
2. Manejan el logging del job.
3. Delegan la lógica de negocio a servicios (`FileProcessingService`, `EmbeddingComponent`, etc.).
4. Manejan errores y reintentos.

Ejemplo `FileProcessingWorker`:
Delegates to `FileProcessingService.processFile(job.data)`.

---

## 4. Resultados de Implementación

### 4.1 Conteo de Líneas

| Módulo | Objetivo Original | Actual | Estado |
|--------|-------------------|--------|--------|
| MessageQueue.ts (facade) | ~200 | 699 | ⚠️ Excede (incluye boilerplate de facada y tipos) |
| QueueManager.ts | ~150 | 211 | ✅ Aceptable |
| WorkerRegistry.ts | ~100 | 162 | ✅ Aceptable |
| RedisConnectionManager.ts | ~100 | 233 | ~ Aceptable (robusto error handling) |
| Workers (promedio) | < 200 | 120-230 | ✅ Cumple |

### 4.2 Cobertura de Tests

| Tipo | Localización | Estado |
|------|--------------|--------|
| Unit (Infra) | `src/__tests__/unit/services/queue` (Partial) | Se encontraron tests para RateLimit, Close, Embedding. |
| Integration | `src/__tests__/integration/services/queue/*.test.ts` | ✅ Tests de integración robustos (`MessageQueue.integration.test.ts`, `pipeline.integration.test.ts`). |

### 4.3 Verificación Funcional

- ✅ **Backward Compatibility**: API pública mantenida.
- ✅ **Separación de Concerns**: Lógica de negocio movida fuera de `infrastructure`.
- ✅ **Worker Isolation**: Cada worker en su propio archivo.

## 5. Próximos Pasos (Pendientes Menores)

1. **Migración de Tests Unitarios**: Mover tests de `src/__tests__/unit/services/queue` a `src/__tests__/unit/infrastructure/queue` para reflejar la estructura de carpetas.
2. **Completar Tests Unitarios**: Aumentar cobertura unitaria para componentes `core` (`QueueManager`, `WorkerRegistry`), aunque los tests de integración cubren los flujos principales.

---

## 6. Changelog

| Fecha | Versión | Cambios |
|-------|---------|---------|
| 2026-01-21 | 1.0 | Draft inicial |
| 2026-01-23 | 2.0 | **Implementación completada**. Refactoring verificado. Estructura modular implementada exitosamente. Lógica de procesadores movida a capa de servicios. |

