/**
 * Graphing Agent Tools
 *
 * Three catalog-driven tools for the Graphing Agent:
 * 1. list_available_charts - Discover all supported chart types
 * 2. get_chart_details - Get full metadata for a specific chart type
 * 3. validate_chart_config - Validate a chart configuration against schemas
 *
 * @module modules/agents/graphing/tools
 */

import { z } from 'zod';
import { tool } from '@langchain/core/tools';
import { ChartConfigSchema, ChartTypeSchema } from '@bc-agent/shared';
import { getAllChartTypes, getChartTypeMetadata } from './chart-registry';

// ============================================
// LangChain Tool Definitions
// Note: @ts-expect-error comments suppress "Type instantiation is excessively deep"
// This is a known TypeScript limitation with LangChain's tool() generic inference
// and complex Zod schemas. The tools work correctly at runtime.
// ============================================

// ============================================
// Tool 1: List Available Charts
// ============================================

// @ts-expect-error TS2589: Type instantiation is excessively deep (LangChain tool() + Zod)
export const listAvailableChartsTool = tool(
  async () => {
    const chartTypes = getAllChartTypes();
    const summary = chartTypes.map(ct => ({
      id: ct.id,
      name: ct.name,
      description: ct.description,
      bestFor: ct.bestFor,
      dataShape: ct.dataShape,
    }));

    return JSON.stringify({
      total: summary.length,
      chartTypes: summary,
    }, null, 2);
  },
  {
    name: 'list_available_charts',
    description: 'Returns a catalog of all supported chart types with their descriptions, best uses, and data shapes. Call this first to understand what visualizations are available.',
    schema: z.object({}),
  }
);

// ============================================
// Tool 2: Get Chart Details
// ============================================

// @ts-expect-error TS2589: Type instantiation is excessively deep (LangChain tool() + Zod)
export const getChartDetailsTool = tool(
  async (input) => {
    const { chart_type } = input;
    const metadata = getChartTypeMetadata(chart_type);

    if (!metadata) {
      return JSON.stringify({
        error: true,
        message: `Unknown chart type: "${chart_type}". Use list_available_charts to see valid types.`,
      });
    }

    return JSON.stringify(metadata, null, 2);
  },
  {
    name: 'get_chart_details',
    description: 'Returns full metadata for a specific chart type including required/optional fields, constraints, and a complete example configuration.',
    schema: z.object({
      chart_type: ChartTypeSchema.describe('The chart type ID to get details for'),
    }),
  }
);

// ============================================
// Tool 3: Validate Chart Config
// ============================================

// @ts-expect-error TS2589: Type instantiation is excessively deep (LangChain tool() + Zod)
export const validateChartConfigTool = tool(
  async (input) => {
    const { config } = input;
    const result = ChartConfigSchema.safeParse(config);

    if (result.success) {
      // Return the validated config with _type: 'chart_config'
      // This triggers the frontend's ChartRenderer to display an interactive chart
      return JSON.stringify(result.data);
    }

    const errors = result.error.errors.map(e => ({
      path: e.path.join('.'),
      message: e.message,
    }));

    return JSON.stringify({
      valid: false,
      errors,
    });
  },
  {
    name: 'validate_chart_config',
    description: 'Validates and delivers a chart to the user. If valid, the chart renders interactively in the UI. If invalid, returns errors for correction. Always call this as the final step.',
    schema: z.object({
      config: z.record(z.unknown()).describe('The chart configuration object to validate'),
    }),
  }
);
