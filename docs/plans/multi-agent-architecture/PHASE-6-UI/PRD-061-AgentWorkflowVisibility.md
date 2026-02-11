# PRD-061: Agent Workflow Visibility

**Estado**: ✅ COMPLETADO
**Fecha**: 2026-02-11
**Fase**: 6 (UI)
**Dependencias**: PRD-020 (Extended State), PRD-040 (Handoffs), PRD-062 (Tool Enforcement)

---

## Problema

El usuario solo ve mensajes planos en el chat. No ve:
- Transiciones entre agentes (supervisor → bc-agent → supervisor)
- Thinking de sub-agentes
- Tool calls intermedias
- Handoffs y sus razones

El backend emite `agent_changed` events con toda la info pero el frontend los ignora — solo actualiza estado interno sin crear elementos visuales.

---

## Solución

### Shared Package

**`isInternal` field**: Nuevo campo booleano opcional en `BaseAgentEvent` y `BaseMessage` que marca eventos/mensajes como artefactos internos del workflow.

### Backend

1. **MessageNormalizer.ts**: En vez de FILTRAR handoff-back messages, los TAG con `isInternal: true`
2. **BatchResultNormalizer.ts**: Marca `transfer_to_*` tool events con `isInternal: true`
3. **ExecutionPipeline.ts**: Popula `handoffType` en eventos `agent_changed`
4. **EventConverter.ts**: Propaga `isInternal` de NormalizedEvent a AgentEvent

### Frontend

#### Stores
- **agentWorkflowStore**: Tracks `AgentProcessingGroup[]` durante cada turno
  - `startTurn()`: Reset al inicio de sesión
  - `addGroup()`: Nuevo grupo en `agent_changed`
  - `addMessageToCurrentGroup()`: Asocia mensajes al grupo activo
  - `markLastGroupFinal()`: Marca el último grupo en `complete`
  - `reconstructFromMessages()`: Reconstruye desde `agent_identity` en session reload
- **uiPreferencesStore**: Toggle `showAgentWorkflow` (persistido en localStorage)

#### Event Processing
- **processAgentEventSync.ts**: Integra workflow store
  - `session_start` → `startTurn()`
  - `agent_changed` → `addGroup()`
  - `thinking_complete`, `tool_use`, `message` → `addMessageToCurrentGroup()`
  - `complete` → `markLastGroupFinal()` + `endTurn()`

#### UI Components
- **AgentProcessingSection**: Sección colapsable por agente (shadcn Collapsible)
  - Header: icon + nombre + color + badge de steps + chevron toggle
  - Contenido: thinking, tools, mensajes intermedios
  - Borde izquierdo con color del agente
- **AgentTransitionIndicator**: Divider horizontal entre secciones
  - `icon_from → icon_to` + tipo de handoff + reason
- **ChatContainer**: Renderizado condicional
  - Si `showAgentWorkflow && hasGroups`: render por secciones colapsables
  - Mensajes finales (end_turn, !isInternal) fuera del collapsible
  - Fallback: render plano para sesiones sin grupos
- **InputOptionsBar**: Toggle "Workflow" con icono Layers

### Clasificación de Mensajes

| Tipo | Clasificación | Dónde se muestra |
|------|---------------|------------------|
| `assistant_message` con `stopReason: 'end_turn'` y `!isInternal` | Relevante | Fuera del collapsible |
| `thinking_complete` | Interno | Dentro del collapsible del agente |
| `tool_use` / `tool_result` (no-transfer) | Interno | Dentro del collapsible del agente |
| `assistant_message` con `isInternal: true` | Interno | Dentro del collapsible del agente |
| `assistant_message` con `stopReason: 'tool_use'` | Interno | Dentro del collapsible del agente |
| `agent_changed` events | Transición | Divider visual entre secciones |

---

## Persistencia

- Transiciones (`agent_changed`) siguen siendo **transient** — no se persisten en DB
- Al recargar sesión, `reconstructFromMessages()` reconstruye grupos desde `agent_identity`
- Handoff-back messages ahora se persisten como `assistant_message` con `isInternal: true`

---

## Verificación

```bash
# Build shared
npm run build:shared

# Type check
npm run verify:types

# Backend tests
npm run -w backend test:unit

# Frontend tests
npm run -w bc-agent-frontend test

# Manual: verificar secciones colapsables, transiciones, toggle
```

---

## Archivos Creados/Modificados

### Shared
| Archivo | Cambio |
|---------|--------|
| `packages/shared/src/types/agent.types.ts` | `isInternal?: boolean` en BaseAgentEvent |
| `packages/shared/src/types/message.types.ts` | `isInternal?: boolean` en BaseMessage |
| `packages/shared/src/types/normalized-events.types.ts` | `isInternal?: boolean` en BaseNormalizedEvent |

### Backend
| Archivo | Cambio |
|---------|--------|
| `backend/src/shared/providers/normalizers/MessageNormalizer.ts` | Tag en vez de filtrar |
| `backend/src/shared/providers/normalizers/BatchResultNormalizer.ts` | `isInternal` en transfer tools |
| `backend/src/domains/agent/orchestration/execution/ExecutionPipeline.ts` | `handoffType` en agent_changed |
| `backend/src/domains/agent/orchestration/events/EventConverter.ts` | Propagar isInternal |

### Frontend
| Archivo | Cambio |
|---------|--------|
| `frontend/src/domains/chat/stores/agentWorkflowStore.ts` | **NUEVO** |
| `frontend/src/domains/chat/hooks/useAgentWorkflow.ts` | **NUEVO** |
| `frontend/src/domains/ui/stores/uiPreferencesStore.ts` | Toggle showAgentWorkflow |
| `frontend/src/domains/chat/services/processAgentEventSync.ts` | Workflow group integration |
| `frontend/src/presentation/chat/AgentProcessingSection.tsx` | **NUEVO** |
| `frontend/src/presentation/chat/AgentTransitionIndicator.tsx` | **NUEVO** |
| `frontend/components/chat/ChatContainer.tsx` | Conditional workflow rendering |
| `frontend/src/presentation/chat/InputOptionsBar.tsx` | Workflow toggle |
| `frontend/components/chat/ChatInput.tsx` | Wire workflow toggle |
