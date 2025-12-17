# TODO - Fase 4.5: Golden Flows Validation

## Informacion de Tracking

| Campo | Valor |
|-------|-------|
| **Fase** | 4.5 |
| **Estado** | PENDIENTE |
| **Dependencias** | Fase 4.2 y Fase 4.4 completadas |

---

## Tareas

### Preparation Task

#### T4.5.0: Create Test Helpers
- [ ] Crear archivo `backend/src/__tests__/e2e/helpers/goldenFlowHelpers.ts`
- [ ] Implementar `setupAuthenticatedSession()`: Crea usuario, sesion, socket autenticado
- [ ] Implementar `waitForEvent(socket, eventName, predicate, timeout)`: Async wait for specific event
- [ ] Implementar `captureEvents(socket, eventName)`: Captura todos los eventos en array
- [ ] Implementar `validateAgainstGoldenFlow(events, flowName)`: Compara secuencia contra golden snapshot
- [ ] Implementar `queryDBMessages(sessionId)`: Helper para query DB directa

**Criterio de Aceptacion**:
- Helpers reutilizables para todos los flows
- Timeouts configurables
- Error messages claros en validaciones

**Archivos a Crear**:
- `backend/src/__tests__/e2e/helpers/goldenFlowHelpers.ts`

---

### Bloque 1: Flow Tests (12h)

#### T4.5.1: Flow 1 - Simple Message Flow
- [ ] Crear archivo `backend/src/__tests__/e2e/golden-flows/golden-flows.e2e.test.ts`
- [ ] Setup: Usuario autenticado, sesion creada, socket conectado
- [ ] Setup: Configure FakeAnthropicClient con `GoldenResponses.createSimpleTextResponse()`
- [ ] Execute: Emit `chat:message` con mensaje simple
- [ ] Capture: Capturar todos los `agent:event` events
- [ ] Validate: Orden de eventos coincide con Flow 1 en `golden-snapshots.md`:
  ```
  user_message_sent → message_chunk* → message → complete
  ```
- [ ] Validate: `user_message_sent` contiene sequenceNumber
- [ ] Validate: `message_chunk*` events contienen content deltas
- [ ] Validate: `message` event contiene content completo, sequenceNumber, stopReason
- [ ] Validate: `complete` event contiene stop_reason='end_turn'
- [ ] Validate: DB persistence - 2 mensajes (user + assistant) con sequenceNumbers correctos
- [ ] Validate: Invariant 1 - sequenceNumbers son monotonicos
- [ ] Validate: Invariant 2 - No eventos duplicados (mismo sequenceNumber)

**Criterio de Aceptacion**:
- Test pasa consistentemente
- Valida TODA la secuencia documentada
- Valida invariantes criticos
- Valida persistence en DB

**Archivos a Crear**:
- `backend/src/__tests__/e2e/golden-flows/golden-flows.e2e.test.ts`

**Referencia**:
- `docs/plans/phase-2.5/golden-snapshots.md` - Flow 1: Simple Message
- `docs/plans/phase-2.5/api-contract.md` - Invariantes

**Tiempo**: 1.5h

---

#### T4.5.2: Flow 2 - Extended Thinking Flow
- [ ] Setup: Similar a Flow 1
- [ ] Setup: Configure FakeAnthropicClient con `GoldenResponses.createExtendedThinkingResponse()`
- [ ] Execute: Emit `chat:message` con thinking enabled
- [ ] Capture: Capturar todos los eventos
- [ ] Validate: Orden coincide con Flow 2:
  ```
  user_message_sent → thinking_chunk* → thinking_complete → thinking → message_chunk* → message → complete
  ```
- [ ] Validate: `thinking_chunk*` llegan ANTES de `message_chunk*`
- [ ] Validate: `thinking_complete` se emite como transicion (blockIndex correcto)
- [ ] Validate: `thinking` event final con content completo, sequenceNumber
- [ ] Validate: `message` event con content SEPARADO de thinking
- [ ] Validate: DB persistence - 3 registros (user + thinking + assistant)
- [ ] Validate: Invariant 3 - thinking_complete SIEMPRE antes de primer message_chunk
- [ ] Validate: Invariant 4 - blockIndex thinking < blockIndex message

**Criterio de Aceptacion**:
- Valida separacion thinking vs message
- Valida transicion thinking_complete
- Valida persistence de thinking como registro separado

**Archivos a Editar**:
- `backend/src/__tests__/e2e/golden-flows/golden-flows.e2e.test.ts`

**Referencia**:
- `docs/plans/phase-2.5/golden-snapshots.md` - Flow 2: Extended Thinking

**Tiempo**: 2h

---

#### T4.5.3: Flow 3 - Tool Execution Flow
- [ ] Setup: Similar a flows anteriores
- [ ] Setup: Configure FakeAnthropicClient con `GoldenResponses.createToolUseResponse()`
- [ ] Setup: Mockear BC API response (ej: getSalesOrders retorna array de orders)
- [ ] Execute: Emit `chat:message` que trigger tool use
- [ ] Capture: Capturar todos los eventos
- [ ] Validate: Orden coincide con Flow 3:
  ```
  user_message_sent → message_chunk* → message(stopReason='tool_use') → tool_use → tool_result → message_chunk* → message → complete
  ```
- [ ] Validate: `message` inicial con stopReason='tool_use'
- [ ] Validate: `tool_use` event contiene toolUseId, toolName, args
- [ ] Validate: Tool execution se ejecuta (verificar mock fue llamado)
- [ ] Validate: `tool_result` event contiene toolUseId (mismo que tool_use), result, success=true
- [ ] Validate: `message` final contiene respuesta usando tool result
- [ ] Validate: DB persistence - tool_use y tool_result persistidos
- [ ] Validate: Invariant 5 - toolUseId consistente entre tool_use y tool_result
- [ ] Validate: Invariant 6 - tool_result SIEMPRE despues de tool_use (por toolUseId)

**Criterio de Aceptacion**:
- Valida tool execution completo
- Valida consistency de toolUseId
- Valida que tool result se usa en respuesta

**Archivos a Editar**:
- `backend/src/__tests__/e2e/golden-flows/golden-flows.e2e.test.ts`

**Referencia**:
- `docs/plans/phase-2.5/golden-snapshots.md` - Flow 3: Tool Use

**Tiempo**: 2.5h

---

#### T4.5.4: Flow 4 - Approval Flow
- [ ] Setup: Similar a flows anteriores
- [ ] Setup: Configure FakeAnthropicClient con `GoldenResponses.createApprovalFlowResponse()`
- [ ] Setup: Tool que requiere approval (ej: createCustomer)
- [ ] Execute: Emit `chat:message` que trigger tool con approval
- [ ] Capture: Capturar eventos hasta approval_requested
- [ ] Validate: `approval_requested` event contiene approvalId, toolName, description, args
- [ ] Validate: Execution PAUSA (no tool_result inmediato)
- [ ] Execute: Emit `approval:respond` con approvalId y approved=true
- [ ] Capture: Capturar eventos post-approval
- [ ] Validate: Orden completo coincide con Flow 4:
  ```
  user_message_sent → message → tool_use → approval_requested → [PAUSE] → approval_resolved → tool_result → message_chunk* → message → complete
  ```
- [ ] Validate: `approval_resolved` event contiene approvalId (mismo), approved=true
- [ ] Validate: `tool_result` llega DESPUES de approval_resolved
- [ ] Validate: DB persistence - approval record creado con status='approved'
- [ ] Validate: Invariant 7 - approvalId consistente entre approval_requested y approval_resolved
- [ ] Validate: Invariant 8 - tool_result SIEMPRE despues de approval_resolved (si approval required)
- [ ] Test adicional: User rechaza approval (approved=false)
- [ ] Validate: tool_result con success=false si rejected

**Criterio de Aceptacion**:
- Valida pause en execution
- Valida approval flow completo
- Valida tanto approve como reject cases

**Archivos a Editar**:
- `backend/src/__tests__/e2e/golden-flows/golden-flows.e2e.test.ts`

**Referencia**:
- `docs/plans/phase-2.5/golden-snapshots.md` - Flow 4: Approval Flow

**Tiempo**: 3h

---

#### T4.5.5: Flow 5 - Error Handling Flow
- [ ] Setup: Similar a flows anteriores
- [ ] Setup: Configure FakeAnthropicClient con `GoldenResponses.createErrorResponse()` (ej: rate limit error)
- [ ] Execute: Emit `chat:message` que trigger error
- [ ] Capture: Capturar eventos
- [ ] Validate: Orden coincide con Flow 6:
  ```
  user_message_sent → error
  ```
- [ ] Validate: `error` event contiene error message, code
- [ ] Validate: DB persistence - error se persiste como event (eventType='error')
- [ ] Validate: No incomplete state - session sigue valida, puede recibir nuevos mensajes
- [ ] Validate: Socket connection sigue activa (no disconnect)
- [ ] Test adicional: Emit nuevo mensaje post-error → funciona correctamente

**Criterio de Aceptacion**:
- Valida error handling graceful
- Valida persistence de error
- Valida que sistema se recupera (no queda en estado inconsistente)

**Archivos a Editar**:
- `backend/src/__tests__/e2e/golden-flows/golden-flows.e2e.test.ts`

**Referencia**:
- `docs/plans/phase-2.5/golden-snapshots.md` - Flow 6: Error Handling

**Tiempo**: 1.5h

---

## Comandos Utiles

```bash
# Ejecutar todos los golden flows tests
cd backend && npm run test:e2e -- golden-flows.e2e

# Ejecutar un flow especifico (por nombre de test)
cd backend && npm run test:e2e -- golden-flows.e2e -t "Simple Message"
cd backend && npm run test:e2e -- golden-flows.e2e -t "Extended Thinking"
cd backend && npm run test:e2e -- golden-flows.e2e -t "Tool Execution"
cd backend && npm run test:e2e -- golden-flows.e2e -t "Approval Flow"
cd backend && npm run test:e2e -- golden-flows.e2e -t "Error Handling"

# Debug con logs verbosos
cd backend && LOG_LEVEL=debug npm run test:e2e -- golden-flows.e2e

# Ver HTML report
open backend/test-results/e2e-report.html
```

---

## Criterios de Aceptacion de la Fase

Esta fase se considera COMPLETADA cuando:

1. [ ] Todos los 5 golden flows implementados y pasando
2. [ ] Cada flow valida secuencia completa de eventos
3. [ ] Cada flow valida persistence en DB
4. [ ] Todos los invariantes documentados validados
5. [ ] Tests demuestran que sistema actual coincide con documentacion Phase 2.5
6. [ ] HTML report generado sin errores
7. [ ] Todas las tareas marcadas como completadas

---

## Notas de Ejecucion

### Bloqueadores Encontrados

(A completar durante ejecucion)

### Decisiones Tomadas

(A completar durante ejecucion)

### Discrepancias con Golden Snapshots

Si se encuentran discrepancias entre comportamiento actual y golden snapshots documentados:

1. Verificar si golden snapshot esta desactualizado
2. Verificar si comportamiento actual es un bug
3. Documentar la discrepancia en esta seccion
4. Decidir: actualizar golden snapshot o fixear bug

---

*Ultima actualizacion: 2025-12-17*
