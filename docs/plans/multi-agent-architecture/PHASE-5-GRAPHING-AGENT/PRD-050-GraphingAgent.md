# PRD-050: Graphing Agent (Data Visualization) - v2.0

**Estado**: Draft
**Prioridad**: Media
**Dependencias**: PRD-011 (Agent Registry), PRD-020 (Extended State), PRD-040 (Dynamic Handoffs)
**Bloquea**: PRD-070 (Agent-Specific Rendering Framework)

---

## 1. Objetivo

Implementar un agente especializado en visualizacion de datos que:
- Genera configuraciones de graficas a partir de datos usando una **arquitectura catalog-driven**
- Soporta **10 tipos de graficas** con Zod schemas estrictos por tipo
- Usa **Tremor UI** components para renderizado en frontend
- Produce resultados con `_type: 'chart_config'` para rendering especializado (PRD-070)
- Se integra con BC-Agent y RAG-Agent via handoffs bidireccionales (PRD-040)

---

## 2. Contexto

### 2.1 Por que un Agente Separado

1. **Especializacion**: Visualizacion requiere conocimiento especifico de tipos de graficas, data shapes, y mejores practicas de presentacion
2. **Reutilizacion**: Puede ser invocado por BC-Agent (datos ERP) o RAG-Agent (datos de documentos) via handoffs
3. **Flexibilidad**: Frontend puede evolucionar los componentes de graficas independientemente
4. **Performance**: Modelo optimizado para generacion de schemas JSON, no requiere extended thinking

### 2.2 Pre-requisitos de Paquetes

Solo se requiere instalar el paquete de UI en frontend:

```bash
# Frontend - Tremor UI para renderizar visualizaciones
npm install @tremor/react
```

> **NOTA**: No se requiere `@langchain/langgraph-checkpoint-postgres` - el sistema usa `MSSQLSaver` (PRD-032). `@langchain/langgraph-supervisor` ya esta instalado (PRD-030).

### 2.3 ExtendedAgentState (PRD-020)

El Graphing Agent utiliza `ExtendedAgentState` (implementado en PRD-020), que incluye:
- `currentAgentIdentity`: Cada agent node retorna su identidad para el UI
- `context`: Contexto compartido con `searchContext`, `bcCompanyId`, `metadata`

> **NOTA**: No existe campo `state.plan` en `ExtendedAgentState`. `createSupervisor()` maneja planes internamente. El Graphing Agent obtiene datos de `state.messages` (tool results previos de otros agentes).

### 2.4 Tremor UI Library

[Tremor](https://www.tremor.so/) es una libreria React para dashboards y visualizacion de datos:
- **Componentes nativos**: `BarChart`, `LineChart`, `AreaChart`, `DonutChart`, `ScatterChart`, `BarList`
- **TypeScript-first**, Tailwind-based
- **Componentes custom**: `KPICard` y `DataTable` se construyen con Tremor primitives (Card, Table)

### 2.5 Arquitectura Catalog-Driven

En lugar de tools genericos que intentan adivinar el tipo de grafica, el Graphing Agent usa un **catalogo de tipos** que el LLM puede navegar:

1. **`list_chart_types`**: LLM descubre los 10 tipos disponibles y sus casos de uso
2. **`get_chart_schema`**: LLM obtiene el schema exacto (campos, constraints, ejemplo) para un tipo especifico
3. **`generate_chart_config`**: LLM produce la configuracion y el tool la valida contra Zod

Este patron elimina la ambiguedad y reduce errores de generacion.

---

## 3. Chart Type Catalog (10 Tipos)

| # | Type ID | Tremor Component | Data Shape | Min/Max | Business Use |
|---|---------|-----------------|------------|---------|-------------|
| 1 | `bar` | `<BarChart>` | `Record[], index, categories` | 1-100 rows, 1-10 cats | Revenue by quarter, sales comparison |
| 2 | `stacked_bar` | `<BarChart type="stacked">` | `Record[], index, categories` | 1-100 rows, 2-10 cats | Revenue composition, cost breakdown |
| 3 | `line` | `<LineChart>` | `Record[], index, categories` | 2-500 rows, 1-10 cats | Monthly trends, cash flow, time series |
| 4 | `area` | `<AreaChart>` | `Record[], index, categories` | 2-500 rows, 1-10 cats | Cumulative revenue, market share |
| 5 | `donut` | `<DonutChart>` | `{name, value}[]` | 2-12 segments | Expense distribution, revenue segments |
| 6 | `bar_list` | `<BarList>` | `{name, value}[]` | 1-30 items | Top N rankings, performance |
| 7 | `kpi` | Custom `<KPICard>` | Single metric object | 1 metric | Total revenue, YoY growth |
| 8 | `kpi_grid` | Grid of `<KPICard>` | Array of metrics | 2-8 KPIs | Dashboard overview, summary panels |
| 9 | `table` | Custom `<DataTable>` | `Record[], columns` | 1-500 rows, 1-20 cols | Transaction details, inventory list |
| 10 | `scatter` | `<ScatterChart>` | `Record[], x, y, category` | 2-200 points | Price/volume correlation, profitability |

### 3.1 Zod Schemas por Tipo

Cada tipo tiene su **schema Zod** con validaciones estrictas. Todos los schemas incluyen `_type: z.literal('chart_config')` como discriminador para el frontend (PRD-070).

```typescript
// Shared base fields
const ChartBaseSchema = z.object({
  _type: z.literal('chart_config'),
  chartType: z.string(),
  title: z.string().min(1).max(200),
  subtitle: z.string().max(300).optional(),
});

// 1. Bar Chart
const BarChartConfigSchema = ChartBaseSchema.extend({
  chartType: z.literal('bar'),
  data: z.array(z.record(z.union([z.string(), z.number()]))).min(1).max(100),
  index: z.string().min(1),
  categories: z.array(z.string()).min(1).max(10),
  colors: z.array(z.string()).max(10).optional(),
  layout: z.enum(['vertical', 'horizontal']).default('vertical'),
  showLegend: z.boolean().default(true),
  showGridLines: z.boolean().default(true),
  valueFormatter: z.string().optional(),
  xAxisLabel: z.string().optional(),
  yAxisLabel: z.string().optional(),
});

// 2. Stacked Bar Chart
const StackedBarChartConfigSchema = ChartBaseSchema.extend({
  chartType: z.literal('stacked_bar'),
  data: z.array(z.record(z.union([z.string(), z.number()]))).min(1).max(100),
  index: z.string().min(1),
  categories: z.array(z.string()).min(2).max(10), // min 2: stacking requires multiple series
  colors: z.array(z.string()).max(10).optional(),
  layout: z.enum(['vertical', 'horizontal']).default('vertical'),
  showLegend: z.boolean().default(true),
  showGridLines: z.boolean().default(true),
  valueFormatter: z.string().optional(),
  xAxisLabel: z.string().optional(),
  yAxisLabel: z.string().optional(),
});

// 3. Line Chart
const LineChartConfigSchema = ChartBaseSchema.extend({
  chartType: z.literal('line'),
  data: z.array(z.record(z.union([z.string(), z.number()]))).min(2).max(500), // min 2 points
  index: z.string().min(1),
  categories: z.array(z.string()).min(1).max(10),
  colors: z.array(z.string()).max(10).optional(),
  connectNulls: z.boolean().default(false),
  showMarker: z.boolean().default(true),
  curveType: z.enum(['linear', 'natural', 'monotone', 'step']).default('linear'),
  showLegend: z.boolean().default(true),
  showGridLines: z.boolean().default(true),
  xAxisLabel: z.string().optional(),
  yAxisLabel: z.string().optional(),
});

// 4. Area Chart
const AreaChartConfigSchema = ChartBaseSchema.extend({
  chartType: z.literal('area'),
  data: z.array(z.record(z.union([z.string(), z.number()]))).min(2).max(500),
  index: z.string().min(1),
  categories: z.array(z.string()).min(1).max(10),
  colors: z.array(z.string()).max(10).optional(),
  stacked: z.boolean().default(false),
  showLegend: z.boolean().default(true),
  showGridLines: z.boolean().default(true),
  xAxisLabel: z.string().optional(),
  yAxisLabel: z.string().optional(),
});

// 5. Donut Chart
const DonutChartConfigSchema = ChartBaseSchema.extend({
  chartType: z.literal('donut'),
  data: z.array(z.object({
    name: z.string(),
    value: z.number(),
  })).min(2).max(12), // max 12: more segments become illegible
  colors: z.array(z.string()).max(12).optional(),
  variant: z.enum(['donut', 'pie']).default('donut'),
  label: z.string().optional(),
  showTooltip: z.boolean().default(true),
  showLabel: z.boolean().default(true),
  valueFormatter: z.string().optional(),
});

// 6. Bar List
const BarListConfigSchema = ChartBaseSchema.extend({
  chartType: z.literal('bar_list'),
  data: z.array(z.object({
    name: z.string(),
    value: z.number(),
  })).min(1).max(30),
  color: z.string().optional(),
  showAnimation: z.boolean().default(true),
  valueFormatter: z.string().optional(),
  sortOrder: z.enum(['ascending', 'descending', 'none']).default('descending'),
});

// 7. KPI Card
const KPIConfigSchema = ChartBaseSchema.extend({
  chartType: z.literal('kpi'),
  metric: z.string().min(1),
  metricLabel: z.string().min(1),
  delta: z.string().optional(),
  deltaType: z.enum(['increase', 'decrease', 'unchanged']).optional(),
  icon: z.string().optional(),
  valuePrefix: z.string().optional(), // e.g., "$"
  valueSuffix: z.string().optional(), // e.g., "%"
});

// 8. KPI Grid
const KPIGridConfigSchema = ChartBaseSchema.extend({
  chartType: z.literal('kpi_grid'),
  metrics: z.array(z.object({
    metric: z.string().min(1),
    metricLabel: z.string().min(1),
    delta: z.string().optional(),
    deltaType: z.enum(['increase', 'decrease', 'unchanged']).optional(),
    icon: z.string().optional(),
    valuePrefix: z.string().optional(),
    valueSuffix: z.string().optional(),
  })).min(2).max(8), // min 2 KPIs, max 8 per grid
  columns: z.number().min(2).max(4).default(3),
});

// 9. Table
const TableConfigSchema = ChartBaseSchema.extend({
  chartType: z.literal('table'),
  data: z.array(z.record(z.unknown())).min(1).max(500),
  columns: z.array(z.object({
    key: z.string(),
    header: z.string(),
    type: z.enum(['text', 'number', 'currency', 'date', 'badge']).default('text'),
    align: z.enum(['left', 'center', 'right']).default('left'),
  })).min(1).max(20),
  sortable: z.boolean().default(true),
  paginate: z.boolean().default(true),
  pageSize: z.number().min(5).max(100).default(10),
});

// 10. Scatter Chart
const ScatterChartConfigSchema = ChartBaseSchema.extend({
  chartType: z.literal('scatter'),
  data: z.array(z.record(z.union([z.string(), z.number()]))).min(2).max(200),
  x: z.string().min(1),
  y: z.string().min(1),
  category: z.string().optional(),
  size: z.string().optional(),
  colors: z.array(z.string()).max(10).optional(),
  showLegend: z.boolean().default(true),
  showGridLines: z.boolean().default(true),
  xAxisLabel: z.string().optional(),
  yAxisLabel: z.string().optional(),
});

// Discriminated union of all chart configs
const ChartConfigSchema = z.discriminatedUnion('chartType', [
  BarChartConfigSchema,
  StackedBarChartConfigSchema,
  LineChartConfigSchema,
  AreaChartConfigSchema,
  DonutChartConfigSchema,
  BarListConfigSchema,
  KPIConfigSchema,
  KPIGridConfigSchema,
  TableConfigSchema,
  ScatterChartConfigSchema,
]);

type ChartConfig = z.infer<typeof ChartConfigSchema>;
```

---

## 4. Tool Architecture (3 Catalog-Driven Tools)

### 4.1 Tool 1: `list_chart_types`

```typescript
// tools/list-chart-types.ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { CHART_REGISTRY } from '../schemas/chart-registry';

export const listChartTypes = tool(
  async () => {
    return CHART_REGISTRY.map(entry => ({
      id: entry.id,
      name: entry.name,
      description: entry.description,
      bestFor: entry.bestFor,
      dataShape: entry.dataShape,
      constraints: entry.constraints,
    }));
  },
  {
    name: 'list_chart_types',
    description: 'List all available chart types with descriptions, data shapes, and constraints. Call this FIRST to understand what visualizations are available.',
    schema: z.object({}),
  }
);
```

**Input**: ninguno
**Output**: array de `{ id, name, description, bestFor, dataShape, constraints }`
**Proposito**: LLM navega el catalogo antes de elegir un tipo

### 4.2 Tool 2: `get_chart_schema`

```typescript
// tools/get-chart-schema.ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { CHART_REGISTRY } from '../schemas/chart-registry';

export const getChartSchema = tool(
  async ({ chartType }) => {
    const entry = CHART_REGISTRY.find(e => e.id === chartType);
    if (!entry) {
      return { error: `Unknown chart type: ${chartType}. Use list_chart_types to see available types.` };
    }
    return {
      chartType: entry.id,
      requiredFields: entry.requiredFields,
      optionalFields: entry.optionalFields,
      constraints: entry.constraints,
      example: entry.example,
    };
  },
  {
    name: 'get_chart_schema',
    description: 'Get the exact schema (required fields, optional fields, constraints, example) for a specific chart type. Call this AFTER list_chart_types to understand what data to produce.',
    schema: z.object({
      chartType: z.string().describe('Chart type ID from list_chart_types'),
    }),
  }
);
```

**Input**: `{ chartType: ChartTypeId }`
**Output**: descripcion JSON del Zod schema (campos requeridos, opcionales, constraints, ejemplo)
**Proposito**: LLM sabe exactamente que datos producir

### 4.3 Tool 3: `generate_chart_config`

```typescript
// tools/generate-chart-config.ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { ChartConfigSchema } from '@bc-agent/shared';

export const generateChartConfig = tool(
  async ({ chartType, config }) => {
    const fullConfig = { ...config, chartType, _type: 'chart_config' as const };
    const result = ChartConfigSchema.safeParse(fullConfig);

    if (!result.success) {
      return {
        valid: false,
        errors: result.error.issues.map(issue => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      };
    }

    return {
      valid: true,
      config: result.data,
    };
  },
  {
    name: 'generate_chart_config',
    description: 'Validate and generate a chart configuration. Validates against the Zod schema for the chart type. Returns validated config on success or validation errors on failure.',
    schema: z.object({
      chartType: z.string().describe('Chart type ID'),
      config: z.record(z.unknown()).describe('Chart configuration matching the schema from get_chart_schema'),
    }),
  }
);
```

**Input**: `{ chartType: ChartTypeId, config: Record<string, unknown> }`
**Validacion**: contra Zod schema del chart type
**Output**: `{ valid: true, config: ChartConfig }` o `{ valid: false, errors: ZodError[] }`
**Discriminador**: Config validado incluye `_type: 'chart_config'` para rendering frontend (PRD-070)

---

## 5. Backend Implementation

### 5.1 Shared Package Changes (`@bc-agent/shared`)

#### 5.1.1 Constants (`constants/agent-registry.constants.ts`)

```typescript
// Agregar al objeto AGENT_ID
AGENT_ID.GRAPHING_AGENT = 'graphing-agent';

// Agregar a AGENT_DISPLAY_NAME
AGENT_DISPLAY_NAME['graphing-agent'] = 'Data Visualization Expert';

// Agregar a AGENT_ICON
AGENT_ICON['graphing-agent'] = '📈';  // NOTA: BC Agent usa 📊, diferente icono

// Agregar a AGENT_COLOR
AGENT_COLOR['graphing-agent'] = '#F59E0B';  // Amber

// Agregar a AGENT_DESCRIPTION
AGENT_DESCRIPTION['graphing-agent'] = 'Creates charts, graphs, and data tables from your data using Tremor UI components';
```

#### 5.1.2 Nuevo `types/chart-config.types.ts`

Exportar: `ChartType`, per-type config interfaces, union `ChartConfig`

#### 5.1.3 Nuevo `schemas/chart-config.schema.ts`

Exportar: Zod schemas para 10 tipos + `ChartConfigSchema` discriminated union (como se muestra en seccion 3.1)

#### 5.1.4 `AgentId` type

Se extiende automaticamente al agregar entrada a `AGENT_ID` constants.

### 5.2 Backend File Structure

```
backend/src/modules/agents/graphing/
├── tools/
│   ├── list-chart-types.ts           # Tool 1: Navigate chart catalog
│   ├── get-chart-schema.ts           # Tool 2: Get schema for specific type
│   └── generate-chart-config.ts      # Tool 3: Validate and generate config
├── schemas/
│   ├── chart-registry.ts             # Catalog of 10 types with metadata
│   └── index.ts
├── prompts/
│   └── graphing.system.ts            # System prompt for graphing agent
├── graphing-agent.definition.ts      # Agent registry definition (PRD-011)
└── index.ts
```

### 5.3 Chart Registry (Catalog)

```typescript
// schemas/chart-registry.ts
export interface ChartRegistryEntry {
  id: string;
  name: string;
  description: string;
  bestFor: string[];
  dataShape: string;
  constraints: string;
  requiredFields: Record<string, string>;
  optionalFields: Record<string, string>;
  example: Record<string, unknown>;
}

export const CHART_REGISTRY: ChartRegistryEntry[] = [
  {
    id: 'bar',
    name: 'Bar Chart',
    description: 'Vertical or horizontal bars comparing values across categories',
    bestFor: ['comparisons', 'rankings', 'quarterly revenue', 'sales by region'],
    dataShape: 'Record[] with index (category) and numeric categories',
    constraints: '1-100 rows, 1-10 categories',
    requiredFields: { data: 'Record[]', index: 'string (category field)', categories: 'string[] (value fields)' },
    optionalFields: { colors: 'string[]', layout: '"vertical"|"horizontal"', showLegend: 'boolean', valueFormatter: 'string' },
    example: {
      chartType: 'bar',
      title: 'Revenue by Quarter',
      data: [{ quarter: 'Q1', revenue: 45000 }, { quarter: 'Q2', revenue: 52000 }],
      index: 'quarter',
      categories: ['revenue'],
    },
  },
  // ... 9 more entries for each chart type
];
```

### 5.4 Agent Definition (PRD-011 Pattern)

```typescript
// graphing-agent.definition.ts
import type { AgentDefinitionInput } from '../core/registry/AgentDefinition';

export const graphingAgentDefinition: AgentDefinitionInput = {
  id: 'graphing-agent',
  name: 'Data Visualization Expert',
  description: 'Creates charts, graphs, and data tables from your data',

  icon: '📈',
  color: '#F59E0B', // Amber

  capabilities: ['data_viz', 'charts', 'tables', 'kpis'],

  tools: [
    { name: 'list_chart_types', description: 'List all available chart types' },
    { name: 'get_chart_schema', description: 'Get schema for a chart type' },
    { name: 'generate_chart_config', description: 'Validate and generate chart config' },
  ],

  systemPrompt: `You are a data visualization expert. You help users create clear,
informative charts and visualizations from their data.

Workflow:
1. Call list_chart_types to see available chart types
2. Choose the best chart type for the user's data and intent
3. Call get_chart_schema to get the exact schema for that type
4. Call generate_chart_config with the properly formatted data

Always prefer the simplest chart type that conveys the information effectively.
Use KPI cards for single metrics, donut for proportions, bar for comparisons,
line for trends, and table for detailed data.`,

  modelConfig: {
    preferredModel: 'claude-sonnet-4-5-20250929',
    maxTokens: 4096,
    temperature: 0.1,
  },

  isUserSelectable: true,
  isSystemAgent: false,

  triggerKeywords: [
    'chart', 'graph', 'visualize', 'visualization',
    'plot', 'bar chart', 'line chart', 'pie chart',
    'show me a graph', 'create a chart', 'dashboard',
    'KPI', 'metrics', 'scatter plot',
  ],
  triggerPatterns: [
    /create\s+a?\s*(chart|graph|visualization|dashboard)/i,
    /show\s+(me\s+)?a?\s*(chart|graph|plot)/i,
    /visualize\s+(the\s+)?data/i,
    /make\s+a?\s*(bar|line|pie|donut|scatter)\s*(chart|graph|plot)?/i,
  ],
};
```

### 5.5 Agent Node (Graph Integration)

```typescript
// Agent node for supervisor graph
// Data is extracted from state.messages, NOT from state.plan (which doesn't exist)
export async function createGraphingAgentNode() {
  const llm = await initChatModel('claude-sonnet-4-5-20250929', {
    temperature: 0.1,
    maxTokens: 4096,
  });

  const tools = [listChartTypes, getChartSchema, generateChartConfig];
  // Handoff tools injected by buildHandoffToolsForAgent() (PRD-040)

  return createReactAgent({
    llm,
    tools,
    name: AGENT_ID.GRAPHING_AGENT,
    prompt: getGraphingSystemPrompt(),
  });
}
```

### 5.6 Handoff Integration (PRD-040)

`buildHandoffToolsForAgent()` automatically injects handoff tools:
- Graphing Agent receives: `transfer_to_bc-agent`, `transfer_to_rag-agent`
- BC Agent receives: `transfer_to_rag-agent`, `transfer_to_graphing-agent`
- RAG Agent receives: `transfer_to_bc-agent`, `transfer_to_graphing-agent`

---

## 6. Frontend Integration

### 6.1 File Structure

```
frontend/src/components/chat/ChartRenderer/
├── ChartRenderer.tsx             # Main switch by chartType
├── charts/
│   ├── BarChartView.tsx          # bar
│   ├── StackedBarChartView.tsx   # stacked_bar
│   ├── LineChartView.tsx         # line
│   ├── AreaChartView.tsx         # area
│   ├── DonutChartView.tsx        # donut
│   ├── BarListView.tsx           # bar_list
│   ├── KPICard.tsx               # kpi
│   ├── KPIGrid.tsx               # kpi_grid
│   ├── DataTable.tsx             # table
│   └── ScatterChartView.tsx      # scatter
└── index.ts
```

### 6.2 ChartRenderer Component

```tsx
// ChartRenderer.tsx
import type { ChartConfig } from '@bc-agent/shared';
import { BarChartView } from './charts/BarChartView';
import { StackedBarChartView } from './charts/StackedBarChartView';
import { LineChartView } from './charts/LineChartView';
import { AreaChartView } from './charts/AreaChartView';
import { DonutChartView } from './charts/DonutChartView';
import { BarListView } from './charts/BarListView';
import { KPICard } from './charts/KPICard';
import { KPIGrid } from './charts/KPIGrid';
import { DataTable } from './charts/DataTable';
import { ScatterChartView } from './charts/ScatterChartView';

interface ChartRendererProps {
  config: ChartConfig;
}

export function ChartRenderer({ config }: ChartRendererProps) {
  switch (config.chartType) {
    case 'bar':           return <BarChartView config={config} />;
    case 'stacked_bar':   return <StackedBarChartView config={config} />;
    case 'line':          return <LineChartView config={config} />;
    case 'area':          return <AreaChartView config={config} />;
    case 'donut':         return <DonutChartView config={config} />;
    case 'bar_list':      return <BarListView config={config} />;
    case 'kpi':           return <KPICard config={config} />;
    case 'kpi_grid':      return <KPIGrid config={config} />;
    case 'table':         return <DataTable config={config} />;
    case 'scatter':       return <ScatterChartView config={config} />;
    default:
      return <div className="text-sm text-gray-500">Unsupported chart type</div>;
  }
}
```

### 6.3 Detection in MessageList

Cuando un `tool_result` contiene `_type: 'chart_config'`, el MessageList renderiza `<ChartRenderer>` en lugar de JSON crudo. Este mecanismo se formaliza en PRD-070 (Agent-Specific Rendering Framework).

```tsx
// In MessageList.tsx (simplified)
function renderToolResult(result: unknown) {
  if (isChartConfig(result)) {
    return <ChartRenderer config={result} />;
  }
  return <MarkdownRenderer content={JSON.stringify(result)} />;
}

function isChartConfig(value: unknown): value is ChartConfig {
  return typeof value === 'object' && value !== null && '_type' in value
    && (value as Record<string, unknown>)._type === 'chart_config';
}
```

### 6.4 Example: BarChartView

```tsx
// charts/BarChartView.tsx
import { BarChart, Card } from '@tremor/react';
import type { BarChartConfig } from '@bc-agent/shared';

interface BarChartViewProps {
  config: BarChartConfig;
}

export function BarChartView({ config }: BarChartViewProps) {
  return (
    <Card className="mt-4">
      <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
        {config.title}
      </h3>
      {config.subtitle && (
        <p className="text-sm text-gray-500 mt-1">{config.subtitle}</p>
      )}
      <BarChart
        data={config.data}
        index={config.index}
        categories={config.categories}
        colors={config.colors}
        layout={config.layout}
        showLegend={config.showLegend}
        showGridLines={config.showGridLines}
        className="h-72 mt-4"
      />
    </Card>
  );
}
```

---

## 7. Tests Requeridos

### 7.1 Schema Validation Tests

```typescript
describe('Chart Config Schemas', () => {
  describe('BarChartConfigSchema', () => {
    it('validates correct bar chart config');
    it('rejects missing required fields (data, index, categories)');
    it('rejects data array exceeding 100 rows');
    it('rejects categories exceeding 10');
  });

  describe('StackedBarChartConfigSchema', () => {
    it('requires minimum 2 categories for stacking');
    it('rejects single category');
  });

  describe('LineChartConfigSchema', () => {
    it('requires minimum 2 data points');
    it('rejects single data point');
  });

  describe('DonutChartConfigSchema', () => {
    it('requires minimum 2 segments');
    it('rejects more than 12 segments');
  });

  describe('ScatterChartConfigSchema', () => {
    it('validates with x and y fields');
    it('validates with optional category and size fields');
    it('rejects missing x or y field');
  });

  describe('KPIGridConfigSchema', () => {
    it('requires minimum 2 metrics');
    it('rejects more than 8 metrics');
  });

  describe('ChartConfigSchema (discriminated union)', () => {
    it('correctly discriminates by chartType');
    it('all 10 chart types are valid');
    it('rejects unknown chartType');
  });
});
```

### 7.2 Tool Tests

```typescript
describe('Graphing Agent Tools', () => {
  describe('list_chart_types', () => {
    it('returns catalog of 10 chart types');
    it('each entry has id, name, description, bestFor, dataShape');
  });

  describe('get_chart_schema', () => {
    it('returns schema for valid chart type');
    it('returns error for unknown chart type');
    it('includes required fields, optional fields, constraints, example');
  });

  describe('generate_chart_config', () => {
    it('validates and returns config for valid bar chart');
    it('validates and returns config for valid scatter chart');
    it('returns validation errors for invalid config');
    it('adds _type: chart_config discriminator to output');
  });
});
```

### 7.3 Frontend Component Tests

```typescript
describe('ChartRenderer', () => {
  it('renders BarChartView for bar chartType');
  it('renders ScatterChartView for scatter chartType');
  it('renders KPIGrid for kpi_grid chartType');
  it('shows fallback for unknown chartType');
});
```

---

## 8. Criterios de Aceptacion

- [ ] `AGENT_ID.GRAPHING_AGENT` existe en `@bc-agent/shared` constants
- [ ] Graphing agent registrado en AgentRegistry con 3 tools
- [ ] `list_chart_types` retorna catalogo de 10 tipos
- [ ] `get_chart_schema` retorna schema correcto por tipo
- [ ] `generate_chart_config` valida y retorna o rechaza configs
- [ ] Zod schemas validan correctamente los 10 tipos con constraints
- [ ] `_type: 'chart_config'` discriminador presente en configs validados
- [ ] Frontend `ChartRenderer` renderiza los 10 tipos via Tremor
- [ ] Handoff tools inyectados: `transfer_to_bc-agent`, `transfer_to_rag-agent`
- [ ] Agent node retorna `currentAgentIdentity` (PRD-020 pattern)
- [ ] `npm run verify:types` pasa
- [ ] `npm run -w backend test:unit` pasa sin regresiones

---

## 9. Archivos a Crear/Modificar

### Crear

| # | Archivo | Descripcion |
|---|---------|-------------|
| 1 | `packages/shared/src/types/chart-config.types.ts` | TypeScript types for 10 chart configs |
| 2 | `packages/shared/src/schemas/chart-config.schema.ts` | Zod schemas for 10 chart configs |
| 3 | `backend/src/modules/agents/graphing/tools/list-chart-types.ts` | Tool 1 |
| 4 | `backend/src/modules/agents/graphing/tools/get-chart-schema.ts` | Tool 2 |
| 5 | `backend/src/modules/agents/graphing/tools/generate-chart-config.ts` | Tool 3 |
| 6 | `backend/src/modules/agents/graphing/schemas/chart-registry.ts` | Chart catalog (10 entries) |
| 7 | `backend/src/modules/agents/graphing/schemas/index.ts` | Barrel export |
| 8 | `backend/src/modules/agents/graphing/prompts/graphing.system.ts` | System prompt |
| 9 | `backend/src/modules/agents/graphing/graphing-agent.definition.ts` | Registry definition |
| 10 | `backend/src/modules/agents/graphing/index.ts` | Barrel export |
| 11 | `frontend/src/components/chat/ChartRenderer/ChartRenderer.tsx` | Main renderer switch |
| 12 | `frontend/src/components/chat/ChartRenderer/charts/*.tsx` | 10 chart view components |
| 13 | `frontend/src/components/chat/ChartRenderer/index.ts` | Barrel export |

### Modificar

| # | Archivo | Cambio |
|---|---------|--------|
| 1 | `packages/shared/src/index.ts` | Export chart types and schemas |
| 2 | `packages/shared/src/schemas/agent-identity.schema.ts` | (no change needed, extends automatically) |
| 3 | `backend/src/modules/agents/core/registry/AgentRegistry.ts` | Register graphing agent |
| 4 | `backend/src/modules/agents/supervisor/agent-builders.ts` | Create graphing agent node |
| 5 | `backend/src/modules/agents/supervisor/supervisor-graph.ts` | Add graphing agent to supervisor |
| 6 | `backend/src/modules/agents/handoffs/handoff-tool-builder.ts` | Include graphing agent in handoff matrix |

---

## 10. Estimacion

| Componente | Dias |
|-----------|------|
| Shared package (types + schemas) | 1-2 |
| Backend tools + registry + catalog | 2-3 |
| Backend agent integration (supervisor, handoffs) | 1-2 |
| Frontend ChartRenderer + 10 chart views | 3-4 |
| Testing (schemas, tools, components) | 2-3 |
| **Total** | **9-14 dias** |

---

## 11. Changelog

| Fecha | Version | Cambios |
|-------|---------|---------|
| 2026-01-21 | 1.0 | Draft inicial con 5 chart types y 3 tools genericos |
| 2026-02-06 | 1.1 | Actualizado con pre-requisitos de paquetes (`@langchain/langgraph-supervisor`, `-checkpoint-postgres`). Corregido `graphingAgentNode` para usar `state.messages` en lugar de `state.plan?.steps`. Agregado `currentAgentIdentity` al return del agent node (PRD-020). |
| 2026-02-09 | 2.0 | **REWRITE COMPLETO**: Expandido de 5 a 10 chart types (agregados `stacked_bar`, `area`, `bar_list`, `kpi_grid`, `scatter`; eliminado `combo` sin soporte nativo Tremor). Arquitectura rediseñada a catalog-driven con 3 tools (`list_chart_types`, `get_chart_schema`, `generate_chart_config`). Zod schemas estrictos por tipo con validaciones (min/max rows, min categories para stacking, etc.). Eliminada referencia a `@langchain/langgraph-checkpoint-postgres` (sistema usa `MSSQLSaver` PRD-032). Icon cambiado de 📊 a 📈 (BC Agent ya usa 📊). Color unificado a `#F59E0B` (amber). Agregado `_type: 'chart_config'` como discriminador frontend (PRD-070). Agregada integracion con handoffs bidireccionales (PRD-040). Nuevo campo `Bloquea: PRD-070`. |
