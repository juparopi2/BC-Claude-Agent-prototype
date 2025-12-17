# Fase 4.4: WebSocket Tests

## Informacion de la Fase

| Campo | Valor |
|-------|-------|
| **Fase** | 4.4 |
| **Nombre** | WebSocket Tests |
| **Estado** | Alta prioridad |
| **Prerequisitos** | Fase 4.1 completada |
| **Fase Siguiente** | Fase 4.5 (Golden Flows Validation) |

---

## Objetivo Principal

Crear tests E2E exhaustivos para la integracion WebSocket (Socket.IO): connection lifecycle, room management, event emission, y manejo de errores. WebSocket es el canal primario de comunicacion en tiempo real con el frontend.

---

## Success Criteria

### SC-1: Connection Lifecycle (2 tests)
- [ ] Connect con session valida (autenticado)
- [ ] Connect sin session (no autenticado) - rechazado
- [ ] Disconnect limpio (cleanup de rooms)

### SC-2: Session Room Management (3 tests)
- [ ] Join session room - usuario se une a room de session
- [ ] Leave session room - usuario sale de room
- [ ] Session isolation - eventos solo llegan a usuarios en room

### SC-3: Session Ready Signal (1 test)
- [ ] `session:ready` event - emitido cuando usuario se une

### SC-4: Agent Events (12+ tests)
- [ ] `user_message_sent` - Confirmacion de mensaje usuario
- [ ] `message_chunk` - Streaming de texto
- [ ] `message` - Mensaje completo de Claude
- [ ] `thinking_chunk` - Streaming de thinking
- [ ] `thinking_complete` - Transicion thinking→text
- [ ] `thinking` - Thinking completo persisted
- [ ] `tool_use` - Claude solicita tool execution
- [ ] `tool_result` - Resultado de tool execution
- [ ] `approval_requested` - Tool requiere aprobacion
- [ ] `approval_resolved` - Usuario respondio a approval
- [ ] `complete` - Agent termino (stop_reason)
- [ ] `error` - Error durante execution

### SC-5: Multi-Client Broadcast (2 tests)
- [ ] Multiples clientes en mismo session - todos reciben eventos
- [ ] Cliente en diferente session - NO recibe eventos

### SC-6: Error Handling (3 tests)
- [ ] Malformed payload - error response
- [ ] Invalid sessionId - error response
- [ ] Unauthorized access - disconnect o error

---

## Filosofia de Esta Fase

### Principio: "Real-Time is Mission-Critical"

WebSocket es el corazon de la experiencia del usuario. Eventos perdidos, duplicados, o fuera de orden destruyen la UX. Los tests deben ser exhaustivos.

### Enfoque de Test Design

1. **Connection State**: Validar lifecycle completo (connect → join → events → leave → disconnect)
2. **Event Order**: Validar que eventos llegan en orden correcto
3. **Broadcast Isolation**: Validar que solo usuarios autorizados reciben eventos
4. **Error Resilience**: Validar manejo de errores sin crash

---

## Entregables de Esta Fase

### E-1: Connection Tests
```
backend/src/__tests__/e2e/websocket/connection.ws.test.ts
```
Tests para:
- Connect autenticado vs no autenticado
- Disconnect y cleanup

### E-2: Session Room Tests
```
backend/src/__tests__/e2e/websocket/session-rooms.ws.test.ts
```
Tests para:
- Join/leave session rooms
- Session isolation
- Multi-client broadcast

### E-3: Agent Events Tests
```
backend/src/__tests__/e2e/websocket/events.ws.test.ts
```
Tests para:
- Todos los tipos de `agent:event` (12+ tipos)
- Order validation
- Persistence correlation

### E-4: Error Handling Tests
```
backend/src/__tests__/e2e/websocket/error-handling.ws.test.ts
```
Tests para:
- Malformed payloads
- Invalid session access
- Error recovery

---

## Estructura de Tests

### Connection Tests (~150 lineas)

```typescript
describe('WebSocket Connection', () => {
  it('connects with valid session cookie', async () => {
    const socket = await createAuthenticatedSocket();
    expect(socket.connected).toBe(true);
  });

  it('rejects connection without auth', async () => {
    const socket = await createUnauthenticatedSocket();
    expect(socket.connected).toBe(false);
  });

  it('cleans up on disconnect', async () => {
    const socket = await createAuthenticatedSocket();
    await socket.disconnect();
    // Validar cleanup en server side
  });
});
```

### Session Room Tests (~200 lineas)

```typescript
describe('Session Room Management', () => {
  it('joins session room successfully', async () => {
    const socket = await createAuthenticatedSocket();
    const ack = await socket.emitWithAck('session:join', { sessionId });
    expect(ack.success).toBe(true);
  });

  it('isolates events between sessions', async () => {
    const socket1 = await createAuthenticatedSocket();
    const socket2 = await createAuthenticatedSocket();

    await socket1.emitWithAck('session:join', { sessionId: 'session-1' });
    await socket2.emitWithAck('session:join', { sessionId: 'session-2' });

    const events1 = [];
    socket1.on('agent:event', (e) => events1.push(e));

    // Emit en session-2, socket1 NO debe recibir
    await socket2.emit('chat:message', { sessionId: 'session-2', message: 'test' });

    await wait(500);
    expect(events1).toHaveLength(0);
  });

  it('broadcasts to all clients in same session', async () => {
    const socket1 = await createAuthenticatedSocket();
    const socket2 = await createAuthenticatedSocket();

    await socket1.emitWithAck('session:join', { sessionId });
    await socket2.emitWithAck('session:join', { sessionId });

    const events1 = [];
    const events2 = [];
    socket1.on('agent:event', (e) => events1.push(e));
    socket2.on('agent:event', (e) => events2.push(e));

    await socket1.emit('chat:message', { sessionId, message: 'test' });

    await wait(1000);
    expect(events1.length).toBeGreaterThan(0);
    expect(events2.length).toBeGreaterThan(0);
  });
});
```

### Agent Events Tests (~400 lineas)

```typescript
describe('Agent Events', () => {
  it('emits user_message_sent confirmation', async () => { ... });
  it('emits message_chunk events during streaming', async () => { ... });
  it('emits message event with full content', async () => { ... });
  it('emits thinking events in correct order', async () => { ... });
  it('emits tool_use and tool_result', async () => { ... });
  it('emits approval_requested and approval_resolved', async () => { ... });
  it('emits complete event with stop_reason', async () => { ... });
  it('emits error event on failure', async () => { ... });
});
```

---

## Tareas

Ver `TODO.md` para el listado completo de tareas (6 areas = ~20 tests).

---

## Dependencias

### De Fase 4.1
- `GoldenResponses.ts` - Para respuestas predecibles en tests
- `TestDataFactory.ts` - Para sessions de test
- `setup.e2e.ts` - Test environment

### Tecnicas
- `socket.io-client` - Cliente Socket.IO para tests
- Vitest - Test runner con async support
- Cookie handling - Para autenticacion en Socket.IO

---

## Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigacion |
|--------|--------------|---------|------------|
| Race conditions en broadcasts | Media | Alto | Usar waitForEvent helpers con timeouts |
| Cleanup incompleto entre tests | Media | Alto | afterEach con disconnect forzado |
| Eventos duplicados | Baja | Medio | Validar deduplicacion con IDs |

---

## Tiempo Estimado

| Bloque | Estimado |
|--------|----------|
| Connection tests | 1h |
| Session room tests | 2h |
| Agent events tests | 4h |
| Error handling tests | 1.5h |
| Multi-client tests | 1.5h |
| **TOTAL** | **10h** |

---

*Ultima actualizacion: 2025-12-17*
