# Fase 4.2: Core APIs (Health, Auth, Sessions)

## Informacion de la Fase

| Campo | Valor |
|-------|-------|
| **Fase** | 4.2 |
| **Nombre** | Core APIs (Health, Auth, Sessions) |
| **Estado** | Alta prioridad |
| **Prerequisitos** | Fase 4.1 completada |
| **Fase Siguiente** | Fase 4.3 (Extended APIs) |

---

## Objetivo Principal

Crear tests E2E exhaustivos para los endpoints core del backend: health checks, autenticacion Microsoft OAuth, y manejo de sesiones de chat. Estos son los endpoints mas criticos que sostienen toda la aplicacion.

---

## Success Criteria

### SC-1: Health Endpoints (2 tests)
- [ ] `GET /health` - Basic health check
- [ ] `GET /health/liveness` - Kubernetes liveness probe

### SC-2: Auth Endpoints (6 tests)
- [ ] `GET /api/auth/login` - Redirect a Microsoft OAuth
- [ ] `GET /api/auth/callback` - Procesa callback y crea sesion
- [ ] `POST /api/auth/logout` - Destruye sesion y limpia cookies
- [ ] `GET /api/auth/me` - Retorna info de usuario autenticado
- [ ] `GET /api/auth/bc-status` - Estado de token BC del usuario
- [ ] `POST /api/auth/bc-consent` - Inicia flujo de consentimiento BC

### SC-3: Sessions Endpoints (6 tests)
- [ ] `GET /api/chat/sessions` - Lista todas las sesiones del usuario
- [ ] `POST /api/chat/sessions` - Crea nueva sesion
- [ ] `GET /api/chat/sessions/:id` - Obtiene sesion especifica
- [ ] `GET /api/chat/sessions/:id/messages` - Obtiene mensajes con paginacion
- [ ] `PATCH /api/chat/sessions/:id` - Actualiza titulo de sesion
- [ ] `DELETE /api/chat/sessions/:id` - Elimina sesion (cascade)

### SC-4: Test Coverage Requirements
- [ ] Cada endpoint tiene test de happy path
- [ ] Cada endpoint tiene test de error cases (401, 404, 400)
- [ ] Tests validan estructura de respuesta (schema validation)
- [ ] Tests validan side effects (DB, Redis, eventos)

---

## Filosofia de Esta Fase

### Principio: "Core First, Extensions Later"

Los endpoints core (health, auth, sessions) son la base de la aplicacion. Si estos fallan, nada mas funciona. Por eso los testeamos primero y exhaustivamente.

### Enfoque de Test Design

Cada endpoint debe validar:
1. **Happy Path**: Comportamiento esperado con inputs validos
2. **Auth/Authz**: Validar que autenticacion/autorizacion funcionen
3. **Error Cases**: 400, 401, 404, 500 segun sea aplicable
4. **Side Effects**: Validar cambios en DB, Redis, eventos emitidos
5. **Schema**: Validar estructura de respuesta (types, required fields)

---

## Entregables de Esta Fase

### E-1: Health API Tests
```
backend/src/__tests__/e2e/api/health.api.test.ts
```
Tests para:
- `GET /health` retorna 200 con status info
- `GET /health/liveness` retorna 200 (simple probe)

### E-2: Auth API Tests
```
backend/src/__tests__/e2e/api/auth.api.test.ts
```
Tests para:
- Microsoft OAuth redirect (login)
- OAuth callback handling (code exchange, session creation)
- Logout (session destruction)
- Current user info (me)
- BC token status check
- BC consent flow initiation

### E-3: Sessions API Tests
```
backend/src/__tests__/e2e/api/sessions.api.test.ts
```
Tests para:
- List sessions (con filtros, sorting)
- Create session (titulo auto-generado)
- Get session by ID
- Get messages with pagination (limit, offset)
- Update session title
- Delete session (cascade a messages)

---

## Estructura de Tests

### Health Tests (2 tests, ~50 lineas)

```typescript
describe('Health API', () => {
  it('GET /health - returns system status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'healthy',
      timestamp: expect.any(String),
      uptime: expect.any(Number),
    });
  });

  it('GET /health/liveness - returns ok', async () => {
    const res = await request(app).get('/health/liveness');
    expect(res.status).toBe(200);
  });
});
```

### Auth Tests (6 tests, ~300 lineas)

```typescript
describe('Auth API', () => {
  describe('Microsoft OAuth Flow', () => {
    it('GET /api/auth/login - redirects to Microsoft', async () => { ... });
    it('GET /api/auth/callback - creates session on success', async () => { ... });
  });

  describe('Session Management', () => {
    it('POST /api/auth/logout - destroys session', async () => { ... });
    it('GET /api/auth/me - returns authenticated user', async () => { ... });
  });

  describe('Business Central Integration', () => {
    it('GET /api/auth/bc-status - returns token status', async () => { ... });
    it('POST /api/auth/bc-consent - initiates consent flow', async () => { ... });
  });
});
```

### Sessions Tests (6 tests, ~350 lineas)

```typescript
describe('Sessions API', () => {
  describe('GET /api/chat/sessions', () => {
    it('returns empty array for new user', async () => { ... });
    it('returns user sessions only (isolation)', async () => { ... });
    it('supports sorting by lastMessageAt', async () => { ... });
  });

  describe('POST /api/chat/sessions', () => {
    it('creates session with auto-generated title', async () => { ... });
  });

  describe('GET /api/chat/sessions/:id', () => {
    it('returns session details', async () => { ... });
    it('returns 404 for non-existent session', async () => { ... });
    it('returns 401 for other user session', async () => { ... });
  });

  describe('GET /api/chat/sessions/:id/messages', () => {
    it('returns messages with pagination', async () => { ... });
    it('respects limit and offset', async () => { ... });
  });

  describe('PATCH /api/chat/sessions/:id', () => {
    it('updates session title', async () => { ... });
  });

  describe('DELETE /api/chat/sessions/:id', () => {
    it('deletes session and cascades to messages', async () => { ... });
  });
});
```

---

## Tareas

Ver `TODO.md` para el listado completo de tareas (14 endpoints = 14 tareas principales).

---

## Dependencias

### De Fase 4.1
- `GoldenResponses.ts` - NO usado en esta fase (solo API tests, no agent)
- `TestDataFactory.ts` - Para crear sessions, users, messages de test
- `setup.e2e.ts` - Setup de test environment

### Tecnicas
- `supertest` - Para HTTP requests en tests
- Vitest - Test runner
- Azure SQL - Database de test
- Redis - Session storage de test

---

## Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigacion |
|--------|--------------|---------|------------|
| OAuth mock complejo | Media | Medio | Mockear solo callback, no todo OAuth flow |
| Session isolation falla | Baja | Alto | Usar UUIDs unicos por test |
| DB cleanup incompleto | Media | Medio | Usar transacciones o limpiar en afterEach |

---

## Tiempo Estimado

| Bloque | Estimado |
|--------|----------|
| Health tests | 30min |
| Auth tests | 3h |
| Sessions tests | 3h |
| Error cases | 1h |
| Schema validation | 1h |
| **TOTAL** | **8.5h** |

---

*Ultima actualizacion: 2025-12-17*
