# TASK-002: Arreglar Race Condition en BCTokenManager

**Prioridad**: 🔴 CRÍTICA (Production Risk)
**Estimación**: 3-4 horas
**Sprint**: 1 (Días 3-4)
**Owner**: Dev + QA
**Status**: 🔴 NOT STARTED

---

## 📋 PROBLEM STATEMENT

### Descripción del Problema

El servicio `BCTokenManager` tiene un **race condition conocido y documentado** donde múltiples requests concurrentes de refresh token NO están deduplicados, causando que **múltiples llamadas a Microsoft OAuth API** ocurran simultáneamente para el mismo usuario.

**Anti-Pattern Actual**: El test documenta el problema pero NO lo arregla.

**Archivo Problemático**: `backend/src/__tests__/unit/BCTokenManager.raceCondition.test.ts`

**Líneas 59-104**:
```typescript
it('should demonstrate race condition with concurrent getBCToken calls (KNOWN ISSUE)', async () => {
  // PROBLEMA: Test DOCUMENTA race condition pero NO lo arregla
  expect(refreshCallCount).toBeGreaterThanOrEqual(1);
  // Comment: "In an ideal world, only 1 refresh should happen"
});
```

**Líneas 357-361** (Placeholder Test):
```typescript
it('should acknowledge race condition exists and document fix approach', () => {
  expect(true).toBe(true); // ANTI-PATTERN: Siempre pasa
});
```

### Impacto en Producción

| Escenario | Sin Fix | Con Fix |
|-----------|---------|---------|
| **10 requests concurrentes** | 10 llamadas a OAuth | 1 llamada a OAuth |
| **Rate Limiting de Microsoft** | ✅ Probable (429 Too Many Requests) | ❌ Evitado |
| **Latencia** | 10x latencia (10 requests en paralelo) | 1x latencia (1 request, 9 esperan) |
| **Costos** | 10x calls innecesarias | 1x call |
| **Error Rate** | Alto (rate limit errors) | Bajo |

### Ejemplo de Producción

```typescript
// Escenario: 3 usuarios cargan la página simultáneamente

// SIN FIX (Actual):
User1 → getBCToken('user123', 'refresh') → OAuth Call #1 ❌
User1 → getBCToken('user123', 'refresh') → OAuth Call #2 ❌ (duplicado)
User1 → getBCToken('user123', 'refresh') → OAuth Call #3 ❌ (duplicado)
// Resultado: 3 llamadas para el mismo usuario

// CON FIX (Esperado):
User1 → getBCToken('user123', 'refresh') → OAuth Call #1 ✅
User1 → getBCToken('user123', 'refresh') → Espera result de Call #1 ✅
User1 → getBCToken('user123', 'refresh') → Espera result de Call #1 ✅
// Resultado: 1 llamada, 2 esperan el resultado
```

---

## 🎯 SUCCESS CRITERIA (Extremadamente Riguroso)

### Criterios Funcionales

#### 1. Deduplicación de Refreshes (100% Required)

| Test | Input | Expected Behavior | Validation |
|------|-------|------------------|------------|
| **2 concurrent refreshes** | 2x getBCToken('user1', 'refresh') | 1 OAuth call, 2 promises resolved with same token | Mock OAuth spy count |
| **10 concurrent refreshes** | 10x getBCToken('user1', 'refresh') | 1 OAuth call, 10 promises resolved | Mock OAuth spy count |
| **100 concurrent refreshes** | 100x getBCToken('user1', 'refresh') | 1 OAuth call, 100 promises resolved | Stress test |
| **Multiple users** | 3 users × 5 refreshes each | 3 OAuth calls (1 per user), 15 promises | Isolation test |

**Comando de Validación**:
```typescript
// Test debe pasar 100 veces consecutivas
for (let i = 0; i < 100; i++) {
  const promises = Array.from({ length: 10 }, () =>
    tokenManager.getBCToken('user123', 'refresh')
  );
  const results = await Promise.all(promises);

  // Validar: 1 OAuth call
  expect(mockOAuthClient.refreshToken).toHaveBeenCalledTimes(1);

  // Validar: 10 resultados idénticos
  expect(new Set(results).size).toBe(1);

  // Reset for next iteration
  mockOAuthClient.refreshToken.mockClear();
}
```

#### 2. Error Handling (Required)

| Scenario | Expected Behavior | Validation |
|----------|------------------|------------|
| **OAuth fails during refresh** | All waiting promises reject with same error | Test with mock rejection |
| **Timeout during refresh** | All waiting promises reject with timeout error | Test with 30s timeout |
| **Network error** | All waiting promises reject, retry on next call | Test network failure |
| **Partial failure** | First promise succeeds, subsequent use cached result | Test error recovery |

#### 3. Memory Management (Required)

| Aspect | Target | Validation Method |
|--------|--------|-------------------|
| **Promise Map Size** | 0 after all refreshes complete | Check `refreshPromises.size` |
| **Promise Cleanup** | Cleaned even on error | Test with failing refresh |
| **Memory Leaks** | None detected | Run with `--expose-gc` |
| **Long-Running Process** | No accumulation over 1000 refreshes | Stress test |

---

### Criterios No Funcionales

#### 4. Test Quality

| Aspecto | Current | Target | Status |
|---------|---------|--------|--------|
| **Placeholder Tests** | 1 test (línea 357) | 0 tests | 🔴 TO FIX |
| **"KNOWN ISSUE" Tests** | 1 test (línea 59) | 0 tests | 🔴 TO FIX |
| **Real Behavior Tests** | 0 tests | 3+ tests (concurrent, error, multi-user) | 🔴 TO ADD |
| **Coverage** | ~60% | 80%+ | 🔴 TO INCREASE |

#### 5. Production Readiness

| Check | Target | Validation |
|-------|--------|------------|
| **Rate Limit Protection** | < 10 OAuth calls/min per user | Monitor logs |
| **Latency Impact** | No additional latency vs single call | Benchmark |
| **Concurrency Support** | 100 concurrent users | Load test |
| **Error Recovery** | Retry on next request after failure | Test error scenarios |

---

## 🔧 IMPLEMENTATION SOLUTION

### Solución: Promise Deduplication Pattern

**Archivo a Modificar**: `backend/src/services/auth/BCTokenManager.ts`

**Cambios Requeridos**:

```typescript
// backend/src/services/auth/BCTokenManager.ts

export class BCTokenManager {
  // AGREGAR: Map para deduplicación de refreshes concurrentes
  private refreshPromises = new Map<string, Promise<string>>();

  /**
   * Get BC token for user with deduplication of concurrent refreshes
   *
   * @param userId - User ID
   * @param mode - 'refresh' (force refresh) or 'use' (return existing if valid)
   * @returns Access token
   *
   * CONCURRENCY GUARANTEE:
   * Multiple concurrent calls to getBCToken(userId, 'refresh') will result in
   * ONLY ONE actual OAuth refresh call. All concurrent callers will wait for
   * and receive the same refreshed token.
   */
  async getBCToken(userId: string, mode: 'refresh' | 'use' = 'use'): Promise<string> {
    if (mode === 'refresh') {
      return this._getOrCreateRefreshPromise(userId);
    }

    // Existing 'use' logic (unchanged)
    const existingToken = await this._getExistingToken(userId);
    if (existingToken) {
      return existingToken;
    }

    // Token expired or doesn't exist, refresh
    return this._getOrCreateRefreshPromise(userId);
  }

  /**
   * Get existing refresh promise or create new one (deduplication)
   *
   * PATTERN: Promise Deduplication
   * - If refresh already in progress, return existing promise
   * - If no refresh in progress, create new promise and store in map
   * - Always cleanup promise from map after completion (success or error)
   *
   * @private
   */
  private async _getOrCreateRefreshPromise(userId: string): Promise<string> {
    const key = `refresh:${userId}`;

    // Check if refresh already in progress
    if (this.refreshPromises.has(key)) {
      logger.debug('BCTokenManager: Reusing existing refresh promise', { userId });
      return this.refreshPromises.get(key)!;
    }

    // Create new refresh promise
    logger.debug('BCTokenManager: Creating new refresh promise', { userId });
    const promise = this._doRefresh(userId);

    // Store promise in map
    this.refreshPromises.set(key, promise);

    // Cleanup promise from map after completion (success or failure)
    try {
      const result = await promise;
      logger.debug('BCTokenManager: Refresh completed successfully', { userId });
      return result;
    } catch (error) {
      logger.error('BCTokenManager: Refresh failed', { userId, error });
      throw error;
    } finally {
      // CRITICAL: Always cleanup, even on error
      this.refreshPromises.delete(key);
      logger.debug('BCTokenManager: Refresh promise cleaned up', { userId });
    }
  }

  /**
   * Perform actual token refresh (called by _getOrCreateRefreshPromise)
   *
   * @private
   */
  private async _doRefresh(userId: string): Promise<string> {
    // Existing refresh logic (unchanged)
    // 1. Get user from database
    // 2. Decrypt refresh token
    // 3. Call Microsoft OAuth to refresh
    // 4. Encrypt new tokens
    // 5. Update database
    // 6. Return new access token

    // ... existing implementation ...
  }
}
```

### Diagrama de Flujo

```
┌─────────────────────────────────────────────────────────────────┐
│                   CONCURRENT REFRESH FLOW                       │
└─────────────────────────────────────────────────────────────────┘

Request #1 (arrives at t=0ms):
  ├─> getBCToken('user123', 'refresh')
  ├─> Check refreshPromises.has('refresh:user123') → FALSE
  ├─> Create promise = _doRefresh('user123')
  ├─> Store in refreshPromises.set('refresh:user123', promise)
  └─> await promise → [WAITING...]

Request #2 (arrives at t=5ms):
  ├─> getBCToken('user123', 'refresh')
  ├─> Check refreshPromises.has('refresh:user123') → TRUE ✅
  ├─> Reuse existing promise
  └─> await promise → [WAITING...]

Request #3 (arrives at t=10ms):
  ├─> getBCToken('user123', 'refresh')
  ├─> Check refreshPromises.has('refresh:user123') → TRUE ✅
  ├─> Reuse existing promise
  └─> await promise → [WAITING...]

[t=150ms] OAuth refresh completes:
  ├─> promise resolves with token: "new_access_token_xyz"
  ├─> Request #1 receives token ✅
  ├─> Request #2 receives token ✅
  ├─> Request #3 receives token ✅
  └─> finally { refreshPromises.delete('refresh:user123') } → Cleanup

Total OAuth calls: 1 (deduplication successful)
```

---

## 📝 IMPLEMENTATION STEPS

### Paso 1: Implementar Deduplicación (1.5 horas)

1. **Agregar property `refreshPromises`** a BCTokenManager class
2. **Crear método `_getOrCreateRefreshPromise()`**
3. **Refactorizar `getBCToken()`** para usar nuevo método
4. **Agregar logging** en puntos clave (create, reuse, cleanup)

### Paso 2: Actualizar Tests (1 hora)

1. **Remover placeholder test** (línea 357-361)
2. **Reescribir "KNOWN ISSUE" test** (línea 59-104):
   ```typescript
   it('should deduplicate concurrent token refreshes', async () => {
     // Setup: 10 concurrent refresh requests
     const promises = Array.from({ length: 10 }, () =>
       tokenManager.getBCToken('user123', 'refresh')
     );

     // Execute
     const results = await Promise.all(promises);

     // Assert: Only 1 OAuth call
     expect(mockOAuthClient.refreshToken).toHaveBeenCalledTimes(1);

     // Assert: All results are identical
     expect(new Set(results).size).toBe(1);

     // Assert: Promise map is empty (cleaned up)
     expect(tokenManager['refreshPromises'].size).toBe(0);
   });
   ```

3. **Agregar test de error handling**:
   ```typescript
   it('should reject all concurrent callers if refresh fails', async () => {
     mockOAuthClient.refreshToken.mockRejectedValue(new Error('OAuth failed'));

     const promises = Array.from({ length: 5 }, () =>
       tokenManager.getBCToken('user123', 'refresh')
     );

     // All should reject with same error
     await expect(Promise.all(promises)).rejects.toThrow('OAuth failed');

     // Promise map should be cleaned up
     expect(tokenManager['refreshPromises'].size).toBe(0);
   });
   ```

4. **Agregar test de multiple users**:
   ```typescript
   it('should isolate refreshes per user', async () => {
     const user1Promises = Array.from({ length: 5 }, () =>
       tokenManager.getBCToken('user1', 'refresh')
     );
     const user2Promises = Array.from({ length: 5 }, () =>
       tokenManager.getBCToken('user2', 'refresh')
     );

     await Promise.all([...user1Promises, ...user2Promises]);

     // Should be 2 OAuth calls (1 per user)
     expect(mockOAuthClient.refreshToken).toHaveBeenCalledTimes(2);
   });
   ```

### Paso 3: Testing Local (30 min)

1. **Ejecutar tests unitarios**:
   ```bash
   npm test -- BCTokenManager.raceCondition.test.ts
   ```

2. **Ejecutar 100 veces para detectar race conditions**:
   ```bash
   for i in {1..100}; do
     npm test -- BCTokenManager.raceCondition.test.ts
     if [ $? -ne 0 ]; then
       echo "FAILED at iteration $i"
       exit 1
     fi
   done
   ```

3. **Verificar memory leaks**:
   ```bash
   node --expose-gc node_modules/.bin/vitest BCTokenManager.raceCondition.test.ts
   ```

### Paso 4: Integration Test (30 min)

Crear test de integración que valide el fix con servicios reales:

```typescript
// backend/src/__tests__/integration/auth/BCTokenManager.integration.test.ts

describe('BCTokenManager Integration - Race Condition', () => {
  it('should deduplicate concurrent refreshes with REAL database', async () => {
    // Setup: Real user in database
    const userId = await createTestUser();

    // Spy on OAuth client (mock external API, not internal logic)
    const oauthSpy = vi.spyOn(mockOAuthClient, 'refreshToken');

    // Execute: 10 concurrent refreshes
    const promises = Array.from({ length: 10 }, () =>
      tokenManager.getBCToken(userId, 'refresh')
    );

    const results = await Promise.all(promises);

    // Validate: Only 1 OAuth call
    expect(oauthSpy).toHaveBeenCalledTimes(1);

    // Validate: All results are valid tokens
    results.forEach(token => {
      expect(token).toBeTruthy();
      expect(typeof token).toBe('string');
    });

    // Validate: Token persisted in database
    const user = await getUserById(userId);
    expect(user.bc_access_token_encrypted).toBeTruthy();

    // Cleanup
    await deleteTestUser(userId);
  });
});
```

### Paso 5: Documentation (30 min)

1. **Actualizar JSDoc** en BCTokenManager methods
2. **Actualizar CLAUDE.md** con patrón de deduplicación
3. **Crear ejemplo** en docs/ si es necesario

---

## ✅ VALIDATION CHECKLIST

### Pre-Merge Checklist

- [ ] **Implementation**: Deduplicación implementada
- [ ] **Placeholder test removed**: Línea 357-361 eliminada
- [ ] **"KNOWN ISSUE" test fixed**: Línea 59-104 reescrita
- [ ] **New tests added**: Concurrent, error handling, multi-user
- [ ] **100 runs locales**: 100/100 passing
- [ ] **Memory check**: No leaks con --expose-gc
- [ ] **Integration test**: Con database real
- [ ] **Code review**: 2 approvals
- [ ] **QA sign-off**: Stress test validado

### Post-Merge Validation

- [ ] **Production monitoring**: Tasa de OAuth calls/min
- [ ] **Rate limit incidents**: 0 en 1 semana
- [ ] **Error rate**: < 0.1% en refreshes
- [ ] **Latency**: Sin degradación

---

## 🧪 TESTING STRATEGY (Principio de Infraestructura Real)

### Tests Unitarios (Con Mocks Controlados)

**Archivo**: `backend/src/__tests__/unit/BCTokenManager.raceCondition.test.ts`

**Mocks Permitidos** (External Dependencies):
- ✅ **OAuth Client**: Mock de `MicrosoftOAuthService` (external API)
- ✅ **Database**: Mock de `executeQuery` (para unit tests de lógica)
- ✅ **Crypto**: Mock de encryption (para tests de concurrencia)

**NO Mockear** (Internal Logic):
- ❌ `refreshPromises` Map (debe ser real)
- ❌ Promise deduplication logic
- ❌ Error handling flow

### Tests de Integración (Infraestructura REAL)

**Archivo** (NUEVO): `backend/src/__tests__/integration/auth/BCTokenManager.integration.test.ts`

**Infraestructura REAL Usada**:
- ✅ **Azure SQL**: Real database connection via setupDatabaseForTests()
- ✅ **Encryption**: Real AES-256-GCM encryption (no mock)
- ✅ **Promise Deduplication**: Real `refreshPromises` Map

**Mock Permitido** (External Only):
- ✅ **Microsoft OAuth API**: FakeOAuthClient (external API)

**Comentario Requerido**:
```typescript
/**
 * INTEGRATION TEST - REAL INFRASTRUCTURE
 *
 * Infrastructure used:
 * - Azure SQL: Real database via setupDatabaseForTests()
 * - Encryption: Real AES-256-GCM via crypto.randomBytes()
 * - Promise Map: Real Map for deduplication
 *
 * Mocks allowed:
 * - Microsoft OAuth API (external service)
 *
 * NO MOCKS of:
 * - BCTokenManager service logic
 * - Database operations (encrypt, persist, retrieve)
 * - Promise deduplication mechanism
 *
 * Purpose:
 * Validates that concurrent refresh token requests are correctly
 * deduplicated, persisted to database, and encrypted securely.
 */
```

---

## 📊 METRICS & MONITORING

### Success Metrics

| Métrica | Baseline | Target | Post-Fix | Status |
|---------|----------|--------|----------|--------|
| OAuth Calls per User (10 concurrent) | 10 calls | 1 call | - | 🔴 |
| Memory Leaks | Unknown | 0 leaks | - | 🔴 |
| Test Placeholder Count | 1 test | 0 tests | - | 🔴 |
| "KNOWN ISSUE" Count | 1 test | 0 tests | - | 🔴 |

### Time Tracking

| Fase | Estimado | Actual | Notes |
|------|----------|--------|-------|
| Implementation | 1.5 horas | - | |
| Tests Update | 1 hora | - | |
| Local Testing | 30 min | - | |
| Integration Test | 30 min | - | |
| Documentation | 30 min | - | |
| **TOTAL** | **4 horas** | - | |

---

## 🔗 REFERENCES

### Código Relevante
- `backend/src/services/auth/BCTokenManager.ts` - Service a modificar
- `backend/src/__tests__/unit/BCTokenManager.raceCondition.test.ts:59-104` - Test "KNOWN ISSUE"
- `backend/src/__tests__/unit/BCTokenManager.raceCondition.test.ts:357-361` - Placeholder test

### Documentación
- [PRD: Phase 1 Completion](../PRD-QA-PHASE1-COMPLETION.md)
- [QA Master Audit Report](C:\Users\juanp\.claude\plans\scalable-shimmying-kay.md)

---

**Última Actualización**: 2025-11-27
**Próxima Revisión**: Después de implementación
