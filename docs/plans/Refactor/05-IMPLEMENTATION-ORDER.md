# Orden de Implementación

**Fecha**: 2025-12-22
**Estado**: En Progreso - Fase 1 y 2 Completadas ✅

---

## Estrategia: De Hojas a Raíz

Implementar clases en orden de **menor a mayor dependencias** (hojas primero del árbol de dependencias).

Esto permite:
- Testear cada clase inmediatamente después de crearla
- Evitar dependencias circulares
- Minimizar cambios en código ya testeado

---

## Orden de Implementación

| Fase | Clase | Dependencias | Riesgo | Estado | Tests |
|------|-------|--------------|--------|--------|-------|
| 1 | PersistenceErrorAnalyzer | Ninguna | Bajo | ✅ Completada | 27 |
| 2 | EventIndexTracker | Ninguna | Bajo | ✅ Completada | 13 |
| 3 | ThinkingAccumulator | Ninguna | Bajo | ✅ Completada | 24 |
| 4 | ContentAccumulator | Ninguna | Bajo | ✅ Completada | 21 |
| 5 | ToolEventDeduplicator | Ninguna | Bajo | ✅ Completada | 30 |
| 6 | AgentEventEmitter | EventIndexTracker | Bajo | ✅ Completada | 32 |
| 7 | UsageTracker | Services externos | Bajo | ✅ Completada | 35 |
| 8 | PersistenceCoordinator | EventStore, Queue, ErrorAnalyzer | Medio | ⏳ Pendiente | - |
| 9 | SemanticSearchHandler | SemanticSearchService | Bajo | ⏳ Pendiente | - |
| 10 | FileContextPreparer | SemanticSearchHandler | Medio | ⏳ Pendiente | - |
| 11 | ToolExecutionProcessor | Deduplicator, Persistence, Emitter | Medio | ⏳ Pendiente | - |
| 12 | GraphStreamProcessor | Accumulators, ToolProcessor | **Alto** | ⏳ Pendiente | - |
| 13 | AgentOrchestrator | Todas las anteriores | **Alto** | ⏳ Pendiente | - |

**Total tests Fase A (hojas):** 182 tests pasando
**Progreso:** 7/13 clases completadas (54%)

---

## Fase 1: Hojas (Días 1-2) ✅ COMPLETADA

### Clases Implementadas

1. **PersistenceErrorAnalyzer** ✅
   - Ubicación: `backend/src/domains/agent/persistence/`
   - Tests: 27 pasando
   - LOC: ~60

2. **EventIndexTracker** ✅
   - Ubicación: `backend/src/domains/agent/emission/`
   - Tests: 13 pasando
   - LOC: ~30

3. **ThinkingAccumulator** ✅
   - Ubicación: `backend/src/domains/agent/streaming/`
   - Tests: 24 pasando
   - LOC: ~60

4. **ContentAccumulator** ✅
   - Ubicación: `backend/src/domains/agent/streaming/`
   - Tests: 21 pasando
   - LOC: ~45

5. **ToolEventDeduplicator** ✅
   - Ubicación: `backend/src/domains/agent/tools/`
   - Tests: 30 pasando
   - LOC: ~50

### Criterios de Éxito ✅ CUMPLIDOS

- ✅ Todas las clases con tests unitarios (115 tests)
- ✅ No dependencias externas (solo tipos de @bc-agent/shared)
- ✅ Interfaces públicas documentadas en types.ts
- ✅ Código < 60 LOC cada clase

---

## Fase 2: Emisores y Trackers (Días 3-4) ✅ COMPLETADA

### Clases Implementadas

6. **AgentEventEmitter** ✅
   - Ubicación: `backend/src/domains/agent/emission/`
   - Tests: 32 pasando
   - LOC: ~80
   - Dependencias: EventIndexTracker (interno)

7. **UsageTracker** ✅
   - Ubicación: `backend/src/domains/agent/usage/`
   - Tests: 35 pasando
   - LOC: ~70
   - Nota: Acumula tokens, no llama a services (eso lo hace el coordinador)

### Criterios de Éxito ✅ CUMPLIDOS

- ✅ Tests con dependencias internas (EventIndexTracker)
- ✅ Interfaces públicas estables en types.ts
- ✅ Código < 80 LOC cada clase

---

## Fase 3: Coordinadores (Días 5-7)

### Clases a Implementar

8. **PersistenceCoordinator** (2.0 días)
   - Depende de: EventStore, MessageQueue, ErrorAnalyzer
   - Tests:
     - Persistencia exitosa
     - Manejo de errores recuperables
     - Manejo de errores no recuperables
     - Coordinación EventStore + Queue

9. **SemanticSearchHandler** (1.0 día)
   - Depende de: SemanticSearchService (externo)
   - Tests: search, filterByThreshold, limitResults (con mock)

### Criterios de Éxito

- ✅ PersistenceCoordinator probado con fixture de errores
- ✅ SemanticSearchHandler con mock de service
- ✅ Código < 120 LOC cada clase

---

## Fase 4: Preparación de Contexto (Días 8-9)

### Clases a Implementar

10. **FileContextPreparer** (1.5 días)
    - Depende de: SemanticSearchHandler
    - Tests:
      - Validación de attachments
      - Búsqueda semántica automática
      - Construcción de contexto
      - Manejo de archivos no encontrados

### Criterios de Éxito

- ✅ Tests con fixtures de archivos
- ✅ Mock de SemanticSearchHandler
- ✅ Código < 100 LOC

---

## Fase 5: Procesamiento de Tools (Días 10-11)

### Clases a Implementar

11. **ToolExecutionProcessor** (2.0 días)
    - Depende de: Deduplicator, PersistenceCoordinator, AgentEventEmitter
    - Tests:
      - Procesamiento de ejecuciones válidas
      - Deduplicación de tool_use_id
      - Emisión de eventos tool_use y tool_result
      - Persistencia de tool_use y tool_result

### Criterios de Éxito

- ✅ Tests con mocks de todas las dependencias
- ✅ Cobertura > 90%
- ✅ Código < 100 LOC

---

## Fase 6: Stream Processor (Días 12-14) - RIESGO ALTO

### Clases a Implementar

12. **GraphStreamProcessor** (3.0 días)
    - Depende de: ThinkingAccumulator, ContentAccumulator, ToolExecutionProcessor
    - Tests:
      - Procesamiento de cada tipo de evento LangGraph (8 tipos)
      - Acumulación de thinking chunks
      - Acumulación de message chunks
      - Procesamiento de tool executions
      - Manejo de errores en stream
      - Stop reasons correctos

**CRÍTICO:**
- Esta clase tiene la mayor complejidad
- Coordina múltiples accumuladores
- Maneja 8 tipos de eventos de LangGraph
- Debe mantener estado durante stream

### Criterios de Éxito

- ✅ Tests para cada tipo de evento
- ✅ Tests de integración con fixtures reales
- ✅ FakeAnthropicClient con streaming funcional
- ✅ Cobertura > 90%
- ✅ Código < 120 LOC

---

## Fase 7: Orchestrator Final (Días 15-16) - RIESGO ALTO

### Clases a Implementar

13. **AgentOrchestrator** (2.0 días)
    - Depende de: TODAS las clases anteriores
    - Tests:
      - Flow completo de ejecución
      - Coordinación de todas las fases
      - Manejo de errores en cualquier fase
      - Cleanup al finalizar
      - E2E con FakeAnthropicClient

**CRÍTICO:**
- Entry point del sistema
- Coordina todas las clases
- Debe reemplazar DirectAgentService

### Criterios de Éxito

- ✅ Tests de integración completos
- ✅ Tests E2E con Playwright (verificar WebSocket)
- ✅ Compatibilidad con ChatMessageHandler
- ✅ Cobertura > 90%
- ✅ Código < 100 LOC

---

## Fase 8: Integración y Cutover (Días 17-18)

### Tareas

1. **Actualizar ChatMessageHandler** (0.5 día)
   - Reemplazar DirectAgentService por AgentOrchestrator
   - Verificar imports
   - Actualizar tipos

2. **Actualizar Tests Existentes** (1.0 día)
   - Migrar tests de DirectAgentService
   - Actualizar fixtures
   - Verificar seeds de DB

3. **E2E Testing** (0.5 día)
   - Ejecutar suite completa de E2E tests
   - Verificar WebSocket streaming
   - Verificar persistencia

### Criterios de Éxito

- ✅ Todos los E2E tests pasan
- ✅ Cobertura global > 70%
- ✅ No regressions detectadas

---

## Fase 9: Cleanup (Días 19-20)

### Tareas

1. **Eliminar Código Viejo** (0.5 día)
   - Archivar DirectAgentService
   - Remover imports no usados
   - Cleanup de tests obsoletos

2. **Actualizar Documentación** (0.5 día)
   - Actualizar README
   - Actualizar docs/backend/
   - Agregar diagramas de arquitectura

3. **Audit Final** (1.0 día)
   - Verificar path aliases
   - Verificar cobertura de tests
   - Verificar lint sin errores
   - Verificar build sin errores

### Criterios de Éxito

- ✅ Código viejo eliminado
- ✅ Documentación actualizada
- ✅ Build + lint + tests pasan
- ✅ Cobertura > 70%

---

## Diagrama de Flujo de Implementación

```
Días 1-2: Hojas
  ├─ PersistenceErrorAnalyzer
  ├─ EventIndexTracker
  ├─ ThinkingAccumulator
  ├─ ContentAccumulator
  └─ ToolEventDeduplicator
      ↓
Días 3-4: Emisores y Trackers
  ├─ AgentEventEmitter (usa EventIndexTracker)
  └─ UsageTracker
      ↓
Días 5-7: Coordinadores
  ├─ PersistenceCoordinator (usa ErrorAnalyzer)
  └─ SemanticSearchHandler
      ↓
Días 8-9: Contexto
  └─ FileContextPreparer (usa SemanticSearchHandler)
      ↓
Días 10-11: Tools
  └─ ToolExecutionProcessor (usa Deduplicator, Persistence, Emitter)
      ↓
Días 12-14: Stream (ALTO RIESGO)
  └─ GraphStreamProcessor (usa Accumulators, ToolProcessor)
      ↓
Días 15-16: Orchestrator (ALTO RIESGO)
  └─ AgentOrchestrator (usa TODAS las clases)
      ↓
Días 17-18: Integración
  ├─ Actualizar ChatMessageHandler
  ├─ Migrar tests
  └─ E2E testing
      ↓
Días 19-20: Cleanup
  ├─ Eliminar código viejo
  ├─ Actualizar docs
  └─ Audit final
```

---

## Checkpoints de Riesgo

### Checkpoint 1: Fin de Fase 1 (Día 2) ✅ PASADO
**Pregunta:** ¿Todas las clases hojas tienen tests al 100%?
- **SÍ** ✅ → 182 tests pasando para las 7 clases hoja
- **Resultado:** Lint (0 errores), Build (345 archivos), Tests (2031 pasando)

### Checkpoint 2: Fin de Fase 3 (Día 7)
**Pregunta:** ¿PersistenceCoordinator maneja todos los casos de error?
- **SÍ** → Continuar
- **NO** → Revisar ErrorAnalyzer

### Checkpoint 3: Fin de Fase 6 (Día 14)
**Pregunta:** ¿GraphStreamProcessor procesa todos los eventos correctamente?
- **SÍ** → Continuar
- **NO** → RIESGO ALTO - revisar con equipo

### Checkpoint 4: Fin de Fase 7 (Día 16)
**Pregunta:** ¿AgentOrchestrator pasa E2E tests?
- **SÍ** → Continuar a cutover
- **NO** → RIESGO CRÍTICO - no hacer cutover

---

*Última actualización: 2025-12-22*
