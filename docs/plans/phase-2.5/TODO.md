# TODO - Fase 2.5: Pre-Refactor Stabilization

## Información de Tracking

| Campo | Valor |
|-------|-------|
| **Fase** | 2.5 |
| **Inicio** | _pendiente_ |
| **Fin Esperado** | _1-2 días máximo_ |
| **Estado** | 🔴 No iniciada |

---

## Tareas

### Bloque 1: Integration Test Inventory (2h)

- [ ] **T2.5.1** Listar todos los archivos de integration tests de DirectAgentService
  - `DirectAgentService.integration.test.ts`
  - `DirectAgentService.attachments.integration.test.ts`
  - `orchestrator.integration.test.ts`
  - `thinking-state-transitions.integration.test.ts`

- [ ] **T2.5.2** Documentar cobertura por archivo
  - Qué flujos cubre cada test
  - Qué eventos valida
  - Qué edge cases maneja

- [ ] **T2.5.3** Identificar gaps
  - Flujos no cubiertos
  - Edge cases faltantes

### Bloque 2: Golden Behavior Snapshots (3h)

- [ ] **T2.5.4** Capturar eventos de "simple message"
  ```
  user_message_sent → message_chunk* → message → complete
  ```

- [ ] **T2.5.5** Capturar eventos de "thinking + message"
  ```
  user_message_sent → thinking_chunk* → thinking → message_chunk* → message → complete
  ```

- [ ] **T2.5.6** Capturar eventos de "tool use flow"
  ```
  user_message_sent → tool_use → tool_result → message_chunk* → message → complete
  ```

- [ ] **T2.5.7** Capturar eventos de "approval flow"
  ```
  user_message_sent → tool_use → approval_requested → [wait] → approval_resolved → tool_result → message → complete
  ```

### Bloque 3: API Contract Documentation (2h)

- [ ] **T2.5.8** Documentar `executeQueryStreaming()` signature
  ```typescript
  executeQueryStreaming(
    query: string,
    sessionId: string,
    onEvent: (event: AgentEvent) => void,
    userId: string,
    options?: ExecuteOptions
  ): Promise<ExecuteResult>
  ```

- [ ] **T2.5.9** Documentar cada event type
  | Event | Payload | Cuándo |
  |-------|---------|--------|
  | session_start | sessionId | Inicio |
  | thinking | content, blockIndex | Thinking acumulado |
  | message_chunk | content, blockIndex | Streaming text |
  | message | content, sequenceNumber | Mensaje final |
  | tool_use | toolId, name, input | Tool request |
  | tool_result | toolId, result, success | Tool response |
  | approval_requested | toolId, description | Needs approval |
  | approval_resolved | toolId, approved | User responded |
  | complete | reason, tokenUsage | Fin de request |
  | error | message, code | Error |

- [ ] **T2.5.10** Documentar orden garantizado
  - `session_start` SIEMPRE primero
  - `thinking*` ANTES de `message*`
  - `tool_use` ANTES de `tool_result`
  - `complete` o `error` SIEMPRE último

### Bloque 4: Pre-Refactor Checklist (1h)

- [ ] **T2.5.11** Crear checklist de "must not break"
  - [ ] Event ordering invariants
  - [ ] Persistence guarantees (sequenceNumber)
  - [ ] WebSocket emission contract
  - [ ] Error propagation

- [ ] **T2.5.12** Identificar dependencias en ChatMessageHandler
  - Qué eventos espera
  - Qué transformaciones hace

- [ ] **T2.5.13** Identificar dependencias en WebSocket handlers
  - Qué events se relayan al cliente
  - Qué format espera el frontend

---

## Comandos Útiles

```bash
# Ejecutar integration tests específicos
cd backend && npm test -- thinking-state-transitions

# Ejecutar todos los integration tests de agent
npm test -- DirectAgentService.integration orchestrator.integration

# Ver output detallado de un test
npm test -- --reporter=verbose thinking-state-transitions
```

---

## Criterios de Aceptación

### Esta fase se considera COMPLETADA cuando:

1. ✅ `integration-test-inventory.md` creado con cobertura documentada
2. ✅ `golden-snapshots.md` creado con secuencias de eventos
3. ✅ `api-contract.md` creado con API documentada
4. ✅ `pre-refactor-checklist.md` creado para Fase 5
5. ✅ Tiempo total < 8 horas (timeboxed)

---

## Notas de Ejecución

### Bloqueadores Encontrados

_Documentar aquí cualquier bloqueador._

### Decisiones Tomadas

_Documentar decisiones importantes._

---

*Última actualización: 2025-12-17*
