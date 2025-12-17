# Fase 2: Tests Unitarios del Pipeline de Mensajes

## Información de la Fase

| Campo | Valor |
|-------|-------|
| **Fase** | 2 |
| **Nombre** | Tests Unitarios del Pipeline de Mensajes |
| **Prerequisitos** | Fase 1 completada (baseline de tests limpia) |
| **Fase Siguiente** | Fase 3: Tests de Integración |

---

## Objetivo Principal

Crear tests unitarios exhaustivos para cada componente del pipeline de mensajes, asegurando que cada transformación de datos está correctamente testeada.

---

## Success Criteria

### SC-1: AnthropicStreamAdapter Coverage (reemplaza StreamAdapter)
- [ ] 100% coverage de `processChunk()`
- [ ] Tests para cada tipo de evento normalizado (INormalizedStreamEvent)
- [ ] Tests de mapping Anthropic → INormalizedStreamEvent
- [ ] Tests de edge cases (empty content, null values)

### SC-2: MessageEmitter Coverage
- [ ] 100% coverage de métodos públicos
- [ ] Tests para eventos transient
- [ ] Tests para eventos persisted

### SC-3: DirectAgentService.runGraph Coverage
- [ ] >80% coverage de `runGraph()`
- [ ] Tests de flujo de eventos
- [ ] Tests de persistencia
- [ ] Tests de error handling

### SC-4: Tests de Thinking Flow
- [ ] Test de acumulación de thinking chunks
- [ ] Test de señal thinking_complete
- [ ] Test de transición thinking→text

### SC-5: Tests de Tool Flow
- [ ] Test de deduplicación de tool events
- [ ] Test de persistencia de tool_use/tool_result
- [ ] Test de IDs consistentes

---

## Filosofía de Esta Fase

### Principio: "Test Behavior, Not Implementation"

Los tests deben validar comportamiento observable, no detalles de implementación. Un test bien escrito debe seguir pasando incluso si se refactoriza el código interno.

### Estructura de Tests

```typescript
describe('ComponentName', () => {
  describe('methodName', () => {
    describe('when [condition]', () => {
      it('should [expected behavior]', () => {
        // Arrange - Setup
        // Act - Execute
        // Assert - Verify
      });
    });
  });
});
```

### Criterios para Buenos Tests

1. **Descriptivos**: El nombre del test describe el comportamiento
2. **Independientes**: No dependen de otros tests
3. **Determinísticos**: Mismos inputs = mismos outputs
4. **Rápidos**: Ejecutan en millisegundos
5. **Focused**: Prueban una sola cosa

---

## Consideraciones Técnicas Específicas

### Sobre AnthropicStreamAdapter Tests (Post-Fase 0.5)

**Inputs a Testear**:
- `on_chat_model_stream` con `content: []` (empty)
- `on_chat_model_stream` con thinking block
- `on_chat_model_stream` con text block
- `on_chat_model_stream` con tool_use block
- `on_chat_model_end` con usage data

**Outputs Normalizados Esperados**:
- `reasoning_delta` event con `blockIndex` (antes: thinking_chunk)
- `content_delta` event con `blockIndex` (antes: message_chunk)
- `tool_call` event con ID normalizado (antes: tool_use)
- `usage` event con campos en camelCase (inputTokens, outputTokens)
- `null` para eventos no procesables (ej: signature_delta)

**Tests de Normalización**:
- Test: thinking_delta → reasoning_delta
- Test: text_delta → content_delta
- Test: tool_use → tool_call (ID sin prefijo toolu_)
- Test: usage field normalization (input_tokens → inputTokens)

**Edge Cases**:
- Content array vacío
- Content string vs array
- Citations en text blocks
- signature_delta ignorado

### Sobre MessageEmitter Tests

**Métodos a Testear**:
```typescript
// Transient events
emitMessageChunk(chunk, blockIndex, sessionId?, messageId?)
emitThinkingChunk(chunk, blockIndex, sessionId?, messageId?)
emitThinkingComplete(content, blockIndex, sessionId?, messageId?)
emitComplete(stopReason, tokenUsage?, sessionId?, citedFiles?)
emitError(error, code?, sessionId?)

// Persisted events
emitThinking(data: ThinkingEventData)
emitMessage(data: MessageEventData)
emitToolUse(data: ToolUseEventData)
emitToolResult(data: ToolResultEventData)
```

**Verificaciones**:
- Estructura del evento emitido
- `persistenceState` correcto
- `timestamp` en formato ISO 8601
- `eventId` único (UUID)

### Sobre DirectAgentService.runGraph Tests

**Flujos a Testear**:
1. Simple message (no thinking, no tools)
2. Message with thinking enabled
3. Message that triggers tool use
4. Message with multiple tool calls
5. Message with file attachments

**Mocking Strategy**:
- Usar `FakeAnthropicClient` para simular responses
- Mock `EventStore` para verificar persistencia
- Mock `MessageQueue` para verificar enqueueing
- Spy en `onEvent` callback

**Verificaciones**:
- Eventos emitidos en orden correcto
- Todos los eventos persistidos
- Stop reason correcto
- Token usage tracked

---

## Entregables de Esta Fase

### E-1: AnthropicStreamAdapter Tests (reemplaza StreamAdapter)
```
backend/src/__tests__/unit/core/providers/AnthropicStreamAdapter.test.ts
```

### E-2: MessageEmitter Tests
```
backend/src/services/agent/messages/MessageEmitter.test.ts
```

### E-3: DirectAgentService.runGraph Tests
```
backend/src/__tests__/unit/services/agent/DirectAgentService.runGraph.test.ts
```

### E-4: Coverage Report
```
docs/plans/phase-2/coverage-report.md
```

---

## Dependencias

### De Fase 0.5 (Abstracción Provider)
- AnthropicStreamAdapter implementado
- INormalizedStreamEvent types disponibles
- StreamAdapterFactory funcional

### De Fase 1 (Limpieza Tests)
- Tests existentes limpios y pasando
- Baseline de coverage establecida

### De Código
- `FakeAnthropicClient` funcional
- Fixtures de respuestas Claude actualizadas para eventos normalizados
- Test utilities configuradas

---

## Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| Mocks no representan realidad | Alta | Alto | Validar contra diagnóstico Fase 0 |
| Tests muy acoplados a implementación | Media | Medio | Focus en behavior, no implementation |
| Coverage no mejora significativamente | Baja | Bajo | Identificar código no testeable |

---

## Descubrimientos y Notas

### Descubrimientos de Fase 1

_Copiar aquí descubrimientos relevantes de Fase 1._

### Descubrimientos de Esta Fase

_Agregar aquí hallazgos durante la ejecución._

### Prerequisitos para Fase 3

_Agregar aquí información que Fase 3 necesita saber._

---

*Última actualización: 2025-12-16*
