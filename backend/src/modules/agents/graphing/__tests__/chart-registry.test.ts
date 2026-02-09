/**
 * Chart Registry Tests
 *
 * Tests for the chart type catalog metadata.
 */

import { describe, it, expect } from 'vitest';
import { ChartConfigSchema } from '@bc-agent/shared';
import { getAllChartTypes, getChartTypeMetadata, CHART_REGISTRY } from '../chart-registry';

describe('Chart Registry', () => {
  it('should contain exactly 10 chart types', () => {
    const types = getAllChartTypes();
    expect(types).toHaveLength(10);
  });

  it('should have all required metadata fields for each entry', () => {
    const types = getAllChartTypes();
    for (const ct of types) {
      expect(ct).toHaveProperty('id');
      expect(ct).toHaveProperty('name');
      expect(ct).toHaveProperty('description');
      expect(ct).toHaveProperty('bestFor');
      expect(ct).toHaveProperty('dataShape');
      expect(ct).toHaveProperty('constraints');
      expect(ct).toHaveProperty('requiredFields');
      expect(ct).toHaveProperty('optionalFields');
      expect(ct).toHaveProperty('example');
      expect(ct.bestFor.length).toBeGreaterThan(0);
      expect(ct.constraints.length).toBeGreaterThan(0);
      expect(ct.requiredFields.length).toBeGreaterThan(0);
    }
  });

  it('should have valid example configs that pass ChartConfigSchema', () => {
    const types = getAllChartTypes();
    for (const ct of types) {
      const result = ChartConfigSchema.safeParse(ct.example);
      expect(result.success, `Example for "${ct.id}" should be valid: ${JSON.stringify(result.success ? {} : result.error.errors)}`).toBe(true);
    }
  });

  it('should return correct metadata for getChartTypeMetadata("bar")', () => {
    const metadata = getChartTypeMetadata('bar');
    expect(metadata).toBeDefined();
    expect(metadata!.id).toBe('bar');
    expect(metadata!.name).toBe('Bar Chart');
    expect(metadata!.requiredFields).toContain('data');
    expect(metadata!.requiredFields).toContain('index');
    expect(metadata!.requiredFields).toContain('categories');
  });

  it('should return undefined for unknown chart type', () => {
    const metadata = getChartTypeMetadata('unknown');
    expect(metadata).toBeUndefined();
  });

  it('should return undefined for empty string', () => {
    const metadata = getChartTypeMetadata('');
    expect(metadata).toBeUndefined();
  });

  it('should have the CHART_REGISTRY map exported', () => {
    expect(CHART_REGISTRY).toBeDefined();
    expect(CHART_REGISTRY.size).toBe(10);
  });

  it('should contain all expected chart type IDs', () => {
    const expectedIds = ['bar', 'stacked_bar', 'line', 'area', 'donut', 'bar_list', 'combo', 'kpi', 'kpi_grid', 'table'];
    for (const id of expectedIds) {
      expect(CHART_REGISTRY.has(id as Parameters<typeof CHART_REGISTRY.has>[0]),
        `Registry should contain "${id}"`).toBe(true);
    }
  });
});
