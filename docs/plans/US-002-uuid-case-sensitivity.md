# US-002: Corregir Aislamiento de Sesiones Redis (UUID Case Sensitivity)

**Epic**: Multi-tenant Security
**Prioridad**: P0 - Crítica
**Afecta**: session-isolation.integration.test.ts
**Tests a Rehabilitar**: 7 tests
**Estimación**: 75 minutos

---

## Descripción

Como **desarrollador de seguridad**, necesito que la validación de ownership de sesiones funcione correctamente independientemente del case del UUID, para garantizar el aislamiento multi-tenant.

---

## Problema Actual

### Síntomas
- Tests fallan con: `validateSessionOwnership returning UNAUTHORIZED`
- User válido no puede acceder a su propia sesión
- Comparación de userId falla silenciosamente

### Causa Raíz
1. SQL Server retorna UUIDs en mayúsculas: `'322A1BAC-77DB-4A15-B1F0-48A51604642B'`
2. JavaScript genera UUIDs en minúsculas: `'322a1bac-77db-4a15-b1f0-48a51604642b'`
3. `TestSessionFactory` crea sesiones en Redis sin vincular correctamente el userId
4. Socket middleware no encuentra `microsoftOAuth.userId` en la sesión Redis
5. Comparación estricta falla: `'ABC' !== 'abc'`

### Archivo Afectado
- `backend/src/__tests__/integration/multi-tenant/session-isolation.integration.test.ts`
- Línea 41: `describe.skip('Multi-Tenant Session Isolation', ...)`

---

## Criterios de Aceptación

### Para Desarrollador

| # | Criterio | Verificación |
|---|----------|--------------|
| D1 | User A NO puede unirse a sesión de User B | Test "prevent User A from joining" |
| D2 | User A NO puede enviar mensajes a sesión de User B | Test "prevent sending messages" |
| D3 | Eventos de sesión A NO se filtran a User B | Test "should not leak events" |
| D4 | Comparación de UUIDs es case-insensitive | Test con UUIDs mixtos |

### Para QA

| # | Criterio | Comando de Verificación |
|---|----------|-------------------------|
| Q1 | Intentar acceso cross-tenant → UNAUTHORIZED | Ejecutar suite |
| Q2 | Tests de connection.integration siguen pasando | grep connection |
| Q3 | UUID lowercase, UPPERCASE, MiXeD funcionan | Tests específicos |

---

## Solución Técnica

### Archivo 1: `backend/src/__tests__/integration/helpers/TestSessionFactory.ts`

Asegurar que la sesión Redis contiene microsoftOAuth.userId correctamente:

```typescript
import { randomBytes } from 'crypto';
import { getRedis } from '@/config/redis';
import cookie from 'cookie-signature';

const TEST_PREFIX = 'test_';
const TEST_SESSION_SECRET = 'test-secret-for-integration-tests';

interface SessionCookieResult {
  sessionId: string;
  sessionCookie: string;
}

class TestSessionFactory {
  /**
   * Crea una cookie de sesión con userId vinculado en Redis
   */
  async createSessionCookie(userId: string, email: string): Promise<SessionCookieResult> {
    const redis = getRedis();
    if (!redis) {
      throw new Error('Redis not initialized');
    }

    const sessionId = `${TEST_PREFIX}sess_${Date.now()}_${randomBytes(8).toString('hex')}`;

    // Estructura compatible con express-session + connect-redis
    const sessionData = {
      cookie: {
        originalMaxAge: 86400000,
        expires: new Date(Date.now() + 86400000).toISOString(),
        httpOnly: true,
        secure: false,
        path: '/',
      },
      microsoftOAuth: {
        userId: userId.toLowerCase(), // CRÍTICO: Normalizar a minúsculas
        email,
        accessToken: `test_token_${Date.now()}`,
      },
    };

    // Guardar en Redis con el formato correcto de connect-redis
    // Formato: sess:{sessionId}
    await redis.set(`sess:${sessionId}`, JSON.stringify(sessionData), { EX: 86400 });

    // Generar cookie firmada compatible con express-session
    const signedCookie = cookie.sign(sessionId, TEST_SESSION_SECRET);

    return {
      sessionId,
      sessionCookie: `connect.sid=s%3A${signedCookie}`,
    };
  }

  /**
   * Crea un usuario de prueba con sesión Redis vinculada
   */
  async createTestUser(options: { prefix?: string } = {}): Promise<TestUser> {
    const prefix = options.prefix || 'test_';
    const userId = `${prefix}${randomBytes(16).toString('hex')}`.toLowerCase();
    const email = `${prefix}user@test.com`;

    // Crear usuario en base de datos
    const dbUser = await this.createUserInDatabase(userId, email);

    // Crear sesión en Redis vinculada al userId
    const { sessionId, sessionCookie } = await this.createSessionCookie(
      dbUser.id, // Usar el ID de la DB (puede ser uppercase)
      email
    );

    return {
      id: dbUser.id.toLowerCase(), // Normalizar para comparaciones
      email,
      sessionId,
      sessionCookie,
    };
  }
}
```

### Archivo 2: `backend/src/services/approval/ApprovalManager.ts`

Verificar comparación case-insensitive (línea ~480):

```typescript
// En el método validateSessionOwnership o similar
private isOwner(sessionOwnerId: string, requestUserId: string): boolean {
  // CRÍTICO: Comparación case-insensitive para UUIDs
  return sessionOwnerId.toLowerCase() === requestUserId.toLowerCase();
}
```

### Archivo 3: `backend/src/utils/session-ownership.ts`

Verificar normalización en validateSessionOwnership:

```typescript
export async function validateSessionOwnership(
  sessionId: string,
  userId: string
): Promise<{ isOwner: boolean; reason?: string }> {
  // Obtener owner de la sesión desde DB
  const session = await getSessionById(sessionId);

  if (!session) {
    return { isOwner: false, reason: 'SESSION_NOT_FOUND' };
  }

  // CRÍTICO: Comparación case-insensitive
  const normalizedUserId = userId.toLowerCase();
  const normalizedOwnerId = session.userId.toLowerCase();

  if (normalizedUserId !== normalizedOwnerId) {
    return { isOwner: false, reason: 'UNAUTHORIZED' };
  }

  return { isOwner: true };
}
```

### Archivo 4: Remover describe.skip

```typescript
// ANTES (línea 41):
describe.skip('Multi-Tenant Session Isolation', () => {

// DESPUÉS:
describe('Multi-Tenant Session Isolation', () => {
```

---

## Tareas de Implementación

| # | Tarea | Archivo | Estimación |
|---|-------|---------|------------|
| 2.1 | Revisar estructura de sesión actual | TestSessionFactory.ts | 15 min |
| 2.2 | Implementar formato compatible con express-session | TestSessionFactory.ts | 30 min |
| 2.3 | Verificar comparación UUID en ApprovalManager | ApprovalManager.ts | 10 min |
| 2.4 | Verificar session-ownership.ts | session-ownership.ts | 5 min |
| 2.5 | Remover describe.skip | session-isolation.integration.test.ts | 5 min |
| 2.6 | Ejecutar tests de seguridad | - | 10 min |

**Total**: 75 minutos

---

## Validación

### Comando de Ejecución

```bash
cd backend && npm run test:integration -- --grep "session-isolation"
```

### Tests de Seguridad Específicos

```bash
# Test de acceso cruzado
npm run test:integration -- --grep "prevent User A from joining"

# Test de eventos
npm run test:integration -- --grep "should not leak events"

# Test de userId autenticado
npm run test:integration -- --grep "should use authenticated userId"
```

### Resultado Esperado

```
✓ should prevent User A from joining User B session
✓ should allow User B to join their own session
✓ should prevent User A from sending messages to User B session
✓ should not leak events between users
✓ should use authenticated userId, not payload userId
✓ should reject session enumeration attempts
✓ should not allow access to sessions by guessing IDs

Test Files  1 passed (1)
Tests       7 passed (7)
```

---

## Dependencias

- **Requiere**: US-001 (Database initialization fix)
- **Habilita**: US-005 (Validación Final)

---

## Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| UUID edge cases no cubiertos | Baja | Medio | Añadir tests con formatos mixtos |
| Regresión en connection tests | Media | Alto | Ejecutar suite completa |
| Performance de toLowerCase() | Muy Baja | Bajo | Insignificante para strings cortos |

---

## Consideraciones de Seguridad

### Por qué es Crítico

Este fix es esencial para la seguridad multi-tenant:

1. **Aislamiento de Datos**: Un usuario nunca debe ver datos de otro
2. **Prevención de IDOR**: Impide acceso a sesiones por ID conocido
3. **Spoofing Prevention**: Ignora userId en payload, usa solo el autenticado

### Validación de Seguridad Recomendada

```
[ ] Penetration test: Intentar acceder a sesión de otro usuario
[ ] Fuzzing: Probar con UUIDs malformados
[ ] Enumeration: Verificar que respuestas no revelan existencia de sesiones
```

---

## Referencias

- Test file: `backend/src/__tests__/integration/multi-tenant/session-isolation.integration.test.ts`
- Session factory: `backend/src/__tests__/integration/helpers/TestSessionFactory.ts`
- Approval manager: `backend/src/services/approval/ApprovalManager.ts`
- Session ownership: `backend/src/utils/session-ownership.ts`
- PRD: [PRD-INTEGRATION-TESTS.md](PRD-INTEGRATION-TESTS.md)
