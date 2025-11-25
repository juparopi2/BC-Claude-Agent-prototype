# QA Report: F4-001 Approval Ownership Validation

**Fecha**: 2025-11-25
**Feature**: Fix de Seguridad - Validación de Ownership en Approvals
**ID**: F4-001
**Prioridad**: ALTA (Seguridad)
**Estado**: Implementado - Pendiente QA Manual

---

## 1. RESUMEN EJECUTIVO

Se implementó una validación de seguridad crítica que previene que usuarios respondan a solicitudes de aprobación (approvals) de sesiones que no les pertenecen.

### Cambios Implementados

| Archivo | Cambio |
|---------|--------|
| `backend/src/types/approval.types.ts` | Nuevos tipos: `ApprovalOwnershipError`, `ApprovalOwnershipResult` |
| `backend/src/services/approval/ApprovalManager.ts` | Nuevo método: `validateApprovalOwnership()` |
| `backend/src/server.ts` | Validación en endpoint `POST /api/approvals/:id/respond` |
| `backend/src/__tests__/unit/ApprovalManager.test.ts` | 5 nuevos tests de seguridad |

---

## 2. DESCRIPCIÓN DEL PROYECTO

### BC Claude Agent

BC Claude Agent es un asistente conversacional que permite a usuarios interactuar con Microsoft Dynamics 365 Business Central mediante lenguaje natural. El sistema:

1. **Autenticación**: Usa Microsoft OAuth 2.0 para autenticar usuarios
2. **Sesiones**: Cada usuario tiene sus propias sesiones de chat
3. **Multi-tenant**: Aislamiento estricto entre usuarios - cada usuario solo puede ver/modificar sus propios datos
4. **Human-in-the-Loop**: Operaciones de escritura en Business Central requieren aprobación del usuario

### Flujo de Aprobación

```
Usuario → Solicita crear cliente → Claude genera tool_use →
  → Backend detecta operación de escritura →
    → Crea approval request en BD →
      → Emite evento WebSocket approval:requested →
        → Frontend muestra modal de confirmación →
          → Usuario aprueba/rechaza →
            → Backend ejecuta/cancela operación
```

---

## 3. VULNERABILIDAD CORREGIDA

### Problema Original

El endpoint `POST /api/approvals/:id/respond` NO validaba que el usuario que responde sea el dueño de la sesión asociada al approval.

**Escenario de ataque**:
1. Usuario A crea una sesión y solicita crear un cliente en BC
2. El sistema crea un approval request con ID `approval_123`
3. Usuario B (atacante) conoce el approval ID
4. Usuario B envía `POST /api/approvals/approval_123/respond` con `{ decision: 'approved' }`
5. **ANTES**: La operación se ejecutaba aunque Usuario B no es dueño de la sesión
6. **AHORA**: El sistema retorna HTTP 403 Forbidden

### Solución Implementada

```typescript
// server.ts - Endpoint POST /api/approvals/:id/respond

// SECURITY: Validate that user owns the session associated with this approval
const ownershipResult = await approvalManager.validateApprovalOwnership(approvalId, userIdVerified);

if (!ownershipResult.isOwner) {
  // Log unauthorized access attempt for security audit
  console.warn(`[API] Unauthorized approval access: User ${userIdVerified} attempted to respond...`);

  if (ownershipResult.error === 'APPROVAL_NOT_FOUND') {
    return res.status(404).json({ error: 'Not Found' });
  }

  return res.status(403).json({ error: 'Forbidden' });
}
```

---

## 4. TESTS AUTOMATIZADOS

### Unit Tests Agregados (5 tests)

| Test | Descripción | Resultado |
|------|-------------|-----------|
| `should return isOwner=true when user owns the session` | Usuario válido puede ver su approval | ✅ PASS |
| `should return isOwner=false when user does not own the session` | Usuario inválido NO puede ver approval de otro | ✅ PASS |
| `should return error when approval does not exist` | Approval inexistente retorna error | ✅ PASS |
| `should correctly parse tool_args JSON in approval object` | Los argumentos se parsean correctamente | ✅ PASS |
| `should log warning when unauthorized access is attempted` | Se registra intento de acceso no autorizado | ✅ PASS |

### Ejecución de Tests

```bash
cd backend && npm test
# Result: 450 tests passed (incluyendo los 5 nuevos tests de seguridad)
```

---

## 5. PLAN DE QA MANUAL

### 5.1 Prerrequisitos

1. **Dos usuarios de prueba** con cuentas Microsoft diferentes
2. **Backend corriendo** en `http://localhost:3002`
3. **Frontend corriendo** (si disponible) o usar herramienta como Postman/curl
4. **Base de datos** con datos de prueba (ejecutar `npm run e2e:seed`)

### 5.2 Casos de Prueba

#### TC-001: Usuario puede aprobar sus propias solicitudes

**Precondiciones**:
- Usuario A está autenticado
- Usuario A tiene una sesión activa

**Pasos**:
1. Usuario A envía mensaje que requiere aprobación (ej: "Create a customer named Test Corp")
2. Esperar evento `approval:requested` en WebSocket
3. Obtener el `approvalId` del evento
4. Enviar `POST /api/approvals/{approvalId}/respond` con `{ decision: 'approved' }`

**Resultado Esperado**:
- HTTP 200 con `{ success: true, approvalId, decision: 'approved' }`
- La operación en BC se ejecuta

---

#### TC-002: Usuario NO puede aprobar solicitudes de otros usuarios

**Precondiciones**:
- Usuario A tiene un approval pendiente (ID conocido)
- Usuario B está autenticado (diferente sesión)

**Pasos**:
1. Usuario B envía `POST /api/approvals/{approvalId_de_A}/respond` con `{ decision: 'approved' }`

**Resultado Esperado**:
- HTTP 403 Forbidden
- Response: `{ error: 'Forbidden', message: 'You do not have permission to respond to this approval request' }`
- Log de warning en backend: `[API] Unauthorized approval access: User {B} attempted to respond...`
- La operación en BC NO se ejecuta

---

#### TC-003: Approval inexistente retorna 404

**Pasos**:
1. Usuario autenticado envía `POST /api/approvals/nonexistent-id/respond` con `{ decision: 'approved' }`

**Resultado Esperado**:
- HTTP 404 Not Found
- Response: `{ error: 'Not Found', message: 'Approval request not found' }`

---

#### TC-004: Validación de parámetros

**Pasos**:
1. Enviar `POST /api/approvals/{approvalId}/respond` con `{ decision: 'invalid' }`
2. Enviar `POST /api/approvals/{approvalId}/respond` sin `decision`

**Resultado Esperado**:
- HTTP 400 Bad Request
- Response: `{ error: 'Invalid request', message: 'decision must be either "approved" or "rejected"' }`

---

#### TC-005: Rechazo funciona correctamente

**Precondiciones**:
- Usuario A tiene un approval pendiente

**Pasos**:
1. Usuario A envía `POST /api/approvals/{approvalId}/respond` con `{ decision: 'rejected', reason: 'Changed my mind' }`

**Resultado Esperado**:
- HTTP 200 con `{ success: true, approvalId, decision: 'rejected' }`
- La operación en BC NO se ejecuta
- El agent recibe que fue rechazado y responde apropiadamente

---

### 5.3 Comandos Útiles para Testing

```bash
# Autenticarse (usar browser para OAuth, luego copiar cookie)
# La cookie se llama 'connect.sid'

# Listar approvals pendientes del usuario actual
curl -X GET http://localhost:3002/api/approvals/pending \
  -H "Cookie: connect.sid=YOUR_SESSION_COOKIE"

# Responder a un approval (aprobar)
curl -X POST http://localhost:3002/api/approvals/{APPROVAL_ID}/respond \
  -H "Cookie: connect.sid=YOUR_SESSION_COOKIE" \
  -H "Content-Type: application/json" \
  -d '{"decision": "approved"}'

# Responder a un approval (rechazar)
curl -X POST http://localhost:3002/api/approvals/{APPROVAL_ID}/respond \
  -H "Cookie: connect.sid=YOUR_SESSION_COOKIE" \
  -H "Content-Type: application/json" \
  -d '{"decision": "rejected", "reason": "Test rejection"}'
```

---

## 6. VERIFICACIÓN DE BUILD

```
✅ npm run lint     - 0 errores (11 warnings existentes, ninguno nuevo)
✅ npm run type-check - Sin errores de tipos
✅ npm run build    - Compilación exitosa
✅ npm test         - 450 tests pasaron
```

---

## 7. ARCHIVOS MODIFICADOS

### Nuevos/Modificados

| Archivo | Líneas | Descripción |
|---------|--------|-------------|
| `backend/src/types/approval.types.ts` | +20 | Tipos `ApprovalOwnershipError`, `ApprovalOwnershipResult` |
| `backend/src/services/approval/ApprovalManager.ts` | +100 | Método `validateApprovalOwnership()` |
| `backend/src/server.ts` | +25 | Validación en endpoint |
| `backend/src/__tests__/unit/ApprovalManager.test.ts` | +85 | 5 tests de seguridad |
| `docs/DIAGNOSTIC-AND-TESTING-PLAN.md` | actualizado | Marcado como COMPLETADO |

### Sin Breaking Changes

- La API externa no cambia (mismos endpoints, mismos parámetros)
- Solo se agregan validaciones adicionales
- Usuarios legítimos no experimentan diferencias
- Solo usuarios intentando acceder a approvals de otros reciben 403

---

## 8. NOTAS PARA EL QA

1. **Multi-tenant**: Esta validación es crítica para el aislamiento entre usuarios. Verificar que un usuario NUNCA pueda ver ni modificar datos de otro.

2. **Logs de Auditoría**: Verificar que intentos de acceso no autorizado se registran en los logs del backend con el formato:
   ```
   [API] Unauthorized approval access: User X attempted to respond to approval Y (owned by Z). Error: UNAUTHORIZED
   ```

3. **Tiempos de Respuesta**: La validación adicional no debería impactar significativamente el tiempo de respuesta (1 query SQL adicional).

4. **Edge Cases**:
   - Approval que ya fue aprobado/rechazado
   - Approval expirado (timeout de 5 minutos)
   - Usuario sin sesión válida (debe retornar 401)

---

## 9. APROBACIÓN

| Rol | Nombre | Fecha | Estado |
|-----|--------|-------|--------|
| Desarrollador | Claude | 2025-11-25 | ✅ Implementado |
| QA | - | - | Pendiente |
| Product Owner | - | - | Pendiente |

---

*Reporte generado automáticamente*
*Fecha: 2025-11-25*
