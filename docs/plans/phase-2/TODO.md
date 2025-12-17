# TODO - Fase 2: Tests Unitarios del Pipeline

## Información de Tracking

| Campo | Valor |
|-------|-------|
| **Fase** | 2 |
| **Inicio** | 2025-12-16 |
| **Fin** | 2025-12-17 |
| **Estado** | 🟡 Parcialmente Completada |

---

## Tareas

### Bloque 1: Reorganización de Tests (COMPLETADO)

- [x] **T2.1** Mover tests de providers a ubicación centralizada
  - De: `src/core/providers/adapters/__tests__/`
  - A: `src/__tests__/unit/core/providers/`
  - Archivos: `AnthropicStreamAdapter.test.ts`, `StreamAdapterFactory.test.ts`

- [x] **T2.2** Actualizar imports a path aliases
  - Cambio: imports relativos → `@/core/providers/adapters/`

### Bloque 2: Documentación (COMPLETADO)

- [x] **T2.3** Actualizar `docs/plans/phase-2/TODO.md`
  - Corregir referencias a arquitectura provider-agnostic

- [x] **T2.4** Actualizar `backend/src/core/providers/README.md`
  - Agregar ubicación de tests
  - Agregar tabla de event mapping
  - Agregar ejemplos de uso

### Bloque 3: AnthropicStreamAdapter Tests (COMPLETADO)

- [x] **T2.5** Tests de edge cases
  - Test: empty content array → null ✅
  - Test: missing chunk data → null ✅
  - Test: signature blocks → skip (null) ✅
  - Test: input_json_delta → skip (null) ✅

- [x] **T2.6** Tests de citations
  - Test: extraer citation con text, source, location ✅
  - Test: text blocks sin citations ✅

- [x] **T2.7** Tests de blockIndex
  - Test: blockIndex incrementa correctamente ✅
  - Test: blockIndex no incrementa para eventos skipped ✅
  - Test: reset() reinicia contador ✅
  - Test: getCurrentBlockIndex() retorna valor actual ✅

- [x] **T2.8** Bug fix: blockIndex siempre 0
  - Problema: Spread operator order en `createEvent()`
  - Fix: Mover `...data` antes de `metadata` definition

**Total Tests AnthropicStreamAdapter**: 18 (10 originales + 8 nuevos)

### Bloque 4: MessageEmitter Tests (YA COMPLETADO)

- [x] **T2.9** Tests de eventos transient
  - emitMessageChunk, emitThinkingChunk, emitComplete, emitError ✅

- [x] **T2.10** Tests de eventos persisted
  - emitThinking, emitMessage, emitToolUse, emitToolResult ✅

- [x] **T2.11** Tests de singleton pattern
  - Event ID y Timestamp generation ✅

**Nota**: 412 líneas de tests existían de trabajo previo.

### Bloque 5: DirectAgentService.runGraph Tests (DEFERRED)

- [ ] ~~**T2.12** Crear archivo de tests unitarios~~
- [ ] ~~**T2.13** Crear fixtures de respuestas~~
- [ ] ~~**T2.14** Tests de emisión básica~~
- [ ] ~~**T2.15** Tests de thinking flow~~
- [ ] ~~**T2.16** Tests de tool flow~~
- [ ] ~~**T2.17** Tests de deduplicación~~
- [ ] ~~**T2.18** Tests de error handling~~

**DECISIÓN: DEFERRED**

| Aspecto | Detalle |
|---------|---------|
| **Razón** | DirectAgentService tiene ~1200 líneas (viola PRINCIPLES.md: max 300) |
| **Alternativa** | Tests de integración YA existen y cubren estos flujos |
| **Plan** | Unit tests se escribirán POST-REFACTOR (Fase 5.5) |
| **Coverage actual** | ~17% (bajo) pero integration tests compensan |

**Tests de Integración Existentes** (cubren SC-3, SC-4, SC-5 funcionalmente):
- `DirectAgentService.integration.test.ts` - Flujo completo con approval
- `DirectAgentService.attachments.integration.test.ts` - File attachments
- `orchestrator.integration.test.ts` - Graph orchestration
- `thinking-state-transitions.integration.test.ts` - Thinking flow completo

### Bloque 6: Validación y Cierre (COMPLETADO)

- [x] **T2.19** Ejecutar todos los tests
  - Resultado: 1,855 passed, 1 skipped ✅

- [x] **T2.20** Generar coverage report
  - Archivo: `docs/plans/phase-2/coverage-report.md` ✅

- [x] **T2.21** Documentar decisiones
  - Deferred items documentados ✅
  - Rationale incluido ✅

---

## Decisiones Tomadas

### D-1: Omitir Unit Tests de DirectAgentService.runGraph

**Fecha**: 2025-12-17
**Decision Maker**: Desarrollador + QA Review

**Contexto**:
- DirectAgentService.ts tiene ~1200 líneas
- Fase 5 planifica refactorizar a <150 líneas
- Escribir 500+ líneas de mocks para código que morirá = bajo ROI

**Decisión**:
- Deferred a Fase 5.5 (post-refactor)
- Integration tests existentes sirven como safety net
- Unit tests se escribirán contra nueva arquitectura limpia

**Impacto**:
- SC-3, SC-4, SC-5 marcados como DEFERRED (no FAILED)
- Fase 2.5 creada como bridge de estabilización

### D-2: Adoptar Arquitectura Provider-Agnostic en Tests

**Fecha**: 2025-12-17

**Decisión**:
- Tests validan `INormalizedStreamEvent`, no eventos Anthropic-specific
- Esto permite que tests sigan pasando si agregamos Azure OpenAI

---

## Comandos de Validación

```bash
# Ejecutar tests de providers
cd backend && npm test -- AnthropicStreamAdapter StreamAdapterFactory

# Ejecutar tests con coverage
npm run test:coverage

# Ejecutar tests de integración relacionados
npm test -- thinking-state-transitions DirectAgentService.integration
```

---

## Información para Fase 2.5

1. **Integration tests** son la safety net para refactor
2. **Comportamiento documentado** en coverage-report.md
3. **APIs públicas a preservar**:
   - `executeQueryStreaming(query, sessionId, onEvent, userId, options)`
   - Events emitidos: session_start, thinking, message_chunk, message, tool_use, tool_result, complete, error

---

*Última actualización: 2025-12-17*
