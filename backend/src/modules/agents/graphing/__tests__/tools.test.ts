/**
 * Graphing Agent Tools Tests
 *
 * Tests for the 3 catalog-driven tools.
 */

import { describe, it, expect } from 'vitest';
import {
  listAvailableChartsTool,
  getChartDetailsTool,
  validateChartConfigTool,
} from '../tools';

describe('Graphing Agent Tools', () => {
  describe('list_available_charts', () => {
    it('should return 10 chart types', async () => {
      const result = await listAvailableChartsTool.invoke({});
      const parsed = JSON.parse(result);
      expect(parsed.total).toBe(10);
      expect(parsed.chartTypes).toHaveLength(10);
    });

    it('should include metadata for each chart type', async () => {
      const result = await listAvailableChartsTool.invoke({});
      const parsed = JSON.parse(result);
      for (const ct of parsed.chartTypes) {
        expect(ct).toHaveProperty('id');
        expect(ct).toHaveProperty('name');
        expect(ct).toHaveProperty('description');
        expect(ct).toHaveProperty('bestFor');
        expect(ct).toHaveProperty('dataShape');
      }
    });

    it('should include all expected chart type IDs', async () => {
      const result = await listAvailableChartsTool.invoke({});
      const parsed = JSON.parse(result);
      const ids = parsed.chartTypes.map((ct: { id: string }) => ct.id);
      expect(ids).toContain('bar');
      expect(ids).toContain('stacked_bar');
      expect(ids).toContain('line');
      expect(ids).toContain('area');
      expect(ids).toContain('donut');
      expect(ids).toContain('bar_list');
      expect(ids).toContain('combo');
      expect(ids).toContain('kpi');
      expect(ids).toContain('kpi_grid');
      expect(ids).toContain('table');
    });
  });

  describe('get_chart_details', () => {
    it('should return full metadata for a valid chart type', async () => {
      const result = await getChartDetailsTool.invoke({ chart_type: 'bar' });
      const parsed = JSON.parse(result);
      expect(parsed.id).toBe('bar');
      expect(parsed.name).toBe('Bar Chart');
      expect(parsed).toHaveProperty('requiredFields');
      expect(parsed).toHaveProperty('optionalFields');
      expect(parsed).toHaveProperty('constraints');
      expect(parsed).toHaveProperty('example');
    });

    it('should return a complete example config', async () => {
      const result = await getChartDetailsTool.invoke({ chart_type: 'donut' });
      const parsed = JSON.parse(result);
      expect(parsed.example._type).toBe('chart_config');
      expect(parsed.example.chartType).toBe('donut');
    });

    it('should work for all valid chart types', async () => {
      const chartTypes = ['bar', 'stacked_bar', 'line', 'area', 'donut', 'bar_list', 'combo', 'kpi', 'kpi_grid', 'table'];
      for (const chartType of chartTypes) {
        const result = await getChartDetailsTool.invoke({ chart_type: chartType });
        const parsed = JSON.parse(result);
        expect(parsed.id).toBe(chartType);
        expect(parsed).toHaveProperty('name');
        expect(parsed).toHaveProperty('example');
      }
    });
  });

  describe('validate_chart_config', () => {
    it('should validate a correct bar config', async () => {
      const config = {
        _type: 'chart_config',
        chartType: 'bar',
        title: 'Test',
        data: [{ x: 'A', y: 10 }],
        index: 'x',
        categories: ['y'],
      };
      const result = await validateChartConfigTool.invoke({ config });
      const parsed = JSON.parse(result);
      expect(parsed.valid).toBe(true);
      expect(parsed.chartType).toBe('bar');
    });

    it('should return errors for invalid config', async () => {
      const config = {
        _type: 'chart_config',
        chartType: 'bar',
        title: 'Test',
        // missing data, index, categories
      };
      const result = await validateChartConfigTool.invoke({ config });
      const parsed = JSON.parse(result);
      expect(parsed.valid).toBe(false);
      expect(parsed.errors).toBeInstanceOf(Array);
      expect(parsed.errors.length).toBeGreaterThan(0);
    });

    it('should return errors with path and message', async () => {
      const config = {
        _type: 'chart_config',
        chartType: 'bar',
        title: '',
        data: [],
        index: 'x',
        categories: [],
      };
      const result = await validateChartConfigTool.invoke({ config });
      const parsed = JSON.parse(result);
      expect(parsed.valid).toBe(false);
      for (const err of parsed.errors) {
        expect(err).toHaveProperty('path');
        expect(err).toHaveProperty('message');
      }
    });

    it('should validate a correct kpi config', async () => {
      const config = {
        _type: 'chart_config',
        chartType: 'kpi',
        title: 'Revenue',
        metric: '$100K',
        label: 'Total',
      };
      const result = await validateChartConfigTool.invoke({ config });
      const parsed = JSON.parse(result);
      expect(parsed.valid).toBe(true);
      expect(parsed.chartType).toBe('kpi');
    });
  });
});
