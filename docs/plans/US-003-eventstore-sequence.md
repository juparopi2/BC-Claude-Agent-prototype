# US-003: Resolver Duplicación de Secuencia en EventStore

**Epic**: Servicios Core
**Prioridad**: P1 - Alta (Quick Win #1)
**Afecta**: approval-lifecycle.integration.test.ts
**Tests a Rehabilitar**: 6 tests
**Estimación**: 65 minutos

---

## Descripción

Como **desarrollador**, necesito que el EventStore genere números de secuencia únicos incluso cuando se usa `vi.mock()`, para que los tests de aprobación no fallen con errores de clave duplicada.

---

## Problema Actual

### Síntomas
- Tests fallan con: `Cannot insert duplicate key row in object 'dbo.message_events'`
- El error ocurre solo cuando otros tests se ejecutan antes

### Causa Raíz
1. `vi.mock('@/services/approval/ApprovalManager')` afecta el aislamiento de módulos
2. EventStore singleton no se resetea entre tests
3. Redis keys `event:sequence:{sessionId}` persisten entre tests
4. Secuencias se reutilizan causando violación de constraint único

### Archivo Afectado
- `backend/src/__tests__/integration/approval-flow/approval-lifecycle.integration.test.ts`
- Línea 41: `describe.skip('Approval Lifecycle Integration Tests', ...)`

---

## Criterios de Aceptación

### Para Desarrollador

| # | Criterio | Verificación |
|---|----------|--------------|
| D1 | EventStore.reset() disponible para tests | `typeof EventStore.reset === 'function'` |
| D2 | Cada test obtiene secuencias únicas | No hay errores de duplicate key |
| D3 | No hay violación de constraint en message_events | 6/6 tests pasan |
| D4 | vi.mock() no interfiere con EventStore | Tests aislados correctamente |

### Para QA

| # | Criterio | Comando de Verificación |
|---|----------|-------------------------|
| Q1 | 10 eventos concurrentes → 10 secuencias únicas | Ver test "concurrent events" |
| Q2 | Reset() → siguiente secuencia empieza limpia | Ejecutar test 2 veces consecutivas |
| Q3 | Test A y Test B no comparten secuencias | Ejecutar suite completa |

---

## Solución Técnica

### Archivo 1: `backend/src/services/events/EventStore.ts`

Añadir método de reset para tests:

```typescript
class EventStore {
  private static instance: EventStore | null = null;

  // NUEVO: Método para resetear singleton en tests
  public static reset(): void {
    EventStore.instance = null;
  }

  // NUEVO: Método para limpiar secuencias de sesión específica
  public async resetSessionSequence(sessionId: string): Promise<void> {
    const redis = getRedis();
    if (redis) {
      await redis.del(`event:sequence:${sessionId}`);
    }
  }
}

// Exportar función de reset
export function resetEventStore(): void {
  EventStore.reset();
}
```

### Archivo 2: `backend/src/__tests__/integration/approval-flow/approval-lifecycle.integration.test.ts`

Actualizar hooks de test:

```typescript
import { getEventStore, resetEventStore } from '@/services/events/EventStore';

beforeEach(async () => {
  // Resetear singleton antes de cada test
  resetEventStore();
  vi.clearAllMocks();
});

afterEach(async () => {
  // Limpiar keys de secuencia del test
  const redis = getRedis();
  if (redis) {
    const keys = await redis.keys('event:sequence:*');
    if (keys.length > 0) {
      await redis.del(keys);
    }
  }
});
```

### Archivo 3: Remover describe.skip

```typescript
// ANTES (línea 41):
describe.skip('Approval Lifecycle Integration Tests', () => {

// DESPUÉS:
describe('Approval Lifecycle Integration Tests', () => {
```

---

## Tareas de Implementación

| # | Tarea | Archivo | Estimación |
|---|-------|---------|------------|
| 3.1 | Añadir EventStore.reset() | EventStore.ts | 15 min |
| 3.2 | Añadir resetSessionSequence() | EventStore.ts | 10 min |
| 3.3 | Actualizar beforeEach/afterEach del test | approval-lifecycle.integration.test.ts | 15 min |
| 3.4 | Remover describe.skip | approval-lifecycle.integration.test.ts | 5 min |
| 3.5 | Validar flujo completo de aprobación | - | 20 min |

**Total**: 65 minutos

---

## Validación

### Comando de Ejecución

```bash
cd backend && npm run test:integration -- --grep "approval-lifecycle"
```

### Resultado Esperado

```
✓ should create approval request for write operations
✓ should track pending approvals
✓ should resolve approval on user response
✓ should timeout approval after configured period
✓ should emit events for approval lifecycle
✓ should handle concurrent approval requests

Test Files  1 passed (1)
Tests       6 passed (6)
```

---

## Dependencias

- **Requiere**: Ninguna (puede implementarse independientemente)
- **Habilita**: US-005 (Validación Final)

---

## Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| reset() rompe estado en producción | Baja | Alto | Solo exportar en modo test |
| Keys Redis no se limpian completamente | Media | Medio | Usar patrón wildcard con KEYS |

---

## Referencias

- Test file: `backend/src/__tests__/integration/approval-flow/approval-lifecycle.integration.test.ts`
- Source file: `backend/src/services/events/EventStore.ts`
- PRD: [PRD-INTEGRATION-TESTS.md](PRD-INTEGRATION-TESTS.md)
- QA Checklist: [templates/QA-CHECKLIST-US-003.md](templates/QA-CHECKLIST-US-003.md)
