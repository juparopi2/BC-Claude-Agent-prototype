# TASK-001: Resolver BullMQ Cleanup Error

**Prioridad**: 🔴 CRÍTICA (Blocker)
**Estimación**: 4-6 horas
**Sprint**: 1 (Días 1-2)
**Owner**: Dev + QA
**Status**: 🔴 NOT STARTED

---

## 📋 PROBLEM STATEMENT

### Descripción del Problema

Los 18 tests de `MessageQueue.integration.test.ts` **validan correctamente el comportamiento** del sistema (todos los asserts pasan), pero el test file completo falla con **exit code 1** debido a un error no manejado que ocurre durante el cleanup en el hook `afterAll`.

**Error**:
```
Unhandled Errors
Connection is closed

This error originated in "src/__tests__/integration/services/queue/MessageQueue.integration.test.ts"
The latest test that might've caused the error is "should add job to tool-execution queue"
```

### Impacto en el Sistema

| Aspecto | Impacto | Severidad |
|---------|---------|-----------|
| **Funcionalidad** | ✅ NO afectada (tests validan correctamente) | 🟢 BAJA |
| **CI/CD Pipeline** | ❌ Marca build como FAILED | 🔴 CRÍTICA |
| **Pre-push Hook** | ❌ Bloquea push al repositorio | 🔴 CRÍTICA |
| **Developer Experience** | ❌ Confusión (tests pasan pero file falla) | 🟡 MEDIA |
| **Tiempo Bloqueado** | 2+ semanas investigando | 🔴 CRÍTICA |

### Causa Raíz (Hipótesis)

**Archivo**: `backend/src/services/queue/MessageQueue.ts`

El método `close()` (líneas 679-728) intenta cerrar queues y workers, pero:

1. **Orden incorrecto**: Se cierran queues ANTES que workers
2. **Workers activos**: Workers pueden estar procesando jobs al momento del cierre
3. **Redis connection**: Se cierra la conexión antes de terminar operaciones pendientes
4. **Promise rejections**: Errores no manejados durante el cierre

**Código actual problemático**:
```typescript
async close(): Promise<void> {
  try {
    // PROBLEMA 1: Cierra queues primero (debería ser workers primero)
    await Promise.all([
      this.messagePersistenceQueue.close(),
      this.toolExecutionQueue.close(),
      this.eventProcessingQueue.close(),
    ]);

    // PROBLEMA 2: Workers pueden estar procesando aún
    // (No hay espera explícita a que terminen)

    // PROBLEMA 3: Cierra Redis inmediatamente
    await this.redis.quit();
  } catch (error) {
    // PROBLEMA 4: Error se loguea pero se propaga
    logger.error('Error closing MessageQueue', { error });
  }
}
```

---

## 🎯 SUCCESS CRITERIA (Extremadamente Riguroso)

### Criterios Funcionales

#### 1. Test Execution (100% Required)

| Criterio | Target | Validation Method |
|----------|--------|-------------------|
| **Tests Passing** | 18/18 en CADA run | `grep "18 passed"` |
| **Exit Code** | 0 en CADA run | `echo $?` después de test |
| **Consecutive Runs** | 5 runs sin errores | Script automatizado |
| **Pre-push Hook** | 3 runs consecutivos exitosos | `git push --dry-run` |

**Comando de Validación**:
```bash
# Debe ejecutarse 5 veces consecutivas sin fallar
for i in {1..5}; do
  echo "=== RUN $i/5 ==="
  npm run test:integration -- MessageQueue
  if [ $? -ne 0 ]; then
    echo "❌ FAILED at run $i"
    exit 1
  fi
done
echo "✅ ALL 5 RUNS PASSED"
```

#### 2. Error Messages (0 Allowed)

| Error Type | Current | Target | Validation |
|------------|---------|--------|------------|
| "Connection is closed" | ✅ Present | ❌ MUST NOT appear | `grep -c "Connection is closed"` = 0 |
| Unhandled promise rejections | ✅ Present | ❌ MUST NOT appear | `grep -c "UnhandledPromiseRejection"` = 0 |
| "Worker is not running" | Unknown | ❌ MUST NOT appear | Check stderr |
| Redis ECONNREFUSED | Unknown | ❌ MUST NOT appear | Check stderr |

#### 3. Resource Cleanup (100% Required)

| Recurso | Estado Esperado Post-Test | Validation Method |
|---------|---------------------------|-------------------|
| **Redis Connections** | 0 open connections | `netstat -an \| grep 6399 \| grep ESTABLISHED` = empty |
| **BullMQ Workers** | All workers closed | Log message "Worker closed successfully" |
| **BullMQ Queues** | All queues closed | Log message "Queue closed successfully" |
| **Event Listeners** | All detached | No memory leaks |

**Comando de Validación**:
```bash
# ANTES del test
netstat -an | grep 6399 | wc -l  # Baseline

# DESPUÉS del test (debe ser igual al baseline)
netstat -an | grep 6399 | wc -l  # Debe ser 0 o igual a baseline
```

#### 4. CI/CD Integration (Required)

| Check | Target | Validation |
|-------|--------|------------|
| GitHub Actions workflow | ✅ Passing | Check badge status |
| Backend integration-tests job | ✅ Passing | Workflow logs |
| Pre-push hook local | ✅ Passing | Developer confirmation |

---

### Criterios No Funcionales

#### 5. Performance

| Métrica | Current | Target | Max Aceptable |
|---------|---------|--------|---------------|
| Test Suite Duration | ~110s | < 120s | 150s |
| Cleanup Duration | Unknown | < 5s | 10s |
| Memory Usage | Unknown | < 200MB | 300MB |

#### 6. Code Quality

| Aspecto | Requerimiento |
|---------|--------------|
| **Comments** | Cada operación de cleanup debe tener comentario explicando por qué |
| **Error Handling** | try/catch en CADA operación async |
| **Logging** | Nivel DEBUG para cada paso de cierre |
| **Testing** | Agregar test unitario de close() method |

---

## 🔧 IMPLEMENTATION OPTIONS

### Opción A: Fix del Orden de Cierre (RECOMENDADA)

**Estrategia**: Corregir el orden de cierre y agregar esperas explícitas.

**Cambios Requeridos**:

```typescript
// backend/src/services/queue/MessageQueue.ts

async close(): Promise<void> {
  logger.info('MessageQueue: Starting graceful shutdown...');

  try {
    // PASO 1: Pause queues (no aceptar más jobs)
    logger.debug('MessageQueue: Pausing queues...');
    await Promise.all([
      this.messagePersistenceQueue.pause(),
      this.toolExecutionQueue.pause(),
      this.eventProcessingQueue.pause(),
    ]);
    logger.debug('MessageQueue: Queues paused ✓');

    // PASO 2: Wait for active jobs to complete (timeout 30s)
    logger.debug('MessageQueue: Waiting for active jobs to complete...');
    const timeout = 30000; // 30 seconds
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const [activeMP, activeTE, activeEP] = await Promise.all([
        this.messagePersistenceQueue.getActiveCount(),
        this.toolExecutionQueue.getActiveCount(),
        this.eventProcessingQueue.getActiveCount(),
      ]);

      if (activeMP === 0 && activeTE === 0 && activeEP === 0) {
        logger.debug('MessageQueue: All active jobs completed ✓');
        break;
      }

      await new Promise(resolve => setTimeout(resolve, 100)); // Poll every 100ms
    }

    // PASO 3: Close workers FIRST (stop processing)
    logger.debug('MessageQueue: Closing workers...');
    const workers = [
      this.messagePersistenceWorker,
      this.toolExecutionWorker,
      this.eventProcessingWorker,
    ].filter(w => w !== undefined);

    await Promise.all(
      workers.map(async (worker) => {
        if (worker) {
          await worker.close();
          logger.debug(`MessageQueue: Worker closed ✓`);
        }
      })
    );

    // PASO 4: Close queues SECOND
    logger.debug('MessageQueue: Closing queues...');
    await Promise.all([
      this.messagePersistenceQueue.close(),
      this.toolExecutionQueue.close(),
      this.eventProcessingQueue.close(),
    ]);
    logger.debug('MessageQueue: Queues closed ✓');

    // PASO 5: Close Redis connection LAST
    logger.debug('MessageQueue: Closing Redis connection...');
    await this.redis.quit();
    logger.info('MessageQueue: Graceful shutdown complete ✓');
  } catch (error) {
    // Log but DON'T rethrow (cleanup should be best-effort)
    logger.error('MessageQueue: Error during shutdown (non-fatal)', { error });

    // Try to force-close Redis as last resort
    try {
      await this.redis.disconnect();
    } catch (redisError) {
      logger.error('MessageQueue: Failed to force-close Redis', { redisError });
    }
  }
}
```

**Pros**:
- ✅ Mínimo cambio en arquitectura
- ✅ Respeta el diseño actual
- ✅ Tiempo estimado: 2-4 horas

**Cons**:
- ⚠️ Depende de BullMQ comportándose correctamente
- ⚠️ Timeout de 30s puede no ser suficiente

---

### Opción B: Rediseño del Test (ALTERNATIVA)

**Estrategia**: Reestructurar el test para no depender de cleanup complejo.

**Cambios Requeridos**:

1. **Separar tests** en múltiples archivos:
   - `MessageQueue.basic.integration.test.ts` - Init, connection
   - `MessageQueue.ratelimit.integration.test.ts` - Rate limiting
   - `MessageQueue.jobs.integration.test.ts` - Job operations

2. **Usar `beforeEach` + `afterEach`** en lugar de setup global:
   ```typescript
   describe('MessageQueue', () => {
     let messageQueue: MessageQueue;

     beforeEach(async () => {
       messageQueue = getMessageQueue({...});
       await messageQueue.waitForReady();
     });

     afterEach(async () => {
       // Close individual instance (más seguro)
       await messageQueue.close();
     });

     it('should rate limit', async () => {
       // Test individual
     });
   });
   ```

**Pros**:
- ✅ Cleanup más simple (por test, no global)
- ✅ Menor riesgo de race conditions

**Cons**:
- ❌ Más cambios en código de test
- ❌ Tiempo estimado: 4-6 horas

---

### Opción C: Tests Sin Workers (FALLBACK)

**Estrategia**: Testear solo operaciones de queue, no workers.

**Cambios Requeridos**:

```typescript
describe('MessageQueue - Queue Operations Only', () => {
  it('should add job to queue', async () => {
    const messageQueue = getMessageQueue({...});

    // SOLO agregar job (no procesarlo)
    await messageQueue.addMessagePersistence(job);

    // Verificar que está en queue
    const jobs = await messageQueue.messagePersistenceQueue.getJobs(['waiting']);
    expect(jobs).toHaveLength(1);

    // Cleanup simple (no workers involucrados)
    await messageQueue.messagePersistenceQueue.obliterate({ force: true });
    await messageQueue.redis.quit();
  });
});
```

**Pros**:
- ✅ Cleanup trivial (no workers)
- ✅ Tests rápidos

**Cons**:
- ❌ NO testea workers (pérdida de coverage)
- ❌ NO es test de integración real

---

## 📝 IMPLEMENTATION STEPS (Opción A - Recomendada)

### Paso 1: Análisis y Preparación (30 min)

1. **Leer código actual** de `MessageQueue.ts` método `close()`
2. **Verificar BullMQ docs** sobre graceful shutdown
3. **Confirmar orden correcto**: Workers → Queues → Redis

### Paso 2: Implementación del Fix (2 horas)

1. **Modificar `MessageQueue.ts`**:
   - Agregar pausa de queues
   - Agregar espera de jobs activos (con timeout)
   - Cerrar workers ANTES de queues
   - Mejorar error handling

2. **Agregar logging detallado**:
   - Cada paso del cierre debe loguear
   - Nivel DEBUG para troubleshooting

3. **Agregar test unitario**:
   ```typescript
   // backend/src/__tests__/unit/MessageQueue.close.test.ts
   describe('MessageQueue.close()', () => {
     it('should close in correct order: workers → queues → redis', async () => {
       const closeSpy = vi.fn();
       // Test del orden
     });
   });
   ```

### Paso 3: Testing Local (1 hora)

1. **Ejecutar 5 runs consecutivos**:
   ```bash
   for i in {1..5}; do npm run test:integration -- MessageQueue; done
   ```

2. **Verificar exit codes**: Todos deben ser 0

3. **Verificar stderr**: No debe haber "Connection is closed"

4. **Verificar conexiones Redis**:
   ```bash
   netstat -an | grep 6399 | grep ESTABLISHED
   ```

### Paso 4: Validación en CI (30 min)

1. **Push a branch** de prueba
2. **Verificar GitHub Actions** pasa
3. **Verificar pre-push hook** local funciona

### Paso 5: Documentation (30 min)

1. **Actualizar `US-004-bullmq-cleanup.md`** con solución
2. **Agregar comentarios** en código explicando el orden
3. **Actualizar CLAUDE.md** si es necesario

---

## ✅ VALIDATION CHECKLIST

### Pre-Merge Checklist

- [ ] **5 runs locales consecutivos**: Exit code 0
- [ ] **No errors en stderr**: grep "Connection is closed" = 0
- [ ] **No unhandled rejections**: grep "UnhandledPromise" = 0
- [ ] **Redis connections closed**: netstat check post-test
- [ ] **Pre-push hook**: 3 runs exitosos
- [ ] **CI/CD**: GitHub Actions pasa
- [ ] **Code review**: 2 approvals
- [ ] **QA sign-off**: Smoke test de 10 runs
- [ ] **Documentation**: US-004 actualizado

### Post-Merge Validation

- [ ] **Production monitoring**: Sin errores de cleanup
- [ ] **CI/CD stability**: 20 runs en 1 semana sin fallos
- [ ] **Developer feedback**: No reportes de problemas

---

## 🧪 TESTING STRATEGY (Principio de Infraestructura Real)

### Tests de Integración (Mantenidos)

**Archivo**: `backend/src/__tests__/integration/services/queue/MessageQueue.integration.test.ts`

**Infraestructura REAL Usada** (NO CAMBIAR):
- ✅ **Redis**: Docker container (port 6399) - `REDIS_TEST_CONFIG`
- ✅ **Azure SQL**: setupDatabaseForTests() - conexión real
- ✅ **BullMQ**: Queues + Workers reales procesando jobs
- ✅ **EventStore**: getEventStore() con Redis real

**Mocks Permitidos** (Ya existentes, MANTENER):
- ✅ **Logger**: vi.mock('@/utils/logger') - Utility, no afecta comportamiento

**NO AGREGAR MOCKS DE**:
- ❌ BullMQ Queue operations
- ❌ BullMQ Worker processing
- ❌ Redis operations
- ❌ Database operations

**Comentario Requerido** (Agregar al inicio del archivo):
```typescript
/**
 * INTEGRATION TEST - REAL INFRASTRUCTURE
 *
 * Infrastructure used:
 * - Redis: Docker container (localhost:6399) via REDIS_TEST_CONFIG
 * - Azure SQL: Real database connection via setupDatabaseForTests()
 * - BullMQ: Real queues and workers processing jobs
 * - EventStore: Real EventStore with Redis INCR for sequence numbers
 *
 * Mocks allowed:
 * - Logger utilities (infrastructure logging only)
 *
 * NO MOCKS of:
 * - MessageQueue service
 * - BullMQ Queue/Worker classes
 * - Redis client operations
 * - Database operations
 *
 * Purpose:
 * Validates that MessageQueue correctly manages BullMQ queues and workers,
 * including rate limiting (Redis INCR), job processing, and graceful shutdown.
 */
```

---

## 📊 METRICS & MONITORING

### Success Metrics

| Métrica | Baseline | Target | Actual | Status |
|---------|----------|--------|--------|--------|
| Exit Code Success Rate | 0% (always 1) | 100% | - | 🔴 |
| Tests Passing Rate | 100% (18/18) | 100% (18/18) | - | ✅ |
| Consecutive Runs | 0/5 | 5/5 | - | 🔴 |
| CI/CD Success Rate | 0% | 100% | - | 🔴 |

### Time Tracking

| Fase | Estimado | Actual | Notes |
|------|----------|--------|-------|
| Análisis | 30 min | - | |
| Implementación | 2 horas | - | |
| Testing Local | 1 hora | - | |
| CI Validation | 30 min | - | |
| Documentation | 30 min | - | |
| **TOTAL** | **4.5 horas** | - | |

---

## 🔗 REFERENCES

### Código Relevante
- `backend/src/services/queue/MessageQueue.ts:679-728` - Método close()
- `backend/src/__tests__/integration/services/queue/MessageQueue.integration.test.ts` - Tests afectados

### Documentación
- [BullMQ Graceful Shutdown](https://docs.bullmq.io/guide/going-to-production#graceful-shutdown)
- [PRD: Phase 1 Completion](../PRD-QA-PHASE1-COMPLETION.md)
- [US-004: BullMQ Cleanup](../US-004-bullmq-cleanup.md)

### Issues Relacionados
- US-004: BullMQ Cleanup (este task)
- US-001.6: MessageQueue True Integration (completado)

---

## 📝 NOTES

### Decisiones Técnicas

1. **Por qué Opción A**: Respeta el diseño actual, mínimo cambio
2. **Por qué cerrar workers primero**: Workers procesan jobs, deben terminar antes de cerrar queues
3. **Por qué timeout de 30s**: Balance entre esperar jobs y no bloquear tests
4. **Por qué no rethrow errors**: Cleanup debe ser best-effort, no bloquear

### Lecciones Aprendidas (Post-Implementation)

[A completar después de implementar]

---

**Última Actualización**: 2025-11-27
**Próxima Revisión**: Después de implementación
