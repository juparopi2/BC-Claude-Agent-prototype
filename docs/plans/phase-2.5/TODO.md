# TODO - Fase 2.5: Pre-Refactor Stabilization

## Informacion de Tracking

| Campo | Valor |
|-------|-------|
| **Fase** | 2.5 |
| **Inicio** | 2025-12-17 |
| **Fin** | 2025-12-17 |
| **Estado** | COMPLETADA |

---

## Tareas

### Bloque 1: Integration Test Inventory (2h)

- [x] **T2.5.1** Listar todos los archivos de integration tests de DirectAgentService
  - `DirectAgentService.integration.test.ts` - 378 lineas, 4 tests
  - `DirectAgentService.attachments.integration.test.ts` - 489 lineas, 13 tests
  - `orchestrator.integration.test.ts` - 743 lineas, 18 tests
  - `thinking-state-transitions.integration.test.ts` - 493 lineas, 10 tests
  - `approval-lifecycle.integration.test.ts` - 434 lineas, 6 tests

- [x] **T2.5.2** Documentar cobertura por archivo
  - Documentado en `integration-test-inventory.md`
  - Incluye flujos, eventos, edge cases por cada archivo

- [x] **T2.5.3** Identificar gaps
  - Semantic search auto-context no cubierto
  - Approval flow en DirectAgentService (solo en approval-lifecycle)
  - Image Vision API verification
  - Citation parsing logic

### Bloque 2: Golden Behavior Snapshots (3h)

- [x] **T2.5.4** Capturar eventos de "simple message"
  ```
  user_message_sent -> message_chunk* -> message -> complete
  ```
  Documentado en `golden-snapshots.md` Flow 1

- [x] **T2.5.5** Capturar eventos de "thinking + message"
  ```
  user_message_sent -> thinking_chunk* -> thinking_complete -> message_chunk* -> thinking -> message -> complete
  ```
  Documentado en `golden-snapshots.md` Flow 2

- [x] **T2.5.6** Capturar eventos de "tool use flow"
  ```
  user_message_sent -> message_chunk* -> message(tool_use) -> tool_use -> tool_result -> message_chunk* -> message -> complete
  ```
  Documentado en `golden-snapshots.md` Flow 3

- [x] **T2.5.7** Capturar eventos de "approval flow"
  ```
  user_message_sent -> message -> tool_use -> approval_requested -> [wait] -> approval_resolved -> tool_result -> message -> complete
  ```
  Documentado en `golden-snapshots.md` Flow 4

### Bloque 3: API Contract Documentation (2h)

- [x] **T2.5.8** Documentar `runGraph()` signature
  ```typescript
  runGraph(
    prompt: string,
    sessionId: string,
    onEvent?: (event: AgentEvent) => void,
    userId?: string,
    options?: ExecuteStreamingOptions
  ): Promise<AgentExecutionResult>
  ```
  Documentado en `api-contract.md` Section 1

- [x] **T2.5.9** Documentar cada event type
  | Event | Payload | Cuando |
  |-------|---------|--------|
  | session_start | sessionId | Inicio |
  | thinking_chunk | content, blockIndex | Streaming thinking |
  | thinking_complete | content, blockIndex | Transition signal |
  | thinking | content, messageId, sequenceNumber | Final thinking |
  | message_chunk | content, blockIndex | Streaming text |
  | message | content, messageId, sequenceNumber, stopReason | Mensaje final |
  | tool_use | toolUseId, toolName, args | Tool request |
  | tool_result | toolUseId, toolName, result, success | Tool response |
  | approval_requested | approvalId, toolName, description | Needs approval |
  | approval_resolved | approvalId, approved | User responded |
  | complete | reason | Fin de request |
  | error | error, code | Error |

  Documentado en `api-contract.md` Section 2

- [x] **T2.5.10** Documentar orden garantizado
  - `user_message_sent` SIEMPRE primero
  - `thinking_chunk*` ANTES de `message_chunk*`
  - `tool_use` ANTES de `tool_result`
  - `complete` o `error` SIEMPRE ultimo

  Documentado en `api-contract.md` Section 3

### Bloque 4: Pre-Refactor Checklist (1h)

- [x] **T2.5.11** Crear checklist de "must not break"
  - Event ordering invariants
  - Persistence guarantees (sequenceNumber)
  - WebSocket emission contract
  - Error propagation

  Documentado en `pre-refactor-checklist.md`

- [x] **T2.5.12** Identificar dependencias en ChatMessageHandler
  - Eventos esperados documentados
  - Transformaciones documentadas
  - Fallback logic documentado

  Documentado en `api-contract.md` Section 4.1

- [x] **T2.5.13** Identificar dependencias en WebSocket handlers
  - Events emitidos via `agent:event`
  - Format esperado por frontend
  - Room-based emission

  Documentado en `api-contract.md` Section 4.2

---

## Comandos Utiles

```bash
# Ejecutar integration tests especificos
cd backend && npm test -- thinking-state-transitions

# Ejecutar todos los integration tests de agent
npm test -- DirectAgentService.integration orchestrator.integration

# Ver output detallado de un test
npm test -- --reporter=verbose thinking-state-transitions

# Ejecutar todos los tests
npm test
```

---

## Criterios de Aceptacion

### Esta fase se considera COMPLETADA cuando:

1. [x] `integration-test-inventory.md` creado con cobertura documentada
2. [x] `golden-snapshots.md` creado con secuencias de eventos
3. [x] `api-contract.md` creado con API documentada
4. [x] `pre-refactor-checklist.md` creado para Fase 5
5. [x] Tiempo total < 8 horas (timeboxed) - Completado en ~2 horas

---

## Notas de Ejecucion

### Bloqueadores Encontrados

Ninguno.

### Decisiones Tomadas

1. **runGraph vs executeQueryStreaming**: Documentamos `runGraph()` ya que `executeQueryStreaming` fue deprecado en Phase 1. Todos los tests usan `runGraph()`.

2. **Approval flow documentation**: Incluimos el approval flow aunque no esta directamente integrado con DirectAgentService tests. Esta cubierto por `approval-lifecycle.integration.test.ts`.

3. **51 tests totales**: Contamos 51 integration tests relevantes para DirectAgentService y agent functionality.

4. **Coverage gaps documentados**: Identificamos 5 gaps que no bloquean pero deben considerarse en Fase 5.

---

## Entregables Creados

| Archivo | Lineas | Descripcion |
|---------|--------|-------------|
| `integration-test-inventory.md` | ~250 | Inventario de 51 tests con cobertura |
| `golden-snapshots.md` | ~300 | 6 flows con secuencias de eventos |
| `api-contract.md` | ~350 | API contract completo |
| `pre-refactor-checklist.md` | ~250 | Checklist para Fase 5 |

---

*Ultima actualizacion: 2025-12-17*
