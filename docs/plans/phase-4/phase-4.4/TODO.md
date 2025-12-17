# TODO - Fase 4.4: WebSocket Tests

## Informacion de Tracking

| Campo | Valor |
|-------|-------|
| **Fase** | 4.4 |
| **Estado** | PENDIENTE |
| **Dependencias** | Fase 4.1 completada |

---

## Tareas

### Bloque 1: Connection Lifecycle (1h)

#### T4.4.1: Connection Tests
- [ ] Crear archivo `backend/src/__tests__/e2e/websocket/connection.ws.test.ts`
- [ ] Implementar `createAuthenticatedSocket()` helper - crea socket con session cookie valida
- [ ] Implementar `createUnauthenticatedSocket()` helper - crea socket sin auth
- [ ] Test: Connect con session valida retorna connected=true
- [ ] Test: Connect sin session es rechazado (connected=false o disconnect event)
- [ ] Test: Disconnect limpio - validar que server hace cleanup

**Criterio de Aceptacion**:
- Helper reutilizable para otros tests
- Validar autenticacion via session cookie
- Validar cleanup en server (no memory leaks)

**Archivos a Crear**:
- `backend/src/__tests__/e2e/websocket/connection.ws.test.ts`
- `backend/src/__tests__/e2e/helpers/socketHelpers.ts` (helpers reutilizables)

---

### Bloque 2: Session Room Management (2h)

#### T4.4.2: Join/Leave Session Room
- [ ] Crear archivo `backend/src/__tests__/e2e/websocket/session-rooms.ws.test.ts`
- [ ] Test: Emit `session:join` con sessionId valido retorna ack success
- [ ] Test: Emit `session:join` con sessionId invalido retorna ack error
- [ ] Test: Emit `session:leave` retorna ack success
- [ ] Test: Despues de leave, eventos de session ya no llegan

**Criterio de Aceptacion**:
- Validar que join agrega socket a room correcto
- Validar que leave remueve socket de room
- Validar ack responses contienen success flag

**Archivos a Crear**:
- `backend/src/__tests__/e2e/websocket/session-rooms.ws.test.ts`

---

#### T4.4.3: Session Ready Signal
- [ ] Test: Despues de `session:join`, socket recibe evento `session:ready`
- [ ] Test: `session:ready` contiene `{ sessionId, userId }`

**Criterio de Aceptacion**:
- Validar que evento se emite inmediatamente despues de join
- Validar payload correcto

**Archivos a Editar**:
- `backend/src/__tests__/e2e/websocket/session-rooms.ws.test.ts`

---

#### T4.4.4: Session Isolation
- [ ] Test: Crear 2 sockets en diferentes sessions
- [ ] Test: Emit mensaje en session A
- [ ] Test: Socket en session B NO recibe eventos de session A
- [ ] Test: Socket en session A SI recibe sus propios eventos

**Criterio de Aceptacion**:
- Validar aislamiento completo entre sessions
- Validar que room logic funciona correctamente

**Archivos a Editar**:
- `backend/src/__tests__/e2e/websocket/session-rooms.ws.test.ts`

---

### Bloque 3: Agent Events (4h)

#### T4.4.5: Basic Message Events
- [ ] Crear archivo `backend/src/__tests__/e2e/websocket/events.ws.test.ts`
- [ ] Configurar FakeAnthropicClient con GoldenResponses.createSimpleTextResponse()
- [ ] Test: Emit `chat:message` → recibir `user_message_sent` con sequenceNumber
- [ ] Test: Recibir multiples `message_chunk` events con content deltas
- [ ] Test: Recibir `message` event final con content completo
- [ ] Test: Recibir `complete` event con stop_reason

**Criterio de Aceptacion**:
- Validar orden correcto: user_message_sent → message_chunk* → message → complete
- Validar structure de cada event type
- Validar que content acumulado = content final

**Archivos a Crear**:
- `backend/src/__tests__/e2e/websocket/events.ws.test.ts`

**Referencia**:
- `docs/plans/phase-2.5/golden-snapshots.md` - Flow 1: Simple Message

---

#### T4.4.6: Extended Thinking Events
- [ ] Configurar FakeAnthropicClient con GoldenResponses.createExtendedThinkingResponse()
- [ ] Test: Emit `chat:message` con thinking enabled
- [ ] Test: Recibir `thinking_chunk*` events ANTES de `message_chunk*`
- [ ] Test: Recibir `thinking_complete` event (transicion)
- [ ] Test: Recibir `thinking` event final con content completo y sequenceNumber
- [ ] Test: Recibir `message_chunk*` y `message` despues de thinking

**Criterio de Aceptacion**:
- Validar orden: user_message_sent → thinking_chunk* → thinking_complete → thinking → message_chunk* → message → complete
- Validar que thinking content es separado de message content

**Archivos a Editar**:
- `backend/src/__tests__/e2e/websocket/events.ws.test.ts`

**Referencia**:
- `docs/plans/phase-2.5/golden-snapshots.md` - Flow 2: Extended Thinking

---

#### T4.4.7: Tool Use Events
- [ ] Configurar FakeAnthropicClient con GoldenResponses.createToolUseResponse()
- [ ] Test: Emit `chat:message` que trigger tool use
- [ ] Test: Recibir `message` con stopReason='tool_use'
- [ ] Test: Recibir `tool_use` event con toolUseId, toolName, args
- [ ] Test: Recibir `tool_result` event con toolUseId, result, success=true
- [ ] Test: Recibir `message_chunk*` y `message` con respuesta post-tool
- [ ] Test: Recibir `complete` con stop_reason='end_turn'

**Criterio de Aceptacion**:
- Validar orden: message(tool_use) → tool_use → tool_result → message_chunk* → message → complete
- Validar que toolUseId coincide entre tool_use y tool_result

**Archivos a Editar**:
- `backend/src/__tests__/e2e/websocket/events.ws.test.ts`

**Referencia**:
- `docs/plans/phase-2.5/golden-snapshots.md` - Flow 3: Tool Use

---

#### T4.4.8: Approval Flow Events
- [ ] Configurar FakeAnthropicClient con GoldenResponses.createApprovalFlowResponse()
- [ ] Test: Emit `chat:message` que trigger tool con approval
- [ ] Test: Recibir `tool_use` event
- [ ] Test: Recibir `approval_requested` event con approvalId, description
- [ ] Test: Emit `approval:respond` con approvalId y approved=true
- [ ] Test: Recibir `approval_resolved` event con approved=true
- [ ] Test: Recibir `tool_result` event despues de approval
- [ ] Test: Recibir `message` y `complete` final

**Criterio de Aceptacion**:
- Validar orden: tool_use → approval_requested → [wait] → approval_resolved → tool_result → message → complete
- Validar que approvalId coincide entre approval_requested y approval_resolved
- Validar que tool_result contiene resultado correcto segun approval

**Archivos a Editar**:
- `backend/src/__tests__/e2e/websocket/events.ws.test.ts`

**Referencia**:
- `docs/plans/phase-2.5/golden-snapshots.md` - Flow 4: Approval Flow

---

#### T4.4.9: Error Events
- [ ] Configurar FakeAnthropicClient con GoldenResponses.createErrorResponse()
- [ ] Test: Emit `chat:message` que trigger error
- [ ] Test: Recibir `error` event con error message, code
- [ ] Test: Validar que error se persiste en DB (eventType='error')

**Criterio de Aceptacion**:
- Validar structure de error event
- Validar que error no crash el WebSocket connection
- Validar persistence

**Archivos a Editar**:
- `backend/src/__tests__/e2e/websocket/events.ws.test.ts`

**Referencia**:
- `docs/plans/phase-2.5/golden-snapshots.md` - Flow 6: Error Handling

---

### Bloque 4: Multi-Client Broadcast (1.5h)

#### T4.4.10: Multi-Client in Same Session
- [ ] Test: Crear 2 sockets autenticados (mismo usuario o diferentes)
- [ ] Test: Ambos join mismo sessionId
- [ ] Test: Emit `chat:message` desde socket1
- [ ] Test: Ambos sockets reciben todos los `agent:event` events
- [ ] Test: Validar que events son identicos (mismo content, sequenceNumbers)

**Criterio de Aceptacion**:
- Validar broadcast a todos los clientes en room
- Validar que no hay duplicacion de eventos
- Validar que order es consistente para ambos clientes

**Archivos a Editar**:
- `backend/src/__tests__/e2e/websocket/session-rooms.ws.test.ts`

---

### Bloque 5: Error Handling (1.5h)

#### T4.4.11: Malformed Payloads
- [ ] Crear archivo `backend/src/__tests__/e2e/websocket/error-handling.ws.test.ts`
- [ ] Test: Emit `chat:message` sin sessionId → recibir error response
- [ ] Test: Emit `chat:message` sin message → recibir error response
- [ ] Test: Emit evento no reconocido → no crash, posible ignore

**Criterio de Aceptacion**:
- Validar que server no crash con payloads invalidos
- Validar error responses son descriptivos

**Archivos a Crear**:
- `backend/src/__tests__/e2e/websocket/error-handling.ws.test.ts`

---

#### T4.4.12: Unauthorized Access
- [ ] Test: Socket A intenta join session de Usuario B (no owner) → recibir error ack
- [ ] Test: Socket sin auth intenta emit `chat:message` → disconnect o error
- [ ] Test: Session no existe → recibir error ack

**Criterio de Aceptacion**:
- Validar authorization checks en server
- Validar que unauthorized actions no permiten leak de datos

**Archivos a Editar**:
- `backend/src/__tests__/e2e/websocket/error-handling.ws.test.ts`

---

## Comandos Utiles

```bash
# Ejecutar todos los tests de esta fase
cd backend && npm run test:e2e -- connection.ws session-rooms.ws events.ws error-handling.ws

# Ejecutar por archivo
cd backend && npm run test:e2e -- connection.ws
cd backend && npm run test:e2e -- session-rooms.ws
cd backend && npm run test:e2e -- events.ws
cd backend && npm run test:e2e -- error-handling.ws

# Debug con logs
cd backend && LOG_LEVEL=debug npm run test:e2e -- events.ws
```

---

## Criterios de Aceptacion de la Fase

Esta fase se considera COMPLETADA cuando:

1. [ ] Todos los ~20 tests implementados y pasando
2. [ ] Connection lifecycle validado (connect, auth, disconnect)
3. [ ] Session room management validado (join, leave, isolation)
4. [ ] Todos los 12+ agent event types validados
5. [ ] Multi-client broadcast validado
6. [ ] Error handling validado (malformed, unauthorized)
7. [ ] HTML report generado sin errores
8. [ ] Todas las tareas marcadas como completadas

---

*Ultima actualizacion: 2025-12-17*
