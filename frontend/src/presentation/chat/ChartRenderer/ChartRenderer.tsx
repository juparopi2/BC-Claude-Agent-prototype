'use client';

import { ChartConfigSchema } from '@bc-agent/shared';
import type { RendererProps } from '../AgentResultRenderer/types';
import { BarChartView } from './charts/BarChartView';
import { StackedBarChartView } from './charts/StackedBarChartView';
import { LineChartView } from './charts/LineChartView';
import { AreaChartView } from './charts/AreaChartView';
import { DonutChartView } from './charts/DonutChartView';
import { BarListView } from './charts/BarListView';
import { ComboChartView } from './charts/ComboChartView';
import { KpiView } from './charts/KpiView';
import { KpiGridView } from './charts/KpiGridView';
import { TableView } from './charts/TableView';

/**
 * ChartRenderer - Routes chart_config results to the appropriate chart view.
 * Validates data with ChartConfigSchema before rendering.
 */
export function ChartRenderer({ data }: RendererProps) {
  const parsed = ChartConfigSchema.safeParse(data);

  if (!parsed.success) {
    return (
      <div className="p-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
        <p className="text-xs font-medium text-red-700 dark:text-red-300 mb-1">Invalid chart configuration</p>
        <pre className="text-xs text-red-600 dark:text-red-400 overflow-auto max-h-32">
          {parsed.error.message}
        </pre>
      </div>
    );
  }

  const config = parsed.data;

  switch (config.chartType) {
    case 'bar':
      return <BarChartView config={config} />;
    case 'stacked_bar':
      return <StackedBarChartView config={config} />;
    case 'line':
      return <LineChartView config={config} />;
    case 'area':
      return <AreaChartView config={config} />;
    case 'donut':
      return <DonutChartView config={config} />;
    case 'bar_list':
      return <BarListView config={config} />;
    case 'combo':
      return <ComboChartView config={config} />;
    case 'kpi':
      return <KpiView config={config} />;
    case 'kpi_grid':
      return <KpiGridView config={config} />;
    case 'table':
      return <TableView config={config} />;
    default:
      return (
        <div className="p-3 rounded-lg border bg-muted">
          <p className="text-xs text-muted-foreground">Unsupported chart type</p>
        </div>
      );
  }
}
