# TODO - Fase 4.2: Core APIs (Health, Auth, Sessions)

## Informacion de Tracking

| Campo | Valor |
|-------|-------|
| **Fase** | 4.2 |
| **Estado** | PENDIENTE |
| **Dependencias** | Fase 4.1 completada |

---

## Tareas

### Bloque 1: Health Endpoints (30min)

#### T4.2.1: GET /health - Basic Health Check
- [ ] Crear archivo `backend/src/__tests__/e2e/api/health.api.test.ts`
- [ ] Test: Request a `/health` retorna 200
- [ ] Test: Response contiene `{ status, timestamp, uptime }`
- [ ] Test: Validar types de campos (status = string, timestamp = ISO string, uptime = number)

**Criterio de Aceptacion**:
- Test pasa consistentemente
- Valida estructura completa de respuesta

**Archivos a Crear**:
- `backend/src/__tests__/e2e/api/health.api.test.ts`

---

#### T4.2.2: GET /health/liveness - Liveness Probe
- [ ] En mismo archivo `health.api.test.ts`
- [ ] Test: Request a `/health/liveness` retorna 200
- [ ] Test: No requiere validacion de body (solo status code)

**Criterio de Aceptacion**:
- Test pasa consistentemente
- Simula lo que Kubernetes liveness probe hace

**Archivos a Editar**:
- `backend/src/__tests__/e2e/api/health.api.test.ts`

---

### Bloque 2: Auth Endpoints (3h)

#### T4.2.3: GET /api/auth/login - Microsoft OAuth Redirect
- [ ] Crear archivo `backend/src/__tests__/e2e/api/auth.api.test.ts`
- [ ] Test: Request a `/api/auth/login` retorna 302 (redirect)
- [ ] Test: Location header contiene `login.microsoftonline.com`
- [ ] Test: Query params incluyen `client_id`, `redirect_uri`, `scope`

**Criterio de Aceptacion**:
- Test valida que redirect esta configurado correctamente
- No ejecuta OAuth flow completo (solo valida configuracion)

**Archivos a Crear**:
- `backend/src/__tests__/e2e/api/auth.api.test.ts`

**Referencia**:
- `backend/src/routes/auth.ts` - Implementacion de login

---

#### T4.2.4: GET /api/auth/callback - OAuth Callback Handling
- [ ] Test: Mock Microsoft Graph API response
- [ ] Test: Request a `/api/auth/callback?code=MOCK_CODE` retorna 302
- [ ] Test: Redirect apunta a frontend con sesion creada
- [ ] Test: Cookie `connect.sid` se setea correctamente
- [ ] Test: Usuario se crea/actualiza en DB
- [ ] Test: Sesion se crea en Redis

**Criterio de Aceptacion**:
- Test mockea llamadas a Microsoft (no requiere API real)
- Valida side effects: DB insert, Redis session, cookie set

**Archivos a Editar**:
- `backend/src/__tests__/e2e/api/auth.api.test.ts`

**Notas**:
- Usar MSW (Mock Service Worker) para mockear Microsoft Graph API
- Validar que token se encripta antes de guardar en DB

---

#### T4.2.5: POST /api/auth/logout - Session Destruction
- [ ] Test: Crear sesion autenticada primero (helper)
- [ ] Test: Request a `/api/auth/logout` retorna 200
- [ ] Test: Cookie `connect.sid` se elimina (header Set-Cookie con Max-Age=0)
- [ ] Test: Sesion se elimina de Redis
- [ ] Test: Request subsiguiente a `/api/auth/me` retorna 401

**Criterio de Aceptacion**:
- Test valida limpieza completa de sesion
- Test valida que sesion ya no es valida despues

**Archivos a Editar**:
- `backend/src/__tests__/e2e/api/auth.api.test.ts`

---

#### T4.2.6: GET /api/auth/me - Current User Info
- [ ] Test (autenticado): Request a `/api/auth/me` retorna 200 con user info
- [ ] Test (autenticado): Response contiene `{ userId, email, displayName, microsoftId }`
- [ ] Test (no autenticado): Request retorna 401

**Criterio de Aceptacion**:
- Test valida estructura de user object
- Test valida que info sensible NO se expone (ej: encrypted BC token)

**Archivos a Editar**:
- `backend/src/__tests__/e2e/api/auth.api.test.ts`

---

#### T4.2.7: GET /api/auth/bc-status - BC Token Status
- [ ] Test (con token BC): Request retorna 200 con `{ hasToken: true, isValid: true }`
- [ ] Test (sin token BC): Request retorna 200 con `{ hasToken: false, isValid: false }`
- [ ] Test (token expirado): Request retorna 200 con `{ hasToken: true, isValid: false }`
- [ ] Test (no autenticado): Request retorna 401

**Criterio de Aceptacion**:
- Test cubre 3 estados posibles del token BC
- Test NO expone el token mismo en response

**Archivos a Editar**:
- `backend/src/__tests__/e2e/api/auth.api.test.ts`

**Notas**:
- Usar `TestDataFactory` para crear user con/sin BC token
- Mockear validacion de token BC si es necesario

---

#### T4.2.8: POST /api/auth/bc-consent - BC API Consent
- [ ] Test: Request a `/api/auth/bc-consent` retorna 302 (redirect)
- [ ] Test: Location header contiene URL de Microsoft consent
- [ ] Test: Query params incluyen `client_id`, `scope` (BC API scopes)
- [ ] Test (no autenticado): Request retorna 401

**Criterio de Aceptacion**:
- Test valida que redirect esta configurado para BC consent
- No ejecuta flow completo (solo configuracion)

**Archivos a Editar**:
- `backend/src/__tests__/e2e/api/auth.api.test.ts`

---

### Bloque 3: Sessions Endpoints (3h)

#### T4.2.9: GET /api/chat/sessions - List All Sessions
- [ ] Crear archivo `backend/src/__tests__/e2e/api/sessions.api.test.ts`
- [ ] Test (usuario nuevo): Request retorna 200 con array vacio `[]`
- [ ] Test (con sesiones): Request retorna 200 con array de sessions
- [ ] Test (isolation): Usuario A no ve sesiones de Usuario B
- [ ] Test (sorting): Sessions ordenadas por `lastMessageAt DESC` por default
- [ ] Test (no autenticado): Request retorna 401

**Criterio de Aceptacion**:
- Test valida estructura de cada session object en array
- Test valida isolation entre usuarios
- Test valida sorting default

**Archivos a Crear**:
- `backend/src/__tests__/e2e/api/sessions.api.test.ts`

**Referencia**:
- `backend/src/routes/chat.ts` - Implementacion de sessions endpoints
- `TestDataFactory.createSession()` - Para crear sesiones de test

---

#### T4.2.10: POST /api/chat/sessions - Create Session
- [ ] Test: Request a `/api/chat/sessions` (body vacio) retorna 201
- [ ] Test: Response contiene `{ sessionId, userId, createdAt, title }`
- [ ] Test: `title` es auto-generado (ej: "New Chat")
- [ ] Test: Session se persiste en DB
- [ ] Test: `GET /api/chat/sessions` incluye nueva session
- [ ] Test (no autenticado): Request retorna 401

**Criterio de Aceptacion**:
- Test valida creacion exitosa en DB
- Test valida que session es accesible inmediatamente

**Archivos a Editar**:
- `backend/src/__tests__/e2e/api/sessions.api.test.ts`

---

#### T4.2.11: GET /api/chat/sessions/:id - Get Specific Session
- [ ] Test (existe): Request a `/api/chat/sessions/{validId}` retorna 200 con session
- [ ] Test (no existe): Request a `/api/chat/sessions/{invalidId}` retorna 404
- [ ] Test (otro usuario): Request a session de otro usuario retorna 401 o 404
- [ ] Test (no autenticado): Request retorna 401

**Criterio de Aceptacion**:
- Test valida estructura completa de session object
- Test valida authorization (user puede solo ver sus sessions)

**Archivos a Editar**:
- `backend/src/__tests__/e2e/api/sessions.api.test.ts`

---

#### T4.2.12: GET /api/chat/sessions/:id/messages - Get Messages with Pagination
- [ ] Test (sin mensajes): Request retorna 200 con array vacio `[]`
- [ ] Test (con mensajes): Request retorna 200 con array de messages
- [ ] Test (pagination): Query `?limit=5&offset=0` retorna primeros 5 mensajes
- [ ] Test (pagination): Query `?limit=5&offset=5` retorna siguientes 5 mensajes
- [ ] Test (ordering): Mensajes ordenados por `sequenceNumber ASC`
- [ ] Test (no autenticado): Request retorna 401

**Criterio de Aceptacion**:
- Test valida estructura de cada message object
- Test valida que pagination funciona correctamente
- Test valida ordering correcto

**Archivos a Editar**:
- `backend/src/__tests__/e2e/api/sessions.api.test.ts`

**Notas**:
- Crear 10+ mensajes de test para validar pagination
- Validar que `sequenceNumber` se respeta en ordering

---

#### T4.2.13: PATCH /api/chat/sessions/:id - Update Session Title
- [ ] Test: Request a `/api/chat/sessions/{id}` con `{ title: "New Title" }` retorna 200
- [ ] Test: Response contiene session actualizada con nuevo titulo
- [ ] Test: `GET /api/chat/sessions/{id}` confirma cambio persistido
- [ ] Test (titulo vacio): Request con `{ title: "" }` retorna 400
- [ ] Test (otro usuario): Request sobre session de otro usuario retorna 401/404
- [ ] Test (no autenticado): Request retorna 401

**Criterio de Aceptacion**:
- Test valida actualizacion exitosa
- Test valida validacion de input (titulo no vacio)

**Archivos a Editar**:
- `backend/src/__tests__/e2e/api/sessions.api.test.ts`

---

#### T4.2.14: DELETE /api/chat/sessions/:id - Delete Session (Cascade)
- [ ] Test: Crear session con 5+ mensajes
- [ ] Test: Request a `DELETE /api/chat/sessions/{id}` retorna 204 (No Content)
- [ ] Test: `GET /api/chat/sessions/{id}` retorna 404 (session eliminada)
- [ ] Test: Mensajes asociados tambien se eliminaron (query DB directa)
- [ ] Test (otro usuario): Request sobre session de otro usuario retorna 401/404
- [ ] Test (no autenticado): Request retorna 401

**Criterio de Aceptacion**:
- Test valida cascade delete (session + messages)
- Test valida que no quedan registros huerfanos en DB

**Archivos a Editar**:
- `backend/src/__tests__/e2e/api/sessions.api.test.ts`

**Notas**:
- Validar cascade con query directa a DB: `SELECT * FROM messages WHERE sessionId = ?`
- Asegurar que test cleanup no interfiere con otros tests

---

## Comandos Utiles

```bash
# Ejecutar todos los tests de esta fase
cd backend && npm run test:e2e -- health.api auth.api sessions.api

# Ejecutar solo health tests
cd backend && npm run test:e2e -- health.api

# Ejecutar solo auth tests
cd backend && npm run test:e2e -- auth.api

# Ejecutar solo sessions tests
cd backend && npm run test:e2e -- sessions.api

# Ver HTML report
open backend/test-results/e2e-report.html
```

---

## Criterios de Aceptacion de la Fase

Esta fase se considera COMPLETADA cuando:

1. [ ] Todos los 14 tests implementados y pasando
2. [ ] Cada test valida happy path + error cases
3. [ ] Cada test valida schema de respuesta
4. [ ] Tests de sessions validan isolation entre usuarios
5. [ ] Tests de auth validan side effects (DB, Redis, cookies)
6. [ ] HTML report generado sin errores
7. [ ] Todas las tareas marcadas como completadas

---

## Notas de Ejecucion

### Bloqueadores Encontrados

(A completar durante ejecucion)

### Decisiones Tomadas

(A completar durante ejecucion)

---

*Ultima actualizacion: 2025-12-17*
