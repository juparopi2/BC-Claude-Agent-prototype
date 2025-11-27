# US-004: Corregir Limpieza de Workers BullMQ

**Epic**: Servicios Core
**Prioridad**: P1 - Alta (Quick Win #2)
**Afecta**: MessageQueue.integration.test.ts
**Tests a Rehabilitar**: 18 tests
**Estimación**: 85 minutos

---

## Descripción

Como **desarrollador**, necesito que los workers de BullMQ se cierren correctamente al finalizar los tests, para evitar errores de "Connection is closed" y timeouts.

---

## Problema Actual

### Síntomas
- Tests fallan intermitentemente con: `Connection is closed`
- Vitest timeout durante afterEach/afterAll
- Workers disparan callbacks después de que Redis se cerró

### Causa Raíz
1. `MessageQueue.close()` no espera a que los workers terminen
2. Workers tienen event listeners que disparan después del cierre
3. afterEach() solo espera 100ms (insuficiente para graceful shutdown)
4. Conexiones Redis quedan abiertas y fallan al intentar operar

### Archivo Afectado
- `backend/src/__tests__/integration/queue/MessageQueue.integration.test.ts`
- Línea 56: `describe.skip('MessageQueue Integration Tests', ...)`

---

## Criterios de Aceptación

### Para Desarrollador

| # | Criterio | Verificación |
|---|----------|--------------|
| D1 | MessageQueue.close() retorna solo cuando todos los workers terminaron | Await completa sin timeout |
| D2 | No hay errores "Connection is closed" en logs | grep stderr vacío |
| D3 | No hay timeouts de conexión Redis | 18/18 tests pasan |
| D4 | 18/18 tests pasan consistentemente | 5 ejecuciones exitosas |

### Para QA

| # | Criterio | Comando de Verificación |
|---|----------|-------------------------|
| Q1 | Suite completa 10 veces → 0 errores de conexión | Loop de ejecución |
| Q2 | close() completa en < 5 segundos | Medir tiempo de cierre |
| Q3 | No hay memory leaks después de 50 ejecuciones | Monitorear memoria |

---

## Solución Técnica

### Archivo 1: `backend/src/services/queue/MessageQueue.ts`

Implementar graceful shutdown:

```typescript
async close(): Promise<void> {
  const logger = createChildLogger({ service: 'MessageQueue' });
  logger.info('Initiating MessageQueue shutdown...');

  const closePromises: Promise<void>[] = [];

  // Cerrar todos los workers primero (tienen event loops activos)
  for (const [name, worker] of this.workers.entries()) {
    logger.debug({ worker: name }, 'Closing worker');
    closePromises.push(
      worker.close().catch(err => {
        logger.warn({ err, worker: name }, 'Error closing worker');
      })
    );
  }

  // Cerrar todos los queue events
  for (const [name, events] of this.queueEvents.entries()) {
    logger.debug({ queue: name }, 'Closing queue events');
    closePromises.push(
      events.close().catch(err => {
        logger.warn({ err, queue: name }, 'Error closing queue events');
      })
    );
  }

  // Cerrar todas las queues
  for (const [name, queue] of this.queues.entries()) {
    logger.debug({ queue: name }, 'Closing queue');
    closePromises.push(
      queue.close().catch(err => {
        logger.warn({ err, queue: name }, 'Error closing queue');
      })
    );
  }

  // Esperar con timeout de 5 segundos
  await Promise.race([
    Promise.all(closePromises),
    new Promise<void>(resolve => setTimeout(() => {
      logger.warn('MessageQueue close timeout reached (5s)');
      resolve();
    }, 5000)),
  ]);

  // Limpiar referencias
  this.workers.clear();
  this.queueEvents.clear();
  this.queues.clear();

  logger.info('MessageQueue closed successfully');
}
```

### Archivo 2: `backend/src/__tests__/integration/queue/MessageQueue.integration.test.ts`

Aumentar tiempos de espera en cleanup:

```typescript
afterEach(async () => {
  if (messageQueue) {
    await messageQueue.close();
    // Aumentar de 100ms a 500ms para dar tiempo a cleanup
    await new Promise(resolve => setTimeout(resolve, 500));
    messageQueue = null;
  }
});

afterAll(async () => {
  // Asegurar cierre completo antes de limpiar Redis
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Limpiar keys de BullMQ
  if (redis) {
    const keys = await redis.keys('bull:*');
    if (keys.length > 0) {
      await redis.del(keys);
    }
    await redis.quit();
  }
}, 30000); // Aumentar timeout de afterAll
```

### Archivo 3: Remover describe.skip

```typescript
// ANTES (línea 56):
describe.skip('MessageQueue Integration Tests', () => {

// DESPUÉS:
describe('MessageQueue Integration Tests', () => {
```

---

## Tareas de Implementación

| # | Tarea | Archivo | Estimación |
|---|-------|---------|------------|
| 4.1 | Implementar close() con graceful shutdown | MessageQueue.ts | 45 min |
| 4.2 | Aumentar timeouts en test cleanup | MessageQueue.integration.test.ts | 10 min |
| 4.3 | Añadir logging de cierre | MessageQueue.ts | 10 min |
| 4.4 | Remover describe.skip | MessageQueue.integration.test.ts | 5 min |
| 4.5 | Ejecutar suite completa 5 veces | - | 15 min |

**Total**: 85 minutos

---

## Validación

### Comando de Ejecución

```bash
cd backend && npm run test:integration -- --grep "MessageQueue"
```

### Test de Estabilidad (5 ejecuciones)

```bash
# Windows PowerShell
for ($i=1; $i -le 5; $i++) { npm run test:integration -- --grep "MessageQueue" }

# Bash
for i in {1..5}; do npm run test:integration -- --grep "MessageQueue"; done
```

### Resultado Esperado

```
✓ should enqueue message event
✓ should process message in order
✓ should handle failed jobs with retry
✓ should respect rate limits per session
✓ should isolate queues per session
... (18 tests total)

Test Files  1 passed (1)
Tests       18 passed (18)
```

### Verificación de Cleanup

```bash
# Después de tests, verificar que no hay keys residuales
redis-cli -p 6399 KEYS "bull:*" | wc -l
# Esperado: 0
```

---

## Dependencias

- **Requiere**: Ninguna (puede implementarse independientemente)
- **Habilita**: US-005 (Validación Final)

---

## Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| BullMQ close() tiene bugs internos | Baja | Alto | Timeout forzado de 5s |
| Workers no responden a close() | Media | Alto | Force kill después de timeout |
| Memory leaks acumulativos | Baja | Medio | Monitorear en CI |

---

## Referencias

- Test file: `backend/src/__tests__/integration/queue/MessageQueue.integration.test.ts`
- Source file: `backend/src/services/queue/MessageQueue.ts`
- PRD: [PRD-INTEGRATION-TESTS.md](PRD-INTEGRATION-TESTS.md)
- QA Checklist: [templates/QA-CHECKLIST-US-004.md](templates/QA-CHECKLIST-US-004.md)
