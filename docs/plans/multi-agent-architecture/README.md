# Multi-Agent Architecture - Restructuring Project

**Estado**: En Progreso
**Fecha Inicio**: 2026-01-21
**Versión del Plan**: 1.0

---

## 1. Resumen Ejecutivo

Este proyecto transforma el sistema BC Agent desde un grafo lineal simple hacia una arquitectura multi-agente robusta con:

- **Agente Orquestador/Planificador**: Genera planes y coordina agentes especializados
- **Handoffs Dinámicos**: Delegación entre agentes durante la ejecución
- **UI en Tiempo Real**: Visualización de plan y agente activo
- **Agentes On-Demand**: Seleccionables por el usuario
- **Registro Programático**: AgentRegistry para escalabilidad

---

## 2. Arquitectura Objetivo

```
                    ┌─────────────────────┐
                    │   SUPERVISOR NODE   │ ◄── Entry point
                    │   (Planner Agent)   │
                    └──────────┬──────────┘
                               │ Genera Plan
                               ▼
                    ┌─────────────────────┐
                    │   PLAN EXECUTOR     │ ◄── Ejecuta steps
                    └──────────┬──────────┘
           ┌───────────────────┼───────────────────┐
           ▼                   ▼                   ▼
    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
    │  BC Agent   │    │  RAG Agent  │    │Graph Agent  │
    └──────┬──────┘    └──────┬──────┘    └──────┬──────┘
           │                  │                   │
           └──────────────────┴───────────────────┘
                               │
                               ▼ Resultados
                    ┌─────────────────────┐
                    │   SUPERVISOR NODE   │ ◄── Evalúa/Continúa
                    └─────────────────────┘
```

---

## 3. Fases del Proyecto

### Fase 0: Refactoring de God Files (Pre-requisito)
**Estado**: 🔴 No Iniciado
**Objetivo**: Descomponer archivos >500 líneas antes de añadir complejidad

| PRD | Archivo | Líneas | Módulos Target | Estado |
|-----|---------|--------|----------------|--------|
| [PRD-001](./PHASE-0-REFACTORING/PRD-001-FileService.md) | `FileService.ts` | 1,105 | 6 módulos | 🔴 |
| [PRD-002](./PHASE-0-REFACTORING/PRD-002-ApprovalManager.md) | `ApprovalManager.ts` | 1,133 | 5 módulos | 🔴 |
| [PRD-003](./PHASE-0-REFACTORING/PRD-003-AgentOrchestrator.md) | `AgentOrchestrator.ts` | 853 | 5 módulos | 🔴 |
| [PRD-004](./PHASE-0-REFACTORING/PRD-004-FilesRoutes.md) | `files.ts` routes | 1,494 | 7 módulos | 🔴 |
| [PRD-005](./PHASE-0-REFACTORING/PRD-005-MessageQueue.md) | `MessageQueue.ts` | 2,817 | 12+ módulos | 🔴 |

### Fase 1: Fundación TDD y Agent Registry
**Estado**: 🔴 No Iniciado
**Objetivo**: Infraestructura de testing y registro de agentes

| PRD | Componente | Estado |
|-----|------------|--------|
| [PRD-010](./PHASE-1-TDD-FOUNDATION/PRD-010-TestFixtures.md) | Test Fixtures (FakeChatModel, AgentStateFixture) | 🔴 |
| [PRD-011](./PHASE-1-TDD-FOUNDATION/PRD-011-AgentRegistry.md) | AgentRegistry y AgentDefinition | 🔴 |

### Fase 2: Extended State Schema
**Estado**: 🔴 No Iniciado
**Objetivo**: Extender AgentState para soportar planes y tracking

| PRD | Componente | Estado |
|-----|------------|--------|
| [PRD-020](./PHASE-2-EXTENDED-STATE/PRD-020-ExtendedAgentState.md) | PlanState, AgentIdentity, HandoffRecord | 🔴 |

### Fase 3: Supervisor/Planner Node
**Estado**: 🔴 No Iniciado
**Objetivo**: Agente orquestador que genera planes

| PRD | Componente | Estado |
|-----|------------|--------|
| [PRD-030](./PHASE-3-SUPERVISOR/PRD-030-PlannerAgent.md) | PlannerAgent | 🔴 |
| [PRD-031](./PHASE-3-SUPERVISOR/PRD-031-PlanExecutor.md) | PlanExecutorNode | 🔴 |
| [PRD-032](./PHASE-3-SUPERVISOR/PRD-032-PlanPersistence.md) | Plan Persistence (DB + Events) | 🔴 |

### Fase 4: Handoffs y Re-routing
**Estado**: 🔴 No Iniciado
**Objetivo**: Delegación dinámica entre agentes

| PRD | Componente | Estado |
|-----|------------|--------|
| [PRD-040](./PHASE-4-HANDOFFS/PRD-040-DynamicHandoffs.md) | Command objects, HandoffManager | 🔴 |

### Fase 5: Graphing Agent
**Estado**: 🔴 No Iniciado
**Objetivo**: Agente especializado en visualización de datos

| PRD | Componente | Estado |
|-----|------------|--------|
| [PRD-050](./PHASE-5-GRAPHING-AGENT/PRD-050-GraphingAgent.md) | GraphingAgent con Tremor UI | 🔴 |

### Fase 6: UI Components
**Estado**: 🔴 No Iniciado
**Objetivo**: UI para selección de agentes y visualización de planes

| PRD | Componente | Estado |
|-----|------------|--------|
| [PRD-060](./PHASE-6-UI/PRD-060-AgentSelector.md) | Agent Selector UI | 🔴 |
| [PRD-061](./PHASE-6-UI/PRD-061-PlanVisualization.md) | Plan Visualization Panel | 🔴 |

---

## 4. Decisiones Arquitectónicas

| Decisión | Elección | Justificación |
|----------|----------|---------------|
| **Patrón Arquitectónico** | Supervisor Centralizado | Fácil de debuggear, predecible, mejor para auditoría |
| **Persistencia de Planes** | Sí, en DB | Histórico, analytics, debugging post-mortem |
| **Modelo para Supervisor** | Haiku (económico) | Rápido y barato para routing/planificación |
| **Granularidad de Steps** | Adaptativo | Supervisor decide según complejidad |

---

## 5. Dependencias entre PRDs

```
FASE 0: Refactoring (Pre-requisito)
├── PRD-001: FileService ──────────────────────────┐
├── PRD-002: ApprovalManager ──────────────────────┤
├── PRD-003: AgentOrchestrator ────────────────────┼──► FASE 1
├── PRD-004: FilesRoutes (depende de PRD-001) ─────┤
└── PRD-005: MessageQueue (depende de todos) ──────┘

FASE 1: TDD Foundation
├── PRD-010: TestFixtures ─────────────────────────┐
└── PRD-011: AgentRegistry ────────────────────────┴──► FASE 2

FASE 2: Extended State
└── PRD-020: ExtendedAgentState ───────────────────────► FASE 3

FASE 3: Supervisor
├── PRD-030: PlannerAgent ─────────────────────────┐
├── PRD-031: PlanExecutor ─────────────────────────┼──► FASE 4
└── PRD-032: PlanPersistence ──────────────────────┘

FASE 4: Handoffs
└── PRD-040: DynamicHandoffs ──────────────────────────► FASE 5

FASE 5: Graphing Agent
└── PRD-050: GraphingAgent ────────────────────────────► FASE 6

FASE 6: UI
├── PRD-060: AgentSelector
└── PRD-061: PlanVisualization ────────────────────────► COMPLETADO
```

---

## 6. Métricas de Éxito

| Métrica | Target | Cómo Medir |
|---------|--------|------------|
| Líneas por archivo | < 300 | `wc -l` en archivos refactorizados |
| Test coverage nuevos módulos | >= 80% | Vitest coverage report |
| Latencia planificación | < 500ms | LangSmith traces |
| Tests E2E pasando | 100% | CI/CD pipeline |
| Breaking changes API | 0 | Contract tests |
| God files eliminados | 5/5 | Verificación manual |

---

## 7. Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| Refactoring rompe funcionalidad | Media | Alto | Strangler Fig pattern, tests primero |
| Supervisor genera planes inválidos | Media | Medio | Validación Zod estricta, fallback |
| Latencia aumenta con supervisor | Alta | Medio | Modelo económico, caching |
| Complejidad excesiva del grafo | Media | Alto | Paths simples, documentación |

---

## 8. Comandos de Verificación

```bash
# Type check completo
npm run verify:types

# Tests unitarios
npm run -w backend test:unit

# Tests de integración
npm run -w backend test:integration

# E2E
npm run test:e2e
```

---

## 9. Changelog

| Fecha | Versión | Cambios |
|-------|---------|---------|
| 2026-01-21 | 1.0 | Creación inicial del plan y estructura de PRDs |

