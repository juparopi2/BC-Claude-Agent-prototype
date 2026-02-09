# PRD-070: Agent-Specific UI Rendering Framework

**Estado**: Draft
**Prioridad**: Alta
**Dependencias**: PRD-050 (Graphing Agent), PRD-060 (Agent Selector UI)
**Bloquea**: PRD-071 (RAG Citation UI)

---

## 1. Objetivo

Establecer un patron frontend donde cada agente puede producir output especializado que recibe **rendering custom** en vez de markdown plano. El framework provee:

- Un **discriminador estandar** (`_type`) en payloads de tool results para identificar el tipo de rendering
- Un **renderer registry** extensible que mapea `_type` valores a componentes React
- Integracion transparente con `MessageList.tsx` existente sin romper backward compatibility
- Soporte para agregar nuevos renderers sin modificar codigo existente (open/closed principle)

---

## 2. Contexto

### 2.1 Problema Actual

Hoy, todos los tool results se renderizan como JSON formateado o texto plano en el chat. Esto es inadecuado para:
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

### 3.1 Estructura de Archivos (Frontend)

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

### 3.2 Shared Package Types (`@bc-agent/shared`)

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

### 3.3 Renderer Registry

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

### 3.4 AgentResultRenderer Component

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

### 3.5 Integration con MessageList.tsx

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

### 5.1 Unit Tests

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

### 5.2 Component Tests

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

- [ ] `isAgentRenderedResult()` type guard exported from `@bc-agent/shared`
- [ ] `AgentRenderedResultType` union type exported from `@bc-agent/shared`
- [ ] Renderer registry is extensible (new renderers can be added without modifying existing code)
- [ ] `chart_config` renders via `ChartRenderer` (PRD-050)
- [ ] `citation_result` renders via `CitationRenderer` (PRD-071)
- [ ] Unknown `_type` values fall back to `MarkdownRenderer`
- [ ] Missing `_type` falls back to `MarkdownRenderer`
- [ ] Renderers are lazy-loaded (code splitting)
- [ ] Loading skeleton shown during lazy load
- [ ] No breaking changes to existing tool result rendering
- [ ] `npm run verify:types` pasa
- [ ] `npm run -w bc-agent-frontend test` pasa

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
| 1 | `packages/shared/src/index.ts` | Export `isAgentRenderedResult`, `AgentRenderedResultType` |
| 2 | `frontend/src/components/chat/MessageList.tsx` | Use `AgentResultRenderer` for tool results |

---

## 9. Estimacion

| Componente | Dias |
|-----------|------|
| Shared package types + type guard | 0.5 |
| Renderer registry + AgentResultRenderer | 1-2 |
| Integration with MessageList.tsx | 0.5-1 |
| Testing | 1 |
| **Total** | **3-4 dias** |

---

## 10. Changelog

| Fecha | Version | Cambios |
|-------|---------|---------|
| 2026-02-09 | 1.0 | Draft inicial. Framework de rendering agent-specific con discriminador `_type`, renderer registry lazy-loaded, integracion con MessageList.tsx. Soporta `chart_config` (PRD-050) y `citation_result` (PRD-071) con fallback a MarkdownRenderer. |
