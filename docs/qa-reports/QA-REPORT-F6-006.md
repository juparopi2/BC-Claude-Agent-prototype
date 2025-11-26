# QA Report - F6-006: Alcanzar 70% Cobertura Global

**Fecha**: 2025-11-25
**Estado**: 🧪 **IN TESTING**
**Implementador**: Claude Code
**Worktree**: `cool-tereshkova`

---

## 1. Resumen Ejecutivo

Este ticket tiene como objetivo incrementar la cobertura de tests del proyecto BC Claude Agent de **46.17%** a **≥70%**.

### Estado Actual

| Métrica | Valor |
|---------|-------|
| Cobertura Global Actual | 46.17% |
| Cobertura Objetivo | 70% |
| Gap a Cerrar | 23.83% |
| Tests Actuales | 1152 (1 skipped) |
| Tests Estimados Post-Implementación | ~1250+ |

### Plan de Fases

| Fase | Descripción | Tests Est. | Impacto | Estado |
|------|-------------|------------|---------|--------|
| 1 | DirectAgentService.ts | 40-60 | +8-10% | PENDIENTE |
| 2 | server.ts | 30-40 | +6-8% | PENDIENTE |
| 3 | TodoManager.ts | 20-25 | +2-3% | PENDIENTE |
| 4 | Verificación y Documentación | - | - | PENDIENTE |

---

## 2. Descripción del Proyecto

### 2.1 ¿Qué es BC Claude Agent?

BC Claude Agent es un **agente conversacional AI** que permite a usuarios interactuar con **Microsoft Dynamics 365 Business Central** a través de lenguaje natural.

**Características clave:**
- Usa Anthropic Claude API con Extended Thinking
- 115 herramientas MCP vendorizadas para entidades BC
- Arquitectura multi-tenant (datos aislados por usuario)
- Human-in-the-loop para operaciones de escritura (approvals)
- WebSocket para streaming de eventos en tiempo real

### 2.2 Arquitectura del Backend

```
backend/src/
├── services/
│   ├── agent/
│   │   ├── DirectAgentService.ts  ← 4% cobertura (CRÍTICO)
│   │   ├── AnthropicClient.ts     ← 100% cobertura ✅
│   │   ├── FakeAnthropicClient.ts ← 0% (test infrastructure)
│   │   └── tool-definitions.ts    ← 100% cobertura ✅
│   ├── approval/
│   │   └── ApprovalManager.ts     ← 84% cobertura ✅
│   ├── todo/
│   │   └── TodoManager.ts         ← 0% cobertura (CRÍTICO)
│   └── ...
├── server.ts                      ← 0% cobertura (CRÍTICO)
└── ...
```

---

## 3. Módulos a Testear

### 3.1 DirectAgentService.ts (PRIORIDAD: CRÍTICA)

**Estado Actual**:
- Líneas: 2,240
- Cobertura: 4.09% (solo 91 líneas cubiertas)
- Tests Existentes: 12 (en DirectAgentService.integration.test.ts)

**Funcionalidades a Testear**:

| Funcionalidad | Líneas | Prioridad | Estado |
|---------------|--------|-----------|--------|
| Agentic Loop | 800+ | CRÍTICA | ❌ No testeado |
| Tool Execution (executeMCPTool) | 400+ | CRÍTICA | ❌ No testeado |
| Extended Thinking | 200+ | ALTA | ❌ No testeado |
| Stop Reason handling | 150+ | ALTA | ⚠️ Parcial |
| Event Persistence | 150+ | MEDIA | ⚠️ Mock only |
| Token Tracking | 100+ | MEDIA | ⚠️ Mock only |

**Tests Planificados**:
1. **Agentic Loop Tests (15 tests)**: Continuación de loop, maxTurns, múltiples tool calls
2. **Tool Execution Tests (12 tests)**: Cada herramienta MCP, approval flow, errores
3. **Extended Thinking Tests (8 tests)**: thinking_chunk events, tokens, persistence
4. **Stop Reason Tests (8 tests)**: end_turn, tool_use, max_tokens, content_filter
5. **Event Persistence Tests (10 tests)**: Secuencia de eventos, IDs de Anthropic
6. **Error Handling Tests (7 tests)**: Stream errors, API failures

### 3.2 server.ts (PRIORIDAD: CRÍTICA)

**Estado Actual**:
- Líneas: 1,236
- Cobertura: 0%
- Tests Existentes: 0 (solo server.socket.test.ts para Socket.IO básico)

**Funcionalidades a Testear**:

| Funcionalidad | Líneas | Prioridad | Estado |
|---------------|--------|-----------|--------|
| Initialization | 150 | ALTA | ❌ No testeado |
| Middleware Config | 100 | MEDIA | ❌ No testeado |
| WebSocket Auth | 100 | ALTA | ⚠️ Parcial |
| Approval Endpoints | 150 | ALTA | ❌ No testeado |
| Todo Endpoints | 80 | MEDIA | ❌ No testeado |
| Error Handling | 100 | ALTA | ❌ No testeado |
| Graceful Shutdown | 50 | BAJA | ❌ No testeado |

**Tests Planificados**:
1. **Initialization Tests (8 tests)**: DB, Redis, MCP, BC client connections
2. **Middleware Tests (6 tests)**: CORS, JSON parsing, request ID
3. **WebSocket Authentication Tests (8 tests)**: Session validation, ownership
4. **Approval Endpoints Tests (10 tests)**: respond, pending, session approvals
5. **Error Handling Tests (5 tests)**: Error middleware, logging
6. **Graceful Shutdown Tests (3 tests)**: SIGTERM, SIGINT

### 3.3 TodoManager.ts (PRIORIDAD: MEDIA)

**Estado Actual**:
- Líneas: 350
- Cobertura: 0%
- Tests Existentes: 0
- Estado: ACTIVO (usado en server.ts línea 239)

**Funcionalidades a Testear**:

| Funcionalidad | Prioridad | Estado |
|---------------|-----------|--------|
| Singleton Pattern | MEDIA | ❌ No testeado |
| syncTodosFromSDK | ALTA | ❌ No testeado |
| createManualTodo | ALTA | ❌ No testeado |
| markInProgress/markCompleted | ALTA | ❌ No testeado |
| getTodosBySession | MEDIA | ❌ No testeado |
| toActiveForm | BAJA | ❌ No testeado |

**Tests Planificados**:
1. **Singleton Pattern Tests (3 tests)**
2. **syncTodosFromSDK Tests (5 tests)**
3. **createManualTodo Tests (5 tests)**
4. **Status Transition Tests (6 tests)**
5. **getTodosBySession Tests (3 tests)**
6. **toActiveForm Tests (3 tests)**

---

## 4. Guía de Testing para QA Especializado

### 4.1 Prerrequisitos

```bash
# Clonar y configurar
cd backend
npm install

# Variables de entorno (copiar .env.example a .env)
cp .env.example .env
# Configurar: ANTHROPIC_API_KEY, DATABASE_*, REDIS_*
```

### 4.2 Comandos de Testing

```bash
# Ejecutar todos los tests
npm test

# Ejecutar tests con cobertura
npm run test:coverage

# Ejecutar tests específicos
npm test -- DirectAgentService
npm test -- server.socket
npm test -- TodoManager

# Ejecutar tests en watch mode
npm run test:watch

# Ver UI de tests
npm run test:ui
```

### 4.3 Qué Verificar Post-Implementación

**Checklist de Build:**
- [ ] `npm run test` - 0 failing tests
- [ ] `npm run test:coverage` - ≥70% global
- [ ] `npm run lint` - 0 errors
- [ ] `npm run type-check` - 0 errors
- [ ] `npm run build` - successful

**Checklist de Cobertura por Módulo:**
- [ ] DirectAgentService.ts - ≥70%
- [ ] server.ts - ≥50%
- [ ] TodoManager.ts - ≥70%

**Checklist de Estabilidad:**
- [ ] No tests skipped nuevos (máximo 2 total)
- [ ] No flaky tests (ejecutar 3 veces)
- [ ] Tiempo de ejecución < 60 segundos

---

## 5. Escenarios Críticos de QA

### 5.1 DirectAgentService - Agentic Loop

**Escenario 1: Loop termina en end_turn**
```
GIVEN: Un mensaje del usuario sin necesidad de herramientas
WHEN: Claude responde con stop_reason="end_turn"
THEN: El loop termina, se emite message y complete events
```

**Escenario 2: Loop continúa con tool_use**
```
GIVEN: Un mensaje que requiere herramienta
WHEN: Claude responde con stop_reason="tool_use"
THEN: Se ejecuta la herramienta, se envía resultado a Claude
AND: El loop continúa hasta end_turn
```

**Escenario 3: Límite de turns (maxTurns=20)**
```
GIVEN: Un prompt que causa loop infinito de tools
WHEN: Se alcanzan 20 turns
THEN: El loop se detiene forzadamente
AND: Se emite mensaje de truncación
```

### 5.2 DirectAgentService - Approval Flow

**Escenario 4: Operación de escritura aprobada**
```
GIVEN: Claude quiere crear un customer (create_customer)
WHEN: isWriteOperation() retorna true
THEN: ApprovalManager.request() es llamado
AND: Si aprobado, tool se ejecuta normalmente
```

**Escenario 5: Operación de escritura denegada**
```
GIVEN: Claude quiere eliminar datos (delete_*)
WHEN: Usuario deniega la aprobación
THEN: tool_result contiene mensaje de cancelación
AND: Claude recibe feedback de que operación fue cancelada
```

### 5.3 server.ts - WebSocket Authentication

**Escenario 6: Socket con sesión válida**
```
GIVEN: Un socket con cookie de sesión válida
WHEN: Conecta al servidor Socket.IO
THEN: authSocket.userId se extrae de sesión
AND: Socket puede unirse a rooms de sus sesiones
```

**Escenario 7: Intento de acceso cross-tenant**
```
GIVEN: User A intenta hacer session:join a sesión de User B
WHEN: validateSessionOwnership() es llamado
THEN: Se emite error al socket
AND: No se permite el join
```

### 5.4 TodoManager - Status Transitions

**Escenario 8: Flow completo de todo**
```
GIVEN: SDK envía lista de todos
WHEN: syncTodosFromSDK() es llamado
THEN: Todos se persisten a BD
AND: todo:created event se emite
AND: Frontend recibe lista actualizada
```

**Escenario 9: Todo status updates**
```
GIVEN: Un todo en estado "pending"
WHEN: markInProgress() es llamado
THEN: status cambia a "in_progress"
AND: started_at se establece
AND: todo:updated event se emite
```

---

## 6. Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| Mocks insuficientes para DirectAgentService | Media | Alto | Extender FakeAnthropicClient con más escenarios |
| server.ts tiene dependencias circulares | Baja | Medio | Usar vi.mock() temprano en setup |
| Tests flaky por timing de streams | Media | Medio | Usar vi.useFakeTimers() donde necesario |
| TodoManager.getInstance() singleton issues | Baja | Bajo | Reset singleton en afterEach() |

---

## 7. Dependencias de Test

### 7.1 Mocks Existentes

- `FakeAnthropicClient` - Simula streaming responses
- `AnthropicResponseFactory` - Factory para crear responses mock
- `ApprovalFixture` - Datos de test para approvals
- `BCEntityFixture` - Datos de entidades BC

### 7.2 Mocks a Crear/Extender

- Extender `createToolUseStream` para Extended Thinking
- Mock de `EventStore` para verificar persistence
- Mock de `MessageQueue` para async writes
- Mock de Socket.IO server para TodoManager

---

## 8. Timeline Estimado

| Fase | Duración | Entregable |
|------|----------|------------|
| Fase 1: DirectAgentService | 12-16 horas | 40-60 tests nuevos |
| Fase 2: server.ts | 8-12 horas | 30-40 tests nuevos |
| Fase 3: TodoManager | 2-3 horas | 20-25 tests nuevos |
| Fase 4: Verificación | 2-3 horas | QA Report actualizado |
| **Total** | **24-34 horas** | **~100 tests nuevos** |

---

## 9. Criterios de Aceptación

**Para considerar F6-006 COMPLETADO:**

1. ✅ Cobertura global ≥70%
2. ✅ DirectAgentService.ts ≥70%
3. ✅ server.ts ≥50%
4. ✅ TodoManager.ts ≥70%
5. ✅ Todos los tests pasan (0 failing)
6. ✅ Lint sin errores
7. ✅ Build exitoso
8. ✅ Type-check exitoso
9. ✅ No tests skipped nuevos (máximo 2 total)
10. ✅ No flaky tests

---

## 10. Archivos Relevantes

### 10.1 Archivos a Testear

```
backend/src/services/agent/DirectAgentService.ts  (2240 líneas, 4% → 70%+)
backend/src/server.ts                              (1236 líneas, 0% → 50%+)
backend/src/services/todo/TodoManager.ts           (350 líneas, 0% → 70%+)
```

### 10.2 Tests Existentes

```
backend/src/__tests__/unit/services/agent/DirectAgentService.integration.test.ts
backend/src/__tests__/unit/server.socket.test.ts
```

### 10.3 Helpers de Test

```
backend/src/__tests__/unit/services/agent/streamingMockHelpers.ts
backend/src/services/agent/FakeAnthropicClient.ts
backend/src/__tests__/fixtures/AnthropicResponseFactory.ts
```

---

## 11. Contacto y Soporte

- **Documentación Principal**: `docs/DIAGNOSTIC-AND-TESTING-PLAN.md`
- **Guía de Testing**: `backend/README.md`
- **Issues**: https://github.com/anthropics/claude-code/issues

---

*Generado por Claude Code el 2025-11-25*
