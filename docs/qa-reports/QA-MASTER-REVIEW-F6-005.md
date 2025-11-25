# QA Master Review - F6-005: Tests de Routes

**Fecha**: 2025-11-25
**Revisor**: QA Master (Senior QA Engineer)
**Estándar aplicado**: Enterprise-grade security & scalability review
**Clasificación**: Auditoría de código crítico

---

## Resumen Ejecutivo

He realizado una revisión exhaustiva del ticket F6-005 (Tests de Routes) con estándares de auditoría de empresa Fortune 500. Esta revisión identifica **gaps críticos, edge cases no cubiertos, y vulnerabilidades potenciales** que deben ser abordados antes de marcar el ticket como COMPLETED.

### Veredicto General

| Aspecto | Calificación | Notas |
|---------|--------------|-------|
| Cobertura de funcionalidad básica | ✅ Buena | 145 tests cubren happy paths |
| Seguridad multi-tenant | ⚠️ Parcial | Falta cobertura de timing attacks |
| Edge cases | ❌ Insuficiente | 23 gaps identificados |
| Integración con sessions.ts | ❌ Crítico | Sin archivo de test dedicado |
| Error handling | ⚠️ Parcial | Falta cobertura de errores de red |
| Performance/Stress | ❌ Ausente | No hay tests de carga |

---

## 1. Gaps Críticos (Severidad: ALTA)

### 1.1 🔴 Sessions Routes - SIN COBERTURA

**Archivo**: `backend/src/routes/sessions.ts` (673 líneas)
**Estado**: ❌ **NO TIENE TEST FILE DEDICADO**

El archivo `sessions.routes.integration.test.ts` mencionado en el QA report (18 tests) **no existe** o tiene cobertura mínima. Este es el archivo de rutas más complejo del sistema con:

- 6 endpoints CRUD
- Transformación de mensajes con 3 tipos (standard, thinking, tool_use)
- Paginación de mensajes
- Validación Zod
- CASCADE delete

**Gaps específicos no cubiertos:**

```typescript
// ❌ No testeado: Transformación de thinking messages
case 'thinking':
  return {
    id: row.id,
    type: 'thinking' as const,
    content: row.content || '',
    duration_ms: metadata.duration_ms as number | undefined,
    // ... más campos
  };

// ❌ No testeado: Transformación de tool_use messages
case 'tool_use':
  return {
    tool_name: metadata.tool_name as string,
    tool_args: (metadata.tool_args as Record<string, unknown>) || {},
    status: (metadata.status as 'pending' | 'success' | 'error') || 'pending',
    // ... más campos
  };

// ❌ No testeado: Parsing de metadata JSON con error handling
try {
  metadata = JSON.parse(row.metadata);
} catch {
  // Ignore parse errors - ¿Pero qué pasa con metadata corrupta?
}

// ❌ No testeado: Boundary en title validation
if (title.length > 500) {
  res.status(400).json({
    error: 'Bad Request',
    message: 'Title must be 500 characters or less',
  });
}

// ❌ No testeado: Paginación con offset/limit extremos
const getMessagesSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});
```

**Recomendación**: Crear `sessions.routes.test.ts` con mínimo 40 tests adicionales.

---

### 1.2 🔴 Auth OAuth - Tests NO usan el router real

**Problema crítico**: Los tests de `auth-oauth.routes.test.ts` **recrean la lógica del endpoint manualmente** en lugar de testear el router real.

```typescript
// ❌ INCORRECTO - Test recrea la lógica en lugar de usar el router
app.get('/api/auth/me', async (req: Request, res: Response) => {
  const userId = req.userId;
  // ... lógica duplicada manualmente
});

// ✅ CORRECTO - Debería usar el router importado
app.use('/api/auth', authOAuthRouter);
```

**Impacto**:
- Los tests pasan pero **NO validan el código real**
- Cambios en `auth-oauth.ts` no serán detectados
- Falsos positivos de cobertura

**Afectados**:
- `GET /api/auth/me` (líneas 454-566)
- `GET /api/auth/bc-status` (líneas 571-718)
- `POST /api/auth/bc-consent` (líneas 723-838)
- `POST /api/auth/logout` (líneas 424-448)

**Recomendación**: Refactorizar tests para inyectar mocks vía dependency injection y usar el router real.

---

### 1.3 🔴 Rate Limiting - Sin tests

El sistema implementa rate limiting (100 jobs/session/hour via Redis) pero **no hay tests que lo verifiquen**.

```typescript
// Mencionado en CLAUDE.md pero sin tests:
// "Rate limiting enforces 100 jobs/session/hour via Redis counters"
```

**Recomendación**: Agregar tests para:
- Límite alcanzado retorna 429
- Counter reset después de 1 hora
- Redis unavailable fallback

---

## 2. Gaps de Seguridad (Severidad: ALTA)

### 2.1 ⚠️ Timing Attack en validateSessionOwnership

```typescript
// token-usage.routes.test.ts - Mock siempre responde igual
vi.mock('@/utils/session-ownership', () => ({
  validateSessionOwnership: vi.fn(),
  validateUserIdMatch: vi.fn((requestedId, authenticatedId) => requestedId === authenticatedId),
}));
```

**Problema**: `validateUserIdMatch` usa comparación directa de strings, vulnerable a timing attacks.

**Test faltante**:
```typescript
it('should use constant-time comparison for userId validation', () => {
  // Verificar que se usa crypto.timingSafeEqual o equivalente
});
```

---

### 2.2 ⚠️ Token Refresh Race Condition

Documentado en QA-REPORT-F6-005.md como "Known Issue" pero **sin tests que demuestren el problema**:

```markdown
3. **Token refresh race condition**: Documentado, requiere Redis distributed lock para fix completo (futuro)
```

**Recomendación**: Crear test que demuestre el race condition para documentar comportamiento:
```typescript
it('should handle concurrent token refresh requests (KNOWN ISSUE)', async () => {
  // Este test documenta el race condition actual
  // TODO: Fix con Redis distributed lock
});
```

---

### 2.3 ⚠️ Input Sanitization en logs.routes.ts

```typescript
// logs.routes.test.ts línea 504-508
it('should handle special characters in message', async () => {
  const specialChars = {
    logs: [{
      message: 'Special: <script>alert("xss")</script> & "quotes" \'single\'',
    }],
  };
  // Test solo verifica que no crashea, pero...
});
```

**Problema**: El test verifica que XSS se **pasa al logger sin sanitizar**. Aunque esto es backend logging, si estos logs se muestran en UI de admin, hay riesgo.

**Test faltante**:
```typescript
it('should NOT include client logs in user-facing responses', () => {
  // Verificar que logs nunca se devuelven al frontend
});
```

---

## 3. Edge Cases No Cubiertos (Severidad: MEDIA)

### 3.1 Token Usage Routes

| Edge Case | Estado | Descripción |
|-----------|--------|-------------|
| userId con caracteres especiales en URL | ❌ No testeado | `GET /api/token-usage/user/user%2Fwith%2Fslash` |
| sessionId = UUID v7 (futuro) | ❌ No testeado | Solo UUID v4 probado |
| months=1.5 (decimal) | ⚠️ Parcial | Test verifica truncado a 6.9→6, pero no 1.5→1 |
| limit=50 (boundary exacto) | ❌ No testeado | Solo limit < 1 y > 50 |
| Concurrent access same session | ⚠️ Parcial | Test existe pero no verifica atomicidad |

### 3.2 Auth OAuth Routes

| Edge Case | Estado | Descripción |
|-----------|--------|-------------|
| Session hijacking | ❌ No testeado | Reuse de session cookie |
| OAuth state replay | ❌ No testeado | Mismo state usado 2 veces |
| Token refresh durante request | ❌ No testeado | Token expira mid-request |
| Microsoft API timeout | ❌ No testeado | Graph API no responde |
| malformed JSON en userProfile | ❌ No testeado | Microsoft devuelve JSON inválido |
| Unicode en displayName | ❌ No testeado | Nombres con emojis/CJK |

### 3.3 Server Endpoints

| Edge Case | Estado | Descripción |
|-----------|--------|-------------|
| approvalId con spaces | ❌ No testeado | `POST /api/approvals/approval%20123/respond` |
| decision = "APPROVED" (uppercase) | ❌ No testeado | Solo lowercase probado |
| reason > 10000 chars | ❌ No testeado | Sin límite en rejection reason |
| Empty prompt (whitespace only) | ❌ No testeado | `prompt: "   "` |
| MCP service throws | ⚠️ Parcial | Solo isConfigured, no getMCPServerUrl |

### 3.4 Logs Routes

| Edge Case | Estado | Descripción |
|-----------|--------|-------------|
| logs array > 1000 items | ❌ No testeado | Solo 100 probados |
| timestamp en futuro | ❌ No testeado | `2099-01-01T00:00:00Z` |
| message con null bytes | ❌ No testeado | `message: "test\x00test"` |
| context con circular reference | ❌ No testeado | `context: { self: context }` |
| userAgent > 500 chars | ❌ No testeado | Bots maliciosos |

---

## 4. Inconsistencias en Tests

### 4.1 Mock vs Real Router

| Test File | Usa Router Real | Notas |
|-----------|-----------------|-------|
| auth-oauth.routes.test.ts | ❌ No | Recrea lógica manualmente |
| token-usage.routes.test.ts | ✅ Sí | Correcto |
| logs.routes.test.ts | ✅ Sí | Correcto |
| server-endpoints.test.ts | ⚠️ Parcial | Recrea router en helper |

### 4.2 Inconsistencia en Error Messages

```typescript
// token-usage: "You can only access your own token usage data"
// server-endpoints: "You do not have access to this session"
// auth-oauth: Usa ambos patrones
```

**Recomendación**: Estandarizar mensajes de error multi-tenant.

---

## 5. Tests de Performance Ausentes

### 5.1 No hay tests de carga

El proyecto maneja datos potencialmente grandes pero no hay tests que verifiquen:

```typescript
// ❌ No existe
describe('Performance Tests', () => {
  it('should handle 1000 concurrent token-usage requests', async () => {});
  it('should respond within 200ms for session list with 1000 sessions', async () => {});
  it('should paginate 10000 messages efficiently', async () => {});
});
```

### 5.2 No hay tests de memory leaks

```typescript
// ❌ No existe
it('should not leak memory after processing 10000 log batches', async () => {});
```

---

## 6. Recomendaciones Prioritarias

### Prioridad 1 (Bloqueantes para COMPLETED)

1. **Crear `sessions.routes.test.ts`** con mínimo 40 tests
2. **Refactorizar auth-oauth tests** para usar router real
3. **Agregar tests de rate limiting**

### Prioridad 2 (Alta)

4. Agregar tests de timing attack protection
5. Cubrir edge cases de tokens expirados mid-request
6. Tests de Unicode/encoding en todos los inputs

### Prioridad 3 (Media)

7. Tests de performance básicos
8. Estandarizar mensajes de error
9. Documentar race conditions conocidos con tests

---

## 7. Checklist de Verificación Manual

Antes de aprobar, QA debe verificar manualmente:

- [ ] `sessions.routes.test.ts` existe y tiene 40+ tests
- [ ] Auth tests usan `app.use('/api/auth', authOAuthRouter)`
- [ ] Rate limiting tests existen
- [ ] Total tests > 920 (actual: 884 + sessions + rate limiting)
- [ ] No hay tests que dupliquen lógica del router

---

## 8. Conclusión

**Estado recomendado**: 🔄 **REQUIRES CHANGES**

El ticket F6-005 tiene buena cobertura de happy paths pero presenta gaps críticos en:
1. Sessions routes (componente más complejo sin tests)
2. Tests de auth que no validan el código real
3. Edge cases de seguridad no cubiertos

**Próximos pasos**:
1. Implementar fixes de Prioridad 1
2. Re-ejecutar test suite completa
3. Solicitar segunda revisión QA

---

**Firma del QA Master**:

| Campo | Valor |
|-------|-------|
| Revisor | QA Master Review |
| Fecha | 2025-11-25 |
| Decisión | ❌ NOT APPROVED - Requires Changes |
| Próxima revisión | Después de implementar P1 fixes |
