# Fase 4.5: Golden Flows Validation

## Informacion de la Fase

| Campo | Valor |
|-------|-------|
| **Fase** | 4.5 |
| **Nombre** | Golden Flows Validation |
| **Estado** | Alta prioridad |
| **Prerequisitos** | Fase 4.2 (Core APIs) y Fase 4.4 (WebSocket) completadas |
| **Fase Siguiente** | Fase 4.6 (CI/CD) |

---

## Objetivo Principal

Validar exhaustivamente que los 5 flujos dorados documentados en Phase 2.5 funcionan end-to-end en el sistema actual. Estos tests integran API + WebSocket + Agent en scenarios completos, garantizando que el comportamiento actual coincide con la documentacion baseline.

---

## Success Criteria

### SC-1: Simple Message Flow Validated
- [ ] Test E2E completo: user message → streaming → final message → complete
- [ ] Validar secuencia de eventos coincide con `docs/plans/phase-2.5/golden-snapshots.md` Flow 1
- [ ] Validar persistence: message se guarda en DB con sequenceNumber correcto
- [ ] Validar WebSocket: todos los eventos llegan en orden correcto

### SC-2: Extended Thinking Flow Validated
- [ ] Test E2E completo: user message → thinking streaming → thinking complete → text streaming → complete
- [ ] Validar secuencia coincide con Flow 2
- [ ] Validar thinking content separado de message content
- [ ] Validar thinking_complete se emite ANTES de primer message_chunk

### SC-3: Tool Execution Flow Validated
- [ ] Test E2E completo: user message → tool_use → tool execution → tool_result → response → complete
- [ ] Validar secuencia coincide con Flow 3
- [ ] Validar que toolUseId es consistente entre tool_use y tool_result
- [ ] Validar que tool execution se ejecuta correctamente (mockear BC API)

### SC-4: Approval Flow Validated
- [ ] Test E2E completo: user message → tool_use → approval_requested → user approves → tool_result → complete
- [ ] Validar secuencia coincide con Flow 4
- [ ] Validar que approval flow pausa execution hasta user response
- [ ] Validar que approvalId es consistente

### SC-5: Error Handling Flow Validated
- [ ] Test E2E completo: user message → error → error event → persistence
- [ ] Validar secuencia coincide con Flow 6
- [ ] Validar que error no deja estado inconsistente
- [ ] Validar que error se persiste correctamente

---

## Filosofia de Esta Fase

### Principio: "Validate Against Golden Baseline"

Los golden flows documentados en Phase 2.5 son la "ground truth" del comportamiento actual del sistema. Estos tests E2E deben validar que el sistema REALMENTE funciona como documentamos.

### Enfoque de Validation

1. **Secuencia Completa**: Test desde API call hasta DB persistence
2. **Event Order**: Validar orden exacto contra golden snapshots
3. **Invariants**: Validar los 8 invariantes documentados en `api-contract.md`
4. **No Regressions**: Si estos tests pasan, el sistema funciona como Phase 2.5 documentó

---

## Entregables de Esta Fase

### E-1: Golden Flows Test Suite
```
backend/src/__tests__/e2e/golden-flows/golden-flows.e2e.test.ts
```
Test suite con 5 flows completos, cada uno validando:
- API request/response
- WebSocket event sequence
- Database persistence
- Event order y invariants

---

## Estructura de Tests

### Flow 1: Simple Message (~100 lineas)

```typescript
describe('Golden Flow 1: Simple Message', () => {
  it('executes complete simple message flow', async () => {
    // Setup
    const { socket, sessionId, userId } = await setupAuthenticatedSession();
    const events = [];
    socket.on('agent:event', (e) => events.push(e));

    // Configure golden response
    configureGoldenResponse(fakeClient, 'simple-text');

    // Execute
    socket.emit('chat:message', {
      sessionId,
      message: 'Hello, Claude!'
    });

    // Wait for completion
    await waitForEvent(socket, 'agent:event', (e) => e.type === 'complete');

    // Validate event sequence
    expect(events[0].type).toBe('user_message_sent');
    expect(events.filter(e => e.type === 'message_chunk').length).toBeGreaterThan(0);
    expect(events[events.length - 2].type).toBe('message');
    expect(events[events.length - 1].type).toBe('complete');

    // Validate persistence
    const messages = await db.getMessages(sessionId);
    expect(messages).toHaveLength(2); // User + Assistant
    expect(messages[1].sequenceNumber).toBeDefined();

    // Validate against golden snapshot
    validateAgainstGoldenFlow(events, 'Flow1_SimpleMessage');
  });
});
```

### Flow 2: Extended Thinking (~150 lineas)

Similar structure but validates:
- `thinking_chunk*` events BEFORE `message_chunk*`
- `thinking_complete` transition event
- `thinking` final persisted event
- Thinking content separated from message content

### Flow 3: Tool Execution (~200 lineas)

Validates:
- `tool_use` event with toolName, args
- Tool execution (mockear BC API)
- `tool_result` event with result
- Post-tool message
- toolUseId consistency

### Flow 4: Approval Flow (~250 lineas)

Validates:
- `approval_requested` event
- Pause in execution (async wait)
- User response via `approval:respond`
- `approval_resolved` event
- Tool execution post-approval
- approvalId consistency

### Flow 5: Error Handling (~150 lineas)

Validates:
- `error` event emission
- Error persistence in DB
- No incomplete state left
- Connection still valid after error

---

## Tareas

Ver `TODO.md` para el listado completo de tareas (5 flows = 5 tareas principales).

---

## Dependencias

### De Fases Anteriores
- Fase 4.1: `GoldenResponses.ts` - Pre-configured responses
- Fase 4.2: API test helpers
- Fase 4.4: WebSocket test helpers

### De Documentacion
- `docs/plans/phase-2.5/golden-snapshots.md` - Secuencias esperadas
- `docs/plans/phase-2.5/api-contract.md` - Invariantes a validar

### Tecnicas
- `supertest` + `socket.io-client` - Integracion completa
- `waitForEvent()` helper - Async event validation
- DB queries - Validar persistence

---

## Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigacion |
|--------|--------------|---------|------------|
| Golden snapshots desactualizados | Media | Alto | Comparar contra codigo actual |
| Timeouts en flows complejos | Media | Medio | Timeouts generosos (10s+) |
| BC API mocks incorrectos | Baja | Medio | Derivar de integracion actual |

---

## Tiempo Estimado

| Flow | Estimado |
|------|----------|
| Flow 1: Simple Message | 1.5h |
| Flow 2: Extended Thinking | 2h |
| Flow 3: Tool Execution | 2.5h |
| Flow 4: Approval Flow | 3h |
| Flow 5: Error Handling | 1.5h |
| Validation helpers | 1.5h |
| **TOTAL** | **12h** |

---

*Ultima actualizacion: 2025-12-17*
