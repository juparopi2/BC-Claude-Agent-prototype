# PRD-050: Graphing Agent (Data Visualization)

**Estado**: Draft
**Prioridad**: Media
**Dependencias**: PRD-011 (Agent Registry), PRD-040 (Dynamic Handoffs)
**Bloquea**: Ninguno

---

## 1. Objetivo

Implementar un agente especializado en visualización de datos que:
- Genera configuraciones de gráficas a partir de datos
- Usa Tremor UI components para renderizado
- Se integra con BC-Agent y RAG-Agent para obtener datos
- Produce JSON schemas que el frontend renderiza

---

## 2. Contexto

### 2.1 Por qué un Agente Separado

1. **Especialización**: Visualización requiere conocimiento específico
2. **Reutilización**: Puede ser llamado por múltiples agentes
3. **Flexibilidad**: Frontend puede evolucionar independientemente
4. **Performance**: Modelo optimizado para generación de schemas

### 2.2 Tremor UI

[Tremor](https://www.tremor.so/) es una librería React para dashboards:
- BarChart, LineChart, AreaChart, DonutChart
- Cards, Tables, KPIs
- TypeScript-first, Tailwind-based

---

## 3. Diseño Propuesto

### 3.1 Estructura de Archivos

```
backend/src/modules/agents/graphing/
├── GraphingAgent.ts            # Main agent implementation
├── tools/
│   ├── formatDataForChart.ts   # Transform data for visualization
│   ├── selectChartType.ts      # Choose appropriate chart
│   └── generateTremorConfig.ts # Generate Tremor component config
├── schemas/
│   ├── ChartConfigSchema.ts    # Zod schemas for chart configs
│   ├── TremorComponents.ts     # Type definitions for Tremor
│   └── index.ts
├── prompts/
│   └── graphing.system.ts      # System prompt
├── graphing-agent.definition.ts # Agent registry definition
└── index.ts
```

### 3.2 Chart Configuration Schemas

```typescript
// schemas/ChartConfigSchema.ts
import { z } from 'zod';

/**
 * Base chart configuration
 */
export const BaseChartConfigSchema = z.object({
  /** Chart title */
  title: z.string(),

  /** Chart subtitle/description */
  subtitle: z.string().optional(),

  /** Chart type */
  type: z.enum([
    'bar', 'line', 'area', 'donut', 'scatter',
    'table', 'kpi', 'progress'
  ]),

  /** Width (responsive by default) */
  width: z.enum(['sm', 'md', 'lg', 'full']).default('full'),

  /** Height in pixels */
  height: z.number().min(100).max(800).default(300),
});

/**
 * Bar chart configuration
 */
export const BarChartConfigSchema = BaseChartConfigSchema.extend({
  type: z.literal('bar'),

  /** Data array */
  data: z.array(z.record(z.union([z.string(), z.number()]))),

  /** X-axis category key */
  index: z.string(),

  /** Y-axis value categories */
  categories: z.array(z.string()),

  /** Colors for each category */
  colors: z.array(z.string()).optional(),

  /** Show stacked bars */
  stack: z.boolean().default(false),

  /** Horizontal orientation */
  layout: z.enum(['vertical', 'horizontal']).default('vertical'),

  /** Value formatter */
  valueFormatter: z.string().optional(), // e.g., "(value) => `$${value}`"

  /** Show legend */
  showLegend: z.boolean().default(true),

  /** Y-axis label */
  yAxisLabel: z.string().optional(),

  /** X-axis label */
  xAxisLabel: z.string().optional(),
});

/**
 * Line chart configuration
 */
export const LineChartConfigSchema = BaseChartConfigSchema.extend({
  type: z.literal('line'),

  data: z.array(z.record(z.union([z.string(), z.number()]))),
  index: z.string(),
  categories: z.array(z.string()),
  colors: z.array(z.string()).optional(),

  /** Connect null values */
  connectNulls: z.boolean().default(false),

  /** Show data points */
  showMarker: z.boolean().default(true),

  /** Curved lines */
  curveType: z.enum(['linear', 'natural', 'monotone', 'step']).default('linear'),
});

/**
 * Donut chart configuration
 */
export const DonutChartConfigSchema = BaseChartConfigSchema.extend({
  type: z.literal('donut'),

  data: z.array(z.object({
    name: z.string(),
    value: z.number(),
  })),

  /** Category key for labels */
  category: z.string().default('name'),

  /** Value key */
  value: z.string().default('value'),

  /** Show as ring (vs full pie) */
  variant: z.enum(['donut', 'pie']).default('donut'),

  /** Center label */
  label: z.string().optional(),

  /** Show tooltip */
  showTooltip: z.boolean().default(true),
});

/**
 * KPI card configuration
 */
export const KPIConfigSchema = BaseChartConfigSchema.extend({
  type: z.literal('kpi'),

  /** Main metric value */
  metric: z.string(),

  /** Metric label */
  metricLabel: z.string(),

  /** Comparison value (e.g., "+12%") */
  delta: z.string().optional(),

  /** Delta type for styling */
  deltaType: z.enum(['increase', 'decrease', 'unchanged']).optional(),

  /** Icon name */
  icon: z.string().optional(),
});

/**
 * Table configuration
 */
export const TableConfigSchema = BaseChartConfigSchema.extend({
  type: z.literal('table'),

  /** Table data */
  data: z.array(z.record(z.unknown())),

  /** Column definitions */
  columns: z.array(z.object({
    key: z.string(),
    header: z.string(),
    type: z.enum(['text', 'number', 'currency', 'date', 'badge']).default('text'),
    align: z.enum(['left', 'center', 'right']).default('left'),
  })),

  /** Enable sorting */
  sortable: z.boolean().default(true),

  /** Show pagination */
  paginate: z.boolean().default(true),

  /** Rows per page */
  pageSize: z.number().default(10),
});

/**
 * Union of all chart configs
 */
export const ChartConfigSchema = z.discriminatedUnion('type', [
  BarChartConfigSchema,
  LineChartConfigSchema,
  DonutChartConfigSchema,
  KPIConfigSchema,
  TableConfigSchema,
]);

export type ChartConfig = z.infer<typeof ChartConfigSchema>;
export type BarChartConfig = z.infer<typeof BarChartConfigSchema>;
export type LineChartConfig = z.infer<typeof LineChartConfigSchema>;
export type DonutChartConfig = z.infer<typeof DonutChartConfigSchema>;
export type KPIConfig = z.infer<typeof KPIConfigSchema>;
export type TableConfig = z.infer<typeof TableConfigSchema>;
```

### 3.3 Graphing Agent Tools

```typescript
// tools/formatDataForChart.ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export const formatDataForChart = tool(
  async ({ data, targetFormat, xAxis, yAxes, aggregation }) => {
    // Transform raw data into chart-ready format
    const formatted = [];

    // Group by xAxis
    const groups = new Map<string, Record<string, number>>();

    for (const row of data) {
      const key = String(row[xAxis]);
      if (!groups.has(key)) {
        groups.set(key, { [xAxis]: row[xAxis] });
      }
      const group = groups.get(key)!;

      for (const yAxis of yAxes) {
        const value = Number(row[yAxis]) || 0;
        const existing = group[yAxis] || 0;

        switch (aggregation) {
          case 'sum':
            group[yAxis] = existing + value;
            break;
          case 'avg':
            group[`${yAxis}_sum`] = (group[`${yAxis}_sum`] || 0) + value;
            group[`${yAxis}_count`] = (group[`${yAxis}_count`] || 0) + 1;
            group[yAxis] = group[`${yAxis}_sum`] / group[`${yAxis}_count`];
            break;
          case 'count':
            group[yAxis] = existing + 1;
            break;
          case 'max':
            group[yAxis] = Math.max(existing, value);
            break;
          case 'min':
            group[yAxis] = group[yAxis] === undefined ? value : Math.min(existing, value);
            break;
        }
      }
    }

    return Array.from(groups.values());
  },
  {
    name: 'format_data_for_chart',
    description: 'Transform raw data into chart-ready format with aggregation',
    schema: z.object({
      data: z.array(z.record(z.unknown())).describe('Raw data array'),
      targetFormat: z.enum(['bar', 'line', 'donut', 'table']),
      xAxis: z.string().describe('Field to use for X axis / categories'),
      yAxes: z.array(z.string()).describe('Fields to use for Y axis values'),
      aggregation: z.enum(['sum', 'avg', 'count', 'max', 'min']).default('sum'),
    }),
  }
);

// tools/selectChartType.ts
export const selectChartType = tool(
  async ({ dataCharacteristics, userIntent }) => {
    const { rowCount, columnCount, hasTimeSeries, categoricalColumns, numericColumns } = dataCharacteristics;

    // Decision tree for chart type
    if (userIntent?.includes('trend') || userIntent?.includes('over time') || hasTimeSeries) {
      return { chartType: 'line', reason: 'Time series data best shown as line chart' };
    }

    if (userIntent?.includes('distribution') || userIntent?.includes('breakdown')) {
      if (categoricalColumns === 1 && numericColumns === 1) {
        return { chartType: 'donut', reason: 'Simple distribution shown as donut' };
      }
      return { chartType: 'bar', reason: 'Multi-category distribution as bar chart' };
    }

    if (userIntent?.includes('compare') || userIntent?.includes('comparison')) {
      return { chartType: 'bar', reason: 'Comparison best shown as bar chart' };
    }

    if (rowCount > 20 || columnCount > 5) {
      return { chartType: 'table', reason: 'Large dataset best shown as table' };
    }

    if (numericColumns === 1 && categoricalColumns === 0) {
      return { chartType: 'kpi', reason: 'Single metric as KPI card' };
    }

    return { chartType: 'bar', reason: 'Default to bar chart for general data' };
  },
  {
    name: 'select_chart_type',
    description: 'Determine the best chart type for the given data',
    schema: z.object({
      dataCharacteristics: z.object({
        rowCount: z.number(),
        columnCount: z.number(),
        hasTimeSeries: z.boolean(),
        categoricalColumns: z.number(),
        numericColumns: z.number(),
      }),
      userIntent: z.string().optional(),
    }),
  }
);

// tools/generateTremorConfig.ts
export const generateTremorConfig = tool(
  async ({ chartType, data, options }) => {
    const baseConfig = {
      type: chartType,
      title: options.title || 'Chart',
      subtitle: options.subtitle,
      height: options.height || 300,
      width: 'full',
    };

    switch (chartType) {
      case 'bar':
        return {
          ...baseConfig,
          data,
          index: options.xAxis,
          categories: options.yAxes,
          colors: options.colors || ['blue', 'cyan', 'indigo'],
          stack: options.stacked || false,
          showLegend: options.yAxes.length > 1,
        };

      case 'line':
        return {
          ...baseConfig,
          data,
          index: options.xAxis,
          categories: options.yAxes,
          colors: options.colors || ['blue', 'emerald'],
          curveType: 'monotone',
        };

      case 'donut':
        return {
          ...baseConfig,
          data: data.map(d => ({
            name: d[options.xAxis],
            value: d[options.yAxes[0]],
          })),
          category: 'name',
          value: 'value',
          variant: 'donut',
        };

      case 'kpi':
        const value = data[0]?.[options.yAxes[0]] || 0;
        return {
          ...baseConfig,
          metric: String(value),
          metricLabel: options.title,
          delta: options.delta,
          deltaType: options.deltaType,
        };

      case 'table':
        return {
          ...baseConfig,
          data,
          columns: Object.keys(data[0] || {}).map(key => ({
            key,
            header: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
            type: typeof data[0][key] === 'number' ? 'number' : 'text',
          })),
          sortable: true,
          paginate: data.length > 10,
        };

      default:
        throw new Error(`Unknown chart type: ${chartType}`);
    }
  },
  {
    name: 'generate_tremor_config',
    description: 'Generate Tremor component configuration from data',
    schema: z.object({
      chartType: z.enum(['bar', 'line', 'donut', 'kpi', 'table']),
      data: z.array(z.record(z.unknown())),
      options: z.object({
        title: z.string(),
        subtitle: z.string().optional(),
        xAxis: z.string(),
        yAxes: z.array(z.string()),
        colors: z.array(z.string()).optional(),
        stacked: z.boolean().optional(),
        height: z.number().optional(),
        delta: z.string().optional(),
        deltaType: z.enum(['increase', 'decrease', 'unchanged']).optional(),
      }),
    }),
  }
);
```

### 3.4 Graphing Agent

```typescript
// GraphingAgent.ts
import { ChatAnthropic } from '@langchain/anthropic';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { formatDataForChart, selectChartType, generateTremorConfig } from './tools';
import { getGraphingSystemPrompt } from './prompts/graphing.system';
import type { ExtendedAgentState } from '@/modules/agents/orchestrator/state';
import type { ChartConfig } from './schemas/ChartConfigSchema';

/**
 * Graphing Agent - Specializes in data visualization
 */
export class GraphingAgent {
  private agent: ReturnType<typeof createReactAgent>;

  constructor() {
    const llm = new ChatAnthropic({
      modelName: 'claude-3-5-sonnet-20241022',
      temperature: 0.1,
      maxTokens: 4096,
    });

    const tools = [
      formatDataForChart,
      selectChartType,
      generateTremorConfig,
    ];

    this.agent = createReactAgent({
      llm,
      tools,
      messageModifier: getGraphingSystemPrompt(),
    });
  }

  /**
   * Generate visualization config from data and intent
   */
  async generateVisualization(
    data: unknown[],
    userIntent: string,
    context?: Record<string, unknown>
  ): Promise<ChartConfig> {
    const result = await this.agent.invoke({
      messages: [
        {
          role: 'user',
          content: `Create a visualization for this data:

Data:
${JSON.stringify(data.slice(0, 10), null, 2)}
${data.length > 10 ? `... (${data.length - 10} more rows)` : ''}

User request: ${userIntent}

${context ? `Additional context: ${JSON.stringify(context)}` : ''}

Generate the appropriate chart configuration.`,
        },
      ],
    });

    // Extract chart config from agent response
    const lastMessage = result.messages[result.messages.length - 1];
    const content = typeof lastMessage.content === 'string'
      ? lastMessage.content
      : JSON.stringify(lastMessage.content);

    // Parse JSON from response
    const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1]);
    }

    // Try direct JSON parse
    return JSON.parse(content);
  }
}

// Graph node
export async function graphingAgentNode(
  state: ExtendedAgentState
): Promise<Partial<ExtendedAgentState>> {
  const agent = new GraphingAgent();

  // Extract data from previous step results
  const previousData = extractDataFromState(state);
  const userIntent = state.plan?.steps[state.plan.currentStepIndex]?.task
    || 'Create a visualization';

  const chartConfig = await agent.generateVisualization(
    previousData,
    userIntent
  );

  // Return as special visualization message
  const { AIMessage } = await import('@langchain/core/messages');

  return {
    messages: [
      new AIMessage({
        content: JSON.stringify({
          type: 'visualization',
          config: chartConfig,
        }),
        additional_kwargs: {
          visualization: chartConfig,
        },
      }),
    ],
  };
}

function extractDataFromState(state: ExtendedAgentState): unknown[] {
  // Look for data in previous step results
  const previousSteps = state.plan?.steps.filter(s => s.status === 'completed') || [];

  for (const step of previousSteps.reverse()) {
    if (step.result) {
      try {
        const parsed = JSON.parse(step.result);
        if (Array.isArray(parsed)) return parsed;
        if (parsed.data && Array.isArray(parsed.data)) return parsed.data;
      } catch {
        // Not JSON, continue
      }
    }
  }

  return [];
}
```

### 3.5 Agent Definition

```typescript
// graphing-agent.definition.ts
import { AgentDefinitionInput } from '../core/registry/AgentDefinition';

export const graphingAgentDefinition: AgentDefinitionInput = {
  id: 'graphing-agent',
  name: 'Data Visualization Expert',
  description: 'Creates charts, graphs, and tables from your data',

  icon: '📊',
  color: '#F59E0B', // Amber

  capabilities: ['data_viz'],

  tools: [
    { name: 'format_data_for_chart', description: 'Transform data for charts' },
    { name: 'select_chart_type', description: 'Choose best chart type' },
    { name: 'generate_tremor_config', description: 'Generate chart config' },
  ],

  systemPrompt: `You are a data visualization expert...`,

  modelConfig: {
    preferredModel: 'claude-3-5-sonnet',
    maxTokens: 4096,
    temperature: 0.1,
  },

  isUserSelectable: true,
  isSystemAgent: false,

  triggerKeywords: [
    'chart', 'graph', 'visualize', 'visualization',
    'plot', 'bar chart', 'line chart', 'pie chart',
    'show me a graph', 'create a chart',
  ],
  triggerPatterns: [
    /create\s+a?\s*(chart|graph|visualization)/i,
    /show\s+(me\s+)?a?\s*(chart|graph)/i,
    /visualize\s+(the\s+)?data/i,
  ],
};
```

---

## 4. Frontend Integration

### 4.1 Chart Renderer Component

```typescript
// frontend/src/components/chat/ChartRenderer.tsx
import {
  BarChart, LineChart, DonutChart, Card, Table
} from '@tremor/react';
import type { ChartConfig } from '@bc-agent/shared';

interface ChartRendererProps {
  config: ChartConfig;
}

export function ChartRenderer({ config }: ChartRendererProps) {
  switch (config.type) {
    case 'bar':
      return (
        <Card>
          <h3 className="text-lg font-medium">{config.title}</h3>
          {config.subtitle && <p className="text-sm text-gray-500">{config.subtitle}</p>}
          <BarChart
            data={config.data}
            index={config.index}
            categories={config.categories}
            colors={config.colors}
            stack={config.stack}
            layout={config.layout}
            showLegend={config.showLegend}
            className="h-72 mt-4"
          />
        </Card>
      );

    case 'line':
      return (
        <Card>
          <h3 className="text-lg font-medium">{config.title}</h3>
          <LineChart
            data={config.data}
            index={config.index}
            categories={config.categories}
            colors={config.colors}
            curveType={config.curveType}
            className="h-72 mt-4"
          />
        </Card>
      );

    case 'donut':
      return (
        <Card>
          <h3 className="text-lg font-medium">{config.title}</h3>
          <DonutChart
            data={config.data}
            category={config.category}
            value={config.value}
            variant={config.variant}
            className="h-72 mt-4"
          />
        </Card>
      );

    // ... other chart types

    default:
      return <div>Unsupported chart type</div>;
  }
}
```

### 4.2 Message Handler

```typescript
// In MessageList.tsx - detect visualization messages
function renderMessage(message: AgentMessage) {
  // Check for visualization content
  if (message.visualization) {
    return <ChartRenderer config={message.visualization} />;
  }

  // Regular message
  return <MarkdownRenderer content={message.content} />;
}
```

---

## 5. Tests Requeridos

```typescript
describe('GraphingAgent', () => {
  it('selects bar chart for comparison data');
  it('selects line chart for time series');
  it('selects donut for distribution');
  it('generates valid Tremor config');
  it('handles empty data gracefully');
});

describe('Chart Tools', () => {
  it('formats data with aggregation');
  it('generates correct bar config');
  it('generates correct line config');
});
```

---

## 6. Criterios de Aceptación

- [ ] Generates valid Tremor configs
- [ ] All chart types work
- [ ] Frontend renders charts
- [ ] Integrates with plan execution
- [ ] Agent registered in registry
- [ ] `npm run verify:types` pasa

---

## 7. Estimación

- **Backend Agent**: 4-5 días
- **Frontend Components**: 3-4 días
- **Testing**: 2-3 días
- **Total**: 9-12 días

---

## 8. Changelog

| Fecha | Versión | Cambios |
|-------|---------|---------|
| 2026-01-21 | 1.0 | Draft inicial |

