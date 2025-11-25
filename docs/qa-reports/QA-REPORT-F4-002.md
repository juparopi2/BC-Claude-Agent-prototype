# QA Report: F4-002 Eventos de Approval Unificados

**Fecha**: 2025-11-25
**Feature**: F4-002 - Unificar eventos de Approval en contrato agent:event
**Prioridad**: ALTA
**Estado**: ✅ COMPLETED (QA Master Review Fixes Applied)
**Última Actualización**: 2025-11-25 (Post QA Master Review)

---

## 1. RESUMEN EJECUTIVO

### Contexto del Problema

El sistema de Human-in-the-Loop (approvals) emitia eventos WebSocket de forma separada del contrato unificado `agent:event`. Esto causaba:

1. **Sin sequenceNumber**: Los eventos `approval:requested` y `approval:resolved` no tenian orden garantizado
2. **Sin persistencia en EventStore**: No habia trazabilidad de approvals en `message_events`
3. **Frontend debia manejar dos tipos de eventos**: `agent:event` para mensajes y `approval:*` para approvals
4. **Inconsistencia arquitectural**: Todos los demas eventos usaban el contrato unificado

### Solucion Implementada

Se modifico el `ApprovalManager` para:

1. Usar `EventStore.appendEvent()` para persistir eventos de approval
2. Emitir via `agent:event` con tipo `approval_requested` / `approval_resolved`
3. Incluir `sequenceNumber`, `eventId`, y `persistenceState` en todos los eventos
4. Marcar como deprecated los eventos separados `approval:requested` y `approval:resolved`

### Impacto del Cambio

| Aspecto | Antes | Despues |
|---------|-------|---------|
| Eventos emitidos | `approval:requested`, `approval:resolved` | `agent:event` con type `approval_requested`/`approval_resolved` |
| Persistencia | Solo en tabla `approvals` | `approvals` + `message_events` |
| Orden garantizado | No (sin sequenceNumber) | Si (Redis INCR via EventStore) |
| Frontend listeners | 2 tipos de eventos | 1 tipo unificado |

---

## 2. ARCHIVOS MODIFICADOS

### Archivos Modificados

| Archivo | Cambios |
|---------|---------|
| `backend/src/services/approval/ApprovalManager.ts` | Integra EventStore, emite via `agent:event` |
| `backend/src/types/websocket.types.ts` | Marca `approval:requested` como deprecated |
| `backend/src/types/approval.types.ts` | Marca tipos legacy como deprecated |
| `backend/src/server.ts` | Elimina emision redundante de `approval:resolved` |
| `backend/src/__tests__/unit/ApprovalManager.test.ts` | Agrega mock de EventStore, actualiza assertions |
| `backend/src/__tests__/unit/security/websocket-multi-tenant.test.ts` | Actualiza handlers y assertions a `agent:event` |

---

## 3. DETALLES DE LA IMPLEMENTACION

### 3.1 ApprovalManager - request()

**Ubicacion**: `backend/src/services/approval/ApprovalManager.ts:120-226`

**Cambios**:
- Agrega `private eventStore: EventStore` como propiedad
- Llama a `eventStore.appendEvent()` despues de INSERT en approvals
- Emite `agent:event` con tipo `approval_requested` en lugar de `approval:requested`
- Incluye `sequenceNumber`, `eventId`, `persistenceState` en el evento

### 3.2 ApprovalManager - respondToApproval()

**Ubicacion**: `backend/src/services/approval/ApprovalManager.ts:239-325`

**Cambios**:
- Llama a `eventStore.appendEvent()` despues de UPDATE en approvals
- Emite `agent:event` con tipo `approval_resolved` en lugar de `approval:resolved`
- Incluye `sequenceNumber`, `eventId`, `persistenceState` en el evento

### 3.3 ApprovalManager - respondToApprovalAtomic()

**Ubicacion**: `backend/src/services/approval/ApprovalManager.ts:454-530`

**Cambios**:
- Llama a `eventStore.appendEvent()` despues de COMMIT de la transaccion
- Emite `agent:event` con tipo `approval_resolved`
- Incluye datos de auditoria en el log

### 3.4 server.ts - Eliminacion de emision redundante

**Ubicacion**: `backend/src/server.ts:1081-1083`

**Cambio**: Se elimino la emision directa de `approval:resolved` porque el `ApprovalManager` ahora lo hace internamente.

---

## 4. CASOS DE PRUEBA PARA QA

### 4.1 Pre-requisitos

```bash
cd backend
npm install
npm run dev
```

### 4.2 Test Cases

#### TC-001: Approval request emite agent:event

**Pasos**:
1. Conectar via Socket.IO
2. Enviar mensaje que trigger operacion de escritura (create_customer, update, delete, etc.)
3. Verificar evento recibido

**Verificacion**:
```javascript
socket.on('agent:event', (event) => {
  if (event.type === 'approval_requested') {
    console.log('Event:', event);
    // Verificar campos requeridos
    assert(event.sequenceNumber !== undefined, 'Debe tener sequenceNumber');
    assert(event.eventId !== undefined, 'Debe tener eventId');
    assert(event.persistenceState === 'persisted', 'Debe ser persisted');
    assert(event.approvalId !== undefined, 'Debe tener approvalId');
    assert(event.toolName !== undefined, 'Debe tener toolName');
  }
});
```

**Resultado Esperado**:
- Evento tiene `type: 'approval_requested'`
- Tiene `sequenceNumber` numerico
- Tiene `eventId` UUID
- Tiene `persistenceState: 'persisted'`
- Tiene `approvalId`, `toolName`, `args`, `changeSummary`, `priority`

---

#### TC-002: Approval resolved emite agent:event

**Pasos**:
1. Conectar via Socket.IO
2. Triggear un approval request
3. Responder al approval (approve o reject)
4. Verificar evento recibido

**Verificacion**:
```javascript
socket.on('agent:event', (event) => {
  if (event.type === 'approval_resolved') {
    console.log('Event:', event);
    assert(event.sequenceNumber !== undefined);
    assert(event.eventId !== undefined);
    assert(event.decision === 'approved' || event.decision === 'rejected');
  }
});
```

**Resultado Esperado**:
- Evento tiene `type: 'approval_resolved'`
- Tiene `sequenceNumber` numerico
- Tiene `eventId` UUID
- Tiene `persistenceState: 'persisted'`
- Tiene `approvalId`, `decision`

---

#### TC-003: Eventos persisten en message_events

**Pasos**:
1. Triggear approval request
2. Aprobar o rechazar
3. Verificar en base de datos

**SQL Query**:
```sql
SELECT * FROM message_events
WHERE session_id = @sessionId
  AND event_type IN ('approval_requested', 'approval_completed')
ORDER BY sequence_number;
```

**Resultado Esperado**:
- 2 registros: uno `approval_requested`, uno `approval_completed`
- Ambos tienen `sequence_number` consecutivos
- `data` contiene JSON con detalles del approval

---

#### TC-004: Orden garantizado con sequenceNumber

**Pasos**:
1. Enviar mensaje
2. Recibir approval_requested
3. Aprobar
4. Recibir approval_resolved

**Verificacion**:
```javascript
let lastSeq = -1;
socket.on('agent:event', (event) => {
  if (event.sequenceNumber !== undefined) {
    assert(event.sequenceNumber > lastSeq, 'Debe ser mayor que el anterior');
    lastSeq = event.sequenceNumber;
  }
});
```

**Resultado Esperado**:
- Todos los eventos con sequenceNumber estan en orden ascendente
- No hay gaps en la secuencia

---

#### TC-005: Eventos legacy NO se emiten

**Pasos**:
1. Conectar via Socket.IO
2. Escuchar eventos `approval:requested` y `approval:resolved`
3. Triggear approval workflow

**Verificacion**:
```javascript
let legacyEventReceived = false;
socket.on('approval:requested', () => { legacyEventReceived = true; });
socket.on('approval:resolved', () => { legacyEventReceived = true; });

// Despues del flujo
assert(!legacyEventReceived, 'No debe recibir eventos legacy');
```

**Resultado Esperado**:
- NINGUN evento `approval:requested` recibido
- NINGUN evento `approval:resolved` recibido
- Solo eventos `agent:event` con type correcto

---

## 5. TESTS AUTOMATIZADOS

### 5.1 Ejecutar Tests

```bash
cd backend
npm test
```

**Resultado**:
```
Test Files:  22 passed (22)
Tests:       512 passed | 1 skipped (513)
```

### 5.2 Tests Relevantes

| Archivo | Tests | Estado |
|---------|-------|--------|
| `ApprovalManager.test.ts` | 27 tests | PASS |
| `websocket-multi-tenant.test.ts` | 27 tests | PASS |

### 5.3 Build y Lint

```bash
cd backend
npm run lint   # 0 errors, 15 warnings (preexistentes)
npm run build  # SUCCESS
```

---

## 6. CHECKLIST DE VERIFICACION

### Funcionalidad

- [x] `approval_requested` se emite via `agent:event`
- [x] `approval_resolved` se emite via `agent:event`
- [x] Eventos tienen `sequenceNumber`
- [x] Eventos tienen `eventId`
- [x] Eventos tienen `persistenceState: 'persisted'`
- [x] Eventos legacy `approval:*` NO se emiten desde ApprovalManager
- [x] server.ts no emite `approval:resolved` redundante

### Persistencia

- [x] Eventos persisten en `message_events`
- [x] `event_type` usa `approval_requested` / `approval_completed`
- [x] `data` contiene JSON valido con detalles del approval

### Tests Automatizados

- [x] 512 tests pasan
- [x] Build compila sin errores
- [x] Lint no tiene errores (solo 15 warnings preexistentes)

### Retrocompatibilidad

- [x] Tipos legacy marcados como @deprecated
- [x] WebSocket events legacy marcados como @deprecated
- [x] Frontend puede migrar gradualmente escuchando `agent:event`

---

## 7. INFORMACION ADICIONAL

### Tipos Definidos

**ApprovalRequestedEvent** (agent.types.ts):
```typescript
interface ApprovalRequestedEvent extends BaseAgentEvent {
  type: 'approval_requested';
  approvalId: string;
  toolName: string;
  args: Record<string, unknown>;
  changeSummary: string;
  priority: 'low' | 'medium' | 'high';
  expiresAt?: Date;
}
```

**ApprovalResolvedEvent** (agent.types.ts):
```typescript
interface ApprovalResolvedEvent extends BaseAgentEvent {
  type: 'approval_resolved';
  approvalId: string;
  decision: 'approved' | 'rejected';
  reason?: string;
}
```

### EventStore Types

**EventType** (EventStore.ts):
```typescript
type EventType =
  | 'approval_requested'    // Usado para approval requests
  | 'approval_completed'    // Usado para approval responses
  | ...otros tipos...
```

### Migracion del Frontend

El frontend debe:
1. Escuchar `agent:event` para todos los eventos
2. Filtrar por `event.type === 'approval_requested'` o `event.type === 'approval_resolved'`
3. Dejar de escuchar `approval:requested` y `approval:resolved`

---

## 8. NOMENCLATURA: approval_completed vs approval_resolved (DOC-001)

### Contexto

Existe una diferencia intencional entre los nombres usados en base de datos vs WebSocket:

| Capa | Nombre | Propósito |
|------|--------|-----------|
| **Base de datos (EventStore)** | `approval_completed` | Tipo de evento persistido en `message_events.event_type` |
| **WebSocket (agent:event)** | `approval_resolved` | Tipo de evento emitido al frontend |

### Razón

- `approval_completed` es un término genérico que indica que el proceso de approval terminó (ya sea aprobado, rechazado, o expirado)
- `approval_resolved` es más específico para el frontend, indicando que el estado de UI debe actualizarse

### Queries SQL

Para buscar eventos de approval en la base de datos:

```sql
-- Eventos de approval request
SELECT * FROM message_events
WHERE event_type = 'approval_requested'
ORDER BY sequence_number;

-- Eventos de approval completion (approved/rejected/expired)
SELECT * FROM message_events
WHERE event_type = 'approval_completed'
ORDER BY sequence_number;
```

### Frontend Filtering

```typescript
socket.on('agent:event', (event) => {
  // Para requests
  if (event.type === 'approval_requested') {
    showApprovalModal(event);
  }
  // Para resoluciones (approved/rejected/expired)
  if (event.type === 'approval_resolved') {
    closeApprovalModal(event.approvalId);
    updateApprovalStatus(event.decision);
  }
});
```

---

## 9. QA MASTER REVIEW FIXES APLICADOS

### Fecha de Revisión: 2025-11-25

Se aplicaron los siguientes fixes críticos identificados en el QA Master Review:

### FIX-001: EventStore Failure en request() (CRÍTICO)

**Problema**: Si EventStore fallaba después del INSERT en approvals, el frontend nunca recibía el evento.

**Solución**: Implementación de modo degradado con try/catch:
- Si EventStore falla, se genera un `eventId` fallback
- El evento se emite con `persistenceState: 'failed'`
- No se incluye `sequenceNumber` si no está disponible

**Ubicación**: `ApprovalManager.ts:169-206`

### FIX-002: Promise Resolution Garantizada en respondToApproval() (ALTA)

**Problema**: Si EventStore o DB fallaban, el Promise nunca se resolvía y el agente quedaba colgado.

**Solución**: Uso de try/finally con flag `promiseResolved`:
- El Promise SIEMPRE se resuelve, incluso en caso de error
- En caso de error, se resuelve con `false` para desbloquear el agente
- finally block garantiza resolución como último recurso

**Ubicación**: `ApprovalManager.ts:271-398`

### FIX-003: EventStore Failure Post-Commit en respondToApprovalAtomic() (CRÍTICO)

**Problema**: Si EventStore fallaba DESPUÉS del commit de transacción, había inconsistencia irrecuperable.

**Solución**: Manejo separado post-commit:
- Try/catch específico para EventStore después de commit
- Log crítico con `criticalWarning` para alertar inconsistencia
- Promise siempre se resuelve independiente del EventStore
- Rollback mejorado con try/catch para evitar errores secundarios

**Ubicación**: `ApprovalManager.ts:544-643`

### FIX-004: Emisión de Evento en Expiración (MEDIA)

**Problema**: Cuando un approval expiraba por timeout, el frontend no se enteraba.

**Solución**: Nuevo método `expireApprovalWithEvent()`:
- Persiste evento `approval_completed` con `decision: 'expired'`
- Emite `agent:event` tipo `approval_resolved` al frontend
- Frontend recibe notificación con `reason: 'Approval request timed out'`

**Ubicación**: `ApprovalManager.ts:1010-1092`

### Nuevos Tests Agregados

| Test | Descripción | Archivo |
|------|-------------|---------|
| EventStore failure in request() | Verifica modo degradado | `ApprovalManager.test.ts:857-889` |
| EventStore failure in respondToApproval() | Verifica resolución garantizada | `ApprovalManager.test.ts:891-930` |
| DB + EventStore failure | Verifica que Promise siempre resuelve | `ApprovalManager.test.ts:932-954` |
| EventStore failure after atomic commit | Verifica manejo post-commit | `ApprovalManager.test.ts:956-1008` |
| Expiration emits event | Verifica evento de expiración | `ApprovalManager.test.ts:1012-1046` |
| Expiration persists to EventStore | Verifica persistencia de expiración | `ApprovalManager.test.ts:1048-1078` |
| EventStore failure during expiration | Verifica degraded mode en expiración | `ApprovalManager.test.ts:1080-1111` |

---

## 10. CHECKLIST FINAL POST-FIXES

### Funcionalidad Core

- [x] `approval_requested` se emite via `agent:event`
- [x] `approval_resolved` se emite via `agent:event`
- [x] Eventos tienen `sequenceNumber` (cuando disponible)
- [x] Eventos tienen `eventId`
- [x] Eventos tienen `persistenceState` (`persisted` o `failed`)
- [x] Eventos legacy `approval:*` NO se emiten

### Resiliencia (QA Master Fixes)

- [x] **FIX-001**: EventStore failure en request() → degraded mode
- [x] **FIX-002**: Promise SIEMPRE se resuelve en respondToApproval()
- [x] **FIX-003**: EventStore failure post-commit → handled gracefully
- [x] **FIX-004**: Expiración emite evento al frontend

### Tests

- [x] 7 nuevos tests para edge cases de EventStore
- [x] Tests de expiración con evento
- [x] Build compila sin errores
- [x] Lint pasa sin errores

---

**Documento creado**: 2025-11-25
**QA Master Review**: 2025-11-25
**Fixes Aplicados**: 2025-11-25
**Estado Final**: ✅ COMPLETED
