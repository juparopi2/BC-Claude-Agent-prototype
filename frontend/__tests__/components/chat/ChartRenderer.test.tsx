/**
 * ChartRenderer Component Tests
 *
 * Tests chart validation and rendering logic.
 * Validates error messages for invalid configurations and successful rendering.
 *
 * @module __tests__/components/chat/ChartRenderer
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChartRenderer } from '@/src/presentation/chat/ChartRenderer/ChartRenderer';

// Mock recharts to avoid SSR issues and simplify testing
interface MockProps { children?: React.ReactNode }
vi.mock('recharts', () => ({
  BarChart: ({ children }: MockProps) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  CartesianGrid: () => <div />,
  Tooltip: () => <div />,
  Legend: () => <div />,
  ResponsiveContainer: ({ children }: MockProps) => <div>{children}</div>,
  LineChart: ({ children }: MockProps) => <div data-testid="line-chart">{children}</div>,
  Line: () => <div />,
  AreaChart: ({ children }: MockProps) => <div data-testid="area-chart">{children}</div>,
  Area: () => <div />,
  PieChart: ({ children }: MockProps) => <div data-testid="pie-chart">{children}</div>,
  Pie: () => <div />,
  Cell: () => <div />,
  ComposedChart: ({ children }: MockProps) => <div data-testid="combo-chart">{children}</div>,
}));

describe('ChartRenderer', () => {
  describe('Validation errors', () => {
    it('renders error message for invalid chart data (missing required fields)', () => {
      const invalidConfig = { _type: 'chart_config', chartType: 'bar' };

      render(<ChartRenderer data={invalidConfig} />);

      expect(screen.getByText('Invalid chart configuration')).toBeInTheDocument();
    });

    it('renders error message for completely invalid data', () => {
      const invalidData = { _type: 'chart_config' };

      render(<ChartRenderer data={invalidData} />);

      expect(screen.getByText('Invalid chart configuration')).toBeInTheDocument();
    });

    it('renders error message for wrong _type', () => {
      const wrongType = {
        _type: 'not_chart_config',
        chartType: 'bar',
        title: 'Test',
        data: [],
        index: 'x',
        categories: ['y'],
      };

      render(<ChartRenderer data={wrongType} />);

      expect(screen.getByText('Invalid chart configuration')).toBeInTheDocument();
    });

    it('displays validation error details in pre tag', () => {
      const invalidConfig = { _type: 'chart_config', chartType: 'bar' };

      const { container } = render(<ChartRenderer data={invalidConfig} />);

      const preElement = container.querySelector('pre');
      expect(preElement).toBeInTheDocument();
      expect(preElement).toHaveClass('text-xs');
    });

    it('applies error styling (red border and background)', () => {
      const invalidConfig = { _type: 'chart_config', chartType: 'bar' };

      const { container } = render(<ChartRenderer data={invalidConfig} />);

      const errorDiv = container.querySelector('.border-red-200');
      expect(errorDiv).toBeInTheDocument();
    });
  });

  describe('Valid chart rendering', () => {
    it('renders bar chart title for valid bar config', () => {
      const barConfig = {
        _type: 'chart_config',
        chartType: 'bar',
        title: 'Test Bar Chart',
        data: [{ month: 'Jan', sales: 100 }],
        index: 'month',
        categories: ['sales'],
      };

      render(<ChartRenderer data={barConfig} />);

      expect(screen.getByText('Test Bar Chart')).toBeInTheDocument();
      expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    });

    it('renders line chart for valid line config', () => {
      // LineChart requires minimum 2 data points
      const lineConfig = {
        _type: 'chart_config',
        chartType: 'line',
        title: 'Test Line Chart',
        data: [
          { month: 'Jan', value: 100 },
          { month: 'Feb', value: 150 },
        ],
        index: 'month',
        categories: ['value'],
      };

      render(<ChartRenderer data={lineConfig} />);

      expect(screen.getByText('Test Line Chart')).toBeInTheDocument();
      expect(screen.getByTestId('line-chart')).toBeInTheDocument();
    });

    it('renders KPI with metric and label', () => {
      const kpiConfig = {
        _type: 'chart_config',
        chartType: 'kpi',
        title: 'Revenue',
        metric: '$1.2M',
        label: 'Total Revenue',
      };

      render(<ChartRenderer data={kpiConfig} />);

      // KpiView does NOT render the title prop - only label, metric, subtitle
      expect(screen.getByText('$1.2M')).toBeInTheDocument();
      expect(screen.getByText('Total Revenue')).toBeInTheDocument();
    });

    it('renders KPI with optional subtitle', () => {
      const kpiConfig = {
        _type: 'chart_config',
        chartType: 'kpi',
        title: 'Sales',
        metric: '1,234',
        label: 'Units Sold',
        subtitle: 'Year to Date',
      };

      render(<ChartRenderer data={kpiConfig} />);

      // KpiView renders label (small), metric (large), and subtitle (small)
      expect(screen.getByText('1,234')).toBeInTheDocument();
      expect(screen.getByText('Units Sold')).toBeInTheDocument();
      expect(screen.getByText('Year to Date')).toBeInTheDocument();
    });

    it('renders donut chart for valid config', () => {
      const donutConfig = {
        _type: 'chart_config',
        chartType: 'donut',
        title: 'Distribution',
        data: [
          { name: 'A', value: 30 },
          { name: 'B', value: 70 },
        ],
        category: 'name',
        value: 'value',
      };

      render(<ChartRenderer data={donutConfig} />);

      expect(screen.getByText('Distribution')).toBeInTheDocument();
      expect(screen.getByTestId('pie-chart')).toBeInTheDocument();
    });
  });

  describe('Edge cases', () => {
    it('shows validation error for unsupported chart type', () => {
      // Unsupported chart types fail Zod validation (not in enum)
      const unsupportedConfig = {
        _type: 'chart_config',
        chartType: 'radar' as unknown as 'bar',
        title: 'Radar Chart',
        data: [],
        index: 'x',
        categories: ['y'],
      };

      render(<ChartRenderer data={unsupportedConfig} />);

      // Should show validation error, not "Unsupported chart type"
      expect(screen.getByText('Invalid chart configuration')).toBeInTheDocument();
    });

    it('shows validation error for empty data array', () => {
      // Empty data array fails validation (min 1 for bar charts)
      const emptyDataConfig = {
        _type: 'chart_config',
        chartType: 'bar',
        title: 'Empty Chart',
        data: [],
        index: 'x',
        categories: ['y'],
      };

      render(<ChartRenderer data={emptyDataConfig} />);

      // Should show validation error for empty array
      expect(screen.getByText('Invalid chart configuration')).toBeInTheDocument();
    });

    it('renders bar chart with single data point', () => {
      // Bar chart min is 1 data point (unlike line/area which require 2)
      const singlePointConfig = {
        _type: 'chart_config',
        chartType: 'bar',
        title: 'Single Point',
        data: [{ x: 'A', y: 10 }],
        index: 'x',
        categories: ['y'],
      };

      render(<ChartRenderer data={singlePointConfig} />);

      expect(screen.getByText('Single Point')).toBeInTheDocument();
      expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    });
  });
});
