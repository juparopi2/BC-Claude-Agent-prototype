# Resumen Ejecutivo del Refactor - DirectAgentService

**Fecha**: 2025-12-22
**Estado**: Aprobado

---

## Objetivo

Este plan documenta el proceso de refactor del DirectAgentService, actualmente un "God Object" de 1,471 LOC. El objetivo es extraer responsabilidades a **13 clases especializadas** de menos de 150 LOC cada una.

## Decisiones Confirmadas

| Aspecto | Decisión |
|---------|----------|
| **Scope** | Solo DirectAgentService (1,471 LOC → clases < 150 LOC) |
| **Base de Datos** | DROP y recrear desde cero (actualizar seeds de tests) |
| **Multi-Provider** | Interfaces preparadas, solo Anthropic funcional |
| **ApprovalManager** | Excluir de este refactor (deuda técnica futura) |

## Entregables

1. Nueva carpeta `docs/plans/Refactor/` con documentación
2. Eliminar archivos obsoletos de planificación
3. Nueva estructura en `backend/src/domains/agent/`
4. Tests actualizados con nuevos seeds de DB

## Nueva Estructura de Carpetas

```
backend/src/domains/agent/
├── orchestration/
│   ├── AgentOrchestrator.ts          # <100 LOC - Coordinador principal
│   ├── types.ts                      # Tipos de orquestación
│   └── index.ts
├── context/
│   ├── FileContextPreparer.ts        # ~100 LOC - Adjuntos de archivos
│   ├── SemanticSearchHandler.ts      # ~80 LOC - Búsqueda automática
│   └── index.ts
├── streaming/
│   ├── GraphStreamProcessor.ts       # ~120 LOC - Procesa LangGraph events
│   ├── ThinkingAccumulator.ts        # ~60 LOC - Estado de thinking
│   ├── ContentAccumulator.ts         # ~60 LOC - Estado de mensaje
│   └── index.ts
├── tools/
│   ├── ToolEventDeduplicator.ts      # ~50 LOC - Evita duplicados
│   ├── ToolExecutionProcessor.ts     # ~100 LOC - Procesa ejecuciones
│   └── index.ts
├── persistence/
│   ├── PersistenceCoordinator.ts     # ~120 LOC - EventStore + Queue
│   ├── PersistenceErrorAnalyzer.ts   # ~60 LOC - Categoriza errores
│   └── index.ts
├── emission/
│   ├── AgentEventEmitter.ts          # ~80 LOC - Emisión WebSocket
│   ├── EventIndexTracker.ts          # ~30 LOC - Ordenamiento
│   └── index.ts
└── usage/
    ├── UsageTracker.ts               # ~70 LOC - Tracking de tokens
    └── index.ts
```

**Total**: ~910 LOC distribuidos en 13 clases (vs 1,471 LOC actual)

## Las 13 Clases del Refactor

| # | Clase | LOC | Responsabilidad |
|---|-------|-----|-----------------|
| 1 | **AgentOrchestrator** | <100 | Coordinador principal, entry point |
| 2 | **FileContextPreparer** | ~100 | Validación de adjuntos, contexto |
| 3 | **SemanticSearchHandler** | ~80 | Búsqueda automática de archivos |
| 4 | **GraphStreamProcessor** | ~120 | Consume LangGraph streamEvents |
| 5 | **ThinkingAccumulator** | ~60 | Acumula chunks de thinking |
| 6 | **ContentAccumulator** | ~60 | Acumula chunks de mensaje |
| 7 | **ToolEventDeduplicator** | ~50 | Previene duplicados de tool_use_id |
| 8 | **ToolExecutionProcessor** | ~100 | Procesa toolExecutions de on_chain_end |
| 9 | **PersistenceCoordinator** | ~120 | Coordina EventStore + MessageQueue |
| 10 | **PersistenceErrorAnalyzer** | ~60 | Categoriza errores de persistencia |
| 11 | **AgentEventEmitter** | ~80 | Emisión unificada WebSocket |
| 12 | **EventIndexTracker** | ~30 | Contador de eventIndex |
| 13 | **UsageTracker** | ~70 | Tracking de tokens |

## Fases de Migración

### Fase A: Implementación Paralela (Días 1-3)
- Crear estructura de carpetas `domains/agent/`
- Implementar clases de fases 1-7 (hojas)
- Tests unitarios para cada clase
- **No tocar DirectAgentService**

### Fase B: Integración Gradual (Días 4-6)
- Implementar PersistenceCoordinator y FileContextPreparer
- Reemplazar lógica interna de DirectAgentService con llamadas a nuevas clases
- DirectAgentService actúa como **facade**
- Tests E2E deben seguir pasando

### Fase C: Cutover Final (Días 7-8)
- Implementar GraphStreamProcessor y AgentOrchestrator
- Reemplazar DirectAgentService por AgentOrchestrator
- Actualizar todos los imports
- Archivar código viejo

### Fase D: Cleanup (Días 9-10)
- Eliminar DirectAgentService
- Actualizar documentación
- Audit final de cobertura de tests

## Riesgos y Mitigaciones

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| Breaking streaming behavior | Alto | E2E tests extensivos antes de cutover |
| Sequence number race conditions | Alto | Mantener patrón Redis INCR sin cambios |
| Test coverage regression | Medio | Mantener conteo de tests durante migración |
| Performance degradation | Medio | Benchmark antes/después |

## Archivos de Documentación

Este plan se divide en los siguientes documentos:

- **01-CURRENT-STATE.md** - Estado actual del proyecto (Fase 1)
- **02-ARCHITECTURE.md** - Arquitectura propuesta (Fase 2)
- **03-SHARED-PACKAGE.md** - Integración @bc-agent/shared (Fase 3)
- **04-INTERFACES.md** - Interfaces TypeScript (Fase 4)
- **05-IMPLEMENTATION-ORDER.md** - Orden de implementación (Fase 5)
- **06-MIGRATION-STRATEGY.md** - Estrategia de migración (Fase 6)
- **07-TESTING-PLAN.md** - Plan de testing (Fase 7)
- **99-FUTURE-DEVELOPMENT.md** - Deuda técnica y features futuras (Fase 9)

---

*Última actualización: 2025-12-22*
