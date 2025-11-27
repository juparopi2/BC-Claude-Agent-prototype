# US-002: Corregir Aislamiento de Sesiones Redis (UUID Case Sensitivity)

**Epic**: Multi-tenant Security
**Prioridad**: P0 - Critica
**Afecta**: session-isolation.integration.test.ts, sequence-numbers.integration.test.ts
**Tests a Rehabilitar**: 7 tests (session-isolation) + 8 tests (sequence-numbers)
**Estimacion Original**: 75 minutos
**Estimacion Revisada**: 3-4 horas (incluye fixes de infraestructura)
**Estado**: ✅ COMPLETADO (2024-11-26)

---

## IMPLEMENTACION COMPLETADA (2024-11-26)

### Fixes Aplicados

| # | Archivo | Linea | Cambio |
|---|---------|-------|--------|
| 1 | `ChatMessageHandler.ts` | 95-97 | Agregado `.toLowerCase()` a comparación UUID (CÓDIGO PRODUCCIÓN) |
| 2 | `session-isolation.integration.test.ts` | 87-89 | Agregado `.toLowerCase()` al asignar socket.userId |
| 3 | `TestSessionFactory.ts` | 191-204 | Agregado `.toLowerCase()` a microsoftOAuth.userId |
| 4 | `sequence-numbers.integration.test.ts` | 10-47 | Cambio a inicialización explícita de DB/Redis |

### Resultados Post-Fix

```
session-isolation.integration.test.ts: 7/7 passed ✅
sequence-numbers.integration.test.ts: 8/8 passed ✅

Full suite: 65 passed, 6 skipped (71 total)
3 consecutive successful runs verified
```

---

## AUDITORIA QA PREVIA (2024-11-26)

### Veredicto: NO ACEPTADO (resuelto)

La documentacion decia "COMPLETADO" pero la ejecucion real de tests muestra:

| Suite | Esperado | Real | Estado |
|-------|----------|------|--------|
| session-isolation | 7/7 pass | 3/7 pass, 4/7 fail | **FALLA** |
| sequence-numbers | 8/8 pass | 0/8 pass | **FALLA CRITICA** |

### Resultados de Tests (2024-11-26 17:46 EST)

```
session-isolation.integration.test.ts (7 tests | 4 failed)
  Session Access Control
    [PASS] should prevent User A from joining User B session (1595ms)
    [FAIL] should allow User B to join their own session (997ms)
           -> Error: UNAUTHORIZED
    [PASS] should prevent User A from sending messages to User B session (2017ms)
  Event Isolation
    [FAIL] should not leak events between users (1677ms)
           -> Error: UNAUTHORIZED
    [FAIL] should use authenticated userId, not payload userId (1011ms)
           -> Error: UNAUTHORIZED
  Cross-Tenant Attack Prevention
    [PASS] should reject session enumeration attempts (1877ms)
    [FAIL] should not allow access to sessions by guessing IDs (1904ms)
           -> Error: UNAUTHORIZED

sequence-numbers.integration.test.ts (8 tests | 8 failed)
  [FAIL] ALL TESTS
         -> Error: Database not connected. Call initDatabase() first.
```

---

## Problema 1: UUID Case Sensitivity (PARCIALMENTE RESUELTO)

### Diagnostico

La correccion en `session-ownership.ts` existe pero **no se aplica consistentemente**:

**Log de error real:**
```
attemptedByUserId: "322a1bac-77db-4a15-b1f0-48a51604642b"  (lowercase)
actualOwnerId: "322A1BAC-77DB-4A15-B1F0-48A51604642B"      (UPPERCASE)
```

### Donde esta el fix correcto (YA EXISTE):

**`backend/src/utils/session-ownership.ts:292-320`**
```typescript
export function timingSafeCompare(a: string, b: string): boolean {
  // Normalize to lowercase for case-insensitive UUID comparison
  const normalizedA = a.toLowerCase();
  const normalizedB = b.toLowerCase();
  // ... resto del codigo
}
```

### Donde FALTA la normalizacion:

1. **`session-isolation.integration.test.ts:87-88`** - El socket middleware:
   ```typescript
   // ACTUAL (sin normalizacion):
   (socket as Socket & { userId?: string }).userId = sessionData.microsoftOAuth.userId;

   // DEBERIA SER:
   (socket as Socket & { userId?: string }).userId = sessionData.microsoftOAuth.userId?.toLowerCase();
   ```

2. **`TestSessionFactory.ts:201-202`** - Al crear sessionData:
   ```typescript
   // ACTUAL:
   microsoftOAuth: {
     userId,  // NO normalizado
     email,
     // ...
   }

   // DEBERIA SER:
   microsoftOAuth: {
     userId: userId.toLowerCase(),  // NORMALIZADO
     email,
     // ...
   }
   ```

---

## Problema 2: Database Initialization (CRITICO - BLOQUEANTE)

### Diagnostico

Los 8 tests de `sequence-numbers` fallan con:
```
Error: Database not connected. Call initDatabase() first.
```

### Causa Raiz

**`backend/src/__tests__/integration/helpers/TestDatabaseSetup.ts:31-36`**

```typescript
// PROBLEMA: Variables globales de estado
let isDatabaseInitialized = false;
let isRedisInitialized = false;
```

Vitest ejecuta tests en **workers separados**. El estado del singleton NO se comparte entre workers.

### Flujo del Bug:

```
Worker 1 (e2e-token-persistence)     Worker 2 (sequence-numbers)
    |                                      |
    v                                      v
setupDatabaseForTests()              setupDatabaseForTests()
    |                                      |
    v                                      v
beforeAll() ejecuta                  beforeAll() NO ejecuta
isDatabaseInitialized = true         (ya se "ejecuto" en otro worker?)
    |                                      |
    v                                      v
Tests PASAN                          Tests FALLAN: "Database not connected"
```

### Solucion Requerida

**Opcion A: Forzar ejecucion serial** (Rapido, menos ideal)

```typescript
// vitest.integration.config.ts
export default defineConfig({
  test: {
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true }
    },
  }
});
```

**Opcion B: Inicializacion por worker** (Correcto, mas trabajo)

```typescript
// TestDatabaseSetup.ts
const workerState = new Map<string, { db: boolean; redis: boolean }>();

function getWorkerKey(): string {
  return `${process.pid}_${process.env.VITEST_POOL_ID || 'main'}`;
}

export async function ensureDatabaseAvailable(): Promise<void> {
  const key = getWorkerKey();
  if (workerState.get(key)?.db) return;

  await initDatabase();
  workerState.set(key, { ...workerState.get(key), db: true });
}
```

---

## Criterios de Aceptacion (ACTUALIZADOS)

### Para que US-002 sea ACEPTADA:

| # | Criterio | Verificacion | Estado Actual |
|---|----------|--------------|---------------|
| 1 | 7/7 tests de session-isolation PASAN | `npm run test:integration -- session-isolation` | 3/7 |
| 2 | 8/8 tests de sequence-numbers PASAN | `npm run test:integration -- sequence-numbers` | 0/8 |
| 3 | Sin `describe.skip` en tests habilitados | grep -r "describe.skip" | OK |
| 4 | 3 ejecuciones consecutivas sin fallas | Ejecutar 3 veces seguidas | NO |
| 5 | Tests de connection siguen pasando | `npm run test:integration -- connection` | OK (9/9) |

### Matriz de Tests Especificos:

```
session-isolation (7 tests):
[ ] should prevent User A from joining User B session
[ ] should allow User B to join their own session          <- FALLA
[ ] should prevent User A from sending messages to User B session
[ ] should not leak events between users                   <- FALLA
[ ] should use authenticated userId, not payload userId    <- FALLA
[ ] should reject session enumeration attempts
[ ] should not allow access to sessions by guessing IDs    <- FALLA

sequence-numbers (8 tests):
[ ] should generate sequential sequence numbers            <- FALLA (DB)
[ ] should handle concurrent event appends atomically      <- FALLA (DB)
[ ] should isolate sequence numbers per session            <- FALLA (DB)
[ ] should allow reconstruction of conversation order      <- FALLA (DB)
[ ] should use correct Redis key format                    <- FALLA (DB)
[ ] should persist sequence across multiple append calls   <- FALLA (DB)
[ ] should handle very high sequence numbers               <- FALLA (DB)
[ ] should handle rapid sequential appends                 <- FALLA (DB)
```

---

## Tareas de Implementacion (REVISADAS)

### Fase 1: Fix Database Initialization (BLOQUEANTE)

| # | Tarea | Archivo | Tiempo |
|---|-------|---------|--------|
| 1.1 | Elegir estrategia (serial vs per-worker) | - | 15 min |
| 1.2 | Implementar fix de inicializacion | TestDatabaseSetup.ts | 45 min |
| 1.3 | Verificar sequence-numbers pasan | - | 10 min |

**Tiempo Fase 1**: ~70 minutos

### Fase 2: Fix UUID Normalization

| # | Tarea | Archivo | Tiempo |
|---|-------|---------|--------|
| 2.1 | Agregar `.toLowerCase()` en socket middleware | session-isolation.integration.test.ts:87 | 5 min |
| 2.2 | Agregar `.toLowerCase()` en TestSessionFactory | TestSessionFactory.ts:201 | 5 min |
| 2.3 | Verificar session-isolation pasan | - | 10 min |

**Tiempo Fase 2**: ~20 minutos

### Fase 3: Validacion QA

| # | Tarea | Tiempo |
|---|-------|--------|
| 3.1 | Ejecutar suite completa 3 veces | 15 min |
| 3.2 | Verificar no regresiones en connection/token-persistence | 5 min |
| 3.3 | Documentar resultados | 10 min |

**Tiempo Fase 3**: ~30 minutos

**Tiempo Total Revisado**: ~2 horas

---

## Archivos a Modificar

### 1. `backend/src/__tests__/integration/helpers/TestDatabaseSetup.ts`

**Problema**: Singleton state no funciona con workers de Vitest.

**Lineas afectadas**: 31-36, 92-111

**Cambio requerido**: Implementar tracking de estado per-worker o forzar ejecucion serial.

### 2. `backend/src/__tests__/integration/multi-tenant/session-isolation.integration.test.ts`

**Problema**: Socket middleware no normaliza userId.

**Lineas afectadas**: 87-88

**Cambio requerido**:
```typescript
// Linea 87-88 ANTES:
(socket as Socket & { userId?: string }).userId = sessionData.microsoftOAuth.userId;

// DESPUES:
(socket as Socket & { userId?: string }).userId = sessionData.microsoftOAuth.userId?.toLowerCase();
```

### 3. `backend/src/__tests__/integration/helpers/TestSessionFactory.ts`

**Problema**: userId no normalizado al crear session en Redis.

**Lineas afectadas**: 201-202

**Cambio requerido**:
```typescript
// Linea 201-202 ANTES:
microsoftOAuth: {
  userId,

// DESPUES:
microsoftOAuth: {
  userId: userId.toLowerCase(),
```

### 4. (OPCIONAL) `backend/vitest.integration.config.ts`

**Si se elige Opcion A (ejecucion serial)**:
```typescript
export default defineConfig({
  test: {
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  }
});
```

---

## Comandos de Verificacion

### Verificar estado actual:
```bash
cd backend && npm run test:integration
```

### Verificar solo session-isolation:
```bash
cd backend && npx vitest run --config vitest.integration.config.ts src/__tests__/integration/multi-tenant/session-isolation.integration.test.ts
```

### Verificar solo sequence-numbers:
```bash
cd backend && npx vitest run --config vitest.integration.config.ts src/__tests__/integration/event-ordering/sequence-numbers.integration.test.ts
```

### Verificar 3 ejecuciones consecutivas:
```bash
cd backend
for i in 1 2 3; do echo "=== Run $i ===" && npm run test:integration && echo "PASS" || echo "FAIL"; done
```

---

## Success Criteria (DEFINICION DE DONE)

US-002 estara **COMPLETADA** cuando:

1. **Tests Pasan**:
   ```
   session-isolation.integration.test.ts: 7 passed (7)
   sequence-numbers.integration.test.ts: 8 passed (8)
   ```

2. **Sin Fallas Intermitentes**:
   - 3 ejecuciones consecutivas exitosas
   - No hay "flaky tests"

3. **Sin Regresiones**:
   - connection.integration.test.ts: 9 passed
   - e2e-token-persistence.integration.test.ts: 15 passed
   - MessageQueue.integration.test.ts: 18 passed

4. **Codigo Limpio**:
   - Sin `describe.skip` en tests rehabilitados
   - Sin `// TODO` relacionados a UUID case sensitivity

5. **Documentacion**:
   - Este documento actualizado con estado COMPLETADO
   - PRD-INTEGRATION-TESTS.md actualizado

---

## Dependencias

| Dependencia | Tipo | Estado |
|-------------|------|--------|
| US-001 (Database race condition) | Requiere | COMPLETADO |
| Docker Redis (localhost:6399) | Infraestructura | Requerido |
| Azure SQL Database | Infraestructura | Requerido |

---

## Riesgos Identificados

| Riesgo | Probabilidad | Impacto | Mitigacion |
|--------|--------------|---------|------------|
| Fix de DB initialization rompe otros tests | Media | Alto | Ejecutar suite completa despues de cambios |
| Workers de Vitest tienen comportamiento diferente en CI | Media | Alto | Probar en CI antes de merge |
| toLowerCase() no cubre todos los code paths | Baja | Alto | Buscar todas las comparaciones de userId |

---

## Historial de Cambios

| Fecha | Version | Cambio |
|-------|---------|--------|
| 2024-11-26 | 1.0 | PRD inicial |
| 2024-11-26 | 1.1 | Marcado como COMPLETADO (erroneo) |
| 2024-11-26 | 2.0 | **AUDITORIA QA**: Rechazado. Documentados problemas reales de DB init y UUID normalization. Criterios de aceptacion actualizados. |

---

## Referencias

- Test file: `backend/src/__tests__/integration/multi-tenant/session-isolation.integration.test.ts`
- Test file: `backend/src/__tests__/integration/event-ordering/sequence-numbers.integration.test.ts`
- Session factory: `backend/src/__tests__/integration/helpers/TestSessionFactory.ts`
- Database setup: `backend/src/__tests__/integration/helpers/TestDatabaseSetup.ts`
- Session ownership: `backend/src/utils/session-ownership.ts`
- PRD: [PRD-INTEGRATION-TESTS.md](PRD-INTEGRATION-TESTS.md)
