# Multi-Agent Architecture - Restructuring Project

**Estado**: En Progreso
**Fecha Inicio**: 2026-01-21
**Versión del Plan**: 2.3 (PRD-030 Completado - Supervisor Integration)

---

## 1. Resumen Ejecutivo

Este proyecto transforma el sistema BC Agent desde un grafo lineal simple hacia una arquitectura multi-agente robusta usando **patrones nativos de LangGraph**:

- **`createSupervisor()`**: Orquestación automática de agentes especializados
- **`interrupt()`**: Human-in-the-loop nativo (reemplaza ApprovalManager custom)
- **`Command(goto=...)`**: Handoffs nativos entre agentes
- **`initChatModel()`**: Abstracción multi-proveedor de modelos
- **Checkpointers**: Persistencia automática de estado del grafo

### Reducción de Complejidad

| Componente Original | Solución Nativa | Reducción |
|---------------------|-----------------|-----------|
| Custom PlannerAgent | `createSupervisor()` | ~90% código |
| Custom PlanExecutor | Supervisor automático | 100% eliminado |
| Custom ApprovalManager | `interrupt()` | No refactorizar |
| Custom HandoffManager | `Command(goto=...)` | ~70% código |
| Custom ModelFactory | `initChatModel()` | ~80% código |
| Custom persistence | `PostgresSaver` | ~80% código |

---

## 2. Arquitectura Objetivo

```
                    ┌─────────────────────────────────┐
                    │   createSupervisor()            │ ◄── Entry point
                    │   ┌─────────────────────────┐   │
                    │   │  LLM Router (Haiku)     │   │     Decide qué agente
                    │   └───────────┬─────────────┘   │     procesa cada mensaje
                    └───────────────┼─────────────────┘
           ┌────────────────────────┼────────────────────────┐
           ▼                        ▼                        ▼
    ┌─────────────┐          ┌─────────────┐          ┌─────────────┐
    │ createReact │          │ createReact │          │ createReact │
    │ Agent()     │          │ Agent()     │          │ Agent()     │
    │             │          │             │          │             │
    │  BC Agent   │          │  RAG Agent  │          │Graph Agent  │
    │  + 7 tools  │          │  + search   │          │  + tremor   │
    └──────┬──────┘          └──────┬──────┘          └──────┬──────┘
           │                        │                        │
           └────────────────────────┴────────────────────────┘
                                    │
                                    ▼
                    ┌─────────────────────────────────┐
                    │   PostgresSaver Checkpointer   │ ◄── Persistencia
                    │   (Thread state automático)    │     automática
                    └─────────────────────────────────┘
```

---

## 3. Patrones Nativos LangGraph Usados

### 3.1 `createSupervisor()` - Orquestación Multi-Agente

```typescript
// NOTA: createSupervisor es un paquete separado (npm install @langchain/langgraph-supervisor)
import { createSupervisor } from "@langchain/langgraph-supervisor";
import { ChatAnthropic } from "@langchain/anthropic";

const supervisor = createSupervisor({
  agents: [bcAgent, ragAgent, graphAgent],
  model: new ChatAnthropic({ model: "claude-haiku-4-5-20251001" }),
  prompt: "Route the request to the appropriate agent...",
});

const graph = supervisor.compile({ checkpointer });
```

### 3.2 `createReactAgent()` - Agentes Especializados

```typescript
import { createReactAgent } from "@langchain/langgraph/prebuilt";

const bcAgent = createReactAgent({
  llm: new ChatAnthropic({ model: "claude-sonnet-4-5-20250929" }),
  tools: [bcSearchEntities, bcGetFields, bcValidatePayload, ...],
  name: "bc-agent",
  prompt: "You are an expert in Microsoft Business Central...",
});
```

### 3.3 `interrupt()` - Human-in-the-Loop

```typescript
import { interrupt } from "@langchain/langgraph";

const sensitiveToolNode = async (state) => {
  if (requiresApproval(state.toolCall)) {
    const approved = interrupt({
      type: "approval_request",
      toolName: state.toolCall.name,
      args: state.toolCall.args,
    });
    if (!approved) return { messages: [new AIMessage("Operation cancelled")] };
  }
  return await executeTool(state.toolCall);
};
```

### 3.4 `Command(goto=...)` - Handoffs Nativos

```typescript
import { Command } from "@langchain/langgraph";

// En cualquier nodo del agente:
return new Command({
  goto: "rag-agent",
  update: { messages: state.messages, context: extractedContext },
});
```

### 3.5 `initChatModel()` - Multi-Proveedor

```typescript
import { initChatModel } from "langchain";

// Sintaxis unificada
const anthropic = await initChatModel("claude-sonnet-4-5-20250929");
const openai = await initChatModel("openai:gpt-4.1");
const google = await initChatModel("google-genai:gemini-2.5-flash-lite");

// Feature detection
console.log(anthropic.profile?.reasoningOutput); // true para extended thinking
```

---

## 4. Fases del Proyecto

### Fase 0: Refactoring de God Files (Pre-requisito)
**Estado**: ✅ COMPLETADO (2026-01-23)
**Objetivo**: Descomponer archivos >500 líneas antes de añadir complejidad

| PRD | Archivo | Líneas Originales | Estado | Fecha |
|-----|---------|-------------------|--------|-------|
| [PRD-001](./PHASE-0-REFACTORING/PRD-001-FileService.md) | `FileService.ts` | 1,105 | ✅ Completado | 2026-01-21 |
| [PRD-002](./PHASE-0-REFACTORING/PRD-002-ApprovalManager.md) | `ApprovalManager.ts` | 1,133 | ⚠️ DEPRECATED | - |
| [PRD-003](./PHASE-0-REFACTORING/PRD-003-AgentOrchestrator.md) | `AgentOrchestrator.ts` | 853 | ✅ Completado | 2026-01-21 |
| [PRD-004](./PHASE-0-REFACTORING/PRD-004-FilesRoutes.md) | `files.ts` routes | 1,494 | ✅ Completado | 2026-01-22 |
| [PRD-005](./PHASE-0-REFACTORING/PRD-005-MessageQueue.md) | `MessageQueue.ts` | 2,817 | ✅ Completado | 2026-01-23 |

> **Nota PRD-002**: Marcado como DEPRECATED. Multi-agent flows usarán `interrupt()` nativo de LangGraph. El código existente se mantiene para backward compatibility pero NO se refactorizará.

**Métricas de Fase 0:**
- 4 PRDs completados (PRD-001, PRD-003, PRD-004, PRD-005)
- Archivos reducidos de >500 líneas a <300 líneas cada uno
- Stateless architecture implementada con ExecutionContext pattern

### Fase 0.5: Model Abstraction (NUEVA)
**Estado**: 🔴 No Iniciado
**Objetivo**: Migrar de ModelFactory custom a `initChatModel()` nativo

| PRD | Componente | Estado |
|-----|------------|--------|
| [PRD-006](./PHASE-0-REFACTORING/PRD-006-ModelAbstraction.md) | Multi-provider abstraction con `initChatModel()` | 🔴 |

### Fase 1: Fundación TDD y Agent Registry
**Estado**: 🟡 En Progreso
**Objetivo**: Infraestructura de testing y registro de agentes

| PRD | Componente | Estado | Fecha |
|-----|------------|--------|-------|
| [PRD-010](./PHASE-1-TDD-FOUNDATION/PRD-010-TestFixtures.md) | LangSmith Evaluations (reformulado) | 🔴 | - |
| [PRD-011](./PHASE-1-TDD-FOUNDATION/PRD-011-AgentRegistry.md) | AgentRegistry (simplificado) | ✅ Completado | 2026-02-06 |

**Métricas PRD-011:**
- 12 archivos creados, 4 modificados
- 26 tests unitarios, 0 regresiones (2916 tests backend pasan)
- Constantes centralizadas en `@bc-agent/shared` (single source of truth)
- API endpoint `GET /api/agents` autenticado
- Descubrimiento: `createSupervisor` requiere paquete `@langchain/langgraph-supervisor` (corregido en PRD-030)

### Fase 2: Extended State Schema
**Estado**: ✅ COMPLETADO (2026-02-06)
**Objetivo**: Extender AgentState con identity tracking y contexto enriquecido

| PRD | Componente | Estado | Fecha |
|-----|------------|--------|-------|
| [PRD-020](./PHASE-2-EXTENDED-STATE/PRD-020-ExtendedAgentState.md) | AgentIdentity, AgentContext, ExtendedAgentStateAnnotation | ✅ Completado | 2026-02-06 |

**Métricas PRD-020:**
- 7 archivos creados, 7 modificados, 0 archivos breaking (backward compat via alias)
- 26 tests nuevos (12 reducer + 14 contract), 0 regresiones (2942 tests backend pasan)
- `AgentStateAnnotation` es ahora alias de `ExtendedAgentStateAnnotation` (15+ archivos sin cambios)
- `activeAgent` preservado para routing; `currentAgentIdentity` es complementario (para UI)
- Import de `createSupervisor` corregido en PRD docs: `@langchain/langgraph-supervisor` (paquete separado)
- `AgentChangedEvent` + Zod schemas listos para Phase 6 (frontend badges)

### Fase 3: Supervisor con createSupervisor()
**Estado**: 🟡 En Progreso (PRD-030 ✅)
**Objetivo**: Implementar orquestación usando patrones nativos

| PRD | Componente | Estado | Fecha |
|-----|------------|--------|-------|
| [PRD-030](./PHASE-3-SUPERVISOR/PRD-030-PlannerAgent.md) | Supervisor Integration con `createSupervisor()` | ✅ Completado | 2026-02-06 |
| ~~PRD-031~~ | ~~PlanExecutor~~ | ❌ ELIMINADO | - |
| [PRD-032](./PHASE-3-SUPERVISOR/PRD-032-PlanPersistence.md) | Persistencia durable + Analytics | 🔴 | - |

> **Nota PRD-031**: ELIMINADO. `createSupervisor()` maneja la ejecución de steps automáticamente.
>
> **Pre-requisito de instalación** (descubierto en PRD-011): `createSupervisor` requiere paquete separado `@langchain/langgraph-supervisor`. PostgresSaver requiere `@langchain/langgraph-checkpoint-postgres`. Ninguno está incluido en `@langchain/langgraph`.

**Métricas PRD-030:**
- 13 archivos creados, 6 modificados, 4 eliminados (deprecated code cleanup)
- 44 tests nuevos (5 archivos), 0 regresiones (2986 tests backend pasan)
- `MemorySaver` para MVP (MemorySaver in-memory; PRD-032 proveerá persistencia durable con MSSQL)
- RAG tool refactorizado: `config.configurable.userId` reemplaza closure `toolFactory(userId)`
- Slash commands preservados: `/bc`, `/search`, `/rag` bypass supervisor LLM
- `interrupt()` + `Command({ resume })` implementados con WebSocket `supervisor:resume`
- Old code eliminado: `router.ts`, `graph.ts`, `check_graph.ts`, `AgentFactory.ts`

### Fase 4: Handoffs con Command()
**Estado**: 🔴 No Iniciado
**Objetivo**: Delegación dinámica usando Command pattern nativo

| PRD | Componente | Estado |
|-----|------------|--------|
| [PRD-040](./PHASE-4-HANDOFFS/PRD-040-DynamicHandoffs.md) | Command(goto=...) pattern | 🔴 |

### Fase 5: Graphing Agent
**Estado**: 🔴 No Iniciado
**Objetivo**: Agente especializado en visualización de datos

| PRD | Componente | Estado |
|-----|------------|--------|
| [PRD-050](./PHASE-5-GRAPHING-AGENT/PRD-050-GraphingAgent.md) | GraphingAgent con Tremor UI | 🔴 |

> **Pre-requisitos**: Requiere `@langchain/langgraph-supervisor` y `@tremor/react`. El agent node debe retornar `currentAgentIdentity` (patrón establecido en PRD-020). Los datos se extraen de `state.messages` (no hay campo `plan` en el state; `createSupervisor()` maneja planes internamente).

### Fase 6: UI Components
**Estado**: 🔴 No Iniciado
**Objetivo**: UI para selección de agentes y visualización de planes

| PRD | Componente | Estado |
|-----|------------|--------|
| [PRD-060](./PHASE-6-UI/PRD-060-AgentSelector.md) | Agent Selector UI | 🔴 |
| [PRD-061](./PHASE-6-UI/PRD-061-PlanVisualization.md) | Plan Visualization Panel | 🔴 |

---

## 5. Decisiones Arquitectónicas

| Decisión | Elección | Justificación |
|----------|----------|---------------|
| **Patrón Orquestación** | `createSupervisor()` | Prebuilt, probado, reduce ~90% código custom |
| **Human-in-the-Loop** | `interrupt()` nativo | Eliminates custom ApprovalManager refactoring |
| **Handoffs** | `Command(goto=...)` | Pattern nativo, elimina HandoffManager |
| **Persistencia** | `PostgresSaver` checkpointer | Automatic state persistence |
| **Model Abstraction** | `initChatModel()` | Multi-provider, feature detection con profile |
| **Testing LLM** | LangSmith evaluations | No FakeChatModel - test real behavior |
| **Modelo Supervisor** | Haiku (económico) | Rápido y barato para routing |

---

## 6. Dependencias entre PRDs

```
FASE 0: Refactoring (Pre-requisito)
├── PRD-001: FileService ──────────────────────────────┐
├── PRD-002: ApprovalManager [DEPRECATED] ─────────────┤
├── PRD-003: AgentOrchestrator ────────────────────────┼──► FASE 0.5/1
├── PRD-004: FilesRoutes (depende de PRD-001) ─────────┤
└── PRD-005: MessageQueue (depende de todos) ──────────┘

FASE 0.5: Model Abstraction (NUEVA)
└── PRD-006: initChatModel Migration ─────────────────────► FASE 1

FASE 1: TDD Foundation
├── PRD-010: LangSmith Evaluations (reformulado) ──────┐
└── PRD-011: AgentRegistry (simplificado) ─────────────┴──► FASE 2

FASE 2: Extended State
└── PRD-020: MessagesAnnotation + AgentIdentity ──────────► FASE 3

FASE 3: Supervisor (PRD-030 ✅)
├── PRD-030: createSupervisor() Integration [✅ COMPLETADO] ──┐
├── PRD-031: [ELIMINADO] ─────────────────────────────────────┤
└── PRD-032: Persistencia Durable + Analytics ────────────────┴──► FASE 4

FASE 4: Handoffs
└── PRD-040: Command(goto=...) Pattern ───────────────────► FASE 5

FASE 5: Graphing Agent
└── PRD-050: GraphingAgent ───────────────────────────────► FASE 6

FASE 6: UI
├── PRD-060: AgentSelector
└── PRD-061: PlanVisualization ───────────────────────────► COMPLETADO
```

---

## 7. Métricas de Éxito

| Métrica | Target | Cómo Medir |
|---------|--------|------------|
| Líneas por archivo | < 300 | `wc -l` en archivos refactorizados |
| Código eliminado vs original | >= 60% | Comparar PRDs v1 vs v2 |
| Test coverage (deterministic) | >= 80% | Vitest coverage report |
| LangSmith eval pass rate | >= 90% | LangSmith dashboard |
| Latencia supervisor routing | < 300ms | LangSmith traces |
| Tests E2E pasando | 100% | CI/CD pipeline |
| Breaking changes API | 0 | Contract tests |

---

## 8. Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| `createSupervisor()` no cubre caso de uso | Baja | Alto | Evaluar primero con POC |
| `initChatModel()` no soporta Anthropic features | Media | Medio | Verificar beta features (PDF, caching) |
| LangSmith evaluations lentas | Media | Bajo | Usar `num_repetitions` bajo en CI |
| PostgresSaver performance | Baja | Medio | Índices apropiados en thread_id |
| Migración rompe flujos existentes | Media | Alto | Feature flags, gradual rollout |

---

## 9. Comandos de Verificación

```bash
# Type check completo
npm run verify:types

# Tests unitarios (deterministic only)
npm run -w backend test:unit

# Tests de integración
npm run -w backend test:integration

# LangSmith evaluations
npm run -w backend test:langsmith

# E2E
npm run test:e2e
```

---

## 10. Recursos Críticos

| Recurso | URL |
|---------|-----|
| LangGraph Supervisor (paquete separado) | https://www.npmjs.com/package/@langchain/langgraph-supervisor |
| LangGraph Prebuilts (createReactAgent) | https://langchain-ai.github.io/langgraphjs/reference/functions/langgraph_prebuilt.createReactAgent.html |
| initChatModel | https://js.langchain.com/docs/how_to/chat_models_universal_init/ |
| PostgresSaver | https://langchain-ai.github.io/langgraphjs/reference/classes/checkpoint_postgres.PostgresSaver.html |
| interrupt() | https://langchain-ai.github.io/langgraphjs/how-tos/human_in_the_loop/breakpoints/ |
| Command Pattern | https://langchain-ai.github.io/langgraphjs/how-tos/command/ |
| LangSmith Evaluation | https://docs.smith.langchain.com/evaluation |

---

## 11. Changelog

| Fecha | Versión | Cambios |
|-------|---------|---------|
| 2026-01-21 | 1.0 | Creación inicial del plan y estructura de PRDs |
| 2026-02-02 | 2.0 | Actualización con patrones nativos LangGraph, eliminación de PRD-031, deprecation de PRD-002, adición de PRD-006 |
| 2026-02-06 | 2.1 | PRD-011 completado. Corrección: `createSupervisor` requiere `@langchain/langgraph-supervisor` (paquete separado, no está en `@langchain/langgraph/prebuilt`). Actualizado ejemplo en §3.1 y PRD-030. |
| 2026-02-06 | 2.2 | PRD-020 completado (Fase 2). `ExtendedAgentStateAnnotation` con `currentAgentIdentity` y `AgentContext` enriquecido. Backward compat via alias. Corregidos imports erróneos de `createSupervisor` en PRD-032 y PRD-050. Corregido PRD-050 para usar `state.messages` en lugar de `state.plan?.steps` inexistente. Agregados pre-requisitos de instalación de paquetes en PRDs de Fase 3 y 5. |
| 2026-02-06 | 2.3 | **PRD-030 completado** (Fase 3 parcial). Supervisor Integration implementado: `createSupervisor()` + `createReactAgent()` + `MemorySaver` + `interrupt()`/`Command({ resume })`. 13 archivos creados, 6 modificados, 4 eliminados (deprecated code). 44 tests nuevos, 2986 tests totales pasando. `MemorySaver` como MVP checkpointer (PRD-032 proveerá MSSQL persistence). RAG tool refactorizado a static con `config.configurable`. Old routing eliminado (`router.ts`, `graph.ts`, `AgentFactory.ts`). PRD-032 desbloqueado. |
