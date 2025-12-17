# Fase 2.5: Pre-Refactor Stabilization

## Información de la Fase

| Campo | Valor |
|-------|-------|
| **Fase** | 2.5 |
| **Nombre** | Pre-Refactor Stabilization |
| **Prerequisitos** | Fase 2 completada (parcialmente) |
| **Fase Siguiente** | Fase 3: Tests de Integración |

---

## Objetivo Principal

Garantizar estabilidad del sistema ANTES del refactor de Fase 5, documentando comportamiento actual como "golden baseline" sin escribir tests unitarios que morirán con el refactor.

---

## Justificación de Esta Fase

### Contexto

La Fase 2 dejó 3 Success Criteria (SC-3, SC-4, SC-5) en estado DEFERRED porque:

1. **DirectAgentService.ts** tiene ~1200 líneas (viola PRINCIPLES.md max 300)
2. **ROI negativo**: Escribir 500+ líneas de mocks para código que morirá en Fase 5
3. **Integration tests YA existen** y cubren funcionalmente los flujos

### Decisión Estratégica

En lugar de:
- ❌ Forzar unit tests contra código legacy (desperdicio)
- ❌ Saltar directamente a Fase 3 sin baseline (riesgo)

Se propone:
- ✅ Crear una fase bridge de estabilización
- ✅ Documentar comportamiento como "golden snapshots"
- ✅ Identificar APIs que deben preservarse post-refactor

---

## Success Criteria

### SC-1: Integration Tests Baseline
- [ ] Todos los integration tests de DirectAgentService pasan
- [ ] Documentar qué cubre cada test file

### SC-2: Golden Behavior Snapshots
- [ ] Capturar secuencia de eventos para "simple message"
- [ ] Capturar secuencia de eventos para "message with thinking"
- [ ] Capturar secuencia de eventos para "message with tool use"
- [ ] Capturar secuencia de eventos para "approval flow"

### SC-3: API Contract Documentation
- [ ] Documentar `executeQueryStreaming()` signature
- [ ] Documentar todos los event types emitidos
- [ ] Documentar orden esperado de eventos
- [ ] Identificar invariantes que NO deben cambiar

### SC-4: Pre-Refactor Checklist
- [ ] Crear checklist de validación para Fase 5
- [ ] Documentar "must not break" behaviors
- [ ] Identificar dependencias upstream (ChatMessageHandler, WebSocket)

---

## Filosofía de Esta Fase

### Principio: "Document Before You Destroy"

Antes de refactorizar código complejo, debemos entender y documentar su comportamiento actual. Esto permite:

1. **Validación post-refactor**: Comparar nuevo comportamiento contra baseline
2. **Regression detection**: Identificar cambios accidentales
3. **Knowledge transfer**: Documentar comportamiento implícito que vive solo en el código

### Anti-Pattern a Evitar

```
❌ "El código es la documentación"

En código de ~1200 líneas con lógica entrelazada, el código
NO es documentación suficiente. Comportamiento emergente
puede perderse en refactor sin documentación explícita.
```

---

## Entregables de Esta Fase

### E-1: Integration Test Inventory
```
docs/plans/phase-2.5/integration-test-inventory.md
```
Listado de todos los integration tests con su cobertura.

### E-2: Golden Behavior Snapshots
```
docs/plans/phase-2.5/golden-snapshots.md
```
Secuencias de eventos esperadas para cada flujo principal.

### E-3: API Contract
```
docs/plans/phase-2.5/api-contract.md
```
Contrato de APIs públicas que deben preservarse.

### E-4: Pre-Refactor Checklist
```
docs/plans/phase-2.5/pre-refactor-checklist.md
```
Checklist de validación para después del refactor.

---

## Tareas

### Bloque 1: Integration Test Inventory

- [ ] **T2.5.1** Listar todos los archivos de integration tests
- [ ] **T2.5.2** Para cada archivo, documentar qué flujos cubre
- [ ] **T2.5.3** Identificar gaps de cobertura (si los hay)

### Bloque 2: Golden Snapshots

- [ ] **T2.5.4** Ejecutar test de "simple message" y capturar eventos
- [ ] **T2.5.5** Ejecutar test de "thinking + message" y capturar eventos
- [ ] **T2.5.6** Ejecutar test de "tool use flow" y capturar eventos
- [ ] **T2.5.7** Ejecutar test de "approval flow" y capturar eventos

### Bloque 3: API Contract

- [ ] **T2.5.8** Documentar `executeQueryStreaming()` signature completa
- [ ] **T2.5.9** Documentar cada event type (nombre, payload, cuando se emite)
- [ ] **T2.5.10** Documentar orden garantizado de eventos

### Bloque 4: Pre-Refactor Checklist

- [ ] **T2.5.11** Crear checklist de "must not break"
- [ ] **T2.5.12** Identificar dependencias en ChatMessageHandler
- [ ] **T2.5.13** Identificar dependencias en WebSocket handlers

---

## Dependencias

### De Fase 2
- SC-1 y SC-2 completados
- Bug de blockIndex corregido
- Integration tests existentes pasando

### De Código
- FakeAnthropicClient funcional
- Test helpers (TestSessionFactory, SocketIOServerFactory)
- Azure SQL y Redis configurados para tests

---

## Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| Golden snapshots no capturan todo | Media | Alto | Revisar con conocimiento del código |
| API contract incompleto | Baja | Medio | Derivar de integration tests |
| Fase innecesaria (over-planning) | Baja | Bajo | Timeboxed a 1-2 días máximo |

---

## Información para Fase 3

Esta fase produce los artefactos que Fase 3 (Tests de Integración) necesita:
- Baseline de comportamiento esperado
- API contracts para validar
- Checklist de regresiones a monitorear

---

## Información para Fase 5

Esta fase produce los artefactos críticos para el refactor:
- **Golden snapshots**: Comparar nuevo comportamiento vs baseline
- **API contract**: Garantizar que la API pública no cambie
- **Pre-refactor checklist**: Validar que nada se rompa

---

*Última actualización: 2025-12-17*
