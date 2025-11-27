# PRD: Rehabilitación de Tests de Integración Omitidos

**Proyecto**: BC Claude Agent - Integration Test Rehabilitation
**Versión**: 1.0
**Fecha**: 2024-11-26
**PM**: Claude (AI Project Manager)
**Estado**: Aprobado para Implementación

---

## Resumen Ejecutivo

### Situación Actual
- **Total tests de integración**: 71
- **Pasando**: 24 tests (2 suites: token-persistence, connection)
- **Omitidos**: 47 tests (5 suites con issues documentados)
- **Fallando**: 0 (todos los problemas están skippeados con documentación)

### Objetivo
Rehabilitar los 47 tests omitidos para alcanzar 71/71 tests pasando, manteniendo la estabilidad y seguridad multi-tenant del sistema.

---

## Test Suites Omitidos

| # | Test Suite | Tests | Issue | User Story |
|---|------------|-------|-------|------------|
| 1 | approval-lifecycle | 6 | Redis sequence duplicate | [US-003](US-003-eventstore-sequence.md) |
| 2 | MessageQueue | 18 | BullMQ worker cleanup | [US-004](US-004-bullmq-cleanup.md) |
| 3 | message-flow | 8 | Database setup conflicts | [US-001](US-001-database-race-condition.md) |
| 4 | sequence-numbers | 8 | Database init race condition | [US-001](US-001-database-race-condition.md) |
| 5 | session-isolation | 7 | UUID case sensitivity | [US-002](US-002-uuid-case-sensitivity.md) |

---

## Fases de Entrega

| Fase | Descripción | User Stories | Tests | Criterio de Éxito |
|------|-------------|--------------|-------|-------------------|
| **Fase 1** | Quick Wins | US-003, US-004 | 24 | EventStore y BullMQ estables |
| **Fase 2** | Infraestructura | US-001, US-002 | 23 | Tests paralelos sin conflictos |
| **Fase 3** | Validación | US-005 | - | 71/71 tests, QA aprobado |

---

## User Stories (Índice)

### Orden de Implementación (Quick Wins First)

| Orden | ID | Nombre | Archivo | Estimación |
|-------|-----|--------|---------|------------|
| 1 | US-003 | EventStore Sequence Fix | [US-003-eventstore-sequence.md](US-003-eventstore-sequence.md) | 65 min |
| 2 | US-004 | BullMQ Worker Cleanup | [US-004-bullmq-cleanup.md](US-004-bullmq-cleanup.md) | 85 min |
| 3 | US-001 | Database Race Condition | [US-001-database-race-condition.md](US-001-database-race-condition.md) | 35 min |
| 4 | US-002 | UUID Case Sensitivity | [US-002-uuid-case-sensitivity.md](US-002-uuid-case-sensitivity.md) | 75 min |
| 5 | US-005 | QA Validation | [US-005-qa-validation.md](US-005-qa-validation.md) | 120 min |

**Tiempo Total Estimado**: ~7 horas de desarrollo + QA

---

## Templates de QA

| Template | Uso | Archivo |
|----------|-----|---------|
| QA Checklist US-003 | Validación EventStore | [templates/QA-CHECKLIST-US-003.md](templates/QA-CHECKLIST-US-003.md) |
| QA Checklist US-004 | Validación BullMQ | [templates/QA-CHECKLIST-US-004.md](templates/QA-CHECKLIST-US-004.md) |
| QA Checklist Final | Validación Completa | [templates/QA-CHECKLIST-FINAL.md](templates/QA-CHECKLIST-FINAL.md) |

---

## Matriz de Trazabilidad

| User Story | Archivos Fuente | Test Files | Dependencias |
|------------|-----------------|------------|--------------|
| US-001 | vitest.integration.config.ts | sequence-numbers, message-flow | Ninguna |
| US-002 | TestSessionFactory.ts, ApprovalManager.ts | session-isolation | US-001 |
| US-003 | EventStore.ts | approval-lifecycle | US-001 |
| US-004 | MessageQueue.ts | MessageQueue | US-001 |
| US-005 | - | Todos | US-001 a US-004 |

---

## Cronograma

```
Día 1: US-003 (EventStore) - 65 min      ← QUICK WIN #1
       US-004 (BullMQ) - 85 min          ← QUICK WIN #2
       → Resultado: 24 tests rehabilitados

Día 2: US-001 (Infraestructura) - 35 min
       US-002 (Sesiones Redis) - 75 min
       → Resultado: 31 tests más rehabilitados

Día 3: US-005 (Validación QA) - 120 min
       Documentación final - 30 min
       → Resultado: 71/71 tests pasando
```

---

## Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| Tests seriales muy lentos | Media | Medio | Optimizar setup compartido |
| BullMQ close() tiene bugs | Baja | Alto | Timeout forzado de 5s |
| UUID edge cases no cubiertos | Baja | Medio | Añadir tests específicos |
| Race condition no detectada | Media | Alto | Ejecutar tests múltiples veces |

---

## Definición de Done

Una User Story se considera **DONE** cuando:

1. ✅ Código implementado y revisado
2. ✅ Tests específicos pasan localmente
3. ✅ Tests de regresión pasan
4. ✅ describe.skip removido del test rehabilitado
5. ✅ QA ejecuta checklist de criterios de aceptación
6. ✅ Sin errores en 3 ejecuciones consecutivas
7. ✅ Documentación actualizada si aplica

---

## Referencias

- **Código fuente**: `backend/src/`
- **Tests**: `backend/src/__tests__/integration/`
- **CI/CD**: `.github/workflows/test.yml`
- **CLAUDE.md**: Instrucciones de proyecto
