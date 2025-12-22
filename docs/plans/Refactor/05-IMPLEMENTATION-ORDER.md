# Orden de Implementación

**Fecha**: 2025-12-22
**Estado**: Aprobado

---

## Estrategia: De Hojas a Raíz

Implementar clases en orden de **menor a mayor dependencias** (hojas primero del árbol de dependencias).

Esto permite:
- Testear cada clase inmediatamente después de crearla
- Evitar dependencias circulares
- Minimizar cambios en código ya testeado

---

## Orden de Implementación

| Fase | Clase | Dependencias | Riesgo | Días |
|------|-------|--------------|--------|------|
| 1 | PersistenceErrorAnalyzer | Ninguna | Bajo | 0.5 |
| 2 | EventIndexTracker | Ninguna | Bajo | 0.5 |
| 3 | ThinkingAccumulator | Ninguna | Bajo | 0.5 |
| 4 | ContentAccumulator | Ninguna | Bajo | 0.5 |
| 5 | ToolEventDeduplicator | Ninguna | Bajo | 0.5 |
| 6 | AgentEventEmitter | EventIndexTracker | Bajo | 1.0 |
| 7 | UsageTracker | Services externos | Bajo | 1.0 |
| 8 | PersistenceCoordinator | EventStore, Queue, ErrorAnalyzer | Medio | 2.0 |
| 9 | SemanticSearchHandler | SemanticSearchService | Bajo | 1.0 |
| 10 | FileContextPreparer | SemanticSearchHandler | Medio | 1.5 |
| 11 | ToolExecutionProcessor | Deduplicator, Persistence, Emitter | Medio | 2.0 |
| 12 | GraphStreamProcessor | Accumulators, ToolProcessor | **Alto** | 3.0 |
| 13 | AgentOrchestrator | Todas las anteriores | **Alto** | 2.0 |

**Total estimado:** ~16 días (3 semanas)

---

## Fase 1: Hojas (Días 1-2)

### Clases a Implementar

1. **PersistenceErrorAnalyzer** (0.5 días)
   - Sin dependencias externas
   - Lógica pura de categorización
   - Tests: casos de error conocidos

2. **EventIndexTracker** (0.5 días)
   - Estado simple (contador)
   - Tests: increment, reset

3. **ThinkingAccumulator** (0.5 días)
   - Estado simple (string + boolean)
   - Tests: append, isComplete, markComplete

4. **ContentAccumulator** (0.5 días)
   - Estado simple (string)
   - Tests: append, getContent

5. **ToolEventDeduplicator** (0.5 días)
   - Estado simple (Set)
   - Tests: shouldEmit, markEmitted

### Criterios de Éxito

- ✅ Todas las clases con tests unitarios al 100%
- ✅ No dependencias externas (solo tipos)
- ✅ Interfaces públicas documentadas
- ✅ Código < 60 LOC cada clase

---

## Fase 2: Emisores y Trackers (Días 3-4)

### Clases a Implementar

6. **AgentEventEmitter** (1.0 día)
   - Depende de: EventIndexTracker
   - Tests: emit, emitError, callback

7. **UsageTracker** (1.0 día)
   - Depende de: UsageTrackingService (externo)
   - Tests: trackUsage, finalize (con mock de service)

### Criterios de Éxito

- ✅ Tests con mocks de dependencias
- ✅ Interfaces públicas estables
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

### Checkpoint 1: Fin de Fase 1 (Día 2)
**Pregunta:** ¿Todas las clases hojas tienen tests al 100%?
- **SÍ** → Continuar
- **NO** → Completar antes de avanzar

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
