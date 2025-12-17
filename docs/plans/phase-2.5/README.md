# Fase 2.5: Pre-Refactor Stabilization

## Informacion de la Fase

| Campo | Valor |
|-------|-------|
| **Fase** | 2.5 |
| **Nombre** | Pre-Refactor Stabilization |
| **Prerequisitos** | Fase 2 completada (parcialmente) |
| **Fase Siguiente** | Fase 3: Tests de Integracion |
| **Estado** | COMPLETADA |
| **Fecha** | 2025-12-17 |

---

## Objetivo Principal

Garantizar estabilidad del sistema ANTES del refactor de Fase 5, documentando comportamiento actual como "golden baseline" sin escribir tests unitarios que moriran con el refactor.

---

## Justificacion de Esta Fase

### Contexto

La Fase 2 dejo 3 Success Criteria (SC-3, SC-4, SC-5) en estado DEFERRED porque:

1. **DirectAgentService.ts** tiene ~1200 lineas (viola PRINCIPLES.md max 300)
2. **ROI negativo**: Escribir 500+ lineas de mocks para codigo que morira en Fase 5
3. **Integration tests YA existen** y cubren funcionalmente los flujos

### Decision Estrategica

En lugar de:
- No forzar unit tests contra codigo legacy (desperdicio)
- No saltar directamente a Fase 3 sin baseline (riesgo)

Se propone:
- Crear una fase bridge de estabilizacion
- Documentar comportamiento como "golden snapshots"
- Identificar APIs que deben preservarse post-refactor

---

## Success Criteria

### SC-1: Integration Tests Baseline
- [x] Todos los integration tests de DirectAgentService pasan
- [x] Documentar que cubre cada test file

**Evidencia**: `integration-test-inventory.md` con 51 tests documentados

### SC-2: Golden Behavior Snapshots
- [x] Capturar secuencia de eventos para "simple message"
- [x] Capturar secuencia de eventos para "message with thinking"
- [x] Capturar secuencia de eventos para "message with tool use"
- [x] Capturar secuencia de eventos para "approval flow"

**Evidencia**: `golden-snapshots.md` con 6 flows documentados

### SC-3: API Contract Documentation
- [x] Documentar `runGraph()` signature (antes executeQueryStreaming, deprecado)
- [x] Documentar todos los event types emitidos (13 tipos)
- [x] Documentar orden esperado de eventos
- [x] Identificar invariantes que NO deben cambiar (8 invariantes)

**Evidencia**: `api-contract.md` con contrato completo

### SC-4: Pre-Refactor Checklist
- [x] Crear checklist de validacion para Fase 5
- [x] Documentar "must not break" behaviors
- [x] Identificar dependencias upstream (ChatMessageHandler, WebSocket)

**Evidencia**: `pre-refactor-checklist.md` con 11 secciones de validacion

---

## Filosofia de Esta Fase

### Principio: "Document Before You Destroy"

Antes de refactorizar codigo complejo, debemos entender y documentar su comportamiento actual. Esto permite:

1. **Validacion post-refactor**: Comparar nuevo comportamiento contra baseline
2. **Regression detection**: Identificar cambios accidentales
3. **Knowledge transfer**: Documentar comportamiento implicito que vive solo en el codigo

### Anti-Pattern a Evitar

```
"El codigo es la documentacion"

En codigo de ~1200 lineas con logica entrelazada, el codigo
NO es documentacion suficiente. Comportamiento emergente
puede perderse en refactor sin documentacion explicita.
```

---

## Entregables de Esta Fase

### E-1: Integration Test Inventory
```
docs/plans/phase-2.5/integration-test-inventory.md
```
Listado de 51 integration tests con cobertura detallada por archivo.

### E-2: Golden Behavior Snapshots
```
docs/plans/phase-2.5/golden-snapshots.md
```
6 flows documentados con secuencias de eventos, invariantes, y code references.

### E-3: API Contract
```
docs/plans/phase-2.5/api-contract.md
```
Contrato completo: runGraph signature, 13 event types, 8 invariantes, consumer dependencies.

### E-4: Pre-Refactor Checklist
```
docs/plans/phase-2.5/pre-refactor-checklist.md
```
11 secciones de validacion para Fase 5, incluyendo rollback plan.

---

## Tareas (COMPLETADAS)

### Bloque 1: Integration Test Inventory

- [x] **T2.5.1** Listar todos los archivos de integration tests
- [x] **T2.5.2** Para cada archivo, documentar que flujos cubre
- [x] **T2.5.3** Identificar gaps de cobertura (5 gaps identificados)

### Bloque 2: Golden Snapshots

- [x] **T2.5.4** Capturar eventos de "simple message"
- [x] **T2.5.5** Capturar eventos de "thinking + message"
- [x] **T2.5.6** Capturar eventos de "tool use flow"
- [x] **T2.5.7** Capturar eventos de "approval flow"

### Bloque 3: API Contract

- [x] **T2.5.8** Documentar `runGraph()` signature completa
- [x] **T2.5.9** Documentar cada event type (13 tipos)
- [x] **T2.5.10** Documentar orden garantizado de eventos

### Bloque 4: Pre-Refactor Checklist

- [x] **T2.5.11** Crear checklist de "must not break"
- [x] **T2.5.12** Identificar dependencias en ChatMessageHandler
- [x] **T2.5.13** Identificar dependencias en WebSocket handlers

---

## Dependencias

### De Fase 2
- SC-1 y SC-2 completados
- Bug de blockIndex corregido
- Integration tests existentes pasando

### De Codigo
- FakeAnthropicClient funcional
- Test helpers (TestSessionFactory, SocketIOServerFactory)
- Azure SQL y Redis configurados para tests

---

## Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigacion | Resultado |
|--------|--------------|---------|------------|-----------|
| Golden snapshots no capturan todo | Media | Alto | Revisar con conocimiento del codigo | 6 flows completos |
| API contract incompleto | Baja | Medio | Derivar de integration tests | 13 event types documentados |
| Fase innecesaria (over-planning) | Baja | Bajo | Timeboxed a 1-2 dias maximo | Completado en ~2 horas |

---

## Descubrimientos y Notas

### Descubrimientos de Fase 2

- Provider abstraction layer funcional (AnthropicStreamAdapter)
- Bug de blockIndex corregido
- Integration tests como safety net

### Descubrimientos de Esta Fase

1. **51 integration tests**: Mas cobertura de la esperada para agent functionality
2. **runGraph vs executeQueryStreaming**: executeQueryStreaming fue deprecado en Phase 1, todos los tests usan runGraph()
3. **Event types**: 13 tipos de eventos distintos (mas de lo documentado previamente)
4. **8 invariantes criticos**: Orden de eventos, persistence states, tool IDs

### Coverage Gaps Identificados

1. **Semantic Search Auto-Context**: No hay tests para `enableAutoSemanticSearch`
2. **Approval in DirectAgentService**: Solo cubierto en approval-lifecycle.integration.test.ts
3. **Image Vision API**: Test existe pero no verifica envio real a Claude
4. **Citation Parsing**: Logic no validada profundamente
5. **Error Recovery**: Escenarios de recuperacion limitados

### Prerequisitos para Fase 3

1. Esta documentacion como baseline
2. Integration tests pasando (51 tests)
3. Redis y Azure SQL configurados

### Prerequisitos para Fase 5

1. **golden-snapshots.md**: Comparar comportamiento post-refactor
2. **api-contract.md**: Validar que API publica no cambie
3. **pre-refactor-checklist.md**: Checklist de validacion
4. **integration-test-inventory.md**: Tests a ejecutar antes/despues

---

## Informacion para Fase 3

Esta fase produce los artefactos que Fase 3 (Tests de Integracion) necesita:
- Baseline de comportamiento esperado
- API contracts para validar
- Checklist de regresiones a monitorear

---

## Informacion para Fase 5

Esta fase produce los artefactos criticos para el refactor:
- **Golden snapshots**: Comparar nuevo comportamiento vs baseline
- **API contract**: Garantizar que la API publica no cambie
- **Pre-refactor checklist**: Validar que nada se rompa

---

*Ultima actualizacion: 2025-12-17*
