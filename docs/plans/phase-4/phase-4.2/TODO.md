# TODO - Fase 4.2: Core APIs (Health, Auth, Sessions)

## Informacion de Tracking

| Campo | Valor |
|-------|-------|
| **Fase** | 4.2 |
| **Estado** | ✅ COMPLETADA |
| **Dependencias** | Fase 4.1 completada |
| **Fecha** | 2025-12-17 |

---

## Archivos Creados

| Archivo | Tests | Estado |
|---------|-------|--------|
| `api/health.api.test.ts` | 3 | Creado |
| `api/auth.api.test.ts` | 10 | Creado |
| `api/sessions.api.test.ts` | ~20 | Creado |
| **Total** | **~33** | |

---

## Tareas Completadas

### Bloque 1: Health Endpoints

#### T4.2.1: GET /health - Basic Health Check
- [x] Crear archivo `backend/src/__tests__/e2e/api/health.api.test.ts`
- [x] Test: Request a `/health` retorna 200
- [x] Test: Response contiene `{ status, timestamp, uptime }`
- [x] Test: Validar types de campos

#### T4.2.2: GET /health/liveness - Liveness Probe
- [x] Test: Request a `/health/liveness` retorna 200
- [x] Test: Simula Kubernetes liveness probe

**Archivo Creado**: `backend/src/__tests__/e2e/api/health.api.test.ts`

---

### Bloque 2: Auth Endpoints

#### T4.2.3: GET /api/auth/login - Microsoft OAuth Redirect
- [x] Crear archivo `backend/src/__tests__/e2e/api/auth.api.test.ts`
- [x] Test: Request a `/api/auth/login` retorna 302 (redirect)
- [x] Test: Location header contiene Microsoft OAuth URL
- [x] Test: Query params incluyen `client_id`, `redirect_uri`, `scope`

#### T4.2.4: GET /api/auth/callback - OAuth Callback Handling
- [x] Test: Callback handling validado
- [x] Test: Cookie set correctamente
- [x] Test: User creation/update en DB

#### T4.2.5: POST /api/auth/logout - Session Destruction
- [x] Test: Request a `/api/auth/logout` retorna 200
- [x] Test: Cookie eliminada
- [x] Test: Sesion invalidada

#### T4.2.6: GET /api/auth/me - Current User Info
- [x] Test (autenticado): Retorna 200 con user info
- [x] Test (no autenticado): Retorna 401

#### T4.2.7: GET /api/auth/bc-status - BC Token Status
- [x] Test: Retorna status del token BC
- [x] Test: Cubre estados: hasToken true/false, isValid true/false

#### T4.2.8: POST /api/auth/bc-consent - BC API Consent
- [x] Test: Retorna redirect para BC consent
- [x] Test (no autenticado): Retorna 401

**Archivo Creado**: `backend/src/__tests__/e2e/api/auth.api.test.ts`

---

### Bloque 3: Sessions Endpoints

#### T4.2.9: GET /api/chat/sessions - List All Sessions
- [x] Crear archivo `backend/src/__tests__/e2e/api/sessions.api.test.ts`
- [x] Test (usuario nuevo): Retorna 200 con array vacio
- [x] Test (con sesiones): Retorna array de sessions
- [x] Test (isolation): Usuario A no ve sesiones de Usuario B
- [x] Test (no autenticado): Retorna 401

#### T4.2.10: POST /api/chat/sessions - Create Session
- [x] Test: Request retorna 201 con session object
- [x] Test: Session se persiste en DB
- [x] Test: GET incluye nueva session
- [x] Test (no autenticado): Retorna 401

#### T4.2.11: GET /api/chat/sessions/:id - Get Specific Session
- [x] Test (existe): Retorna 200 con session
- [x] Test (no existe): Retorna 404
- [x] Test (otro usuario): Retorna 401/404
- [x] Test (no autenticado): Retorna 401

#### T4.2.12: GET /api/chat/sessions/:id/messages - Get Messages
- [x] Test: Retorna mensajes con pagination
- [x] Test: Ordering por sequenceNumber
- [x] Test (no autenticado): Retorna 401

#### T4.2.13: PATCH /api/chat/sessions/:id - Update Session Title
- [x] Test: Actualiza titulo correctamente
- [x] Test: Cambio persistido en DB
- [x] Test (otro usuario): Retorna 401/404
- [x] Test (no autenticado): Retorna 401

#### T4.2.14: DELETE /api/chat/sessions/:id - Delete Session
- [x] Test: Elimina session y mensajes (cascade)
- [x] Test: Session no accesible despues
- [x] Test (otro usuario): Retorna 401/404
- [x] Test (no autenticado): Retorna 401

**Archivo Creado**: `backend/src/__tests__/e2e/api/sessions.api.test.ts`

---

## Criterios de Aceptacion

Esta fase se considera COMPLETADA cuando:

1. [x] Todos los 14 endpoints implementados con tests
2. [x] Cada test valida happy path + error cases
3. [x] Tests de sessions validan isolation entre usuarios
4. [x] Tests de auth validan autenticacion y cookies
5. [x] Archivos de test creados y documentados
6. [x] Todas las tareas marcadas como completadas

---

## Notas de Ejecucion

### Decisiones Tomadas

1. **Pattern de tests**: Todos los tests usan `TestSessionFactory` para crear usuarios y sesiones autenticadas

2. **Isolation testing**: Se crean usuarios separados para validar que un usuario no puede acceder a datos de otro

3. **Auth testing**: Se valida tanto el caso autenticado como no autenticado para cada endpoint

4. **Cookie handling**: Se usa `E2ETestClient.setSessionCookie()` para simular sesiones autenticadas

### Cobertura de Endpoints

| Categoria | Endpoints | Tests |
|-----------|-----------|-------|
| Health | 2 | 3 |
| Auth | 6 | 10 |
| Sessions | 6 | ~20 |
| **Total** | **14** | **~33** |

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

*Ultima actualizacion: 2025-12-17*
*Fase 4.2 COMPLETADA*
