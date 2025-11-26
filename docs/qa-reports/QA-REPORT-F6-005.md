# QA Report - F6-005: Tests de Routes

**Fecha**: 2025-11-25
**Estado**: 🧪 **IN TESTING** (Fase 4 de 5 completada)
**Implementador**: Claude Code
**Worktree**: `dreamy-heyrovsky`

---

## 1. Resumen Ejecutivo

Este ticket implementa tests unitarios exhaustivos para los endpoints REST del proyecto BC Claude Agent.

### Progreso de Remediación (QA Master Review)

| Fase | Descripción | Estado | Tests |
|------|-------------|--------|-------|
| 1 | Gaps Críticos | ✅ COMPLETED | +111 tests |
| 2 | Seguridad | ✅ COMPLETED | +42 tests |
| 3 | Edge Cases | ✅ COMPLETED | +61 tests |
| 4 | Inconsistencias | ✅ COMPLETED | +78 tests |
| 5 | Performance | PENDING | - |

### Resultados Actuales de Build

| Métrica | Resultado |
|---------|-----------|
| Tests totales | 1152 passing (413 nuevos desde inicio F6-005) |
| Errores de lint | 0 (15 warnings preexistentes) |
| Type-check | ✅ Sin errores |
| Build | ✅ Compila exitosamente |

### Archivos de Test Creados/Modificados en Fase 1

| Archivo | Tests | Descripción |
|---------|-------|-------------|
| `sessions.routes.test.ts` | 59 | NUEVO - CRUD completo + message transformation + QA audit fixes |
| `auth-oauth.routes.test.ts` | 31 | REFACTORIZADO - Usa router real |
| `MessageQueue.rateLimit.test.ts` | 21 | NUEVO - Rate limiting 100 jobs/session/hour |

### Archivos de Test Creados/Modificados en Fase 2

| Archivo | Tests | Descripción |
|---------|-------|-------------|
| `session-ownership.security.test.ts` | 24 | NUEVO - Timing attack protection tests |
| `BCTokenManager.raceCondition.test.ts` | 8 | NUEVO - Race condition documentation |
| `logs.routes.test.ts` | +10 | MODIFICADO - Input sanitization edge cases |

### Archivos de Test Modificados en Fase 3

| Archivo | Tests Agregados | Categorías |
|---------|-----------------|------------|
| `token-usage.routes.test.ts` | +16 | URL encoding, boundaries, decimals, UUIDs, negatives |
| `auth-oauth.routes.test.ts` | +17 | OAuth callback, profiles, DB errors, BC tokens, sessions |
| `server-endpoints.test.ts` | +14 | Agent query, approvals, session IDs, DB errors, MCP |
| `logs.routes.test.ts` | +14 | Timestamps, context types, URLs, UserAgents, batches |

### Archivos Creados/Modificados en Fase 4 (Error Standardization)

| Archivo | Estado | Descripción |
|---------|--------|-------------|
| `constants/errors.ts` | ✅ NUEVO | 35 ErrorCode values + ERROR_MESSAGES + ERROR_STATUS_CODES |
| `types/error.types.ts` | ✅ NUEVO | ApiErrorResponse interface + type guards (isApiErrorResponse, isValidErrorCode) |
| `utils/error-response.ts` | ✅ NUEVO | sendError() helper + HTTP_STATUS_NAMES |
| `routes/logs.ts` | ✅ REFACTORIZADO | Usa sendError() para errores |
| `routes/token-usage.ts` | ✅ REFACTORIZADO | Usa sendError() para errores |
| `routes/sessions.ts` | ✅ REFACTORIZADO | Usa sendError() para errores |
| `routes/auth-oauth.ts` | ✅ REFACTORIZADO | Usa sendError() para errores |

### Tests Nuevos/Actualizados en Fase 4

| Archivo | Tests | Estado |
|---------|-------|--------|
| `errors.test.ts` | 10 | ✅ NUEVO - Tests de ErrorCode enum |
| `error-response.test.ts` | 22 | ✅ NUEVO - Tests de sendError() |
| `error.types.test.ts` | 15 | ✅ NUEVO - Tests de type guards |
| `sessions.routes.test.ts` | ACTUALIZADO | Usa ErrorCode enum (no magic strings) |
| `token-usage.routes.test.ts` | ACTUALIZADO | Usa ErrorCode enum |
| `logs.routes.test.ts` | ACTUALIZADO | Usa ErrorCode enum |
| `auth-oauth.routes.test.ts` | ACTUALIZADO | Usa ErrorCode enum + status codes corregidos |

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

### 2.2 Arquitectura de Routes

```
backend/src/routes/
├── auth-oauth.ts      # Microsoft OAuth 2.0 + BC token management
├── sessions.ts        # Chat session CRUD + messages
├── token-usage.ts     # Token usage analytics
├── logs.ts           # Client log ingestion

backend/src/server.ts (inline endpoints):
├── /api              # Health check
├── /api/mcp/*        # MCP configuration/health
├── /api/bc/*         # Business Central test/customers
├── /api/agent/*      # Agent status/query
├── /api/approvals/*  # Human-in-the-loop approvals
└── /api/todos/*      # Todo list management
```

---

## 3. Endpoints a Verificar

### 3.1 Auth OAuth Routes (`/api/auth/*`)

| Endpoint | Método | Auth | Descripción |
|----------|--------|------|-------------|
| `/login` | GET | No | Inicia OAuth, redirige a Microsoft |
| `/callback` | GET | No | Procesa callback OAuth con code + state |
| `/logout` | POST | Sí | Destruye sesión |
| `/me` | GET | Sí | Retorna datos del usuario actual |
| `/bc-status` | GET | Sí | Estado del token de Business Central |
| `/bc-consent` | POST | Sí | Adquiere token BC vía refresh token |

**Puntos críticos de verificación:**
- [ ] CSRF state validation en callback (64 hex chars)
- [ ] Redirección correcta en errores OAuth
- [ ] Token BC expiration handling (null, expirado, inválido)
- [ ] No se exponen tokens en respuestas

### 3.2 Token Usage Routes (`/api/token-usage/*`)

| Endpoint | Método | Auth | Parámetros |
|----------|--------|------|------------|
| `/user/:userId` | GET | Sí | userId (debe coincidir con auth) |
| `/session/:sessionId` | GET | Sí | sessionId (debe ser owner) |
| `/user/:userId/monthly` | GET | Sí | months (1-24, default 12) |
| `/user/:userId/top-sessions` | GET | Sí | limit (1-50, default 10) |
| `/user/:userId/cache-efficiency` | GET | Sí | - |
| `/me` | GET | Sí | - (conveniencia) |

**Puntos críticos de verificación:**
- [ ] User A NO puede acceder a `/user/userB` (403)
- [ ] User A NO puede acceder a session de User B (403)
- [ ] Parámetros fuera de rango retornan 400
- [ ] Session inexistente retorna 404

### 3.3 Logs Routes (`/api/logs`)

| Endpoint | Método | Auth | Descripción |
|----------|--------|------|-------------|
| `/logs` | POST | No | Ingesta de logs del frontend |

**Puntos críticos de verificación:**
- [ ] Batch de logs procesados correctamente
- [ ] Log levels (debug/info/warn/error) ruteados al logger correcto
- [ ] Validación de schema Zod (timestamp, level, message required)
- [ ] Manejo de caracteres especiales y unicode

### 3.4 Sessions Routes (`/api/chat/sessions/*`)

| Endpoint | Método | Auth | Descripción |
|----------|--------|------|-------------|
| `/` | GET | Sí | Listar todas las sesiones del usuario |
| `/` | POST | Sí | Crear nueva sesión |
| `/:sessionId` | GET | Sí | Obtener sesión específica |
| `/:sessionId/messages` | GET | Sí | Obtener mensajes de sesión |
| `/:sessionId` | PATCH | Sí | Actualizar título de sesión |
| `/:sessionId` | DELETE | Sí | Eliminar sesión (CASCADE) |

**Puntos críticos de verificación:**
- [ ] Solo retorna sesiones del usuario autenticado
- [ ] Paginación de mensajes funciona (limit, offset)
- [ ] Title validation (1-500 chars, trimmed)
- [ ] CASCADE delete funciona (messages, approvals, todos)

### 3.5 Server Endpoints (Inline)

| Endpoint | Método | Auth | Descripción |
|----------|--------|------|-------------|
| `/api` | GET | No | Health check |
| `/api/mcp/config` | GET | No | Configuración MCP |
| `/api/mcp/health` | GET | No | Health MCP |
| `/api/bc/test` | GET | No | Test conexión BC |
| `/api/bc/customers` | GET | Sí | Obtener clientes BC |
| `/api/agent/status` | GET | No | Estado del agente |
| `/api/agent/query` | POST | Sí | Ejecutar query en agente |
| `/api/approvals/:id/respond` | POST | Sí | Responder a approval |
| `/api/approvals/pending` | GET | Sí | Approvals pendientes del usuario |
| `/api/approvals/session/:sessionId` | GET | Sí | Approvals de una sesión |
| `/api/todos/session/:sessionId` | GET | Sí | Todos de una sesión |

**Puntos críticos de verificación:**
- [ ] Approvals: Solo owner de sesión puede responder
- [ ] Approvals: atomic validation previene TOCTOU race condition
- [ ] Approvals: error codes correctos (404/403/409/410/503)
- [ ] Todos: session ownership validation

---

## 4. Casos de Prueba Manual

### 4.1 Flujo OAuth Completo

```bash
# 1. Iniciar login
GET http://localhost:3002/api/auth/login
# Esperar: Redirect 302 a login.microsoftonline.com con state=<64 hex chars>

# 2. Después de autenticación en Microsoft, callback llega
GET http://localhost:3002/api/auth/callback?code=xxx&state=<same-state>
# Esperar: Redirect a http://localhost:3000/new (nuevo usuario) o /chat (existente)

# 3. Verificar sesión
GET http://localhost:3002/api/auth/me
Cookie: connect.sid=<session-cookie>
# Esperar: 200 con { id, email, fullName, role }
```

### 4.2 Multi-Tenant Isolation

```bash
# Como User A, intentar acceder a sesión de User B
GET http://localhost:3002/api/token-usage/user/<user-b-id>
Cookie: <session-user-a>
# Esperar: 403 Forbidden "You can only access your own token usage data"

# Como User A, intentar acceder a session de User B
GET http://localhost:3002/api/token-usage/session/<session-of-user-b>
Cookie: <session-user-a>
# Esperar: 403 Forbidden "You do not have access to this session"
```

### 4.3 Approval Response Flow

```bash
# Responder a approval con decision inválida
POST http://localhost:3002/api/approvals/<approval-id>/respond
{ "decision": "maybe" }
# Esperar: 400 "decision must be either 'approved' or 'rejected'"

# Responder a approval ya resuelto
POST http://localhost:3002/api/approvals/<resolved-approval-id>/respond
{ "decision": "approved" }
# Esperar: 409 "This approval has already been approved/rejected"

# Responder a approval de otro usuario
POST http://localhost:3002/api/approvals/<other-user-approval>/respond
{ "decision": "approved" }
# Esperar: 403 "You do not have permission to respond"
```

### 4.4 Token Usage Parameter Validation

```bash
# Parámetro months fuera de rango
GET http://localhost:3002/api/token-usage/user/<userId>/monthly?months=30
# Esperar: 400 "months must be a number between 1 and 24"

# Parámetro limit negativo
GET http://localhost:3002/api/token-usage/user/<userId>/top-sessions?limit=-5
# Esperar: 400 "limit must be a number between 1 and 50"

# Parámetro no numérico
GET http://localhost:3002/api/token-usage/user/<userId>/monthly?months=abc
# Esperar: 400
```

---

## 5. Verificación de Seguridad

### 5.1 CSRF Protection

- [ ] State en OAuth callback es de 64 caracteres hexadecimales
- [ ] State mismatch resulta en error `invalid_state`
- [ ] State se genera con `crypto.randomBytes(32)`

### 5.2 Token Exposure

- [ ] `/api/auth/me` NO retorna `bc_access_token_encrypted`
- [ ] `/api/auth/me` NO retorna `bc_refresh_token`
- [ ] Logs NO contienen tokens en texto plano

### 5.3 SQL Injection

- [ ] Inputs parametrizados con `@paramName` (no concatenación)
- [ ] Zod validation antes de queries

### 5.4 Rate Limiting

- [ ] Verificar que existe rate limiting (100 jobs/session/hour vía Redis)

---

## 6. Archivos de Test Creados

### Pre-Fase 1 (existentes)
| Archivo | Ubicación | Tests |
|---------|-----------|-------|
| `token-usage.routes.test.ts` | `backend/src/__tests__/unit/routes/` | 35 |
| `logs.routes.test.ts` | `backend/src/__tests__/unit/routes/` | 25 |
| `server-endpoints.test.ts` | `backend/src/__tests__/unit/routes/` | 38 |
| `sessions.routes.integration.test.ts` | `backend/src/__tests__/unit/routes/` | 18 |

### Fase 1 - Nuevos/Modificados
| Archivo | Ubicación | Tests | Estado |
|---------|-----------|-------|--------|
| `sessions.routes.test.ts` | `backend/src/__tests__/unit/routes/` | 59 | **NUEVO** (+4 QA audit fixes) |
| `auth-oauth.routes.test.ts` | `backend/src/__tests__/unit/routes/` | 31 | **REFACTORIZADO** |
| `MessageQueue.rateLimit.test.ts` | `backend/src/__tests__/unit/services/queue/` | 21 | **NUEVO** |

---

## 7. Comandos para QA

```bash
# Ejecutar todos los tests
cd backend && npm test

# Ejecutar solo tests de routes
cd backend && npx vitest run src/__tests__/unit/routes/

# Ejecutar test específico
cd backend && npx vitest run src/__tests__/unit/routes/token-usage.routes.test.ts

# Verificar lint
cd backend && npm run lint

# Verificar tipos
cd backend && npm run type-check

# Build completo
cd backend && npm run build
```

---

## 8. Criterios de Aceptación

### Criterios Técnicos (Actualizados Fase 4)
- [x] Tests totales: 1152 passing (objetivo inicial 884 superado en +30%)
- [x] 0 errores de lint (15 warnings preexistentes)
- [x] Type-check sin errores
- [x] Build exitoso

### Criterios de Cobertura (En progreso)
- [x] sessions.routes.test.ts creado (59 tests) - Fase 1 + QA Audit
- [x] auth-oauth.routes.test.ts refactorizado para usar router real - Fase 1
- [x] Rate limiting testeado (21 tests) - Fase 1
- [x] Timing attack protection testeada (24 tests) - Fase 2
- [x] Race condition documentada con tests (8 tests) - Fase 2
- [x] Input sanitization testeada (+10 tests) - Fase 2
- [x] Edge cases completos (+61 tests) - Fase 3
- [x] Error messages estandarizados (+78 tests + ErrorCode enum + sendError()) - Fase 4
- [ ] Performance tests básicos - Fase 5

### Validación Manual
- [ ] Multi-tenant isolation verificada manualmente
- [ ] CSRF state validation verificada manualmente
- [ ] Approval atomic validation previene race conditions

---

## 9. Issues Conocidos / Limitaciones

1. **auth-mock.ts no testeado**: Es archivo de desarrollo solo, no usado en producción
2. **MSW warnings en tests**: Son informativos, no afectan funcionamiento
3. **Token refresh race condition**: Documentado, requiere Redis distributed lock para fix completo (futuro)

---

## 10. Próximos Pasos

### Fase 1 ✅ COMPLETADA (con QA Audit fixes)
- [x] sessions.routes.test.ts (59 tests, +4 del QA audit)
- [x] auth-oauth.routes.test.ts refactorizado (31 tests)
- [x] MessageQueue.rateLimit.test.ts (21 tests)
- [x] Verificación: 966 tests, lint OK, type-check OK, build OK

### Fase 2 ✅ COMPLETADA
- [x] session-ownership.security.test.ts (24 tests) - Timing attack protection
- [x] BCTokenManager.raceCondition.test.ts (8 tests) - Race condition documentation
- [x] logs.routes.test.ts (+10 tests) - Input sanitization
- [x] Verificación: 1008 tests, lint OK, type-check OK, build OK

### Fase 3 ✅ COMPLETADA
- [x] token-usage.routes.test.ts (+16 tests) - URL encoding, boundaries, decimals, UUIDs
- [x] auth-oauth.routes.test.ts (+17 tests) - OAuth callback, profiles, DB errors, sessions
- [x] server-endpoints.test.ts (+14 tests) - Agent query, approvals, session IDs, MCP
- [x] logs.routes.test.ts (+14 tests) - Timestamps, context types, URLs, UserAgents
- [x] Verificación: 1074 tests, lint OK, type-check OK, build OK

### Fase 4 ✅ COMPLETADA (Error Standardization)
- [x] constants/errors.ts (ErrorCode enum con 35 valores)
- [x] types/error.types.ts (ApiErrorResponse + type guards)
- [x] utils/error-response.ts (sendError() helper)
- [x] 4 rutas refactorizadas (logs, token-usage, sessions, auth-oauth)
- [x] Tests actualizados para usar ErrorCode enum (no magic strings)
- [x] +78 tests nuevos (errors.test, error-response.test, error.types.test)
- [x] Verificación: 1152 tests, lint OK, type-check OK, build OK

**Breaking Changes Fase 4 (Justificados):**
1. Agregado campo `code` a todas las respuestas de error (machine-readable)
2. Campo `error` ahora contiene HTTP status name (e.g., "Bad Request")
3. SESSION_EXPIRED retorna 401 (no 400) - semánticamente correcto
4. BC_UNAVAILABLE retorna 503 (no 500) - indica service unavailable

### Fases Pendientes
5. **Fase 5 - Performance**: Tests básicos de carga

### Después de Fase 5
- Actualizar DIAGNOSTIC-AND-TESTING-PLAN.md
- Cambiar estado a ✅ COMPLETED
- Continuar con F6-006 (alcanzar 70% cobertura global)

---

**Aprobaciones:**

| Rol | Nombre | Fecha | Firma |
|-----|--------|-------|-------|
| Implementador | Claude Code | 2025-11-25 | ✅ |
| QA Tester | | | |
| Tech Lead | | | |
