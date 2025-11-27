# PRD: Phase 1 Completion - QA Validation & Test Quality Enhancement

**Fecha de Creación**: 2025-11-27
**Versión**: 1.0
**Autor**: Product Manager + Scrum Master + QA Master
**Estado**: 🔴 DRAFT - Requiere Aprobación

---

## 🎯 OBJETIVOS ESTRATÉGICOS

### Visión
Completar Phase 1 del plan de testing con **100% de tests pasando sin errores**, asegurando que la suite de tests valide comportamiento real del sistema (no mocks), y estableciendo un estándar de calidad enterprise-grade para todas las fases futuras.

### Alcance
- **Resolver blocker crítico**: BullMQ cleanup error que causa exit code 1
- **Eliminar anti-patterns**: Tests placeholder, race conditions conocidos, over-mocking
- **Asegurar cobertura arquitectural**: Servicios over-mockeados en unitarias deben tener tests de integración robustos
- **NO incluye**: Aumento de coverage a 70% (pospuesto para Phase 3)

### Principio Fundamental (Non-Negotiable)

> **Tests de integración DEBEN usar infraestructura REAL (Azure SQL, Redis, Socket.IO, WebSocket)**
>
> - ✅ Permitido: DI de FakeAnthropicClient (external API)
> - ✅ Permitido: Mock de logger utilities
> - ❌ Prohibido: Mocks de database, Redis, EventStore, servicios core
> - ❌ Prohibido: Tests que "hacen trampa" para pasar

Este principio DEBE ser documentado en CADA tarea.

---

## 📊 ESTADO ACTUAL (Baseline)

### Métricas Pre-Implementation

| Métrica | Valor Actual | Objetivo Phase 1 | Gap |
|---------|--------------|------------------|-----|
| **Tests de Integración Pasando** | 65/71 (6 skipped) | 71/71 | -6 tests |
| **Tests con Error de Cleanup** | 18/18 (exit code 1) | 18/18 (exit code 0) | Error blocker |
| **Tests Unitarios con Anti-patterns** | 3 archivos | 0 archivos | -3 fixes |
| **Servicios Over-Mocked sin Coverage** | 2 servicios | 0 servicios | -2 servicios |
| **Tests Skipped Críticos** | 3 tests | 0 tests | -3 tests |
| **Phase 1 Completion** | 85% | 100% | -15% |

### Issues Críticos Identificados

#### 🔴 BLOCKER: BullMQ Cleanup Error
- **Impacto**: Exit code 1 → Pre-push hook falla → CI/CD falla
- **Síntoma**: "Connection is closed" en afterAll hook
- **Tests afectados**: 18 tests de MessageQueue (todos pasan, pero error post-test)
- **Tiempo bloqueado**: 2+ semanas

#### 🔴 CRÍTICO: Race Condition en BCTokenManager
- **Impacto**: Producción - múltiples refreshes concurrentes → rate limiting
- **Tests**: Placeholder test que siempre pasa (anti-pattern)
- **Deuda técnica**: Documentado pero NO arreglado

#### 🟡 ALTA: Over-Mocking en Tests Unitarios
- **Servicios afectados**:
  - `DirectAgentService.test.ts` - Todo mockeado (5 mocks)
  - `BCTokenManager.raceCondition.test.ts` - Placeholder tests
- **Riesgo**: Bugs de integración no se detectan

---

## 📋 TAREAS CRÍTICAS (PRIORIDAD 🔴)

### TASK-001: Resolver BullMQ Cleanup Error ⚡ CRÍTICO

**Archivo de Tarea**: [`tasks/TASK-001-bullmq-cleanup-resolution.md`](tasks/TASK-001-bullmq-cleanup-resolution.md)

**Problem Statement**:
Los 18 tests de MessageQueue pasan correctamente, pero el test file falla con exit code 1 debido a error "Connection is closed" en afterAll hook. BullMQ workers y queues no se cierran en orden correcto.

**Opciones de Resolución**:
1. **Opción A (Fix)**: Cerrar workers → queues → redis en orden correcto
2. **Opción B (Rediseño)**: Reestructurar test para evitar dependencia de cleanup complejo
3. **Opción C (Alternativa)**: Tests de integración sin BullMQ workers (solo queue operations)

**Success Criteria** (Extremadamente Riguroso):
- ✅ 5 runs consecutivos: Exit code 0
- ✅ 5 runs consecutivos: 18/18 tests pasan
- ✅ 5 runs consecutivos: No "Connection is closed" error
- ✅ 5 runs consecutivos: No unhandled promise rejections
- ✅ Pre-push hook: Pasa en 3 runs consecutivos
- ✅ Redis: Todas las conexiones cerradas (verificar con `netstat`)
- ✅ Memory: Sin leaks (verificar con `--expose-gc`)

**Estimación**: 4-6 horas (incluye exploración de opciones)

---

### TASK-002: Arreglar Race Condition en BCTokenManager ⚡ CRÍTICO

**Archivo de Tarea**: [`tasks/TASK-002-bctoken-race-condition.md`](tasks/TASK-002-bctoken-race-condition.md)

**Problem Statement**:
Múltiples refreshes concurrentes no están deduplicados. Test actual es placeholder que siempre pasa (anti-pattern). En producción, puede causar rate limiting de Microsoft OAuth.

**Success Criteria** (Extremadamente Riguroso):
- ✅ Concurrent refreshes (10 simultáneos): Solo 1 llamada real a OAuth
- ✅ Test actualizado: `should deduplicate concurrent token refreshes`
- ✅ Test removido: Placeholder test eliminado
- ✅ Race condition: 100 runs con Promise.all → 100% deduplicación
- ✅ Production simulation: 50 usuarios concurrentes → 1 refresh por usuario
- ✅ Error handling: Refresh falla → promise rechazado para todos los waiters
- ✅ Memory: Map de promises se limpia después de resolve/reject

**Estimación**: 3-4 horas

---

## 📋 TAREAS DE ALTA PRIORIDAD (PRIORIDAD 🟡)

### TASK-003: Integration Tests para Servicios Over-Mocked

**Archivo de Tarea**: [`tasks/TASK-003-overmocked-services-integration.md`](tasks/TASK-003-overmocked-services-integration.md)

**Problem Statement**:
Tests unitarios de `DirectAgentService` y `BCTokenManager` tienen over-mocking (5+ mocks). Si hay bugs de integración, no se detectan. Se requieren tests de integración que validen arquitectura completa.

**Servicios Afectados**:
1. `DirectAgentService` - Mock de ApprovalManager, EventStore, MessageQueue, FS
2. `BCTokenManager` - Mock de executeQuery (database)

**Success Criteria** (Extremadamente Riguroso):
- ✅ DirectAgentService Integration Test:
  - Infraestructura REAL: Azure SQL + Redis + WebSocket + FakeAnthropicClient (DI)
  - Scenario: Usuario envía mensaje → approval → tool execution → respuesta
  - Validar: EventStore persiste todos los eventos
  - Validar: MessageQueue procesa jobs
  - Validar: ApprovalManager crea/responde approvals
  - Validar: Orden correcto de eventos (sequence numbers)
- ✅ BCTokenManager Integration Test:
  - Infraestructura REAL: Azure SQL
  - Scenario: Token expirado → refresh → encrypt → persist → retrieve → decrypt
  - Validar: Encriptación AES-256-GCM funciona
  - Validar: Token persiste en BD
  - Validar: Concurrent refreshes deduplicados (TASK-002)

**Estimación**: 6-8 horas

---

### TASK-004: Rehabilitar Tests Skipped

**Archivo de Tarea**: [`tasks/TASK-004-skipped-tests-rehabilitation.md`](tasks/TASK-004-skipped-tests-rehabilitation.md)

**Problem Statement**:
3 tests críticos están skipped y no se ejecutan en CI/CD:
1. `DirectAgentService.test.ts:204` - Max turns limit (20 turns)
2. `DirectAgentService.test.ts:486` - Prompt caching
3. `retry.test.ts:373` - Retry decorator

**Success Criteria** (Extremadamente Riguroso):
- ✅ Max Turns Test:
  - Ejecuta en < 5 segundos (mock timer)
  - Valida límite de 20 turns
  - Valida error message: "Maximum turns reached"
- ✅ Prompt Caching Test:
  - Valida ENABLE_PROMPT_CACHING=false → string prompt
  - Valida ENABLE_PROMPT_CACHING=true → array prompt
- ✅ Retry Decorator Test:
  - Implementar decorator pattern
  - Validar 3 retries con exponential backoff
- ✅ CI/CD: 3 runs consecutivos sin skip

**Estimación**: 3-4 horas

---

## 📋 TAREAS DE MEDIA PRIORIDAD (PRIORIDAD 🟢)

### TASK-005: Limpiar Código Deprecated

**Archivo de Tarea**: [`tasks/TASK-005-deprecated-code-cleanup.md`](tasks/TASK-005-deprecated-code-cleanup.md)

**Problem Statement**:
Código deprecated y comentarios obsoletos causan confusión. Migración pendiente de approval types legacy a agent:event types.

**Success Criteria**:
- ✅ Tipos deprecated migrados
- ✅ Referencias actualizadas
- ✅ Comentarios @deprecated removidos
- ✅ Build pasa sin warnings de deprecation

**Estimación**: 2-3 horas

---

## 🎯 ROADMAP DE IMPLEMENTACIÓN

### Sprint 1: Resolución de Blockers (1 semana)

**Objetivo**: Desbloquear CI/CD y eliminar anti-patterns críticos

| Día | Tarea | Owner | Output |
|-----|-------|-------|--------|
| 1-2 | TASK-001: BullMQ Cleanup | Dev + QA | Exit code 0 en 5 runs |
| 3-4 | TASK-002: BCToken Race Condition | Dev + QA | Deduplicación funcionando |
| 5 | Validación Integration | QA | Pre-push hook pasa |

**Definition of Done (Sprint 1)**:
- ✅ Pre-push hook: 5 runs consecutivos exitosos
- ✅ CI/CD: Backend integration tests pasan
- ✅ No unhandled errors en logs
- ✅ Code review: 2 approvals
- ✅ QA sign-off: Smoke test de 10 runs

---

### Sprint 2: Cobertura Arquitectural (1 semana)

**Objetivo**: Asegurar que servicios over-mockeados tienen tests de integración

| Día | Tarea | Owner | Output |
|-----|-------|-------|--------|
| 1-3 | TASK-003: DirectAgentService Integration | Dev + QA | Test end-to-end completo |
| 4-5 | TASK-003: BCTokenManager Integration | Dev + QA | Test de encryption + persistence |

**Definition of Done (Sprint 2)**:
- ✅ DirectAgentService: 1 test de integración end-to-end
- ✅ BCTokenManager: 1 test de integración encryption + refresh
- ✅ Tests usan infraestructura REAL (documentado en código)
- ✅ Code review: Validación del principio de no-mocks
- ✅ QA sign-off: Ejecución en 3 environments (dev, local Docker, CI)

---

### Sprint 3: Refinamiento (3 días)

**Objetivo**: Rehabilitar tests skipped y limpiar código

| Día | Tarea | Owner | Output |
|-----|-------|-------|--------|
| 1-2 | TASK-004: Tests Skipped | Dev | 3 tests rehabilitados |
| 3 | TASK-005: Cleanup Deprecated | Dev | Código limpio |

**Definition of Done (Sprint 3)**:
- ✅ 0 tests skipped en CI/CD
- ✅ 0 comentarios @deprecated obsoletos
- ✅ Lint: 0 warnings
- ✅ Build: 0 deprecation warnings

---

## ✅ CRITERIOS DE ÉXITO DEL PRD

### Criterios Técnicos

| Criterio | Baseline | Target | Validation |
|----------|----------|--------|------------|
| **Integration Tests** | 65/71 passing | 71/71 passing | `npm run test:integration` |
| **Exit Code** | 1 (error cleanup) | 0 (clean) | 5 runs consecutivos |
| **Tests Skipped** | 3 tests | 0 tests | CI logs |
| **Anti-patterns** | 3 archivos | 0 archivos | Code review |
| **Over-Mocked Services** | 2 servicios | 0 sin integration tests | Coverage report |

### Criterios de Calidad (Extremadamente Rigurosos)

#### 1. Estabilidad de Tests
- ✅ **100 runs consecutivos**: 100% passing rate
- ✅ **Pre-push hook**: 10 runs en diferentes máquinas → 100% passing
- ✅ **CI/CD**: 20 runs en 1 semana → 0 flaky tests

#### 2. Infraestructura Real
- ✅ **Auditoría de mocks**: 0 mocks de database/Redis/EventStore en integration tests
- ✅ **Documentación**: Cada test de integración tiene comentario explicando infraestructura usada
- ✅ **Code review**: Checklist de "No Mocks" aprobado por 2 reviewers

#### 3. Coverage Arquitectural
- ✅ **DirectAgentService**: 1 test de integración que ejercita approval → tool execution → eventos
- ✅ **BCTokenManager**: 1 test de integración que valida refresh → encrypt → persist
- ✅ **MessageQueue**: 18 tests existentes + exit code 0

#### 4. Error Handling
- ✅ **Cleanup**: afterAll hooks cierran todas las conexiones
- ✅ **Memory**: Ningún leak detectado con `--expose-gc`
- ✅ **Connections**: `netstat` muestra 0 conexiones abiertas post-test

---

## 🚨 RIESGOS Y MITIGACIONES

### Riesgo 1: BullMQ Cleanup Demasiado Complejo

**Probabilidad**: ALTA
**Impacto**: CRÍTICO

**Mitigación**:
- **Plan A**: Fix del orden de cierre (2-4 horas)
- **Plan B**: Rediseño del test (4-6 horas)
- **Plan C**: Tests sin workers (solo queue operations) (3-4 horas)

**Decisión**: Intentar Plan A primero. Si falla después de 4 horas, escalar a Plan B.

---

### Riesgo 2: Tests de Integración Lentos

**Probabilidad**: MEDIA
**Impacto**: MEDIA

**Mitigación**:
- Usar `test.concurrent` para tests independientes
- Reutilizar conexiones de DB/Redis (singleton)
- Timeout de 60 segundos (configurado)

---

### Riesgo 3: Flakiness en CI/CD

**Probabilidad**: MEDIA
**Impacto**: ALTA

**Mitigación**:
- GitHub Actions: Service container de Redis
- Database: Test database dedicada (no compartida)
- Cleanup: UUID normalization para evitar colisiones

---

## 📝 NOTAS DE IMPLEMENTACIÓN

### Principio de No-Mocks (Documentación Requerida)

Cada test de integración DEBE tener un comentario al inicio:

```typescript
/**
 * INTEGRATION TEST - REAL INFRASTRUCTURE
 *
 * Infrastructure used:
 * - Azure SQL: setupDatabaseForTests() (real connection)
 * - Redis: REDIS_TEST_CONFIG (Docker container on port 6399)
 * - WebSocket: Real Socket.IO server with session middleware
 *
 * Mocks allowed:
 * - FakeAnthropicClient (external API via DI)
 * - Logger utilities (infrastructure logging)
 *
 * NO MOCKS of:
 * - Database, Redis, EventStore, MessageQueue, ApprovalManager
 */
```

### Code Review Checklist

Antes de merge, validar:

- [ ] Tests de integración usan infraestructura real
- [ ] Comentario de infraestructura presente
- [ ] Cleanup en afterAll hooks
- [ ] 5 runs locales consecutivos pasan
- [ ] CI/CD logs muestran exit code 0
- [ ] No unhandled errors en stderr
- [ ] Memory leaks: Ninguno detectado

---

## 📌 REFERENCIAS

### Documentos Relacionados
- [QA Master Audit Report](C:\Users\juanp\.claude\plans\scalable-shimmying-kay.md)
- [AUDIT-INTEGRATION-TESTS-MOCKS.md](../AUDIT-INTEGRATION-TESTS-MOCKS.md)
- [US-004-bullmq-cleanup.md](../US-004-bullmq-cleanup.md)
- [DIAGNOSTIC-AND-TESTING-PLAN.md](../DIAGNOSTIC-AND-TESTING-PLAN.md)

### Archivos de Tareas
- [TASK-001: BullMQ Cleanup Resolution](tasks/TASK-001-bullmq-cleanup-resolution.md)
- [TASK-002: BCToken Race Condition Fix](tasks/TASK-002-bctoken-race-condition.md)
- [TASK-003: Integration Tests for Over-Mocked Services](tasks/TASK-003-overmocked-services-integration.md)
- [TASK-004: Rehabilitate Skipped Tests](tasks/TASK-004-skipped-tests-rehabilitation.md)
- [TASK-005: Deprecated Code Cleanup](tasks/TASK-005-deprecated-code-cleanup.md)

---

## 🔄 CHANGELOG

| Fecha | Versión | Cambio | Autor |
|-------|---------|--------|-------|
| 2025-11-27 | 1.0 | PRD inicial creado | PM + SM + QA Master |

---

## ✅ APROBACIONES

| Rol | Nombre | Fecha | Firma |
|-----|--------|-------|-------|
| Product Manager | [Pendiente] | - | - |
| Scrum Master | [Pendiente] | - | - |
| QA Master | [Pendiente] | - | - |
| Tech Lead | [Pendiente] | - | - |

**Estado**: 🔴 DRAFT - Requiere aprobación antes de iniciar implementación
