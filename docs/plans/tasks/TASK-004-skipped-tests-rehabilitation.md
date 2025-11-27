# TASK-004: Rehabilitar Tests Skipped

**Prioridad**: 🟡 ALTA (CI/CD Health)
**Estimación**: 3-4 horas
**Sprint**: 3 (Días 1-2)
**Owner**: Dev + QA
**Status**: 🔴 NOT STARTED

---

## 📋 PROBLEM STATEMENT

### Descripción del Problema

Hay **3 tests críticos** que están marcados como `it.skip()` o `describe.skip()` y **NO se ejecutan en CI/CD**. Estos tests validan funcionalidad importante del sistema pero fueron deshabilitados debido a problemas técnicos (timeouts, implementación pendiente).

**Problema**: Tests skipped → funcionalidad NO validada → posibles bugs en producción.

### Tests Afectados

#### 1. DirectAgentService: Max Turns Limit Test

**Archivo**: `backend/src/__tests__/unit/DirectAgentService.test.ts`
**Línea**: 204

```typescript
it.skip('should enforce max turns limit (20 turns)', async () => {
  // PROBLEMA: Test timeout (12+ segundos)
  // Test valida límite de 20 turns pero tarda demasiado
});
```

**Funcionalidad**: Valida que el agente NO hace más de 20 turns (prevent infinite loops)

**Por qué es crítico**: Sin este límite, un loop infinito de tool use podría:
- Consumir tokens ilimitadamente
- Costar dinero excesivo
- Bloquear el sistema

---

#### 2. DirectAgentService: Prompt Caching Test

**Archivo**: `backend/src/__tests__/unit/DirectAgentService.test.ts`
**Línea**: 486

```typescript
it.skip('should use string system prompt when ENABLE_PROMPT_CACHING=false', async () => {
  // PROBLEMA: Feature pendiente de implementar
});
```

**Funcionalidad**: Valida que el prompt se envía como string cuando caching está disabled

**Por qué es importante**: Prompt caching reduce costos, pero debe ser configurable

---

#### 3. Retry Utility: Decorator Pattern Test

**Archivo**: `backend/src/__tests__/unit/retry.test.ts`
**Línea**: 373

```typescript
it.skip('should apply retry logic to class methods', async () => {
  // PROBLEMA: Decorator pattern no implementado
});
```

**Funcionalidad**: Valida que decorators `@Retry()` funcionan en métodos de clase

**Por qué es importante**: Pattern para retry automático (DRY principle)

---

### Impacto

| Test | Si NO se ejecuta | Riesgo |
|------|------------------|--------|
| **Max Turns** | Infinite loop NO detectado | 🔴 ALTO - Costo $ ilimitado |
| **Prompt Caching** | Config NO validada | 🟡 MEDIO - Costos no optimizados |
| **Retry Decorator** | Pattern NO funciona | 🟢 BAJO - Workaround con función |

---

## 🎯 SUCCESS CRITERIA (Extremadamente Riguroso)

### Criterios Funcionales

#### 1. Max Turns Test (CRÍTICO)

| Aspecto | Target | Validation |
|---------|--------|------------|
| **Test execution time** | < 5 segundos | Timer assertion |
| **Max turns enforced** | Stops at turn 20 | Count assertion |
| **Error message** | "Maximum turns reached (20)" | Error message check |
| **Tool loop simulation** | 21 tool uses → error at turn 20 | Mock responses |

**Validación Rigurosa**:
```typescript
it('should enforce max turns limit (20 turns)', async () => {
  const startTime = Date.now();

  // Setup: Mock client returns tool_use 21 times
  for (let i = 0; i < 21; i++) {
    mockClient.createChatCompletionStream.mockResolvedValueOnce({
      stopReason: 'tool_use',
      content: [{ type: 'tool_use', id: `tool_${i}`, name: 'test_tool', input: {} }],
    });
  }

  // Execute
  const result = await service.executeQueryStreaming({...});

  // Assert: Duration < 5s (mock timer optimization)
  const duration = Date.now() - startTime;
  expect(duration).toBeLessThan(5000);

  // Assert: Stopped at turn 20
  expect(mockClient.createChatCompletionStream).toHaveBeenCalledTimes(20);

  // Assert: Error message
  expect(result.error).toContain('Maximum turns reached');

  // Assert: Success = false
  expect(result.success).toBe(false);
});
```

---

#### 2. Prompt Caching Test

| Aspecto | Target | Validation |
|---------|--------|------------|
| **ENABLE_PROMPT_CACHING=true** | Prompt is array | Type check |
| **ENABLE_PROMPT_CACHING=false** | Prompt is string | Type check |
| **Cache hit** | Reduced input tokens | Token usage check |

**Validación**:
```typescript
describe('Prompt Caching', () => {
  it('should use string system prompt when ENABLE_PROMPT_CACHING=false', async () => {
    process.env.ENABLE_PROMPT_CACHING = 'false';

    // Execute
    await service.executeQueryStreaming({...});

    // Assert: System prompt is string
    const call = mockClient.createChatCompletionStream.mock.calls[0][0];
    expect(typeof call.system).toBe('string');
  });

  it('should use array system prompt when ENABLE_PROMPT_CACHING=true', async () => {
    process.env.ENABLE_PROMPT_CACHING = 'true';

    // Execute
    await service.executeQueryStreaming({...});

    // Assert: System prompt is array
    const call = mockClient.createChatCompletionStream.mock.calls[0][0];
    expect(Array.isArray(call.system)).toBe(true);
    expect(call.system[0]).toHaveProperty('cache_control');
  });
});
```

---

#### 3. Retry Decorator Test

| Aspecto | Target | Validation |
|---------|--------|------------|
| **Retry count** | 3 retries on failure | Call count |
| **Exponential backoff** | 100ms, 200ms, 400ms | Timing check |
| **Success after retry** | Returns result | Result assertion |

**Opción A: Implementar Decorator** (si no existe):
```typescript
// backend/src/utils/retry.ts
export function Retry(options?: RetryOptions) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      return retryAsync(
        () => originalMethod.apply(this, args),
        options
      );
    };

    return descriptor;
  };
}
```

**Opción B: Skip Feature** (si no es prioritario):
- Remover test skipped
- Documentar que decorators NO están soportados
- Usar función `retryAsync()` directamente

---

### Criterios de Calidad

#### 4. CI/CD Integration

| Check | Target | Validation |
|-------|--------|------------|
| **Tests skipped en CI** | 0 tests | GitHub Actions logs |
| **Tests skipped en local** | 0 tests | `npm test` output |
| **Coverage impact** | +0.5% coverage | Coverage report |

#### 5. Documentation

| Aspecto | Requirement |
|---------|------------|
| **Comments** | Cada test tiene JSDoc explaining why it was skipped before |
| **CHANGELOG** | Entry explaining what was fixed |
| **PRD Update** | Mark task as completed |

---

## 🔧 IMPLEMENTATION STEPS

### Paso 1: Fix Max Turns Test (1.5 horas)

**Problema Actual**: Test tarda 12+ segundos porque ejecuta 20 turns reales.

**Solución**: Optimizar con mock timer o reducir delay.

```typescript
// Opción A: Mock timer (RECOMENDADO)
it('should enforce max turns limit (20 turns)', async () => {
  vi.useFakeTimers();

  // Setup: Mock 21 tool_use responses
  for (let i = 0; i < 21; i++) {
    mockClient.createChatCompletionStream.mockResolvedValueOnce({
      stopReason: 'tool_use',
      content: [{ type: 'tool_use', id: `tool_${i}`, name: 'test_tool', input: {} }],
    });
  }

  // Execute (should stop at turn 20)
  const resultPromise = service.executeQueryStreaming({...});

  // Fast-forward time (no actual waiting)
  await vi.runAllTimersAsync();

  const result = await resultPromise;

  // Assert
  expect(result.success).toBe(false);
  expect(result.error).toContain('Maximum turns reached');
  expect(mockClient.createChatCompletionStream).toHaveBeenCalledTimes(20);

  vi.useRealTimers();
});
```

---

### Paso 2: Fix Prompt Caching Test (30 min)

**Problema**: Feature no implementada completamente.

**Solución**: Verificar si ENABLE_PROMPT_CACHING ya está implementado, si no, implementar.

**Verificar en código**:
```bash
grep -r "ENABLE_PROMPT_CACHING" backend/src/
```

Si NO existe:
1. Agregar check en `DirectAgentService.ts`
2. Usar prompt string cuando `false`, array cuando `true`

Si SÍ existe:
1. Solo habilitar el test (remover `.skip`)

---

### Paso 3: Fix Retry Decorator Test (1-2 horas)

**Opción A: Implementar Decorator**:
```typescript
// backend/src/utils/retry.ts
export function Retry(options?: RetryOptions) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      return retryAsync(
        () => originalMethod.apply(this, args),
        options
      );
    };

    return descriptor;
  };
}

// Test
class TestService {
  callCount = 0;

  @Retry({ maxRetries: 3, delayMs: 100 })
  async failTwiceThenSucceed() {
    this.callCount++;
    if (this.callCount < 3) {
      throw new Error('Temporary failure');
    }
    return 'success';
  }
}

it('should apply retry logic to class methods', async () => {
  const service = new TestService();
  const result = await service.failTwiceThenSucceed();

  expect(result).toBe('success');
  expect(service.callCount).toBe(3); // Failed 2 times, succeeded on 3rd
});
```

**Opción B: Skip Feature**:
- Si decorators no son prioritarios, REMOVER el test completamente
- Documentar en CLAUDE.md que se debe usar `retryAsync()` directamente

---

### Paso 4: Validation (30 min)

1. **Ejecutar tests localmente**:
   ```bash
   npm test -- DirectAgentService.test.ts
   npm test -- retry.test.ts
   ```

2. **Verificar 0 skipped**:
   ```bash
   npm test 2>&1 | grep -c "skip"  # Should be 0
   ```

3. **Ejecutar en CI**:
   - Push a branch
   - Verificar GitHub Actions logs

---

## ✅ VALIDATION CHECKLIST

### Pre-Merge Checklist

- [ ] **Max Turns Test**: Ejecuta en < 5s
- [ ] **Max Turns Test**: Valida límite de 20 turns
- [ ] **Prompt Caching Test**: Valida string vs array
- [ ] **Retry Decorator**: Implementado y testeado (o removido con doc)
- [ ] **0 tests skipped**: `npm test` no muestra skips
- [ ] **CI/CD**: GitHub Actions sin skips
- [ ] **Code review**: 2 approvals
- [ ] **Documentation**: CHANGELOG actualizado

### Post-Merge Validation

- [ ] **Coverage**: Aumenta 0.5%+
- [ ] **CI stability**: 20 runs sin skips

---

## 📊 METRICS & MONITORING

### Success Metrics

| Métrica | Baseline | Target | Actual | Status |
|---------|----------|--------|--------|--------|
| Tests Skipped | 3 tests | 0 tests | - | 🔴 |
| Max Turns Test Duration | 12+ seconds | < 5 seconds | - | 🔴 |
| CI/CD Skip Count | 3 skips | 0 skips | - | 🔴 |

### Time Tracking

| Paso | Estimado | Actual | Notes |
|------|----------|--------|-------|
| Max Turns Fix | 1.5 horas | - | |
| Prompt Caching Fix | 30 min | - | |
| Retry Decorator | 1-2 horas | - | |
| Validation | 30 min | - | |
| **TOTAL** | **3.5-4.5 horas** | - | |

---

## 🔗 REFERENCES

### Código Relevante
- `backend/src/__tests__/unit/DirectAgentService.test.ts:204` - Max turns test
- `backend/src/__tests__/unit/DirectAgentService.test.ts:486` - Prompt caching test
- `backend/src/__tests__/unit/retry.test.ts:373` - Retry decorator test

### Documentación
- [PRD: Phase 1 Completion](../PRD-QA-PHASE1-COMPLETION.md)
- [QA Master Audit Report](C:\Users\juanp\.claude\plans\scalable-shimmying-kay.md)

---

## 📝 NOTES

### Decisiones Técnicas

1. **Por qué mock timer**: Reduce test time de 12s a < 1s sin perder validación
2. **Por qué Opción B para decorator**: Si no es feature crítica, mejor remover que implementar

### Alternativas Consideradas

**Max Turns Test**:
- ❌ Opción A: Reducir turns a 5 (pierde validación del límite real)
- ✅ Opción B: Mock timer (mantiene validación, reduce tiempo)

**Retry Decorator**:
- ✅ Opción A: Implementar decorator (feature útil)
- ✅ Opción B: Remover test (simplificar, usar función directamente)

---

**Última Actualización**: 2025-11-27
**Próxima Revisión**: Después de implementación
