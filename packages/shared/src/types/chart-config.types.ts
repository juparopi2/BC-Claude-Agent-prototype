/**
 * Chart Configuration Types
 *
 * Type definitions for the Graphing Agent's chart configurations.
 * Used by both backend (validation) and frontend (rendering).
 *
 * @module @bc-agent/shared/types/chart-config
 */

// ============================================
// Base Types
// ============================================

export type ChartType =
  | 'bar'
  | 'stacked_bar'
  | 'line'
  | 'area'
  | 'donut'
  | 'bar_list'
  | 'combo'
  | 'kpi'
  | 'kpi_grid'
  | 'table';

export type TremorColor =
  | 'blue'
  | 'emerald'
  | 'violet'
  | 'amber'
  | 'gray'
  | 'cyan'
  | 'pink'
  | 'lime'
  | 'fuchsia';

// ============================================
// Base Chart Config
// ============================================

export interface BaseChartConfig {
  _type: 'chart_config';
  chartType: ChartType;
  title: string;
  subtitle?: string;
}

// ============================================
// Per-Type Configs
// ============================================

export interface BarChartConfig extends BaseChartConfig {
  chartType: 'bar';
  data: Record<string, unknown>[];
  index: string;
  categories: string[];
  colors?: TremorColor[];
}

export interface StackedBarChartConfig extends BaseChartConfig {
  chartType: 'stacked_bar';
  data: Record<string, unknown>[];
  index: string;
  categories: string[];
  colors?: TremorColor[];
}

export interface LineChartConfig extends BaseChartConfig {
  chartType: 'line';
  data: Record<string, unknown>[];
  index: string;
  categories: string[];
  colors?: TremorColor[];
}

export interface AreaChartConfig extends BaseChartConfig {
  chartType: 'area';
  data: Record<string, unknown>[];
  index: string;
  categories: string[];
  colors?: TremorColor[];
  type?: 'default' | 'stacked' | 'percent';
  fill?: 'gradient' | 'solid' | 'none';
}

export interface DonutChartConfig extends BaseChartConfig {
  chartType: 'donut';
  data: Record<string, unknown>[];
  category: string;
  value: string;
  colors?: TremorColor[];
}

export interface BarListConfig extends BaseChartConfig {
  chartType: 'bar_list';
  data: { name: string; value: number }[];
  color?: TremorColor;
}

export interface ComboChartConfig extends BaseChartConfig {
  chartType: 'combo';
  data: Record<string, unknown>[];
  index: string;
  barCategories: string[];
  lineCategories: string[];
  colors?: TremorColor[];
}

export interface KpiConfig extends BaseChartConfig {
  chartType: 'kpi';
  metric: string;
  label: string;
  delta?: string;
  deltaType?: 'increase' | 'decrease' | 'unchanged';
}

export interface KpiGridConfig extends BaseChartConfig {
  chartType: 'kpi_grid';
  items: Array<{
    metric: string;
    label: string;
    delta?: string;
    deltaType?: 'increase' | 'decrease' | 'unchanged';
  }>;
  columns?: number;
}

export interface TableConfig extends BaseChartConfig {
  chartType: 'table';
  rows: Record<string, unknown>[];
  columns: Array<{
    key: string;
    label: string;
    align?: 'left' | 'center' | 'right';
  }>;
}

// ============================================
// Discriminated Union
// ============================================

export type ChartConfig =
  | BarChartConfig
  | StackedBarChartConfig
  | LineChartConfig
  | AreaChartConfig
  | DonutChartConfig
  | BarListConfig
  | ComboChartConfig
  | KpiConfig
  | KpiGridConfig
  | TableConfig;
