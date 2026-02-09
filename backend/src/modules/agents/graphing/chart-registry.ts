/**
 * Chart Type Registry
 *
 * Catalog metadata for all supported chart types.
 * The graphing agent's tools use this to help the LLM discover
 * chart capabilities and produce valid configurations.
 *
 * @module modules/agents/graphing/chart-registry
 */

import type { ChartType, TremorColor, ChartConfig } from '@bc-agent/shared';

export interface ChartTypeMetadata {
  id: ChartType;
  name: string;
  description: string;
  bestFor: string[];
  dataShape: string;
  constraints: string[];
  requiredFields: string[];
  optionalFields: string[];
  example: ChartConfig;
}

const CHART_REGISTRY: ReadonlyMap<ChartType, ChartTypeMetadata> = new Map<ChartType, ChartTypeMetadata>([
  ['bar', {
    id: 'bar',
    name: 'Bar Chart',
    description: 'Vertical bar chart for comparing values across categories.',
    bestFor: ['Revenue by quarter', 'Sales comparison', 'Category benchmarking'],
    dataShape: 'Record[] with index field and numeric category fields',
    constraints: ['1-100 data points', '1-10 categories'],
    requiredFields: ['data', 'index', 'categories'],
    optionalFields: ['colors', 'subtitle'],
    example: {
      _type: 'chart_config',
      chartType: 'bar',
      title: 'Revenue by Quarter',
      data: [
        { quarter: 'Q1', revenue: 45000 },
        { quarter: 'Q2', revenue: 52000 },
        { quarter: 'Q3', revenue: 48000 },
        { quarter: 'Q4', revenue: 61000 },
      ],
      index: 'quarter',
      categories: ['revenue'],
      colors: ['blue' as TremorColor],
    },
  }],
  ['stacked_bar', {
    id: 'stacked_bar',
    name: 'Stacked Bar Chart',
    description: 'Stacked vertical bar chart showing composition of categories.',
    bestFor: ['Revenue composition', 'Cost breakdown', 'Market share by segment'],
    dataShape: 'Record[] with index field and 2+ numeric category fields',
    constraints: ['1-100 data points', '2-10 categories (min 2 for stacking)'],
    requiredFields: ['data', 'index', 'categories'],
    optionalFields: ['colors', 'subtitle'],
    example: {
      _type: 'chart_config',
      chartType: 'stacked_bar',
      title: 'Revenue by Product Line',
      data: [
        { quarter: 'Q1', hardware: 30000, software: 15000 },
        { quarter: 'Q2', hardware: 32000, software: 20000 },
      ],
      index: 'quarter',
      categories: ['hardware', 'software'],
      colors: ['blue' as TremorColor, 'emerald' as TremorColor],
    },
  }],
  ['line', {
    id: 'line',
    name: 'Line Chart',
    description: 'Line chart for showing trends over time or continuous data.',
    bestFor: ['Monthly trends', 'Time series', 'Performance tracking'],
    dataShape: 'Record[] with index field and numeric category fields',
    constraints: ['2-500 data points', '1-10 categories'],
    requiredFields: ['data', 'index', 'categories'],
    optionalFields: ['colors', 'subtitle'],
    example: {
      _type: 'chart_config',
      chartType: 'line',
      title: 'Monthly Sales Trend',
      data: [
        { month: 'Jan', sales: 4000 },
        { month: 'Feb', sales: 4500 },
        { month: 'Mar', sales: 5200 },
      ],
      index: 'month',
      categories: ['sales'],
      colors: ['emerald' as TremorColor],
    },
  }],
  ['area', {
    id: 'area',
    name: 'Area Chart',
    description: 'Area chart for showing cumulative values or filled trends.',
    bestFor: ['Cumulative revenue', 'Market share over time', 'Volume trends'],
    dataShape: 'Record[] with index field and numeric category fields',
    constraints: ['2-500 data points', '1-10 categories'],
    requiredFields: ['data', 'index', 'categories'],
    optionalFields: ['colors', 'subtitle', 'type', 'fill'],
    example: {
      _type: 'chart_config',
      chartType: 'area',
      title: 'Cumulative Revenue',
      data: [
        { month: 'Jan', revenue: 10000 },
        { month: 'Feb', revenue: 25000 },
        { month: 'Mar', revenue: 42000 },
      ],
      index: 'month',
      categories: ['revenue'],
      colors: ['violet' as TremorColor],
      fill: 'gradient',
    },
  }],
  ['donut', {
    id: 'donut',
    name: 'Donut Chart',
    description: 'Donut/pie chart for showing proportional distribution.',
    bestFor: ['Expense distribution', 'Market segments', 'Revenue share'],
    dataShape: 'Record[] with a category string field and a value numeric field',
    constraints: ['2-12 data points'],
    requiredFields: ['data', 'category', 'value'],
    optionalFields: ['colors', 'subtitle'],
    example: {
      _type: 'chart_config',
      chartType: 'donut',
      title: 'Expense Distribution',
      data: [
        { department: 'Engineering', amount: 150000 },
        { department: 'Marketing', amount: 80000 },
        { department: 'Sales', amount: 120000 },
      ],
      category: 'department',
      value: 'amount',
      colors: ['blue' as TremorColor, 'emerald' as TremorColor, 'violet' as TremorColor],
    },
  }],
  ['bar_list', {
    id: 'bar_list',
    name: 'Bar List',
    description: 'Horizontal bar list for ranked or ordered data.',
    bestFor: ['Top N rankings', 'Leaderboards', 'Simple comparisons'],
    dataShape: '{name: string, value: number}[]',
    constraints: ['1-30 items'],
    requiredFields: ['data'],
    optionalFields: ['color', 'subtitle'],
    example: {
      _type: 'chart_config',
      chartType: 'bar_list',
      title: 'Top Customers by Revenue',
      data: [
        { name: 'Acme Corp', value: 250000 },
        { name: 'Globex Inc', value: 180000 },
        { name: 'Initech', value: 120000 },
      ],
      color: 'blue' as TremorColor,
    },
  }],
  ['combo', {
    id: 'combo',
    name: 'Combo Chart',
    description: 'Combined bar and line chart for comparing different metrics.',
    bestFor: ['Actual vs target', 'Revenue + growth rate', 'Volume and price'],
    dataShape: 'Record[] with index, barCategories, and lineCategories fields',
    constraints: ['2-500 data points', '1-10 bar categories', '1-10 line categories'],
    requiredFields: ['data', 'index', 'barCategories', 'lineCategories'],
    optionalFields: ['colors', 'subtitle'],
    example: {
      _type: 'chart_config',
      chartType: 'combo',
      title: 'Revenue vs Growth Rate',
      data: [
        { quarter: 'Q1', revenue: 45000, growth: 12 },
        { quarter: 'Q2', revenue: 52000, growth: 15.5 },
        { quarter: 'Q3', revenue: 48000, growth: -7.7 },
      ],
      index: 'quarter',
      barCategories: ['revenue'],
      lineCategories: ['growth'],
      colors: ['blue' as TremorColor, 'amber' as TremorColor],
    },
  }],
  ['kpi', {
    id: 'kpi',
    name: 'KPI Card',
    description: 'Single key performance indicator with optional delta.',
    bestFor: ['Total revenue', 'YoY growth', 'Key metrics'],
    dataShape: 'Single metric object with label, value, and optional delta',
    constraints: ['Single metric only'],
    requiredFields: ['metric', 'label'],
    optionalFields: ['delta', 'deltaType', 'subtitle'],
    example: {
      _type: 'chart_config',
      chartType: 'kpi',
      title: 'Total Revenue',
      metric: '$1,234,567',
      label: 'Total Revenue YTD',
      delta: '+12.3%',
      deltaType: 'increase',
    },
  }],
  ['kpi_grid', {
    id: 'kpi_grid',
    name: 'KPI Grid',
    description: 'Grid of multiple KPI cards for dashboard overview.',
    bestFor: ['Dashboard overview', 'Multiple metrics at a glance', 'Summary panels'],
    dataShape: 'Array of metric objects with columns layout',
    constraints: ['2-8 items', '2-4 columns'],
    requiredFields: ['items'],
    optionalFields: ['columns', 'subtitle'],
    example: {
      _type: 'chart_config',
      chartType: 'kpi_grid',
      title: 'Business Overview',
      items: [
        { metric: '$1.2M', label: 'Revenue', delta: '+12%', deltaType: 'increase' as const },
        { metric: '847', label: 'Orders', delta: '+5%', deltaType: 'increase' as const },
        { metric: '$1,416', label: 'Avg Order Value', delta: '-2%', deltaType: 'decrease' as const },
      ],
      columns: 3,
    },
  }],
  ['table', {
    id: 'table',
    name: 'Data Table',
    description: 'Structured data table with sortable columns.',
    bestFor: ['Transaction details', 'Inventory list', 'Detailed records'],
    dataShape: 'Record[] rows with column definitions',
    constraints: ['1-500 rows', '1-20 columns'],
    requiredFields: ['rows', 'columns'],
    optionalFields: ['subtitle'],
    example: {
      _type: 'chart_config',
      chartType: 'table',
      title: 'Recent Orders',
      rows: [
        { id: 'ORD-001', customer: 'Acme Corp', amount: 15000, status: 'Shipped' },
        { id: 'ORD-002', customer: 'Globex Inc', amount: 8500, status: 'Processing' },
      ],
      columns: [
        { key: 'id', label: 'Order ID' },
        { key: 'customer', label: 'Customer' },
        { key: 'amount', label: 'Amount', align: 'right' as const },
        { key: 'status', label: 'Status' },
      ],
    },
  }],
]);

/**
 * Get all chart types with their metadata.
 */
export function getAllChartTypes(): ChartTypeMetadata[] {
  return Array.from(CHART_REGISTRY.values());
}

/**
 * Get metadata for a specific chart type.
 * @returns Metadata or undefined if not found.
 */
export function getChartTypeMetadata(id: string): ChartTypeMetadata | undefined {
  return CHART_REGISTRY.get(id as ChartType);
}

export { CHART_REGISTRY };
