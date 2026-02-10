# PRD-070: Agent-Specific UI Rendering Framework

**Estado**: ✅ Completado - 2026-02-09
**Prioridad**: Alta
**Dependencias**: PRD-050 (Graphing Agent), PRD-060 (Agent Selector UI)
**Bloquea**: PRD-071 (RAG Citation UI)

---

## 1. Objetivo

Establecer un patron frontend donde:

1. **Cada mensaje muestra que agente lo genero** (per-message agent attribution via `AgentBadge`)
2. Cada agente puede producir output especializado que recibe **rendering custom** en vez de markdown plano

El framework provee:

- **Per-message agent attribution**: Cada mensaje de assistant muestra un badge con el agente que lo genero (nombre, icono, color)
- Un **discriminador estandar** (`_type`) en payloads de tool results para identificar el tipo de rendering
- Un **renderer registry** extensible que mapea `_type` valores a componentes React
- Integracion transparente con `MessageList.tsx` existente sin romper backward compatibility
- Soporte para agregar nuevos renderers sin modificar codigo existente (open/closed principle)

---

## 2. Contexto

### 2.1 Problema Actual

**Agent attribution**: Actualmente los mensajes no indican que agente los genero. El tipo `Message` en `@bc-agent/shared` no tiene campo de identidad de agente. Solo existe un tracking global (`agentStateStore.currentAgentIdentity`) que se actualiza con eventos `agent_changed`, pero los mensajes individuales no llevan esta informacion. En un flujo multi-agente (Supervisor -> BC Agent -> RAG Agent -> Graphing Agent), el usuario no puede ver que agente produjo cada respuesta. El componente `AgentBadge` ya existe (PRD-060) pero no se usa en mensajes.

**Tool result rendering**: Todos los tool results se renderizan como JSON formateado o texto plano en el chat. Esto es inadecuado para:
- **Graficas** (PRD-050): Un JSON de chart config deberia renderizarse como un `<BarChart>` interactivo de Tremor
- **Citaciones** (PRD-071): Un resultado de RAG deberia mostrar citation cards interactivas con excerpts y relevance scores
- **Entidades BC** (futuro): Un resultado de Business Central podria mostrar entity cards con acciones

### 2.2 Patron: Tool Result Discriminator

Cada agente que produce output especializado incluye un campo `_type` en su tool result:

```typescript
// Graphing Agent tool result (PRD-050)
{
  _type: 'chart_config',
  chartType: 'bar',
  title: 'Revenue by Quarter',
  data: [...],
  // ...
}

// RAG Agent tool result (PRD-071)
{
  _type: 'citation_result',
  citations: [...],
  summary: '...',
  // ...
}

// Default (no _type or unrecognized _type)
// Falls back to MarkdownRenderer
```

### 2.3 Pre-requisitos

- PRD-050 (Graphing Agent): Define `_type: 'chart_config'` en `ChartConfigSchema`
- PRD-060 (Agent Selector): Provides `AgentBadge` y event handling infrastructure
- `@bc-agent/shared`: Types compartidos entre backend y frontend

---

## 3. Diseno Propuesto

### 3.1 Per-Message Agent Attribution

#### 3.1.1 Cambio en tipos de mensaje (`@bc-agent/shared`)

Agregar campo opcional `agent_identity` a los tipos base de mensaje:

```typescript
// En message.types.ts - agregar a MessageBase o a cada tipo de mensaje assistant
import type { AgentIdentity } from './agent-identity.types';

// Campo adicional en StandardMessage, ThinkingMessage, ToolUseMessage, ToolResultMessage
/** Identity of the agent that generated this message. Only present for role='assistant' messages. */
agent_identity?: AgentIdentity;
```

El campo es opcional para mantener backward compatibility (mensajes historicos no lo tendran).

#### 3.1.2 Backend: Incluir agent identity en eventos emitidos

El backend ya detecta la identidad del agente activo via `detectAgentIdentity()` en `result-adapter.ts` y la emite en eventos `agent_changed`. El cambio necesario es **propagar** esa identidad a los eventos de mensaje:

```typescript
// En la emision de eventos 'message', 'tool_use', 'tool_result', 'thinking_complete'
// Incluir el agentIdentity del agente que los produjo

// Opcion de implementacion:
// 1. El BatchResultNormalizer ya tiene acceso al state que contiene handoffs/agent info
// 2. Cada NormalizedEvent puede llevar un campo agent_identity
// 3. Al emitir via WebSocket, el campo se propaga al frontend
```

Datos disponibles en backend (ya existentes):
- `detectAgentIdentity(messages)` retorna `AgentIdentity` del ultimo agente activo
- `AGENT_DISPLAY_NAME`, `AGENT_ICON`, `AGENT_COLOR` constantes en `@bc-agent/shared`
- Eventos `agent_changed` ya llevan `currentAgent: AgentIdentity`

#### 3.1.3 Frontend: Almacenar agent identity por mensaje

En `processAgentEventSync.ts`, al crear mensajes en el store, incluir la identidad del agente:

```typescript
// Estrategia: usar agentStateStore.currentAgentIdentity al momento de crear el mensaje
// ya que agent_changed siempre se emite ANTES de los mensajes del agente

case 'message': {
  const currentAgent = agentStateStore.getState().currentAgentIdentity;
  messageStore.getState().addMessage({
    // ...existing fields
    agent_identity: currentAgent ?? undefined,
  });
  break;
}

case 'tool_use': {
  const currentAgent = agentStateStore.getState().currentAgentIdentity;
  messageStore.getState().addMessage({
    // ...existing fields
    agent_identity: currentAgent ?? undefined,
  });
  break;
}
```

#### 3.1.4 Frontend: Renderizar AgentBadge en MessageBubble

El componente `AgentBadge` (PRD-060) ya existe. Integrarlo en `MessageBubble.tsx`:

```tsx
// En MessageBubble.tsx
import { AgentBadge } from './AgentBadge';

// Para mensajes de assistant que tengan agent_identity
{message.role === 'assistant' && message.agent_identity && (
  <AgentBadge
    agentId={message.agent_identity.agentId}
    agentName={message.agent_identity.agentName}
    agentIcon={message.agent_identity.agentIcon}
    agentColor={message.agent_identity.agentColor}
    size="sm"
  />
)}
```

#### 3.1.5 Diseno Visual

```
┌─────────────────────────────────────────────────┐
│  🏢 BC Agent                                    │  <-- AgentBadge (sm)
│  Found 5 customers matching "Contoso":          │
│  1. Contoso Ltd (CU001)                         │
│  2. Contoso Electronics (CU002)                 │
│  ...                                            │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│  🧠 RAG Agent                                   │  <-- Badge diferente
│  Found relevant contract clauses for Contoso:   │
│  [CitationCard]  [CitationCard]                 │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│  📈 Graphing Agent                              │  <-- Badge diferente
│  [BarChart: Revenue by Quarter]                 │
└─────────────────────────────────────────────────┘
```

Cada mensaje de assistant muestra claramente que agente lo genero. Los tool_use cards tambien muestran el badge del agente que invoco la tool.

> **Nota**: PRD-061 (Agent Activity Timeline) fue **ELIMINADO** ya que la per-message attribution provee la misma visibilidad de forma mas natural e integrada en el flujo del chat.

---

### 3.2 Estructura de Archivos - Agent Result Rendering (Frontend)

```
frontend/src/components/chat/AgentResultRenderer/
├── AgentResultRenderer.tsx      # Main renderer (switch on _type)
├── rendererRegistry.ts          # Extensible registry of _type -> Component
├── types.ts                     # Renderer types
└── index.ts

frontend/src/components/chat/ChartRenderer/
├── ChartRenderer.tsx            # Chart rendering (PRD-050)
├── charts/
│   └── ... (10 chart views)
└── index.ts

frontend/src/components/chat/CitationRenderer/
├── CitationRenderer.tsx         # Citation rendering (PRD-071)
├── CitationCard.tsx
├── CitationList.tsx
└── index.ts
```

### 3.3 Shared Package Types (`@bc-agent/shared`)

```typescript
// types/agent-rendered-result.types.ts

/**
 * Base type for all agent-produced renderable results.
 * The `_type` field is the discriminator that the frontend uses
 * to select the appropriate renderer component.
 */
export interface AgentRenderedResultBase {
  /** Discriminator for renderer selection */
  _type: string;
}

/**
 * Known rendered result types.
 * Extensible: new types added here as new renderers are created.
 */
export type AgentRenderedResultType =
  | 'chart_config'      // PRD-050: Tremor chart visualization
  | 'citation_result'   // PRD-071: RAG citation cards
  | 'bc_entity';        // Future: Business Central entity card

/**
 * Type guard to check if a value is a renderable result
 */
export function isAgentRenderedResult(value: unknown): value is AgentRenderedResultBase {
  return (
    typeof value === 'object' &&
    value !== null &&
    '_type' in value &&
    typeof (value as Record<string, unknown>)._type === 'string'
  );
}
```

### 3.4 Renderer Registry

```typescript
// rendererRegistry.ts
import type { ComponentType } from 'react';
import type { AgentRenderedResultType } from '@bc-agent/shared';

/**
 * Props interface for all renderer components.
 * Each renderer receives the full tool result data.
 */
export interface RendererProps<T = unknown> {
  data: T;
}

/**
 * Registry mapping _type values to React components.
 * Lazy-loaded to avoid importing all chart/citation code upfront.
 */
const registry: Record<string, () => Promise<{ default: ComponentType<RendererProps> }>> = {};

/**
 * Register a renderer for a specific _type value.
 * Called during app initialization.
 */
export function registerRenderer(
  type: AgentRenderedResultType,
  loader: () => Promise<{ default: ComponentType<RendererProps> }>
): void {
  registry[type] = loader;
}

/**
 * Get the renderer loader for a given _type.
 * Returns null if no renderer is registered.
 */
export function getRendererLoader(
  type: string
): (() => Promise<{ default: ComponentType<RendererProps> }>) | null {
  return registry[type] ?? null;
}

// ============================================
// Default registrations
// ============================================

// PRD-050: Chart rendering
registerRenderer('chart_config', () =>
  import('@/components/chat/ChartRenderer').then(m => ({ default: m.ChartRenderer as ComponentType<RendererProps> }))
);

// PRD-071: Citation rendering
registerRenderer('citation_result', () =>
  import('@/components/chat/CitationRenderer').then(m => ({ default: m.CitationRenderer as ComponentType<RendererProps> }))
);
```

### 3.5 AgentResultRenderer Component

```tsx
// AgentResultRenderer.tsx
import { Suspense, lazy, useMemo } from 'react';
import { isAgentRenderedResult } from '@bc-agent/shared';
import { getRendererLoader } from './rendererRegistry';

interface AgentResultRendererProps {
  /** Raw tool result content */
  result: unknown;
  /** Fallback renderer for non-specialized results */
  fallback?: React.ReactNode;
}

/**
 * Renders agent tool results using specialized renderers based on _type discriminator.
 * Falls back to default rendering (JSON/markdown) for unrecognized types.
 */
export function AgentResultRenderer({ result, fallback }: AgentResultRendererProps) {
  // Check if result has a _type discriminator
  if (!isAgentRenderedResult(result)) {
    return <>{fallback}</>;
  }

  const loader = getRendererLoader(result._type);
  if (!loader) {
    return <>{fallback}</>;
  }

  // Lazy load the appropriate renderer
  const LazyRenderer = useMemo(() => lazy(loader), [loader]);

  return (
    <Suspense fallback={
      <div className="animate-pulse h-48 bg-gray-100 dark:bg-gray-800 rounded-lg" />
    }>
      <LazyRenderer data={result} />
    </Suspense>
  );
}
```

### 3.6 Integration con MessageList.tsx

```tsx
// In MessageList.tsx - updated tool_result rendering
import { AgentResultRenderer } from '../AgentResultRenderer';

function renderToolResult(toolResult: ToolResultEvent) {
  return (
    <AgentResultRenderer
      result={toolResult.result}
      fallback={
        <MarkdownRenderer content={formatToolResult(toolResult)} />
      }
    />
  );
}
```

**Backward compatibility**: Si un tool result no tiene `_type` o tiene un `_type` no reconocido, el fallback `MarkdownRenderer` maneja el rendering como antes. No hay breaking changes.

---

## 4. Backend Contract

### 4.1 Como Agentes Producen Resultados Renderizables

Cada agente tool que produce output especializado debe:

1. Incluir `_type` como campo en su output schema (Zod)
2. El `_type` value debe ser un literal constante (e.g., `z.literal('chart_config')`)
3. El schema completo debe estar en `@bc-agent/shared` para type safety end-to-end

**Ejemplo (Graphing Agent, PRD-050)**:
```typescript
// En generate_chart_config tool output
const result = {
  valid: true,
  config: {
    _type: 'chart_config',  // Discriminador
    chartType: 'bar',
    title: 'Revenue by Quarter',
    data: [...],
    // ...validated config
  },
};
```

**Ejemplo (RAG Agent, PRD-071)**:
```typescript
// En knowledgeSearchTool output
const result = {
  _type: 'citation_result',  // Discriminador
  citations: [...],
  summary: '...',
  totalResults: 5,
};
```

### 4.2 Validacion en Result Adapter

El `result-adapter.ts` no necesita cambios. Los tool results ya se propagan como `unknown` al frontend via `tool_result` events. La discriminacion ocurre enteramente en el frontend.

### 4.3 Event Flow

```
Backend Agent Tool -> tool_result event -> WebSocket -> Frontend
                                                           |
                                                   MessageList.tsx
                                                           |
                                                   renderToolResult()
                                                           |
                                                   AgentResultRenderer
                                                           |
                                          ┌────────────────┼────────────────┐
                                          │                │                │
                                   _type='chart_config' _type='citation_result'  no _type
                                          │                │                │
                                   ChartRenderer   CitationRenderer   MarkdownRenderer
                                   (PRD-050)       (PRD-071)          (existing)
```

---

## 5. Tests Requeridos

### 5.1 Per-Message Agent Attribution Tests

```typescript
describe('per-message agent attribution', () => {
  describe('processAgentEventSync - agent identity propagation', () => {
    it('attaches currentAgentIdentity to assistant StandardMessage');
    it('attaches currentAgentIdentity to ToolUseMessage');
    it('attaches currentAgentIdentity to ThinkingMessage');
    it('sets agent_identity as undefined when no currentAgentIdentity');
    it('does not attach agent_identity to user messages');
  });

  describe('MessageBubble - AgentBadge rendering', () => {
    it('renders AgentBadge for assistant messages with agent_identity');
    it('does not render AgentBadge for user messages');
    it('does not render AgentBadge when agent_identity is undefined');
    it('passes correct agentName, agentIcon, agentColor to AgentBadge');
    it('renders AgentBadge on ToolCard when agent_identity present');
  });
});
```

### 5.2 Agent Result Renderer Unit Tests

```typescript
describe('isAgentRenderedResult', () => {
  it('returns true for object with _type string field');
  it('returns false for null');
  it('returns false for object without _type');
  it('returns false for object with non-string _type');
  it('returns false for primitive values');
});

describe('rendererRegistry', () => {
  it('registers renderer for chart_config');
  it('registers renderer for citation_result');
  it('returns null for unregistered type');
  it('returns loader function for registered type');
});
```

### 5.3 Agent Result Renderer Component Tests

```typescript
describe('AgentResultRenderer', () => {
  it('renders fallback when result has no _type');
  it('renders fallback for unrecognized _type');
  it('lazy-loads ChartRenderer for chart_config _type');
  it('lazy-loads CitationRenderer for citation_result _type');
  it('shows loading skeleton during lazy load');
});
```

---

## 6. Criterios de Aceptacion

### Per-Message Agent Attribution
- [x] `Message` types include optional `agent_identity?: AgentIdentity` field
- [x] `processAgentEventSync` attaches `currentAgentIdentity` to assistant messages at creation time
- [x] `MessageBubble` renders `AgentBadge` for assistant messages with `agent_identity`
- [x] `ToolCard` renders `AgentBadge` for tool messages with `agent_identity`
- [x] No badge rendered for user messages or messages without `agent_identity`
- [x] Backward compatible: historic messages without `agent_identity` render normally

### Agent Result Rendering
- [x] `isAgentRenderedResult()` type guard exported from `@bc-agent/shared`
- [x] `AgentRenderedResultType` union type exported from `@bc-agent/shared`
- [x] Renderer registry is extensible (new renderers can be added without modifying existing code)
- [x] `chart_config` renders via `ChartRenderer` (PRD-050)
- [x] `citation_result` renders via `CitationRenderer` placeholder (PRD-071 implementation pending)
- [x] Unknown `_type` values fall back to JSON fallback
- [x] Missing `_type` falls back to JSON fallback
- [x] Renderers are lazy-loaded (code splitting)
- [x] Loading skeleton shown during lazy load
- [x] No breaking changes to existing tool result rendering

### Database & Persistence (Added during implementation)
- [x] `agent_id` column added to `messages` table with `idx_messages_agent_id` index
- [x] `MessageService.ts` migrated from raw SQL (`executeQuery`) to Prisma Client (7 methods)
- [x] `MessagePersistenceWorker.ts` migrated from raw MERGE SQL to `prisma.messages.upsert()`
- [x] `agentId` threaded through `MessagePersistenceJob` type and queue facade
- [x] `messageTransformer.ts` reconstructs `agent_identity` from `agent_id` + shared constants

### ChartRenderer (PRD-050 Frontend - 10 chart types)
- [x] `recharts` installed as charting engine (Tremor copy-paste approach, no `@tremor/react` npm dep)
- [x] 10 chart view components: Bar, StackedBar, Line, Area, Donut, BarList, Combo, Kpi, KpiGrid, Table
- [x] Color utility (`chartUtils.ts`) with 9 Tremor named colors mapped to hex
- [x] Dark mode support via Tailwind dark: variants
- [x] Interactive features: tooltips, legend filtering, active dot states, legend scroll

### General
- [x] `npm run verify:types` pasa (0 errors)
- [x] `npm run -w bc-agent-frontend test` pasa (697 tests, 0 failures)
- [x] `npm run -w backend test:unit` pasa (3105 tests, 0 failures)
- [x] `npm run -w backend build` pasa (552 files compiled)

---

## 7. Archivos a Crear

| # | Archivo | Descripcion |
|---|---------|-------------|
| 1 | `packages/shared/src/types/agent-rendered-result.types.ts` | Base type, type union, type guard |
| 2 | `frontend/src/components/chat/AgentResultRenderer/AgentResultRenderer.tsx` | Main renderer component |
| 3 | `frontend/src/components/chat/AgentResultRenderer/rendererRegistry.ts` | Extensible registry |
| 4 | `frontend/src/components/chat/AgentResultRenderer/types.ts` | Renderer props interface |
| 5 | `frontend/src/components/chat/AgentResultRenderer/index.ts` | Barrel export |
| 6 | Tests correspondientes |

---

## 8. Archivos a Modificar

| # | Archivo | Cambio |
|---|---------|--------|
| 1 | `packages/shared/src/types/message.types.ts` | Add `agent_identity?: AgentIdentity` to assistant message types |
| 2 | `packages/shared/src/index.ts` | Export `isAgentRenderedResult`, `AgentRenderedResultType` |
| 3 | `frontend/src/domains/chat/services/processAgentEventSync.ts` | Attach `currentAgentIdentity` when creating messages |
| 4 | `frontend/src/components/chat/MessageBubble.tsx` | Render `AgentBadge` for assistant messages with `agent_identity` |
| 5 | `frontend/src/components/chat/ToolCard.tsx` | Render `AgentBadge` for tool cards with `agent_identity` |
| 6 | `frontend/src/components/chat/MessageList.tsx` | Use `AgentResultRenderer` for tool results |

---

## 9. Estimacion

| Componente | Dias |
|-----------|------|
| Per-message agent attribution (types + event processing + UI) | 1-2 |
| Shared package types + type guard (result rendering) | 0.5 |
| Renderer registry + AgentResultRenderer | 1-2 |
| Integration with MessageList.tsx | 0.5-1 |
| Testing | 1-2 |
| **Total** | **4-7 dias** |

---

## 10. Changelog

| Fecha | Version | Cambios |
|-------|---------|---------|
| 2026-02-09 | 1.0 | Draft inicial. Framework de rendering agent-specific con discriminador `_type`, renderer registry lazy-loaded, integracion con MessageList.tsx. Soporta `chart_config` (PRD-050) y `citation_result` (PRD-071) con fallback a MarkdownRenderer. |
| 2026-02-09 | 1.1 | Agregado per-message agent attribution (seccion 3.1). Cada mensaje de assistant muestra `AgentBadge` con el agente que lo genero. Campo `agent_identity?: AgentIdentity` agregado a tipos de mensaje. PRD-061 (Agent Activity Timeline) ELIMINADO - esta funcionalidad lo reemplaza. |
| 2026-02-09 | 2.0 | **IMPLEMENTACIÓN COMPLETADA**. Diferencias vs draft: (1) Componentes ubicados en `frontend/src/presentation/chat/` (no `components/chat/`) siguiendo estructura existente del proyecto; (2) ChartRenderer usa `recharts` directamente (Tremor copy-paste approach), NO `@tremor/react` npm package — compatible con TW4 + React 19; (3) `combo` chart type en lugar de `scatter` (consistente con PRD-050 backend); (4) Fallback usa `JsonView` existente, no `MarkdownRenderer`; (5) `MessageService.ts` y `MessagePersistenceWorker.ts` migrados completamente de raw SQL (`executeQuery`) a Prisma Client; (6) `agent_id` column + index agregado a tabla `messages` en Prisma schema; (7) `messageTransformer.ts` reconstruye `agent_identity` desde `agent_id` + constants de `@bc-agent/shared`. **Archivos**: 22+ creados (shared types, renderer framework, 10 chart views, chart utils, citation placeholder, tests), 12 modificados (shared index, Prisma schema, MessageService, MessagePersistenceWorker, jobs types, messageTransformer, processAgentEventSync, MessageBubble, ToolCard, ChatContainer). **Tests**: 3105 backend + 697 frontend, 0 regresiones. **Dependencias instaladas**: `recharts` en frontend workspace. |
