# TODO - Fase 2: Tests Unitarios del Pipeline

## Información de Tracking

| Campo | Valor |
|-------|-------|
| **Fase** | 2 |
| **Inicio** | _pendiente_ |
| **Fin Esperado** | _pendiente_ |
| **Estado** | 🔴 No iniciada |

---

## Tareas

### Bloque 1: StreamAdapter Tests

- [ ] **T2.1** Crear archivo `StreamAdapter.test.ts`
  - Ubicación: `backend/src/core/langchain/StreamAdapter.test.ts`
  - Setup: Import StreamAdapter, crear fixtures

- [ ] **T2.2** Tests de `on_chat_model_stream` - thinking
  - Test: thinking block → thinking_chunk event
  - Test: blockIndex incluido
  - Test: persistenceState = 'transient'

- [ ] **T2.3** Tests de `on_chat_model_stream` - text
  - Test: text block → message_chunk event
  - Test: blockIndex incluido
  - Test: citations extraídas si presentes

- [ ] **T2.4** Tests de `on_chat_model_stream` - edge cases
  - Test: empty content array → null
  - Test: tool_use block → skip (null)
  - Test: input_json_delta → skip

- [ ] **T2.5** Tests de `on_chat_model_end`
  - Test: usage data → usage event
  - Test: token counts correctos

- [ ] **T2.6** Tests de tool events
  - Test: on_tool_start → null (skip)
  - Test: on_tool_end → null (skip)

### Bloque 2: MessageEmitter Tests

- [ ] **T2.7** Crear archivo `MessageEmitter.test.ts`
  - Ubicación: `backend/src/services/agent/messages/MessageEmitter.test.ts`
  - Setup: Mock callback, crear instancia

- [ ] **T2.8** Tests de eventos transient
  - Test: emitMessageChunk estructura correcta
  - Test: emitThinkingChunk con blockIndex
  - Test: emitThinkingComplete señal
  - Test: emitComplete con reason mapeado
  - Test: emitError con code

- [ ] **T2.9** Tests de eventos persisted
  - Test: emitThinking con sequenceNumber
  - Test: emitMessage con todos los campos
  - Test: emitToolUse con args y blockIndex
  - Test: emitToolResult con success/error

- [ ] **T2.10** Tests de callback handling
  - Test: emit sin callback → warn log
  - Test: setEventCallback actualiza callback
  - Test: clearEventCallback limpia callback

### Bloque 3: DirectAgentService.runGraph Tests - Setup

- [ ] **T2.11** Crear archivo de tests
  - Ubicación: `backend/src/__tests__/unit/services/agent/DirectAgentService.runGraph.test.ts`
  - Setup: Mocks de EventStore, MessageQueue, onEvent

- [ ] **T2.12** Crear fixtures de respuestas
  - Fixture: Simple text response
  - Fixture: Response with thinking
  - Fixture: Response with tool use
  - Fixture: Response with multiple tools

- [ ] **T2.13** Configurar FakeAnthropicClient
  - Verificar: Simula streaming correctamente
  - Verificar: Soporta thinking blocks
  - Verificar: Soporta tool_use blocks

### Bloque 4: DirectAgentService.runGraph Tests - Event Emission

- [ ] **T2.14** Tests de emisión básica
  - Test: user_message_sent emitido a EventStore
  - Test: message_chunk events durante streaming
  - Test: message event final con stopReason
  - Test: complete event al final

- [ ] **T2.15** Tests de thinking flow
  - Test: thinking_chunk events emitidos
  - Test: thinking_complete ANTES de message_chunk
  - Test: thinking persistido a EventStore y MessageQueue

- [ ] **T2.16** Tests de emisión con eventIndex
  - Test: eventIndex incrementa correctamente
  - Test: Eventos tienen eventIndex para ordenamiento

### Bloque 5: DirectAgentService.runGraph Tests - Tool Handling

- [ ] **T2.17** Tests de tool events
  - Test: tool_use emitido con args
  - Test: tool_result emitido con success
  - Test: tool_use ANTES de tool_result

- [ ] **T2.18** Tests de deduplicación
  - Test: Mismo toolUseId no se emite dos veces
  - Test: emittedToolUseIds Set funciona

- [ ] **T2.19** Tests de persistencia de tools
  - Test: tool_use persistido a EventStore
  - Test: tool_result persistido a EventStore
  - Test: Ambos en MessageQueue

### Bloque 6: DirectAgentService.runGraph Tests - Error Handling

- [ ] **T2.20** Tests de errores de stream
  - Test: Error en stream → propagado
  - Test: Error loggeado con contexto

- [ ] **T2.21** Tests de errores de tools
  - Test: Tool execution error → tool_result con success=false
  - Test: Error message incluido

- [ ] **T2.22** Tests de errores de persistencia
  - Test: EventStore error → logged, no crash
  - Test: MessageQueue error → logged, no crash

### Bloque 7: Validación y Cierre

- [ ] **T2.23** Ejecutar todos los tests nuevos
  - Comando: `npm test StreamAdapter MessageEmitter runGraph`
  - Verificar: 100% pasan

- [ ] **T2.24** Generar coverage report
  - Comando: `npm run test:coverage`
  - Verificar: Targets cumplidos

- [ ] **T2.25** Documentar coverage
  - Crear: `docs/plans/phase-2/coverage-report.md`
  - Incluir: Coverage por archivo

- [ ] **T2.26** Verificar success criteria
  - Revisar: Todos los SC-* marcados

---

## Comandos Útiles

```bash
# Ejecutar tests específicos
npm test -- StreamAdapter.test.ts
npm test -- MessageEmitter.test.ts
npm test -- DirectAgentService.runGraph.test.ts

# Ejecutar con watch
npm test -- --watch StreamAdapter

# Coverage específico
npm run test:coverage -- --include="**/StreamAdapter.ts"
```

---

## Notas de Ejecución

### Bloqueadores Encontrados

_Documentar aquí cualquier bloqueador._

### Decisiones Tomadas

_Documentar decisiones importantes._

### Tiempo Real vs Estimado

| Bloque | Estimado | Real | Notas |
|--------|----------|------|-------|
| Bloque 1 | 3h | - | - |
| Bloque 2 | 2h | - | - |
| Bloque 3 | 2h | - | - |
| Bloque 4 | 3h | - | - |
| Bloque 5 | 2h | - | - |
| Bloque 6 | 2h | - | - |
| Bloque 7 | 1h | - | - |

---

## Descubrimientos Durante Ejecución

### Hallazgos Importantes

_Agregar aquí hallazgos significativos._

### Información para Fase 3

_Agregar aquí información crítica que Fase 3 necesita._

---

*Última actualización: 2025-12-16*
