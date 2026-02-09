/**
 * Chart Configuration Zod Schemas
 *
 * Validation schemas for chart configs produced by the Graphing Agent.
 * Each schema enforces data shape constraints appropriate for its chart type.
 *
 * @module @bc-agent/shared/schemas/chart-config
 */

import { z } from 'zod';

// ============================================
// Shared Sub-Schemas
// ============================================

export const TremorColorSchema = z.enum([
  'blue', 'emerald', 'violet', 'amber', 'gray', 'cyan', 'pink', 'lime', 'fuchsia',
]);

export const ChartTypeSchema = z.enum([
  'bar', 'stacked_bar', 'line', 'area', 'donut', 'bar_list', 'combo', 'kpi', 'kpi_grid', 'table',
]);

// ============================================
// Per-Type Schemas
// ============================================

export const BarChartConfigSchema = z.object({
  _type: z.literal('chart_config'),
  chartType: z.literal('bar'),
  title: z.string().min(1).max(200),
  subtitle: z.string().max(500).optional(),
  data: z.array(z.record(z.unknown())).min(1).max(100),
  index: z.string().min(1),
  categories: z.array(z.string().min(1)).min(1).max(10),
  colors: z.array(TremorColorSchema).optional(),
});

export const StackedBarChartConfigSchema = z.object({
  _type: z.literal('chart_config'),
  chartType: z.literal('stacked_bar'),
  title: z.string().min(1).max(200),
  subtitle: z.string().max(500).optional(),
  data: z.array(z.record(z.unknown())).min(1).max(100),
  index: z.string().min(1),
  categories: z.array(z.string().min(1)).min(2).max(10),
  colors: z.array(TremorColorSchema).optional(),
});

export const LineChartConfigSchema = z.object({
  _type: z.literal('chart_config'),
  chartType: z.literal('line'),
  title: z.string().min(1).max(200),
  subtitle: z.string().max(500).optional(),
  data: z.array(z.record(z.unknown())).min(2).max(500),
  index: z.string().min(1),
  categories: z.array(z.string().min(1)).min(1).max(10),
  colors: z.array(TremorColorSchema).optional(),
});

export const AreaChartConfigSchema = z.object({
  _type: z.literal('chart_config'),
  chartType: z.literal('area'),
  title: z.string().min(1).max(200),
  subtitle: z.string().max(500).optional(),
  data: z.array(z.record(z.unknown())).min(2).max(500),
  index: z.string().min(1),
  categories: z.array(z.string().min(1)).min(1).max(10),
  colors: z.array(TremorColorSchema).optional(),
  type: z.enum(['default', 'stacked', 'percent']).optional(),
  fill: z.enum(['gradient', 'solid', 'none']).optional(),
});

export const DonutChartConfigSchema = z.object({
  _type: z.literal('chart_config'),
  chartType: z.literal('donut'),
  title: z.string().min(1).max(200),
  subtitle: z.string().max(500).optional(),
  data: z.array(z.record(z.unknown())).min(2).max(12),
  category: z.string().min(1),
  value: z.string().min(1),
  colors: z.array(TremorColorSchema).optional(),
});

export const BarListConfigSchema = z.object({
  _type: z.literal('chart_config'),
  chartType: z.literal('bar_list'),
  title: z.string().min(1).max(200),
  subtitle: z.string().max(500).optional(),
  data: z.array(z.object({ name: z.string().min(1), value: z.number() })).min(1).max(30),
  color: TremorColorSchema.optional(),
});

export const ComboChartConfigSchema = z.object({
  _type: z.literal('chart_config'),
  chartType: z.literal('combo'),
  title: z.string().min(1).max(200),
  subtitle: z.string().max(500).optional(),
  data: z.array(z.record(z.unknown())).min(2).max(500),
  index: z.string().min(1),
  barCategories: z.array(z.string().min(1)).min(1).max(10),
  lineCategories: z.array(z.string().min(1)).min(1).max(10),
  colors: z.array(TremorColorSchema).optional(),
});

export const KpiConfigSchema = z.object({
  _type: z.literal('chart_config'),
  chartType: z.literal('kpi'),
  title: z.string().min(1).max(200),
  subtitle: z.string().max(500).optional(),
  metric: z.string().min(1),
  label: z.string().min(1),
  delta: z.string().optional(),
  deltaType: z.enum(['increase', 'decrease', 'unchanged']).optional(),
});

export const KpiGridConfigSchema = z.object({
  _type: z.literal('chart_config'),
  chartType: z.literal('kpi_grid'),
  title: z.string().min(1).max(200),
  subtitle: z.string().max(500).optional(),
  items: z.array(z.object({
    metric: z.string().min(1),
    label: z.string().min(1),
    delta: z.string().optional(),
    deltaType: z.enum(['increase', 'decrease', 'unchanged']).optional(),
  })).min(2).max(8),
  columns: z.number().int().min(2).max(4).optional(),
});

export const TableConfigSchema = z.object({
  _type: z.literal('chart_config'),
  chartType: z.literal('table'),
  title: z.string().min(1).max(200),
  subtitle: z.string().max(500).optional(),
  rows: z.array(z.record(z.unknown())).min(1).max(500),
  columns: z.array(z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    align: z.enum(['left', 'center', 'right']).optional(),
  })).min(1).max(20),
});

// ============================================
// Discriminated Union Schema
// ============================================

export const ChartConfigSchema = z.discriminatedUnion('chartType', [
  BarChartConfigSchema,
  StackedBarChartConfigSchema,
  LineChartConfigSchema,
  AreaChartConfigSchema,
  DonutChartConfigSchema,
  BarListConfigSchema,
  ComboChartConfigSchema,
  KpiConfigSchema,
  KpiGridConfigSchema,
  TableConfigSchema,
]);
