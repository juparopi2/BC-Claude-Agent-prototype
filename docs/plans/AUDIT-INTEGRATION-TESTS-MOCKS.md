# Auditoría: Uso de Mocks en Tests de Integración

**Fecha**: 2024-11-26
**Última Actualización**: 2024-11-26 (US-001.5 COMPLETADA)
**Auditor**: Claude (QA Master)
**Resultado**: HALLAZGOS CRÍTICOS - 1 DE 2 RESUELTOS

---

## Resumen Ejecutivo

Se auditaron **7 archivos** de tests de integración para verificar el cumplimiento del principio fundamental:

> **Tests de integración deben usar infraestructura REAL (Redis, Azure SQL), NO mocks de servicios.**

### Resultados Generales (Actualizado Post-US-001.5)

| Categoría | Archivos | Tests | Estado |
|-----------|----------|-------|--------|
| Sin mocks (CORRECTOS) | 5 | 47 | ✅ PASANDO/SKIP |
| Con mocks de config (ACEPTABLE) | 1 | 6 | SKIP |
| Con mocks de infra (PROBLEMÁTICO) | 1 | 18 | SKIP |
| **TOTAL** | **7** | **71** | - |

> **✅ US-001.5 COMPLETADA**: `message-flow` reescrito usando FakeAnthropicClient via DI (0 mocks)

---

## Principio Fundamental Violado

### Por Qué es Crítico

Los tests de integración existen para validar que **múltiples componentes funcionan correctamente JUNTOS** usando infraestructura real. Si mockeamos la base de datos o servicios core:

1. **No validamos comportamiento real** - El mock puede comportarse diferente a la implementación real
2. **Contaminación de module cache** - `vi.mock` intercepta importaciones globalmente en Vitest
3. **Race conditions ocultas** - Tests que pasan individualmente pero fallan en suite
4. **Falsos positivos** - Tests "pasan" pero el código real falla en producción

### Solución Correcta

Para evitar llamadas costosas (ej: API de Anthropic) sin usar mocks:

```typescript
// INCORRECTO: Mock contamina module cache
vi.mock('@/services/agent/DirectAgentService', () => ({...}));

// CORRECTO: Inyección de dependencia
const fakeClient = new FakeAnthropicClient();
const service = new DirectAgentService(eventStore, approvalManager, fakeClient);
```

---

## Análisis Detallado por Archivo

### 1. message-flow.integration.test.ts ✅ RESUELTO

**Estado**: ✅ PASANDO (8 tests) - Reescrito en US-001.5
**Mocks**: 0 (todos eliminados)

| Cambio | Antes | Después |
|--------|-------|---------|
| DirectAgentService | vi.mock | FakeAnthropicClient via DI |
| Database | vi.mock | setupDatabaseForTests() (Azure SQL real) |
| MessageService | vi.mock | Servicio real |
| Session ownership | vi.mock | Validación real |

**Solución Aplicada (US-001.5)**:
1. Agregado `__resetDirectAgentService()` para resetear singleton entre tests
2. `getDirectAgentService()` ahora acepta `client?: IAnthropicClient` para inyección
3. Test usa `FakeAnthropicClient` via DI - no hay `vi.mock`
4. Infraestructura real: Azure SQL + Redis Docker (puerto 6399)

---

### 2. MessageQueue.integration.test.ts

**Estado**: describe.skip (18 tests)
**Mocks**: 4 (infraestructura crítica)

```typescript
// Línea 27 - Mock de database
vi.mock('@/config/database', () => ({
  executeQuery: (...args: unknown[]) => mockDbQuery(...args),
}));

// Línea 34 - Mock de EventStore
vi.mock('@/services/events/EventStore', () => ({
  getEventStore: vi.fn(() => ({
    markAsProcessed: mockEventStoreMarkAsProcessed,
  })),
}));

// Línea 41 - Mock de logger
vi.mock('@/utils/logger', () => ({...}));

// Línea 51 - Mock de config
vi.mock('@/config', () => ({...}));
```

**Análisis**:
- Este test dice probar "BullMQ integration" pero mockea database y EventStore
- Usa Redis REAL, lo cual es bueno
- Pero al mockear DB/EventStore, no es una verdadera integración

**Veredicto**: REQUIERE NUEVA USER STORY (US-001.6)

**Solución Propuesta**:
1. Usar `setupDatabaseForTests()` para DB real
2. Usar EventStore real (que ya conecta a Redis real)
3. Remover mocks de logger (usar logger real o permitir ruido)

---

### 3. approval-lifecycle.integration.test.ts

**Estado**: describe.skip (6 tests)
**Mocks**: 1 (solo configuración)

```typescript
// Línea 30 - Mock de TIMEOUT solamente
vi.mock('@/services/approval/ApprovalManager', async (importOriginal) => {
  const original = await importOriginal<...>();
  return {
    ...original,
    APPROVAL_TIMEOUT: 5000, // 5 seconds for tests instead of 5 minutes
  };
});
```

**Análisis**:
- Este mock NO cambia comportamiento del servicio
- Solo modifica una constante de configuración (timeout)
- El ApprovalManager REAL se usa para toda la lógica

**Veredicto**: ACEPTABLE - No viola el principio de integración

**Mejora Sugerida**: Exportar `APPROVAL_TIMEOUT` como variable de entorno para evitar el mock completamente:
```typescript
// En ApprovalManager.ts
export const APPROVAL_TIMEOUT = parseInt(process.env.APPROVAL_TIMEOUT_MS || '300000', 10);
```

---

### 4. e2e-token-persistence.integration.test.ts

**Estado**: PASANDO (15 tests)
**Mocks**: 0

**Usa infraestructura REAL**:
- `initDatabase()` - Azure SQL real
- `executeQuery()` - Queries reales
- Crea usuarios y sesiones de prueba en DB real
- Limpia datos después de tests

**Veredicto**: CORRECTO - Ejemplo a seguir

---

### 5. connection.integration.test.ts

**Estado**: PASANDO (9 tests)
**Mocks**: 0

**Usa infraestructura REAL**:
- `setupDatabaseForTests()` - Azure SQL real
- `REDIS_TEST_CONFIG` - Redis Docker (puerto 6399)
- `RedisStore` para sesiones reales
- Socket.IO real

**Veredicto**: CORRECTO - Ejemplo a seguir

---

### 6. sequence-numbers.integration.test.ts

**Estado**: PASANDO (8 tests - REHABILITADO en US-001)
**Mocks**: 0

**Usa infraestructura REAL**:
- `setupDatabaseForTests()` - Azure SQL + Redis
- `getEventStore()` - EventStore real con Redis INCR
- `TestSessionFactory` - Crea datos reales

**Veredicto**: CORRECTO - Ejemplo a seguir

---

### 7. session-isolation.integration.test.ts

**Estado**: describe.skip (7 tests)
**Mocks**: 0

**Usa infraestructura REAL**:
- `setupDatabaseForTests()` - Azure SQL + Redis
- `validateSessionOwnership` - Importación REAL, no mock
- Redis session store real

**Veredicto**: CORRECTO - El skip es por otros issues (UUID case sensitivity), no por arquitectura de tests

---

## Matriz de Cumplimiento

| Archivo | DB Mock | EventStore Mock | Service Mock | Logger Mock | Cumple Principio |
|---------|---------|-----------------|--------------|-------------|------------------|
| message-flow | ~~SI~~ ❌→✅ | - | ~~SI (2)~~ ❌→✅ | - | ✅ **SÍ** (US-001.5) |
| MessageQueue | SI | SI | - | SI | NO |
| approval-lifecycle | - | - | CONFIG | - | SI (marginal) |
| e2e-token-persistence | - | - | - | - | SI |
| connection | - | - | - | - | SI |
| sequence-numbers | - | - | - | - | SI |
| session-isolation | - | - | - | - | SI |

---

## Recomendaciones

### Acción Inmediata

1. ✅ ~~**Completar US-001.5**: Reescribir `message-flow.integration.test.ts` sin mocks~~ **HECHO**
2. **Completar US-001.6**: Reescribir `MessageQueue.integration.test.ts` sin mocks de database/EventStore

### Corto Plazo

1. **Establecer política de no-mocks** para tests de integración en CLAUDE.md
2. **Agregar ESLint rule** que detecte `vi.mock` en carpeta `integration/`:
   ```javascript
   // eslint rule personalizada
   'no-vi-mock-in-integration': ['error', {
     paths: ['**/__tests__/integration/**/*.ts']
   }]
   ```

### Largo Plazo

1. **Reorganizar estructura de tests**:
   ```
   __tests__/
   ├── unit/           # Todo mockeado, sin I/O
   ├── functional/     # Mocks de infra permitidos, lógica de negocio
   └── integration/    # Solo infra REAL - CERO vi.mock
   ```

2. **Mover tests problemáticos** a carpeta correcta si no pueden usar infra real:
   - Si MessageQueue no puede funcionar con DB real → `functional/`

---

## Impacto en Plan de Rehabilitación

### PRD-INTEGRATION-TESTS.md debe actualizarse:

| Cambio | Impacto |
|--------|---------|
| Agregar US-001.6 (MessageQueue) | +2-3 horas |
| Ajustar orden de dependencias | US-001.5 → US-001.6 → US-002 |
| Total tiempo adicional | ~3 horas |

### Nuevo Orden de User Stories

1. ✅ US-001 - Database Race Condition (COMPLETADO - sequence-numbers 8/8)
2. ✅ **US-001.5** - Message Flow True Integration (**COMPLETADO** - 8/8 tests)
3. **US-001.6** - MessageQueue True Integration (PENDIENTE - hallazgo de auditoría)
4. US-002 - UUID Case Sensitivity
5. US-003 - EventStore Sequence Fix
6. US-004 - BullMQ Worker Cleanup
7. US-005 - QA Validation

---

## Conclusión (Actualizada Post-US-001.5)

De los 7 archivos de tests de integración:

- **5 archivos (71%)** cumplen el principio de infraestructura real ✅
- **1 archivo (14%)** tiene mock aceptable (solo config)
- **1 archivo (14%)** requiere reescritura (`MessageQueue`)

El proyecto tiene una base sólida con tests como `e2e-token-persistence`, `connection`, `sequence-numbers`, y ahora `message-flow` que son ejemplos correctos a seguir.

**Progreso**:
- ✅ `message-flow` reescrito en US-001.5 usando FakeAnthropicClient via DI
- 🔲 `MessageQueue` pendiente en US-001.6 (18 tests)

---

## Documentos Relacionados

| Documento | Descripción |
|-----------|-------------|
| [US-001.5](US-001.5-message-flow-true-integration.md) | Reescritura de message-flow |
| [PRD-INTEGRATION-TESTS.md](PRD-INTEGRATION-TESTS.md) | Plan maestro de rehabilitación |
| [REPORT-US-001-QA.md](REPORT-US-001-QA.md) | Reporte QA de US-001 |

---

## Historial

| Fecha | Versión | Cambio |
|-------|---------|--------|
| 2024-11-26 | 1.0 | Auditoría inicial completa |
| 2024-11-26 | 1.1 | US-001.5 COMPLETADA - message-flow reescrito sin mocks (8/8) |
