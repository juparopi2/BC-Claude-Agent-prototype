# PRD: Rehabilitación de Tests de Integración Omitidos

**Proyecto**: BC Claude Agent - Integration Test Rehabilitation
**Versión**: 1.5
**Fecha**: 2024-11-26
**Última Actualización**: 2024-11-26 (US-001.5 + US-001.6 + US-002 COMPLETADAS)
**PM**: Claude (AI Project Manager)
**Estado**: En Progreso - US-001.5, US-001.6 y US-002 Completadas

---

## Resumen Ejecutivo

### Situación Actual (Post-Auditoría Completa)
- **Total tests de integración**: 71
- **Pasando**: 32 tests (3 suites: token-persistence, connection, sequence-numbers)
- **Omitidos (describe.skip)**: 31 tests (3 suites: approval-lifecycle, MessageQueue, session-isolation)
- **Excluidos (config)**: 8 tests (1 suite: message-flow - requiere reescritura)
- **Fallando**: 0

### Hallazgo Crítico de Auditoría
Se identificó que **2 archivos de tests de integración** usan mocks de infraestructura (database, EventStore), violando el principio fundamental:

> **Tests de integración deben usar infraestructura REAL (Redis, Azure SQL), NO mocks.**

| Archivo | Mocks | Acción |
|---------|-------|--------|
| message-flow | 4 | US-001.5 |
| MessageQueue | 4 | US-001.6 (NUEVO) |

### Estado de US-001
- **sequence-numbers**: 8/8 REHABILITADO
- **message-flow**: 0/8 EXCLUIDO (requiere US-001.5)

### Objetivo
Rehabilitar los 39 tests restantes (31 skipped + 8 excluidos) para alcanzar 71/71 tests pasando, asegurando que TODOS usen infraestructura real.

---

## Principio Fundamental

### Tests de Integración: Solo Infraestructura REAL

```
┌──────────────────────────────────────────────────────────────┐
│                   TEST DE INTEGRACIÓN                        │
├──────────────────────────────────────────────────────────────┤
│  ✅ Redis: REAL (Docker localhost:6399)                      │
│  ✅ Database: REAL (Azure SQL)                               │
│  ✅ EventStore: REAL (Redis INCR + SQL INSERT)              │
│  ✅ Socket.IO: REAL                                          │
│  ✅ BullMQ: REAL                                             │
├──────────────────────────────────────────────────────────────┤
│  ✅ FakeAnthropicClient via DI (para evitar API calls)      │
│  ❌ vi.mock de CUALQUIER infraestructura                     │
└──────────────────────────────────────────────────────────────┘
```

Para servicios externos costosos (Anthropic API), usar **Inyección de Dependencia**:
```typescript
// CORRECTO
const fakeClient = new FakeAnthropicClient();
const service = new DirectAgentService(eventStore, approvalManager, fakeClient);

// INCORRECTO - Contamina module cache
vi.mock('@/services/agent/DirectAgentService', () => ({...}));
```

---

## Test Suites - Estado Actual

| # | Test Suite | Tests | Estado | Issue | User Story |
|---|------------|-------|--------|-------|------------|
| 1 | e2e-token-persistence | 15 | PASANDO | - | - |
| 2 | connection | 9 | PASANDO | - | - |
| 3 | sequence-numbers | 8 | REHABILITADO | Race condition resuelto | [US-001](US-001-database-race-condition.md) |
| 4 | message-flow | 8 | ✅ PASANDO | Reescrito sin mocks | [US-001.5](US-001.5-message-flow-true-integration.md) |
| 5 | MessageQueue | 18 | ✅ PASANDO | Reescrito con DI pattern | [US-001.6](US-001.6-messagequeue-true-integration.md) |
| 6 | approval-lifecycle | 6 | describe.skip | Redis sequence + UUID | [US-003](US-003-eventstore-sequence.md) |
| 7 | session-isolation | 7 | ✅ REHABILITADO | UUID case sensitivity resuelto | [US-002](US-002-uuid-case-sensitivity.md) |

### Leyenda de Estados
- **PASANDO**: Test activo y funcionando
- **REHABILITADO**: Antes skipped, ahora pasando
- **EXCLUIDO**: Removido de suite por problemas arquitecturales
- **describe.skip**: Deshabilitado temporalmente con documentación

### Análisis de Mocks (Auditoría)

| Test File | vi.mock Count | Mocks Críticos | Cumple Principio |
|-----------|---------------|----------------|------------------|
| message-flow | 0 | ✅ Ninguno (reescrito) | **SÍ** |
| MessageQueue | 1 | ✅ Solo logger (reescrito) | **SÍ** |
| approval-lifecycle | 1 | Solo config (timeout) | SI |
| e2e-token-persistence | 0 | - | SI |
| connection | 0 | - | SI |
| sequence-numbers | 0 | - | SI |
| session-isolation | 0 | - | SI |

---

## Fases de Entrega (Actualizado Post-Auditoría)

| Fase | Descripción | User Stories | Tests | Estado |
|------|-------------|--------------|-------|--------|
| **Fase 1a** | Infraestructura Base | US-001 (parcial) | 8 | ✅ COMPLETADO |
| **Fase 1b** | Reescritura message-flow | US-001.5 | 8 | ✅ COMPLETADO |
| **Fase 1c** | Reescritura MessageQueue | US-001.6 | 18 | ✅ COMPLETADO |
| **Fase 2** | Quick Wins | US-003 | 6 | PENDIENTE |
| **Fase 3** | Sesiones | US-002 | 7 | ✅ COMPLETADO |
| **Fase 4** | BullMQ Cleanup | US-004 | - | PENDIENTE |
| **Fase 5** | Validación | US-005 | - | PENDIENTE |

### Progreso Actual
```
[================================>       ] 65/71 tests (92%)
```

---

## User Stories (Índice)

### Orden de Implementación (Revisado Post-Auditoría)

| Orden | ID | Nombre | Archivo | Estimación | Estado |
|-------|-----|--------|---------|------------|--------|
| 1 | US-001 | Database Race Condition | [US-001-database-race-condition.md](US-001-database-race-condition.md) | 35 min | ✅ COMPLETADO |
| 2 | US-001.5 | Message Flow True Integration | [US-001.5-message-flow-true-integration.md](US-001.5-message-flow-true-integration.md) | 3.5 hrs | ✅ COMPLETADO |
| 3 | US-001.6 | MessageQueue True Integration | [US-001.6-messagequeue-true-integration.md](US-001.6-messagequeue-true-integration.md) | 2.5 hrs | ✅ COMPLETADO |
| 4 | US-002 | UUID Case Sensitivity | [US-002-uuid-case-sensitivity.md](US-002-uuid-case-sensitivity.md) | 75 min | ✅ COMPLETADO |
| 5 | US-003 | EventStore Sequence Fix | [US-003-eventstore-sequence.md](US-003-eventstore-sequence.md) | 65 min | PENDIENTE |
| 6 | US-004 | BullMQ Worker Cleanup | [US-004-bullmq-cleanup.md](US-004-bullmq-cleanup.md) | 85 min | PENDIENTE |
| 7 | US-005 | QA Validation | [US-005-qa-validation.md](US-005-qa-validation.md) | 120 min | PENDIENTE |

**Tiempo Total Estimado**: ~13 horas de desarrollo + QA

### Notas de Cambio
- **US-001.5 agregada**: Hallazgo de QA reveló que message-flow usa mocks de infraestructura
- **US-001.6 agregada**: Auditoría completa reveló que MessageQueue usa mocks de database/EventStore
- **Orden revisado**: US-001 → US-001.5 → US-001.6 → US-002 → US-003 → US-004 → US-005

---

## Documentos de Auditoría

| Documento | Descripción | Archivo |
|-----------|-------------|---------|
| Auditoría Completa | Análisis de mocks en todos los tests | [AUDIT-INTEGRATION-TESTS-MOCKS.md](AUDIT-INTEGRATION-TESTS-MOCKS.md) |
| Reporte QA US-001 | Validación de criterios de aceptación | [REPORT-US-001-QA.md](REPORT-US-001-QA.md) |

---

## Templates de QA

| Template | Uso | Archivo |
|----------|-----|---------|
| QA Checklist US-003 | Validación EventStore | [templates/QA-CHECKLIST-US-003.md](templates/QA-CHECKLIST-US-003.md) |
| QA Checklist US-004 | Validación BullMQ | [templates/QA-CHECKLIST-US-004.md](templates/QA-CHECKLIST-US-004.md) |
| QA Checklist Final | Validación Completa | [templates/QA-CHECKLIST-FINAL.md](templates/QA-CHECKLIST-FINAL.md) |

---

## Matriz de Trazabilidad (Actualizada)

| User Story | Archivos Fuente | Test Files | Dependencias | Estado |
|------------|-----------------|------------|--------------|--------|
| US-001 | vitest.integration.config.ts | sequence-numbers | Ninguna | ✅ COMPLETADO |
| US-001.5 | message-flow.integration.test.ts, DirectAgentService.ts | message-flow | US-001 | ✅ COMPLETADO |
| US-001.6 | MessageQueue.integration.test.ts, MessageQueue.ts | MessageQueue | US-001 | ✅ COMPLETADO |
| US-002 | session-isolation.integration.test.ts | session-isolation | US-001.6 | ✅ COMPLETADO |
| US-003 | EventStore.ts | approval-lifecycle | US-001.6 | PENDIENTE |
| US-004 | MessageQueue.ts | MessageQueue | US-001.6 | PENDIENTE |
| US-005 | - | Todos | US-001 a US-004 | PENDIENTE |

---

## Cronograma (Revisado Post-US-002)

```
COMPLETADO:
✅ US-001 Parcial (sequence-numbers) - 35 min
   → Resultado: 8 tests rehabilitados (32/71 total)
✅ US-001.5 (message-flow rewrite) - 2024-11-26
   → Resultado: 8 tests más (40/71 total)
   → Cambios: DirectAgentService DI + __resetDirectAgentService()
✅ US-001.6 (MessageQueue rewrite) - 2024-11-26
   → Resultado: 18 tests más (58/71 total)
✅ US-002 (UUID Case) - 2024-11-26
   → Resultado: 7 tests más (65/71 total)
   → Cambio: Removido describe.skip obsoleto (fix ya existía en session-ownership.ts)

PRÓXIMOS PASOS:
Sesión 1: US-003 (EventStore Sequence) - 65 min
          → Resultado: 6 tests más (71/71 total)

Sesión 2: US-004 (BullMQ cleanup) - 85 min
          → Resultado: Estabilidad mejorada

Sesión 3: US-005 (Validación QA) - 120 min
          Documentación final - 30 min
          → Resultado: 71/71 tests validados y documentados
```

### Estimación Actualizada
- **Completado**: ~7 hrs (US-001 + US-001.5 + US-001.6 + US-002)
- **Pendiente**: ~4.5 horas (US-003 + US-004 + US-005)
- **Total Original**: ~7 horas
- **Nuevo Total Post-Auditoría**: ~11.5 horas

---

## Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| Tests seriales muy lentos | Media | Medio | Optimizar setup compartido |
| BullMQ close() tiene bugs | Baja | Alto | Timeout forzado de 5s |
| UUID edge cases no cubiertos | Baja | Medio | Añadir tests específicos |
| Race condition no detectada | Media | Alto | Ejecutar tests múltiples veces |
| **Mocks de infraestructura** | Alta | Alto | US-001.5 + US-001.6 |
| ChatMessageHandler no acepta DI | Media | Alto | Crear factory function |
| **MessageQueue FK constraints** | Media | Medio | Usar TestSessionFactory |

### Hallazgos de Auditoría (2024-11-26)

1. **message-flow.integration.test.ts**: Usa 4 `vi.mock` en módulos de infraestructura críticos (`@/config/database`, `@/services/messages/MessageService`, `@/services/agent/DirectAgentService`, `@/utils/session-ownership`). Esto contamina el module cache de Vitest.

2. **MessageQueue.integration.test.ts**: Usa 4 `vi.mock` en módulos de infraestructura (`@/config/database`, `@/services/events/EventStore`, `@/utils/logger`, `@/config`). Aunque usa BullMQ/Redis real, no es una verdadera integración porque mockea DB y EventStore.

3. **approval-lifecycle.integration.test.ts**: Usa 1 `vi.mock` pero SOLO para modificar el timeout de 5 minutos a 5 segundos. Esto es ACEPTABLE porque no cambia comportamiento.

---

## Definición de Done

Una User Story se considera **DONE** cuando:

1. ✅ Código implementado y revisado
2. ✅ Tests específicos pasan localmente
3. ✅ Tests de regresión pasan
4. ✅ describe.skip removido del test rehabilitado
5. ✅ **Sin vi.mock de infraestructura** (nuevo criterio)
6. ✅ QA ejecuta checklist de criterios de aceptación
7. ✅ Sin errores en 3 ejecuciones consecutivas
8. ✅ Documentación actualizada si aplica

---

## Referencias

- **Código fuente**: `backend/src/`
- **Tests**: `backend/src/__tests__/integration/`
- **CI/CD**: `.github/workflows/test.yml`
- **CLAUDE.md**: Instrucciones de proyecto
- **Auditoría**: [AUDIT-INTEGRATION-TESTS-MOCKS.md](AUDIT-INTEGRATION-TESTS-MOCKS.md)

---

## Historial de Cambios

| Fecha | Versión | Cambio |
|-------|---------|--------|
| 2024-11-26 | 1.0 | PRD inicial |
| 2024-11-26 | 1.1 | US-001.5 agregada (hallazgo QA) |
| 2024-11-26 | 1.2 | US-001.6 agregada + Auditoría completa |
| 2024-11-26 | 1.3 | US-001.5 COMPLETADA - message-flow reescrito sin mocks (8/8 tests) |
| 2024-11-26 | 1.4 | US-001.6 COMPLETADA - MessageQueue reescrito con DI pattern (18/18 tests) |
| 2024-11-26 | 1.5 | US-002 COMPLETADA - session-isolation rehabilitado (7/7 tests seguridad multi-tenant) |
