# QA Report: F1-002 - Tests de Integración WebSocket

**Fecha de Implementación**: 2025-11-26
**Fecha de QA**: 2025-11-26
**QA Engineer**: Claude (Automated QA)
**Versión de Referencia**: DIAGNOSTIC-AND-TESTING-PLAN.md v1.1
**Estado**: FALLANDO - Requiere corrección de lógica

---

## 1. RESUMEN EJECUTIVO

### Objetivo
Crear tests de integración para validar el funcionamiento del sistema WebSocket con conexiones reales a Redis y Azure SQL.

### Resultado General

| Métrica | Valor |
|---------|-------|
| Tests Creados | 38 |
| Tests Pasando | 25 (65.8%) |
| Tests Fallando | 13 (34.2%) |
| Archivos de Test | 5 |
| Helpers Creados | 4 |

### Distribución por Suite

| Suite | Pasando | Fallando | Total | Estado |
|-------|---------|----------|-------|--------|
| WebSocket Connection | 9 | 0 | 9 | ✅ OK |
| Message Lifecycle | 8 | 0 | 8 | ✅ OK |
| Multi-Tenant Isolation | 2 | 6 | 8 | ❌ FAILING |
| Event Ordering | 4 | 4 | 8 | ❌ FAILING |
| Approval Flow | 2 | 3 | 5 | ❌ FAILING |

---

## 2. DIAGNÓSTICO INTENSIVO

### 2.1 ISSUE PRINCIPAL: Session-Cookie-UserId Linkage

#### Contexto del Problema

La validación de ownership multi-tenant funciona así en producción:

```
[Usuario] → Microsoft OAuth → [Backend Callback] → Crea sesión Redis con:
  {
    microsoftOAuth: {
      userId: "uuid-del-usuario",
      email: "user@company.com",
      ...
    }
  }
→ Cookie connect.sid apunta a esta sesión
```

En los tests, `TestSessionFactory.createTestUser()` intenta simular esto:

```typescript
// TestSessionFactory.ts:70-95
async createTestUser(options): Promise<TestUser> {
  // 1. Inserta usuario en SQL ✅
  const result = await executeQuery<{ id: string }[]>(`
    INSERT INTO users (id, email, microsoft_id, display_name, ...)
    OUTPUT INSERTED.id
    VALUES (@id, @email, @microsoft_id, @display_name, ...)`
  );

  // 2. Crea sesión en Redis ✅ (pero ¿con formato correcto?)
  const sessionId = `sess:test_${userId}`;
  const sessionData = {
    cookie: { ... },
    microsoftOAuth: { userId, email, displayName }  // ← ¿Es este el formato correcto?
  };
  await this.redisClient.set(sessionId, JSON.stringify(sessionData));

  // 3. Genera cookie ✅
  const sessionCookie = `connect.sid=s%3A${sessionId}.signature`;

  return { id: userId, sessionCookie, ... };
}
```

#### Investigación Realizada

**Punto de Fallo Identificado**: `validateSessionOwnership()` en `session-ownership.ts:37-60`

```typescript
// session-ownership.ts - CÓDIGO ACTUAL
export async function validateSessionOwnership(
  sessionId: string,
  userId: string
): Promise<SessionOwnershipResult> {
  const result = await executeQuery<{ user_id: string }[]>(
    `SELECT user_id FROM sessions WHERE id = @sessionId`,
    { sessionId }
  );

  if (result.length === 0) {
    return { isOwner: false, error: 'SESSION_NOT_FOUND' };
  }

  const isOwner = result[0]?.user_id === userId;
  return { isOwner, error: isOwner ? undefined : 'UNAUTHORIZED' };
}
```

**Descubrimiento Clave**: La validación usa SQL (`sessions.user_id`), NO Redis.

El problema NO es el formato de sesión Redis, sino que:
1. `TestSessionFactory.createChatSession()` crea la sesión en SQL
2. Pero el `userId` que el WebSocket middleware extrae viene de Redis
3. Si el userId de Redis no coincide con el `user_id` en SQL, falla

#### Flujo de Autenticación en Tests vs Producción

```
PRODUCCIÓN:
┌────────────────────────────────────────────────────────────────┐
│ 1. OAuth callback crea usuario en SQL                          │
│ 2. OAuth callback crea sesión Redis con userId                 │
│ 3. Usuario hace request con cookie connect.sid                 │
│ 4. Middleware extrae userId de sesión Redis                    │
│ 5. Socket.IO auth middleware pone userId en socket.userId      │
│ 6. session:join valida: socket.userId === sessions.user_id     │
│    ✅ Coinciden porque ambos vienen del mismo flujo OAuth      │
└────────────────────────────────────────────────────────────────┘

TESTS (PROBLEMA):
┌────────────────────────────────────────────────────────────────┐
│ 1. TestSessionFactory.createTestUser():                        │
│    - Crea usuario en SQL con id = "test_xxx_uuid"              │
│    - Crea sesión Redis con microsoftOAuth.userId = "test_xxx"  │
│    - Genera cookie apuntando a sesión Redis                    │
│                                                                │
│ 2. TestSessionFactory.createChatSession():                     │
│    - INSERT INTO sessions (id, user_id, ...)                   │
│    - user_id = "test_xxx_uuid" (el UUID completo)              │
│                                                                │
│ 3. Test conecta con cookie:                                    │
│    - Middleware busca sesión Redis                             │
│    - Extrae userId = "test_xxx" (¿o "test_xxx_uuid"?)          │
│                                                                │
│ 4. Test hace session:join:                                     │
│    - validateSessionOwnership compara:                         │
│      socket.userId vs sessions.user_id                         │
│    ❌ NO coinciden si hay mismatch de formato                  │
└────────────────────────────────────────────────────────────────┘
```

#### Evidencia del Output de Tests

```
Error: UNAUTHORIZED
  at Socket.onError (TestSocketClient.ts:220:18)
```

Esto confirma que `validateSessionOwnership()` retorna `UNAUTHORIZED`, lo que significa que `socket.userId !== sessions.user_id`.

---

### 2.2 ISSUE: EventStore Sequence Numbers

#### Investigación Realizada

El test asume que EventStore usa Redis con key `seq:{sessionId}`:

```typescript
// sequence-numbers.integration.test.ts:186-192
const keyPattern = `seq:${session.id}`;
const value = await redis.get(keyPattern);
expect(parseInt(value!, 10)).toBeGreaterThanOrEqual(0);
// FALLA: value es undefined o no numérico → parseInt retorna NaN
```

#### Búsqueda en EventStore.ts

```typescript
// EventStore.ts - BÚSQUEDA NECESARIA
// Buscar: "INCR", "seq:", "sequence", "redis"
//
// Posibilidades:
// A) EventStore usa SQL identity para sequence_number
// B) EventStore usa Redis pero con key diferente (ej: "event:seq:{sessionId}")
// C) EventStore calcula sequence_number en memoria
```

**Comando para investigar**:
```bash
grep -n "sequence\|INCR\|redis" backend/src/services/events/EventStore.ts
```

---

### 2.3 ISSUE: Approval Concurrent Race Condition

#### Investigación Realizada

El test envía dos respuestas concurrentes:
```typescript
const [result1, result2] = await Promise.all([
  approvalManager.respondToApprovalAtomic(approvalId, 'approved', user.id),
  approvalManager.respondToApprovalAtomic(approvalId, 'rejected', user.id),
]);

// Expectativa: 1 success, 1 ALREADY_RESOLVED
// Resultado: 0 success, 2 failures
```

#### Posibles Causas

1. **Approval ya expirado**: El timeout de 5 segundos (mockeado) puede no ser suficiente
2. **Bug en atomicidad**: `respondToApprovalAtomic()` puede tener race condition
3. **Approval nunca creado**: `request()` puede fallar silenciosamente

**Código a revisar** en `ApprovalManager.ts`:
```typescript
// ApprovalManager.ts:400-450 (aprox)
async respondToApprovalAtomic(
  approvalId: string,
  decision: 'approved' | 'rejected',
  userId: string
): Promise<AtomicApprovalResponseResult> {
  // Usar transaction SQL para atomicidad
  // UPDATE approvals SET status = @decision
  // WHERE id = @approvalId AND status = 'pending'
  //
  // Si rowsAffected === 0, retornar ALREADY_RESOLVED
  // Si rowsAffected === 1, retornar success
}
```

---

## 3. HERRAMIENTAS DE DIAGNÓSTICO

### 3.1 Comandos de Debug

```bash
# Ver logs de tests con verbose
cd backend && npm run test:integration -- --reporter=verbose 2>&1 | tee integration-test.log

# Ejecutar un solo test para debuggear
cd backend && npm run test:integration -- --grep "should allow User B to join their own session"

# Verificar conexión a Redis
cd backend && node -e "
const { initRedis, getRedis } = require('./dist/config/redis');
initRedis().then(() => {
  const redis = getRedis();
  redis.keys('sess:*').then(keys => {
    console.log('Session keys:', keys);
    process.exit(0);
  });
});
"

# Verificar contenido de sesión Redis
cd backend && node -e "
const { initRedis, getRedis } = require('./dist/config/redis');
initRedis().then(async () => {
  const redis = getRedis();
  const keys = await redis.keys('sess:test_*');
  for (const key of keys) {
    const value = await redis.get(key);
    console.log(key, '=', value);
  }
  process.exit(0);
});
"

# Verificar sesiones en SQL
cd backend && node -e "
const { executeQuery } = require('./dist/config/database');
executeQuery('SELECT id, user_id, title FROM sessions WHERE id LIKE \\'test_%\\' ORDER BY created_at DESC')
  .then(rows => {
    console.log('Sessions:', rows);
    process.exit(0);
  });
"
```

### 3.2 Puntos de Breakpoint Sugeridos

Para debuggear con VS Code o `--inspect`:

```typescript
// 1. TestSessionFactory.createTestUser() - línea donde crea sesión Redis
// Verificar: ¿Qué userId se guarda en microsoftOAuth?

// 2. session-isolation.integration.test.ts beforeAll() - auth middleware
// Verificar: ¿Qué userId extrae el middleware de la sesión?

// 3. validateSessionOwnership() - comparación de userIds
// Verificar: ¿Qué valores se comparan?
```

### 3.3 Logging Temporal para Debug

Agregar temporalmente en `session-ownership.ts`:
```typescript
export async function validateSessionOwnership(
  sessionId: string,
  userId: string
): Promise<SessionOwnershipResult> {
  console.log('DEBUG validateSessionOwnership:', { sessionId, userId });

  const result = await executeQuery<{ user_id: string }[]>(...);
  console.log('DEBUG SQL result:', result);

  const isOwner = result[0]?.user_id === userId;
  console.log('DEBUG comparison:', {
    sqlUserId: result[0]?.user_id,
    socketUserId: userId,
    isOwner
  });

  return { isOwner, error: isOwner ? undefined : 'UNAUTHORIZED' };
}
```

---

## 4. PLAN DE CORRECCIÓN DETALLADO

### FASE 1: Diagnosticar Session-UserId Mismatch (2-4 horas)

#### Paso 1.1: Agregar Logging
```typescript
// En TestSessionFactory.createTestUser():
console.log('Created test user:', { userId, sessionId: sessionKey });

// En session-isolation.integration.test.ts auth middleware:
console.log('Socket auth:', {
  sessionUserId: sessionData?.microsoftOAuth?.userId,
  socketUserId: authSocket.userId
});
```

#### Paso 1.2: Ejecutar Test Específico
```bash
npm run test:integration -- --grep "should allow User B to join" 2>&1 | grep DEBUG
```

#### Paso 1.3: Comparar Valores
Verificar output:
- `Created test user: { userId: "X" }`
- `Socket auth: { sessionUserId: "Y", socketUserId: "Z" }`
- `SQL result: [{ user_id: "W" }]`

Si X ≠ Y ≠ Z ≠ W, hay inconsistencia en cómo se propaga el userId.

#### Paso 1.4: Corregir TestSessionFactory
Una vez identificado el mismatch, corregir `createTestUser()` para usar el mismo userId en:
- SQL `users.id`
- Redis `session.microsoftOAuth.userId`
- SQL `sessions.user_id`

#### Success Criteria FASE 1:
- [ ] Logging agregado muestra valores de userId en cada punto
- [ ] Identificado dónde ocurre el mismatch
- [ ] TestSessionFactory corregido para usar userId consistente
- [ ] Test "should allow User B to join their own session" PASA

---

### FASE 2: Corregir EventStore Sequence Numbers (1-2 horas)

#### Paso 2.1: Investigar Source de sequence_number
```bash
grep -n "sequence_number\|INCR\|redis" backend/src/services/events/EventStore.ts
```

#### Paso 2.2: Documentar Comportamiento Real
Si usa SQL:
- Actualizar tests para no depender de Redis key
- Documentar en `docs/backend/architecture-deep-dive.md`

Si usa Redis con key diferente:
- Actualizar tests para usar key correcto

#### Paso 2.3: Ajustar Tests
```typescript
// Opción A: Si sequence_number viene de SQL
it('should use correct sequence number source', async () => {
  // Test que verifica SQL, no Redis
});

// Opción B: Si Redis usa key diferente
const keyPattern = `event:sequence:${session.id}`; // Ajustar formato
```

#### Success Criteria FASE 2:
- [ ] Documentado source real de sequence_number
- [ ] Tests ajustados para reflejar implementación real
- [ ] 4 tests de Event Ordering PASAN

---

### FASE 3: Corregir Approval Race Condition (2-3 horas)

#### Paso 3.1: Verificar que Approval se Crea
Agregar logging en test:
```typescript
const approvalPromise = approvalManager.request({ ... });
console.log('Approval request initiated');

const approvalEvent = await client.waitForAgentEvent('approval_requested', 10000);
console.log('Approval event received:', approvalEvent);
```

#### Paso 3.2: Verificar Atomicidad
En `ApprovalManager.respondToApprovalAtomic()`:
```typescript
console.log('respondToApprovalAtomic called:', { approvalId, decision, userId });
// ... SQL update ...
console.log('SQL update result:', { rowsAffected });
```

#### Paso 3.3: Ajustar Timeout si Necesario
```typescript
// En vi.mock de ApprovalManager:
APPROVAL_TIMEOUT: 30000, // Aumentar a 30 segundos para tests
```

#### Success Criteria FASE 3:
- [ ] Approval se crea correctamente (evento recibido)
- [ ] respondToApprovalAtomic() tiene atomicidad correcta
- [ ] Test concurrente: 1 success, 1 ALREADY_RESOLVED
- [ ] 3 tests de Approval Flow PASAN

---

## 5. SUCCESS CRITERIA GLOBAL

### Para Cerrar F1-002 como COMPLETADO:

| Criterio | Estado Actual | Objetivo |
|----------|---------------|----------|
| Tests de integración creados | ✅ 38 tests | ✅ Mantener |
| WebSocket Connection tests | ✅ 9/9 | ✅ Mantener |
| Message Lifecycle tests | ✅ 8/8 | ✅ Mantener |
| Multi-Tenant tests | ❌ 2/8 | ✅ 8/8 |
| Event Ordering tests | ❌ 4/8 | ✅ 8/8 |
| Approval Flow tests | ❌ 2/5 | ✅ 5/5 |
| **TOTAL** | **25/38 (65.8%)** | **38/38 (100%)** |

### Comando de Verificación Final:
```bash
cd backend && npm run test:integration
# Esperado: Test Files: 5 passed (5)
#           Tests: 38 passed (38)
```

---

## 6. ARCHIVOS MODIFICADOS EN ESTA TAREA

### Archivos Nuevos (Tests)
- `backend/src/__tests__/integration/helpers/index.ts`
- `backend/src/__tests__/integration/helpers/constants.ts`
- `backend/src/__tests__/integration/helpers/TestSocketClient.ts`
- `backend/src/__tests__/integration/helpers/TestSessionFactory.ts`
- `backend/src/__tests__/integration/helpers/TestDataCleanup.ts`
- `backend/src/__tests__/integration/websocket-connection/socket-lifecycle.integration.test.ts`
- `backend/src/__tests__/integration/message-lifecycle/message-persistence.integration.test.ts`
- `backend/src/__tests__/integration/multi-tenant/session-isolation.integration.test.ts`
- `backend/src/__tests__/integration/event-ordering/sequence-numbers.integration.test.ts`
- `backend/src/__tests__/integration/approval-flow/approval-lifecycle.integration.test.ts`

### Archivos Modificados (Configuración)
- `backend/vitest.integration.config.ts` - Agregados path aliases
- `backend/.husky/pre-push` - Agregado paso de integration tests

### Archivos Renombrados
- `logger.integration.test.ts` → `logger.test.ts` (era unit test mal nombrado)
- `MessageQueue.integration.test.ts` → `MessageQueue.test.ts` (era unit test mal nombrado)

### Archivos Corregidos (Bugs Encontrados)
- `backend/src/services/approval/ApprovalManager.ts:977-988` - getActionType() valores correctos
- `docs/common/03-database-schema.md` - Documentado constraint chk_approvals_action_type

---

## 7. ANEXO: CONSTRAINT DATABASE DESCUBIERTO

Durante la investigación se descubrió que el constraint `chk_approvals_action_type` en la base de datos no estaba documentado y el código `ApprovalManager.getActionType()` retornaba valores incorrectos.

### Constraint en BD:
```sql
CONSTRAINT chk_approvals_action_type CHECK (action_type IN ('create', 'update', 'delete', 'custom'))
```

### Código Corregido:
```typescript
// ApprovalManager.ts:977-988
private getActionType(toolName: string): 'create' | 'update' | 'delete' | 'custom' {
  if (toolName.includes('create')) return 'create';
  if (toolName.includes('update')) return 'update';
  if (toolName.includes('delete')) return 'delete';
  return 'custom';  // Era 'bc_query' antes
}
```

### Fecha del Constraint:
Creado: 2025-10-29 00:23:12 (descubierto via `sys.check_constraints`)

---

**Fin del QA Report**
