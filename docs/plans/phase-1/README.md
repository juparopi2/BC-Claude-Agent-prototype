# Fase 1: Limpieza de Tests Existentes

## Información de la Fase

| Campo | Valor |
|-------|-------|
| **Fase** | 1 |
| **Nombre** | Limpieza de Tests Existentes |
| **Prerequisitos** | Fase 0 y 0.5 completadas (diagnóstico + abstracción provider) |
| **Fase Siguiente** | Fase 2: Tests Unitarios del Pipeline |

---

## Objetivo Principal

Auditar, limpiar y establecer una baseline de tests funcionales antes de implementar nuevos tests o refactorizar código.

---

## Success Criteria

### SC-1: Auditoría Completa
- [x] Todos los archivos de test inventariados
- [x] Cada test clasificado (pasa/skip/obsoleto)
- [x] Documento de auditoría creado

### SC-2: Tests Skipped Resueltos
- [x] Cada `it.skip` evaluado
- [x] Decisión documentada: rehabilitar o eliminar
- [x] Cero tests skipped sin justificación

### SC-3: Tests Obsoletos Eliminados
- [x] Tests de funciones eliminadas: removidos
- [x] Tests de mocks incorrectos: removidos
- [x] Tests duplicados: consolidados

### SC-4: Baseline Funcional
- [x] `npm test` pasa al 100%
- [x] Coverage report generado
- [x] Baseline documentada

---

## Filosofía de Esta Fase

### Principio: "Un Test Debe Probar Comportamiento Real"

Un test que pasa siempre no tiene valor. Un test que se skipea no tiene valor. Solo tests que prueban comportamiento real del sistema tienen valor.

### Criterios de Decisión para Tests

**MANTENER si**:
- Prueba comportamiento actual del sistema
- Tiene assertions significativas
- Usa mocks que representan comportamiento real

**ELIMINAR si**:
- Prueba función que ya no existe
- Usa mocks que no representan comportamiento real
- Es duplicado de otro test
- Está skipped sin plan de arreglo

**REHABILITAR si**:
- Está skipped pero prueba comportamiento importante
- Falló por cambios de API que se pueden actualizar
- Es valioso para la Fase 2+

---

## Consideraciones Técnicas Específicas

### Sobre DirectAgentService Tests

**Estado Actual**:
- Múltiples archivos de test relacionados
- Algunos usan `FakeAnthropicClient`
- Algunos usan mocks obsoletos

**Archivos a Revisar**:
```
backend/src/__tests__/unit/services/agent/DirectAgentService.test.ts
backend/src/__tests__/unit/services/agent/DirectAgentService.comprehensive.test.ts
backend/src/__tests__/unit/services/agent/DirectAgentService.fileContext.test.ts
backend/src/__tests__/unit/services/agent/DirectAgentService.citedFiles.test.ts
backend/src/__tests__/unit/services/agent/DirectAgentService.semanticSearch.test.ts
```

**Preguntas a Responder**:
- ¿Cuáles tests prueban `runGraph()` (método actual)?
- ¿Cuáles tests prueban métodos deprecated?
- ¿Los mocks representan el comportamiento real de Claude?

### Sobre Tests de Streaming

**Archivos Relacionados**:
```
backend/src/__tests__/unit/agent/e2e-data-flow.test.ts
backend/src/__tests__/unit/agent/stop-reasons.test.ts
```

**Consideraciones**:
- Streaming es difícil de testear con mocks
- FakeAnthropicClient debe simular streaming real
- Tests deben validar orden de eventos

### Sobre Tests de Stream Adapters

**Estado Actual** (Post-Fase 0.5):
- Usar AnthropicStreamAdapter de `core/providers/adapters/`
- Tests deben usar INormalizedStreamEvent types
- Ubicacion de tests: `backend/src/__tests__/unit/core/providers/`

### Sobre Tests de Tools

**Consideraciones**:
- Tool events tienen múltiples fuentes (stream adapter vs toolExecutions)
- Deduplicación debe ser testeada
- IDs deben mantenerse consistentes

---

## Entregables de Esta Fase

### E-1: Documento de Auditoría
```
docs/plans/phase-1/test-audit.md
```
Inventario completo de tests con clasificación.

### E-2: Lista de Eliminaciones
```
docs/plans/phase-1/deleted-tests.md
```
Tests eliminados con justificación.

### E-3: Baseline Report
```
docs/plans/phase-1/baseline-report.md
```
Estado final de tests con coverage.

---

## Dependencias

### De Fase 0 (Diagnóstico)
- Diagnóstico de respuesta Claude
- Entendimiento de flujo de eventos
- Identificación de problemas en thinking/tools

### De Fase 0.5 (Abstracción Provider)
- Interfaces IStreamAdapter, INormalizedStreamEvent definidas
- AnthropicStreamAdapter implementado y funcionando
- StreamAdapterFactory creado
- Tests de adaptadores pasando

### De Código
- Test framework: Vitest
- Coverage tool: v8
- Test utilities: `backend/src/__tests__/fixtures/`

---

## Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| Eliminar test importante | Media | Alto | Documentar razón de eliminación |
| Tests fallan por cambios no relacionados | Media | Medio | Revisar cambios recientes |
| Coverage baja después de limpieza | Alta | Bajo | Es esperado, se recupera en Fase 2 |

---

## Descubrimientos y Notas

> Esta sección se llena durante la ejecución de la fase.

### Descubrimientos de Fase 0

_Copiar aquí descubrimientos relevantes de Fase 0._

### Descubrimientos de Esta Fase

### Descubrimientos de Esta Fase

1.  **Global OpenAI Mock**: El error `Failed to load url openai` persistía debido a importaciones tanto directas como transitivas. La solución fue implementar un `vi.mock('openai')` global en `src/__tests__/setup.ts` que cubre tanto `OpenAI` constructor como `embeddings.create`.
2.  **Limpieza de Legacy**: Se eliminaron tests antiguos de streaming (`e2e-data-flow`, `stop-reasons`, `citations`) que no eran compatibles con la nueva arquitectura direct-client.
3.  **Baseline Establecida**: Se logró un estado "verde" en `npm test` con ~390 tests pasando. Coverage reportado en `baseline-report.md`.

### Prerequisitos para Fase 2

_Agregar aquí información que Fase 2 necesita saber._

### Deuda Técnica Identificada

_Agregar aquí problemas que no se resuelven en esta fase._

---

*Última actualización: 2025-12-16*
