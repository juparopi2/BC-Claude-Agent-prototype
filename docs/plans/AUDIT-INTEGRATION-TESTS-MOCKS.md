# Auditoría: Uso de Mocks en Tests de Integración

**Fecha**: 2024-11-26
**Última Actualización**: 2024-11-26 (US-001.5 + US-001.6 + US-002 COMPLETADAS)
**Auditor**: Claude (QA Master)
**Resultado**: ✅ TODOS LOS HALLAZGOS CRÍTICOS RESUELTOS (2 DE 2)

---

## Resumen Ejecutivo

Se auditaron **7 archivos** de tests de integración para verificar el cumplimiento del principio fundamental:

> **Tests de integración deben usar infraestructura REAL (Redis, Azure SQL), NO mocks de servicios.**

### Resultados Generales (Actualizado Post-US-002)

| Categoría | Archivos | Tests | Estado |
|-----------|----------|-------|--------|
| Sin mocks (CORRECTOS) | 6 | 65 | ✅ PASANDO |
| Con mocks de config (ACEPTABLE) | 1 | 6 | SKIP |
| Con mocks de infra (PROBLEMÁTICO) | 0 | 0 | ✅ RESUELTO |
| **TOTAL** | **7** | **71** | - |

> **✅ US-001.5 COMPLETADA**: `message-flow` reescrito usando FakeAnthropicClient via DI (0 mocks)
> **✅ US-001.6 COMPLETADA**: `MessageQueue` reescrito usando DI pattern (0 mocks de infraestructura)
> **✅ US-002 COMPLETADA**: `session-isolation` rehabilitado (7 tests de seguridad multi-tenant)

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

### 2. MessageQueue.integration.test.ts ✅ RESUELTO

**Estado**: ✅ PASANDO (18 tests) - Reescrito en US-001.6
**Mocks**: 1 (solo logger - aceptable)

| Cambio | Antes | Después |
|--------|-------|---------|
| Database | vi.mock | setupDatabaseForTests() (Azure SQL real) |
| EventStore | vi.mock | getEventStore() via DI (Redis real) |
| Config | vi.mock | REDIS_TEST_CONFIG directo |
| Logger | vi.mock | vi.mock (aceptable por auditoría) |

**Solución Aplicada (US-001.6)**:
1. Creado `IMessageQueueDependencies.ts` para patrón DI
2. `MessageQueue.ts` modificado para aceptar dependencias inyectables
3. Agregado `__resetMessageQueue()` para aislamiento entre tests
4. Test usa `getMessageQueue({ redis, executeQuery, eventStore, logger })` con DI
5. Infraestructura real: Azure SQL + Redis Docker (puerto 6399)

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

### 7. session-isolation.integration.test.ts ✅ RESUELTO

**Estado**: ✅ PASANDO (7 tests) - Rehabilitado en US-002
**Mocks**: 0

**Usa infraestructura REAL**:
- `setupDatabaseForTests()` - Azure SQL + Redis
- `validateSessionOwnership` - Importación REAL, no mock
- Redis session store real
- TestSessionFactory crea usuarios/sesiones reales

**Solución Aplicada (US-002)**:
1. UUID case sensitivity ya estaba corregido en `session-ownership.ts` (`timingSafeCompare` normaliza a lowercase)
2. ApprovalManager también tiene la corrección (líneas 480 y 789)
3. Se removió `describe.skip` que era obsoleto
4. 7 tests de seguridad multi-tenant ahora pasan

**Veredicto**: CORRECTO - Ejemplo a seguir para tests de seguridad

---

## Matriz de Cumplimiento

| Archivo | DB Mock | EventStore Mock | Service Mock | Logger Mock | Cumple Principio |
|---------|---------|-----------------|--------------|-------------|------------------|
| message-flow | ~~SI~~ ❌→✅ | - | ~~SI (2)~~ ❌→✅ | - | ✅ **SÍ** (US-001.5) |
| MessageQueue | ~~SI~~ ❌→✅ | ~~SI~~ ❌→✅ | - | SI (aceptable) | ✅ **SÍ** (US-001.6) |
| approval-lifecycle | - | - | CONFIG | - | SI (marginal) |
| e2e-token-persistence | - | - | - | - | SI |
| connection | - | - | - | - | SI |
| sequence-numbers | - | - | - | - | SI |
| session-isolation | - | - | - | - | SI |

---

## Recomendaciones

### Acción Inmediata

1. ✅ ~~**Completar US-001.5**: Reescribir `message-flow.integration.test.ts` sin mocks~~ **HECHO**
2. ✅ ~~**Completar US-001.6**: Reescribir `MessageQueue.integration.test.ts` sin mocks de database/EventStore~~ **HECHO**

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
3. ✅ **US-001.6** - MessageQueue True Integration (**COMPLETADO** - 18/18 tests)
4. ✅ **US-002** - UUID Case Sensitivity (**COMPLETADO** - session-isolation 7/7)
5. US-003 - EventStore Sequence Fix
6. US-004 - BullMQ Worker Cleanup
7. US-005 - QA Validation

---

## Conclusión (Actualizada Post-US-002)

De los 7 archivos de tests de integración:

- **6 archivos (86%)** cumplen el principio de infraestructura real ✅
- **1 archivo (14%)** tiene mock aceptable (solo config de timeout)
- **0 archivos** con mocks de infraestructura problemáticos ✅

El proyecto tiene una base sólida con tests como `e2e-token-persistence`, `connection`, `sequence-numbers`, `message-flow`, `MessageQueue`, y ahora `session-isolation` que son ejemplos correctos a seguir.

**Progreso**:
- ✅ `message-flow` reescrito en US-001.5 usando FakeAnthropicClient via DI (8 tests)
- ✅ `MessageQueue` reescrito en US-001.6 usando DI pattern (18 tests)
- ✅ `session-isolation` rehabilitado en US-002 (7 tests de seguridad multi-tenant)

**Resultado Final**: 65 de 71 tests pasan (6 skipped por approval-lifecycle). Todos los tests de integración usan infraestructura REAL (Azure SQL + Redis Docker), cumpliendo el principio fundamental de la auditoría.

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
| 2024-11-26 | 1.2 | US-001.6 COMPLETADA - MessageQueue reescrito con DI pattern (18/18) |
| 2024-11-26 | 1.3 | US-002 COMPLETADA - session-isolation rehabilitado (7/7 tests seguridad multi-tenant) |
