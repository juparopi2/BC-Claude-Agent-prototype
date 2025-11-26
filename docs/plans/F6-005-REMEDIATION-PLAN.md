# Plan de Remediación F6-005: QA Master Review Fixes

**Fecha**: 2025-11-25
**Objetivo**: Resolver TODOS los hallazgos del QA Master Review
**Target**: 920+ tests, 0 gaps críticos, cobertura completa de edge cases

---

## Resumen de Trabajo

| Fase | Categoría | Items | Tests Estimados | Estado |
|------|-----------|-------|-----------------|--------|
| 1 | Gaps Críticos | 3 | ~75 tests | ✅ COMPLETED |
| 2 | Seguridad | 3 | ~42 tests | ✅ COMPLETED |
| 3 | Edge Cases | 23+ | ~61 tests | ✅ COMPLETED |
| 4 | Inconsistencias | 2 | ~78 tests | ✅ COMPLETED |
| 4.5 | Error Adoption | 2 | ~0 tests (refactoring) | ✅ COMPLETED |
| 5 | Performance | 2 | ~12 tests | 🧪 IN TESTING |
| **TOTAL** | | **35+** | **~273 tests nuevos** | |

**Target final**: 884 actuales + 188 nuevos = **~1072 tests**
**Actual después de Fase 1 + QA Audit**: 966 tests (82 nuevos en Fase 1)
**Actual después de Fase 2**: 1008 tests (+42 nuevos en Fase 2)
**Actual después de Fase 3**: 1074 tests (+66 nuevos en Fase 3)
**Actual después de Fase 4**: 1152 tests (+78 nuevos en Fase 4 - error standardization)
**Actual después de Fase 4.5**: 1152 tests (0 nuevos - refactoring only, same coverage)
**Actual después de Fase 5**: 1164 tests (+12 nuevos en Fase 5 - performance tests)

---

## Metodología por Fase

Cada fase sigue el mismo ciclo:

```
┌────────────────────────────────────────────────────────────┐
│  1. IMPLEMENTACIÓN                                         │
│     └─ Crear/modificar archivos según especificación       │
├────────────────────────────────────────────────────────────┤
│  2. VERIFICACIÓN TÉCNICA                                   │
│     ├─ npm test (todos deben pasar)                        │
│     ├─ npm run lint (0 errores)                            │
│     ├─ npm run type-check (OK)                             │
│     └─ npm run build (OK)                                  │
├────────────────────────────────────────────────────────────┤
│  3. VALIDACIÓN QA                                          │
│     ├─ Verificar que tests cubren casos especificados      │
│     ├─ Verificar que no hay regresiones                    │
│     └─ Confirmar success criteria de la fase               │
├────────────────────────────────────────────────────────────┤
│  4. DOCUMENTACIÓN INCREMENTAL                              │
│     ├─ Actualizar este REMEDIATION-PLAN.md (marcar [x])    │
│     ├─ Actualizar QA-REPORT-F6-005.md                      │
│     └─ Actualizar QA-MASTER-REVIEW-F6-005.md               │
└────────────────────────────────────────────────────────────┘
```

**NOTA**: `DIAGNOSTIC-AND-TESTING-PLAN.md` se actualiza SOLO al completar todas las 5 fases.

---

## FASE 1: Gaps Críticos (P1) - BLOQUEANTES

### Estado: ✅ COMPLETED (2025-11-25)

### Success Criteria Fase 1:
- [x] `sessions.routes.test.ts` creado con 59 tests (superó objetivo de 45, +4 QA Audit)
- [x] `auth-oauth.routes.test.ts` refactorizado (usa router real con mocked middleware)
- [x] `MessageQueue.rateLimit.test.ts` creado con 21 tests (superó objetivo de 20)
- [x] npm test: 966 tests passing (superó objetivo de 959)
- [x] npm run lint: 0 errors (15 warnings preexistentes)
- [x] npm run type-check: OK
- [x] npm run build: OK

### Resultados Fase 1 (con QA Audit fixes):
| Archivo | Tests | Notas |
|---------|-------|-------|
| sessions.routes.test.ts | 59 | CRUD + msg transform + QA Audit fixes |
| auth-oauth.routes.test.ts | 31 | Refactorizado para usar router real |
| MessageQueue.rateLimit.test.ts | 21 | Rate limiting completo + Redis failure |
| **Total nuevos** | **111** | **Fase 1 + QA Audit completada** |

---

### 1.1 Crear `sessions.routes.test.ts` (~45 tests)

**Archivo a crear**: `backend/src/__tests__/unit/routes/sessions.routes.test.ts`

**Estructura del test file**:

```
sessions.routes.test.ts
├── GET /api/chat/sessions (6 tests)
│   ├── should return all sessions for authenticated user
│   ├── should return empty array for user with no sessions
│   ├── should return 401 without authentication
│   ├── should order sessions by updated_at DESC
│   ├── should transform is_active to status correctly
│   └── should handle database error gracefully (500)
│
├── POST /api/chat/sessions (8 tests)
│   ├── should create session with generated UUID
│   ├── should create session with custom title
│   ├── should create session with default title "New Chat"
│   ├── should return 400 for title > 500 chars
│   ├── should return 400 for empty title string
│   ├── should trim whitespace from title
│   ├── should return 401 without authentication
│   └── should handle database error gracefully (500)
│
├── GET /api/chat/sessions/:sessionId (5 tests)
│   ├── should return session when user owns it
│   ├── should return 404 when session doesn't exist
│   ├── should return 404 when user doesn't own session (no info leak)
│   ├── should return 401 without authentication
│   └── should handle database error gracefully (500)
│
├── GET /api/chat/sessions/:sessionId/messages (10 tests)
│   ├── should return messages with default pagination (limit=50, offset=0)
│   ├── should return messages with custom limit
│   ├── should return messages with custom offset
│   ├── should return 400 for limit > 100
│   ├── should return 400 for limit < 1
│   ├── should return 400 for negative offset
│   ├── should return 400 for non-integer limit/offset
│   ├── should order by sequence_number then created_at
│   ├── should return 404 when session doesn't exist
│   └── should handle database error gracefully (500)
│
├── PATCH /api/chat/sessions/:sessionId (7 tests)
│   ├── should update title successfully
│   ├── should return 400 for empty title
│   ├── should return 400 for title > 500 chars
│   ├── should return 400 for whitespace-only title
│   ├── should return 404 when session doesn't exist
│   ├── should return 404 when user doesn't own session
│   └── should return 401 without authentication
│
├── DELETE /api/chat/sessions/:sessionId (5 tests)
│   ├── should delete session successfully
│   ├── should return 404 when session doesn't exist
│   ├── should return 404 when user doesn't own session
│   ├── should return 401 without authentication
│   └── should cascade delete messages, approvals, todos
│
└── Message Transformation (9 tests)
    ├── should transform standard message correctly
    ├── should transform thinking message correctly
    ├── should transform tool_use message correctly
    ├── should include model in transformed message
    ├── should include input_tokens/output_tokens
    ├── should include sequence_number from event sourcing
    ├── should include stop_reason from SDK
    ├── should handle null/missing metadata
    └── should handle malformed metadata JSON gracefully
```

**Dependencias a mockear**:
- `@/config/database` (executeQuery)
- `@/middleware/auth-oauth` (authenticateMicrosoft)
- `@/utils/logger`

---

### 1.2 Refactorizar `auth-oauth.routes.test.ts` (~10 tests adicionales)

**Problema**: Tests actuales recrean la lógica del router manualmente. Deben usar el router real.

**Cambios requeridos**:

1. **Eliminar lógica duplicada** en los tests de:
   - `GET /api/auth/me`
   - `GET /api/auth/bc-status`
   - `POST /api/auth/bc-consent`
   - `POST /api/auth/logout`

2. **Usar el router real** con mocks inyectados:
```typescript
// ❌ ACTUAL (incorrecto)
app.get('/api/auth/me', async (req: Request, res: Response) => {
  // ... lógica duplicada
});

// ✅ CORRECTO
app.use('/api/auth', authOAuthRouter);
```

3. **Mockear middleware de autenticación** correctamente:
```typescript
// Mock authenticateMicrosoft para inyectar userId
vi.mock('@/middleware/auth-oauth', () => ({
  authenticateMicrosoft: (req: Request, res: Response, next: NextFunction) => {
    const testUserId = req.headers['x-test-user-id'] as string;
    if (testUserId) {
      req.userId = testUserId;
      req.microsoftSession = { ... };
      next();
    } else {
      res.status(401).json({ error: 'Unauthorized' });
    }
  },
}));
```

4. **Tests adicionales a agregar**:
   - Token refresh mid-request
   - Microsoft API timeout handling
   - Unicode en displayName
   - OAuth state replay attack prevention

---

### 1.3 Tests de Rate Limiting (~20 tests)

**Archivo a crear**: `backend/src/__tests__/unit/services/queue/MessageQueue.rateLimit.test.ts`

**Estructura**:

```
MessageQueue.rateLimit.test.ts
├── Rate Limit Enforcement (8 tests)
│   ├── should allow up to 100 jobs per session per hour
│   ├── should reject job 101 with rate limit error
│   ├── should reset counter after 1 hour
│   ├── should track rate limits per session independently
│   ├── should not affect other sessions when one is rate limited
│   ├── should return remaining quota in response
│   ├── should log rate limit violations
│   └── should return 429 Too Many Requests
│
├── Redis Failure Handling (5 tests)
│   ├── should fail open when Redis unavailable (allow request)
│   ├── should log Redis connection failure
│   ├── should retry Redis connection
│   ├── should not crash on Redis timeout
│   └── should recover when Redis comes back online
│
├── Edge Cases (4 tests)
│   ├── should handle sessionId with special characters
│   ├── should handle concurrent rate limit checks atomically
│   ├── should handle clock skew gracefully
│   └── should handle very high job volume
│
└── Integration with Routes (3 tests)
    ├── should enforce rate limit on /api/agent/query
    ├── should return rate limit headers in response
    └── should include retry-after header when limited
```

---

### Verificación Fase 1

Al completar Fase 1, ejecutar:

```bash
cd backend && npm test                    # ~959 tests passing
cd backend && npm run lint                # 0 errors
cd backend && npm run type-check          # OK
cd backend && npm run build               # OK
```

### Documentación Fase 1

Al pasar verificación:
1. Marcar `[x]` en Success Criteria arriba
2. Actualizar `QA-REPORT-F6-005.md` - sección de tests creados
3. Actualizar `QA-MASTER-REVIEW-F6-005.md` - marcar gaps P1 como resueltos

---

## FASE 2: Seguridad (P2)

### Estado: ✅ COMPLETED (2025-11-25)

### Success Criteria Fase 2:
- [x] `session-ownership.security.test.ts` creado (24 tests - superó objetivo de 5)
- [x] `BCTokenManager.raceCondition.test.ts` creado (8 tests - documenta race condition)
- [x] Input sanitization tests agregados a logs.routes.test.ts (+10 tests - superó objetivo de 5)
- [x] Timing-safe comparison implementada en session-ownership.ts (`timingSafeCompare`)
- [x] npm test: 1008 tests passing (superó objetivo de 974)
- [x] npm run lint: 0 errors (15 warnings preexistentes)
- [x] npm run type-check: OK
- [x] npm run build: OK

### Resultados Fase 2:
| Archivo | Tests | Notas |
|---------|-------|-------|
| session-ownership.security.test.ts | 24 | Timing-safe comparison + edge cases |
| BCTokenManager.raceCondition.test.ts | 8 | Race condition documentation + tests |
| logs.routes.test.ts | +10 | Input sanitization + XSS reflection prevention |
| **Total nuevos Fase 2** | **42** | **Fase 2 completada** |

---

### 2.1 Timing Attack Protection (~5 tests)

**Archivo a crear**: `backend/src/__tests__/unit/utils/session-ownership.security.test.ts`

```typescript
describe('Timing Attack Protection', () => {
  it('should use constant-time comparison for userId validation', async () => {
    // Verify validateUserIdMatch implementation
  });

  it('should not leak information about valid session IDs via timing', async () => {
    // Measure response time for valid vs invalid session IDs
  });

  it('should not leak information about valid user IDs via timing', async () => {
    // Measure response time for matching vs non-matching user IDs
  });

  it('should handle different length strings securely', async () => {
    // Length difference should not cause early return timing leak
  });

  it('should handle empty strings securely', async () => {
    // Empty vs non-empty should have same timing behavior
  });
});
```

**Cambio de código requerido** en `session-ownership.ts`:
```typescript
// ANTES (vulnerable)
return requestedUserId === authenticatedUserId;

// DESPUÉS (seguro)
import { timingSafeEqual } from 'crypto';

export function validateUserIdMatch(
  requestedUserId: string,
  authenticatedUserId: string | undefined
): boolean {
  if (!authenticatedUserId || !requestedUserId) {
    return false;
  }

  // Timing-safe comparison to prevent timing attacks
  const a = Buffer.from(requestedUserId, 'utf8');
  const b = Buffer.from(authenticatedUserId, 'utf8');

  // If lengths differ, still do comparison to maintain constant time
  if (a.length !== b.length) {
    // Compare against itself to maintain timing consistency
    timingSafeEqual(a, a);
    return false;
  }

  return timingSafeEqual(a, b);
}
```

---

### 2.2 Token Refresh Race Condition (~5 tests)

**Archivo a crear**: `backend/src/__tests__/unit/middleware/auth-oauth.race.test.ts`

```typescript
describe('Token Refresh Race Condition (KNOWN ISSUE)', () => {
  it('should document concurrent token refresh behavior', async () => {
    // This test documents the current race condition
    // Two concurrent requests both try to refresh expired token
    // TODO: Fix with Redis distributed lock
  });

  it('should not lose refresh token during concurrent refresh', async () => {
    // Verify we don't end up with invalid state
  });

  it('should handle "token already refreshed" scenario', async () => {
    // Second request finds token already refreshed by first
  });

  it('should not crash when multiple refreshes happen simultaneously', async () => {
    // Stress test concurrent refresh
  });

  it('should maintain session integrity after concurrent refresh', async () => {
    // Verify session data is consistent after race
  });
});
```

---

### 2.3 Input Sanitization (~5 tests)

**Agregar a** `logs.routes.test.ts`:

```typescript
describe('Input Sanitization', () => {
  it('should NOT include client logs in any HTTP response body', async () => {
    // POST logs, verify response is 204 No Content (empty body)
  });

  it('should handle message with null bytes', async () => {
    // message: "test\x00test"
  });

  it('should reject circular reference in context (JSON parse fails)', async () => {
    // This tests the Zod validation / JSON parsing
  });

  it('should handle excessively long userAgent', async () => {
    // userAgent > 1000 chars - should not crash
  });

  it('should accept but not validate timestamp format strictly', async () => {
    // Current implementation accepts any string as timestamp
  });
});
```

---

### Verificación Fase 2

```bash
cd backend && npm test                    # ~974 tests passing
cd backend && npm run lint                # 0 errors
cd backend && npm run type-check          # OK
cd backend && npm run build               # OK
```

### Documentación Fase 2

Al pasar verificación:
1. Marcar `[x]` en Success Criteria arriba
2. Actualizar `QA-REPORT-F6-005.md` - sección de security tests
3. Actualizar `QA-MASTER-REVIEW-F6-005.md` - marcar gaps P2 como resueltos

---

## FASE 3: Edge Cases (P3)

### Estado: ✅ COMPLETED (2025-11-25)

### Success Criteria Fase 3:
- [x] token-usage.routes.test.ts: +16 tests (superó objetivo de 12)
- [x] auth-oauth.routes.test.ts: +17 tests (superó objetivo de 12)
- [x] server-endpoints.test.ts: +14 tests (superó objetivo de 10)
- [x] logs.routes.test.ts: +14 tests (superó objetivo de 8)
- [x] npm test: 1074 tests passing (superó objetivo de 1016)
- [x] npm run lint: 0 errors (15 warnings preexistentes)
- [x] npm run type-check: OK
- [x] npm run build: OK

### Resultados Fase 3:
| Archivo | Tests Agregados | Categorías |
|---------|-----------------|------------|
| token-usage.routes.test.ts | +16 | URL encoding, boundaries, decimals, UUID formats, negatives |
| auth-oauth.routes.test.ts | +17 | OAuth callback, profiles, DB errors, BC tokens, sessions |
| server-endpoints.test.ts | +14 | Agent query, approval response, session IDs, DB errors, MCP |
| logs.routes.test.ts | +14 | Timestamps, context types, URLs, UserAgents, batches, Content-Type |
| **Total nuevos Fase 3** | **61** | **Fase 3 completada** |

---

### 3.1 Token Usage Routes Edge Cases (~12 tests)

**Agregar a** `token-usage.routes.test.ts`:

```typescript
describe('Additional Edge Cases', () => {
  // URL Encoding
  it('should handle userId with URL-encoded slashes', async () => {});
  it('should handle sessionId with dots', async () => {});

  // Boundary values
  it('should accept months=1 (minimum)', async () => {});
  it('should accept months=24 (maximum)', async () => {});
  it('should accept limit=1 (minimum)', async () => {});
  it('should accept limit=50 (maximum boundary)', async () => {});

  // Decimal handling
  it('should truncate months=1.9 to 1', async () => {});
  it('should truncate months=23.9 to 23', async () => {});

  // Format validation
  it('should handle UUID v4 format sessionId', async () => {});
  it('should handle UUID v7 format sessionId (future-proof)', async () => {});

  // Negative cases
  it('should return 400 for months=-1', async () => {});
  it('should return 400 for limit=-1', async () => {});
});
```

---

### 3.2 Auth OAuth Edge Cases (~12 tests)

**Agregar a** `auth-oauth.routes.test.ts`:

```typescript
describe('Additional Edge Cases', () => {
  // OAuth state security
  it('should reject OAuth state reuse (replay attack)', async () => {});
  it('should reject OAuth state from different session', async () => {});

  // Token handling
  it('should handle token expiring during request processing', async () => {});

  // Microsoft API errors
  it('should handle Microsoft Graph API timeout', async () => {});
  it('should handle malformed JSON from Microsoft API', async () => {});
  it('should handle Microsoft API returning empty profile', async () => {});

  // Unicode handling
  it('should handle Unicode in displayName (emojis)', async () => {});
  it('should handle Unicode in displayName (CJK)', async () => {});
  it('should handle Unicode in email', async () => {});

  // Session edge cases
  it('should handle session destruction during logout', async () => {});
  it('should handle concurrent logout requests', async () => {});
  it('should handle missing email in profile', async () => {});
});
```

---

### 3.3 Server Endpoints Edge Cases (~10 tests)

**Agregar a** `server-endpoints.test.ts`:

```typescript
describe('Additional Edge Cases', () => {
  // Approval ID handling
  it('should handle approvalId with URL-encoded spaces', async () => {});
  it('should reject decision="APPROVED" (uppercase)', async () => {});
  it('should reject decision="Approved" (mixed case)', async () => {});

  // Reason validation
  it('should accept empty reason string', async () => {});
  it('should handle very long reason (10000 chars)', async () => {});
  it('should handle reason with special characters', async () => {});

  // Prompt validation
  it('should reject whitespace-only prompt', async () => {});
  it('should accept minimum valid prompt', async () => {});

  // MCP service errors
  it('should handle getMCPServerUrl throwing error', async () => {});
  it('should return 503 when MCP service unavailable', async () => {});
});
```

---

### 3.4 Logs Routes Edge Cases (~8 tests)

**Agregar a** `logs.routes.test.ts`:

```typescript
describe('Additional Edge Cases', () => {
  // Large payloads
  it('should handle logs array with 1000 items', async () => {});
  it('should handle logs array with 5000 items without timeout', async () => {});

  // Timestamp validation
  it('should accept timestamp in future', async () => {});
  it('should accept various ISO 8601 formats', async () => {});

  // Message content
  it('should handle message with null bytes', async () => {});
  it('should handle message with only whitespace', async () => {});

  // Context validation
  it('should handle deeply nested context (10 levels)', async () => {});
  it('should handle context with array values', async () => {});
});
```

---

### Verificación Fase 3

```bash
cd backend && npm test                    # ~1016 tests passing
cd backend && npm run lint                # 0 errors
cd backend && npm run type-check          # OK
cd backend && npm run build               # OK
```

### Documentación Fase 3

Al pasar verificación:
1. Marcar `[x]` en Success Criteria arriba
2. Actualizar `QA-REPORT-F6-005.md` - sección de edge cases
3. Actualizar `QA-MASTER-REVIEW-F6-005.md` - marcar gaps P3 como resueltos

---

## FASE 4: Inconsistencias (P4)

### Estado: ✅ COMPLETED (2025-11-25)

### Success Criteria Fase 4:
- [x] `constants/errors.ts` creado con ErrorCode enum y ERROR_MESSAGES
- [x] `types/error.types.ts` creado con ApiErrorResponse y type guards
- [x] `utils/error-response.ts` creado con sendError() helper
- [x] Routes actualizados para usar nuevas constantes (4 archivos)
- [x] Tests actualizados para usar ErrorCode enum (no magic strings)
- [x] Tests de error types creados (15 tests)
- [x] npm test: 1152 tests passing (superó objetivo)
- [x] npm run lint: 0 errors (15 warnings preexistentes)
- [x] npm run type-check: OK
- [x] npm run build: OK

### Resultados Fase 4:
| Archivo | Estado | Notas |
|---------|--------|-------|
| constants/errors.ts | ✅ NUEVO | 35 ErrorCode values + messages + status codes |
| types/error.types.ts | ✅ NUEVO | ApiErrorResponse + type guards |
| utils/error-response.ts | ✅ NUEVO | sendError() + HTTP status mapping |
| routes/logs.ts | ✅ REFACTORIZADO | Usa sendError() |
| routes/token-usage.ts | ✅ REFACTORIZADO | Usa sendError() |
| routes/sessions.ts | ✅ REFACTORIZADO | Usa sendError() |
| routes/auth-oauth.ts | ✅ REFACTORIZADO | Usa sendError() |
| **Tests actualizados** | 4 archivos | sessions, token-usage, logs, auth-oauth |
| **Tests nuevos** | +78 | error.types.test, error-response.test, errors.test |

### Breaking Changes (Justificados):
1. **Added `code` field** to all error responses (machine-readable)
2. **Standardized `error` field** to HTTP status name (e.g., "Bad Request")
3. **SESSION_EXPIRED** returns 401 (not 400) - semantically correct
4. **BC_UNAVAILABLE** returns 503 (not 500) - indicates service unavailable

---

### 4.1 Estandarizar Error Messages

**Archivo a crear**: `backend/src/constants/errors.ts`

```typescript
/**
 * Standardized Error Messages
 *
 * Ensures consistent error messaging across all routes.
 * All multi-tenant and authorization errors should use these constants.
 */

export const ERROR_MESSAGES = {
  // Authentication
  AUTH: {
    UNAUTHORIZED: 'User not authenticated',
    SESSION_NOT_FOUND: 'Session not found. Please log in.',
    TOKEN_EXPIRED: 'Access token expired. Please log in again.',
    INVALID_SESSION: 'Invalid session. Please log in again.',
  },

  // Multi-tenant / Authorization
  FORBIDDEN: {
    OWN_DATA_ONLY: 'You can only access your own data',
    SESSION_ACCESS: 'You do not have access to this session',
    APPROVAL_PERMISSION: 'You do not have permission to respond to this approval request',
  },

  // Not Found
  NOT_FOUND: {
    SESSION: 'Session not found',
    USER: 'User not found',
    APPROVAL: 'Approval request not found',
    USAGE_DATA: 'No usage data found',
  },

  // Validation
  VALIDATION: {
    REQUIRED_FIELD: (field: string) => `${field} is required`,
    INVALID_RANGE: (field: string, min: number, max: number) =>
      `${field} must be between ${min} and ${max}`,
    INVALID_FORMAT: (field: string) => `Invalid ${field} format`,
  },

  // Server Errors
  SERVER: {
    INTERNAL_ERROR: 'An internal error occurred',
    SERVICE_UNAVAILABLE: 'Service temporarily unavailable',
    DATABASE_ERROR: 'Database operation failed',
  },
} as const;
```

**Routes a actualizar**:
- `token-usage.ts` - usar `ERROR_MESSAGES.FORBIDDEN.OWN_DATA_ONLY`
- `sessions.ts` - usar `ERROR_MESSAGES.FORBIDDEN.SESSION_ACCESS`
- `server.ts` (approvals) - usar `ERROR_MESSAGES.FORBIDDEN.APPROVAL_PERMISSION`

---

### 4.2 Tests de Consistencia (~5 tests)

**Agregar a un nuevo archivo o existente**:

```typescript
describe('Error Message Consistency', () => {
  it('should return consistent 403 message for own-data violations', async () => {
    // Test token-usage and sessions return same message format
  });

  it('should return consistent 404 message for missing resources', async () => {
    // Test all routes return same "not found" format
  });

  it('should return consistent 401 message for unauthenticated requests', async () => {
    // Test all protected routes return same auth error
  });

  it('should include error and message fields in all error responses', async () => {
    // Verify error response structure consistency
  });

  it('should not leak internal details in error messages', async () => {
    // Verify no stack traces or internal paths in responses
  });
});
```

---

### Verificación Fase 4

```bash
cd backend && npm test                    # ~1021 tests passing
cd backend && npm run lint                # 0 errors
cd backend && npm run type-check          # OK
cd backend && npm run build               # OK
```

### Documentación Fase 4

Al pasar verificación:
1. Marcar `[x]` en Success Criteria arriba
2. Actualizar `QA-REPORT-F6-005.md` - sección de consistencia
3. Actualizar `QA-MASTER-REVIEW-F6-005.md` - marcar gaps P4 como resueltos

---

## FASE 4.5: Error Standardization Completion (QA Master Audit)

### Estado: ✅ COMPLETED (2025-11-25)

### Background:
QA Master Audit (QA-MASTER-AUDIT-F6-005-PHASE4.md) identified that Phase 4's error standardization infrastructure was excellent, but adoption was only 27.6% (21/76 error responses). Key files `server.ts` and `middleware/auth-oauth.ts` still used the old `res.status().json()` pattern.

### Success Criteria Fase 4.5:
- [x] `server.ts` refactored: All 33 error responses use sendError()
- [x] `middleware/auth-oauth.ts` refactored: All 10 error responses use sendError()
- [x] `server-endpoints.test.ts` updated: 13 assertions fixed for new error format
- [x] `auth-oauth.test.ts` updated: 9 assertions fixed for new error format
- [x] npm test: 1152 tests passing (maintained baseline)
- [x] npm run lint: 0 errors
- [x] npm run type-check: OK
- [x] npm run build: OK

### Files Refactored:
| File | Error Responses | Change |
|------|-----------------|--------|
| `server.ts` | 33 | All now use sendError(), sendBadRequest(), etc. |
| `middleware/auth-oauth.ts` | 10 | All now use sendError() with ErrorCode enum |

### Test Files Updated:
| File | Tests Updated | Notes |
|------|---------------|-------|
| `server-endpoints.test.ts` | 13 | Updated assertions for new {error, message, code} format |
| `auth-oauth.test.ts` | 9 | Updated for status code changes (SESSION_EXPIRED→401, BC_UNAVAILABLE→503) |

### Breaking Changes Applied:
1. **BC_UNAVAILABLE** now returns 503 (was 403/500) - indicates service unavailable
2. **SESSION_EXPIRED** now returns 401 (was 400/403) - indicates re-authentication needed
3. **INVALID_TOKEN** now returns 401 (was 403) - consistent with auth errors
4. All error responses now include `code` field with ErrorCode enum value

### Adoption After Phase 4.5:
- **Before**: 27.6% (21/76 error responses)
- **After**: ~95% (routes + server.ts + middleware refactored)
- Only `auth-mock.ts` (dev-only) remains non-standardized

---

## FASE 5: Performance (P5)

### Estado: 🧪 IN TESTING (2025-11-25) - QA Master Audit Remediation Complete

### Success Criteria Fase 5:
- [x] `performance.test.ts` creado (12 tests - exceeds ~5 estimate)
- [x] Basic performance tests passing
- [x] Memory leak tests passing
- [x] P95/P99 percentile assertions implemented (GAP-1)
- [x] maxResponseTime assertions implemented (GAP-2)
- [x] RSS memory monitoring implemented (GAP-4)
- [x] Multi-tenant data isolation verification (GAP-6)
- [x] Threshold documentation with justification (GAP-9)
- [x] npm test: 1164 tests passing (exceeds ~1026+ target)
- [x] npm run lint: 0 errors (15 warnings preexistentes)
- [x] npm run type-check: OK
- [x] npm run build: OK

### QA Master Audit Remediation:
| Gap ID | Severity | Resolution | Status |
|--------|----------|------------|--------|
| GAP-1 | 🔴 CRITICAL | Added calculatePercentile() function, P95/P99 assertions | ✅ DONE |
| GAP-2 | 🔴 CRITICAL | Added maxResponseTimeMs assertions (< 5000ms test env) | ✅ DONE |
| GAP-4 | 🟠 HIGH | Added calculateRSSGrowthMB() function, RSS assertions | ✅ DONE |
| GAP-6 | 🟡 MEDIUM | Multi-tenant test verifies actual response body isolation | ✅ DONE |
| GAP-9 | 🟡 MEDIUM | MEMORY_THRESHOLDS and LATENCY_THRESHOLDS with math justification | ✅ DONE |

### Resultados Fase 5:
| Categoría | Tests | Descripción |
|-----------|-------|-------------|
| Concurrent Request Handling | 3 | 100 concurrent requests with P95/P99/Max assertions + data isolation |
| Response Time Validation | 3 | SLA compliance with percentile distribution analysis |
| Memory Safety | 2 | Heap + RSS monitoring with documented thresholds |
| Large Batch Processing | 2 | Max batch size with tail latency bounds |
| Error Handling Under Load | 2 | Validation errors under load, service errors under load |
| **Total** | **12** | **Enterprise-grade performance suite** |

### Implementation Details:

**Archivo creado**: `backend/src/__tests__/unit/routes/performance.test.ts`

**Key Features (v2.0 - Post QA Master Audit)**:
- Properly typed with `PerformanceMetrics`, `MemorySnapshot`, `ConcurrentResponse`, `MultiTenantResponse` interfaces
- No `unknown` or `any` types used
- Multi-tenant concurrent access testing with **actual data isolation verification**
- Memory growth detection with **both heap and RSS monitoring**
- Response time benchmarking with **P50/P95/P99 percentile calculations**
- **Tail latency bounds** (no request exceeds MAX_ABSOLUTE_MS)
- **Documented threshold justifications** with mathematical calculations
- Error handling stability under concurrent load

---

### 5.1 Concurrent Request Handling (3 tests)

```typescript
describe('Concurrent Request Handling', () => {
  it('should handle 100 concurrent token-usage/me requests');
  it('should handle 100 concurrent log batch requests');
  it('should handle multi-tenant concurrent access (10 users x 10 requests each)');
});
```

---

### 5.2 Response Time Validation (3 tests)

```typescript
describe('Response Time Validation', () => {
  it('should return token-usage/me within 500ms');
  it('should process 100-item log batch within 500ms');
  it('should maintain reasonable average response time under moderate load');
});
```

---

### 5.3 Memory Safety Tests (2 tests)

```typescript
describe('Memory Safety', () => {
  it('should not accumulate excessive memory after 500 log batch requests');
  it('should not leak memory with complex context objects');
});
```

---

### 5.4 Large Batch Processing (2 tests)

```typescript
describe('Large Batch Processing', () => {
  it('should handle maximum batch size (100 logs) efficiently');
  it('should process 10 concurrent max-size batches');
});
```

---

### 5.5 Error Handling Under Load (2 tests)

```typescript
describe('Error Handling Under Load', () => {
  it('should gracefully handle validation errors under concurrent load');
  it('should maintain stability when service throws errors');
});
```

---

### Verificación Fase 5

```bash
cd backend && npm test                    # 1164 tests passing ✅
cd backend && npm run lint                # 0 errors ✅
cd backend && npm run type-check          # OK ✅
cd backend && npm run build               # OK ✅
```

### Documentación Fase 5 (FINAL)

Al pasar verificación:
1. ✅ Marcar `[x]` en Success Criteria arriba
2. ⏳ Actualizar `QA-REPORT-F6-005.md` - sección de performance + estado final
3. ⏳ Actualizar `QA-MASTER-REVIEW-F6-005.md` - marcar TODOS los gaps como resueltos
4. ⏳ **Actualizar `DIAGNOSTIC-AND-TESTING-PLAN.md`** - cambiar F6-005 a ✅ COMPLETED
5. ⏳ Crear `QA-MASTER-REVIEW-F6-005-RESOLVED.md` con resumen final

---

## Archivos Creados/Modificados

### Creados:
1. ✅ `backend/src/__tests__/unit/routes/sessions.routes.test.ts` (Fase 1) - 59 tests
2. ✅ `backend/src/__tests__/unit/services/queue/MessageQueue.rateLimit.test.ts` (Fase 1) - 21 tests
3. ✅ `backend/src/__tests__/unit/utils/session-ownership.security.test.ts` (Fase 2) - 24 tests
4. ✅ `backend/src/__tests__/unit/middleware/auth-oauth.race.test.ts` (Fase 2) - 18 tests
5. ✅ `backend/src/__tests__/unit/routes/performance.test.ts` (Fase 5) - 12 tests
6. ✅ `backend/src/constants/errors.ts` (Fase 4)
7. ✅ `backend/src/utils/error-response.ts` (Fase 4)

### Modificados:
1. ✅ `backend/src/__tests__/unit/routes/auth-oauth.routes.test.ts` - refactored (Fase 1)
2. ✅ `backend/src/__tests__/unit/routes/token-usage.routes.test.ts` - +12 tests (Fase 3)
3. ✅ `backend/src/__tests__/unit/routes/server-endpoints.test.ts` - +10 tests (Fase 3) + error format updates
4. ✅ `backend/src/__tests__/unit/routes/logs.routes.test.ts` - +13 tests (Fases 2+3)
5. ✅ `backend/src/utils/session-ownership.ts` - timing-safe comparison (Fase 2)
6. ✅ `backend/src/server.ts` - 33 error responses standardized (Fase 4.5)
7. ✅ `backend/src/middleware/auth-oauth.ts` - 10 error responses standardized (Fase 4.5)
8. ✅ All routes - usar sendError() functions (Fase 4)

---

## Verificación Final (Post-Fase 5) - 🧪 IN TESTING

Antes de marcar F6-005 como COMPLETED:

- [x] 1020+ tests passing (actual: 1164 tests)
- [x] `sessions.routes.test.ts` tiene 45+ tests (actual: 59 tests)
- [x] `auth-oauth.routes.test.ts` usa router real (no lógica duplicada)
- [x] Rate limiting tiene 20+ tests (actual: 21 tests)
- [x] Timing attack protection implementada y testeada (24 tests)
- [x] Todos los edge cases de las tablas cubiertos
- [x] 0 errores de lint
- [x] Type-check OK
- [x] Build OK
- [x] Todas las Fases marcadas como completadas/in testing
- [ ] QA Master Review checklist completo (pending QA validation)

---

**Firma del Plan**:

| Campo | Valor |
|-------|-------|
| Autor | Developer Expert |
| Fecha | 2025-11-25 |
| Versión | 4.0 |
| Estado | 🧪 IN TESTING - Phase 5 Complete with QA Master Audit Remediation |
| Tests | 1164 passing (exceeds 1072 target by 92) |
| Cambios v4.0 | QA Master Audit GAPs 1,2,4,6,9 resolved; Documentation updated |
| Cambios v3.0 | Fase 5 performance tests implemented |

### QA Master Audit Completion Summary

| Audit Phase | Status | Date |
|-------------|--------|------|
| Phase 4 Audit | ✅ PASSED | 2025-11-25 |
| Phase 5 Initial | ⚠️ GAPS FOUND | 2025-11-25 |
| Phase 5 Remediation | ✅ COMPLETED | 2025-11-25 |
| Final Validation | ⏳ PENDING QA | - |
