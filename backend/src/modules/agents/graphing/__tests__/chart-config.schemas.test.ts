/**
 * Chart Config Schema Tests
 *
 * Validates all 10 chart config Zod schemas and the discriminated union.
 */

import { describe, it, expect } from 'vitest';
import {
  ChartConfigSchema,
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
} from '@bc-agent/shared';

// ============================================
// Valid Config Fixtures
// ============================================

const validBarConfig = {
  _type: 'chart_config',
  chartType: 'bar',
  title: 'Revenue by Quarter',
  data: [{ quarter: 'Q1', revenue: 45000 }],
  index: 'quarter',
  categories: ['revenue'],
};

const validStackedBarConfig = {
  _type: 'chart_config',
  chartType: 'stacked_bar',
  title: 'Revenue by Product',
  data: [{ quarter: 'Q1', hardware: 30000, software: 15000 }],
  index: 'quarter',
  categories: ['hardware', 'software'],
};

const validLineConfig = {
  _type: 'chart_config',
  chartType: 'line',
  title: 'Monthly Sales',
  data: [
    { month: 'Jan', sales: 4000 },
    { month: 'Feb', sales: 4500 },
  ],
  index: 'month',
  categories: ['sales'],
};

const validAreaConfig = {
  _type: 'chart_config',
  chartType: 'area',
  title: 'Cumulative Revenue',
  data: [
    { month: 'Jan', revenue: 10000 },
    { month: 'Feb', revenue: 25000 },
  ],
  index: 'month',
  categories: ['revenue'],
};

const validDonutConfig = {
  _type: 'chart_config',
  chartType: 'donut',
  title: 'Expense Distribution',
  data: [
    { department: 'Engineering', amount: 150000 },
    { department: 'Marketing', amount: 80000 },
  ],
  category: 'department',
  value: 'amount',
};

const validBarListConfig = {
  _type: 'chart_config',
  chartType: 'bar_list',
  title: 'Top Customers',
  data: [{ name: 'Acme Corp', value: 250000 }],
};

const validComboConfig = {
  _type: 'chart_config',
  chartType: 'combo',
  title: 'Revenue vs Growth',
  data: [
    { quarter: 'Q1', revenue: 45000, growth: 12 },
    { quarter: 'Q2', revenue: 52000, growth: 15 },
  ],
  index: 'quarter',
  barCategories: ['revenue'],
  lineCategories: ['growth'],
};

const validKpiConfig = {
  _type: 'chart_config',
  chartType: 'kpi',
  title: 'Total Revenue',
  metric: '$1,234,567',
  label: 'Total Revenue YTD',
};

const validKpiGridConfig = {
  _type: 'chart_config',
  chartType: 'kpi_grid',
  title: 'Business Overview',
  items: [
    { metric: '$1.2M', label: 'Revenue' },
    { metric: '847', label: 'Orders' },
  ],
};

const validTableConfig = {
  _type: 'chart_config',
  chartType: 'table',
  title: 'Recent Orders',
  rows: [{ id: 'ORD-001', customer: 'Acme', amount: 15000 }],
  columns: [
    { key: 'id', label: 'Order ID' },
    { key: 'customer', label: 'Customer' },
  ],
};

// ============================================
// Tests
// ============================================

describe('Chart Config Schemas', () => {
  describe('Valid configs pass validation', () => {
    it.each([
      ['bar', validBarConfig],
      ['stacked_bar', validStackedBarConfig],
      ['line', validLineConfig],
      ['area', validAreaConfig],
      ['donut', validDonutConfig],
      ['bar_list', validBarListConfig],
      ['combo', validComboConfig],
      ['kpi', validKpiConfig],
      ['kpi_grid', validKpiGridConfig],
      ['table', validTableConfig],
    ])('should accept valid %s config', (_type, config) => {
      const result = ChartConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });
  });

  describe('_type field required', () => {
    it('should reject config without _type', () => {
      const { _type, ...noType } = validBarConfig;
      const result = BarChartConfigSchema.safeParse(noType);
      expect(result.success).toBe(false);
    });

    it('should reject config with wrong _type', () => {
      const result = BarChartConfigSchema.safeParse({ ...validBarConfig, _type: 'wrong' });
      expect(result.success).toBe(false);
    });
  });

  describe('Discriminated union routes by chartType', () => {
    it('should route bar config correctly', () => {
      const result = ChartConfigSchema.safeParse(validBarConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.chartType).toBe('bar');
      }
    });

    it('should route donut config correctly', () => {
      const result = ChartConfigSchema.safeParse(validDonutConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.chartType).toBe('donut');
      }
    });

    it('should reject unknown chartType', () => {
      const result = ChartConfigSchema.safeParse({
        ...validBarConfig,
        chartType: 'scatter',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('Missing required fields', () => {
    it('should reject bar config without data', () => {
      const { data: _data, ...noData } = validBarConfig;
      const result = BarChartConfigSchema.safeParse(noData);
      expect(result.success).toBe(false);
    });

    it('should reject bar config without index', () => {
      const { index: _index, ...noIndex } = validBarConfig;
      const result = BarChartConfigSchema.safeParse(noIndex);
      expect(result.success).toBe(false);
    });

    it('should reject bar config without categories', () => {
      const { categories: _categories, ...noCats } = validBarConfig;
      const result = BarChartConfigSchema.safeParse(noCats);
      expect(result.success).toBe(false);
    });

    it('should reject bar config without title', () => {
      const { title: _title, ...noTitle } = validBarConfig;
      const result = BarChartConfigSchema.safeParse(noTitle);
      expect(result.success).toBe(false);
    });

    it('should reject donut config without category', () => {
      const { category: _category, ...noCat } = validDonutConfig;
      const result = DonutChartConfigSchema.safeParse(noCat);
      expect(result.success).toBe(false);
    });

    it('should reject donut config without value', () => {
      const { value: _value, ...noVal } = validDonutConfig;
      const result = DonutChartConfigSchema.safeParse(noVal);
      expect(result.success).toBe(false);
    });

    it('should reject combo config without barCategories', () => {
      const { barCategories: _barCategories, ...noBars } = validComboConfig;
      const result = ComboChartConfigSchema.safeParse(noBars);
      expect(result.success).toBe(false);
    });

    it('should reject combo config without lineCategories', () => {
      const { lineCategories: _lineCategories, ...noLines } = validComboConfig;
      const result = ComboChartConfigSchema.safeParse(noLines);
      expect(result.success).toBe(false);
    });

    it('should reject kpi config without metric', () => {
      const { metric: _metric, ...noMetric } = validKpiConfig;
      const result = KpiConfigSchema.safeParse(noMetric);
      expect(result.success).toBe(false);
    });

    it('should reject table config without columns', () => {
      const { columns: _columns, ...noCols } = validTableConfig;
      const result = TableConfigSchema.safeParse(noCols);
      expect(result.success).toBe(false);
    });
  });

  describe('Constraint enforcement', () => {
    it('should reject stacked_bar with only 1 category (needs min 2)', () => {
      const result = StackedBarChartConfigSchema.safeParse({
        ...validStackedBarConfig,
        categories: ['hardware'],
      });
      expect(result.success).toBe(false);
    });

    it('should reject line chart with only 1 data point (needs min 2)', () => {
      const result = LineChartConfigSchema.safeParse({
        ...validLineConfig,
        data: [{ month: 'Jan', sales: 4000 }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject area chart with only 1 data point (needs min 2)', () => {
      const result = AreaChartConfigSchema.safeParse({
        ...validAreaConfig,
        data: [{ month: 'Jan', revenue: 10000 }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject donut chart with only 1 data point (needs min 2)', () => {
      const result = DonutChartConfigSchema.safeParse({
        ...validDonutConfig,
        data: [{ department: 'Engineering', amount: 150000 }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject kpi_grid with only 1 item (needs min 2)', () => {
      const result = KpiGridConfigSchema.safeParse({
        ...validKpiGridConfig,
        items: [{ metric: '$1M', label: 'Revenue' }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject kpi_grid with columns < 2', () => {
      const result = KpiGridConfigSchema.safeParse({
        ...validKpiGridConfig,
        columns: 1,
      });
      expect(result.success).toBe(false);
    });

    it('should reject kpi_grid with columns > 4', () => {
      const result = KpiGridConfigSchema.safeParse({
        ...validKpiGridConfig,
        columns: 5,
      });
      expect(result.success).toBe(false);
    });

    it('should reject bar config with empty data', () => {
      const result = BarChartConfigSchema.safeParse({
        ...validBarConfig,
        data: [],
      });
      expect(result.success).toBe(false);
    });

    it('should reject bar config with empty categories', () => {
      const result = BarChartConfigSchema.safeParse({
        ...validBarConfig,
        categories: [],
      });
      expect(result.success).toBe(false);
    });

    it('should reject table with empty rows', () => {
      const result = TableConfigSchema.safeParse({
        ...validTableConfig,
        rows: [],
      });
      expect(result.success).toBe(false);
    });

    it('should reject table with empty columns', () => {
      const result = TableConfigSchema.safeParse({
        ...validTableConfig,
        columns: [],
      });
      expect(result.success).toBe(false);
    });

    it('should reject empty title', () => {
      const result = BarChartConfigSchema.safeParse({
        ...validBarConfig,
        title: '',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('Optional fields', () => {
    it('should accept bar config with colors', () => {
      const result = BarChartConfigSchema.safeParse({
        ...validBarConfig,
        colors: ['blue', 'emerald'],
      });
      expect(result.success).toBe(true);
    });

    it('should accept area config with type and fill', () => {
      const result = AreaChartConfigSchema.safeParse({
        ...validAreaConfig,
        type: 'stacked',
        fill: 'gradient',
      });
      expect(result.success).toBe(true);
    });

    it('should accept kpi with delta', () => {
      const result = KpiConfigSchema.safeParse({
        ...validKpiConfig,
        delta: '+12%',
        deltaType: 'increase',
      });
      expect(result.success).toBe(true);
    });

    it('should accept bar_list with color', () => {
      const result = BarListConfigSchema.safeParse({
        ...validBarListConfig,
        color: 'emerald',
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid Tremor color', () => {
      const result = BarChartConfigSchema.safeParse({
        ...validBarConfig,
        colors: ['red'],
      });
      expect(result.success).toBe(false);
    });

    it('should accept table column with align', () => {
      const result = TableConfigSchema.safeParse({
        ...validTableConfig,
        columns: [
          { key: 'id', label: 'ID', align: 'left' },
          { key: 'amount', label: 'Amount', align: 'right' },
        ],
      });
      expect(result.success).toBe(true);
    });
  });
});
