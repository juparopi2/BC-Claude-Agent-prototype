/**
 * MCP Tool Argument Validation Schemas
 *
 * Zod schemas for validating MCP tool arguments before execution.
 * Ensures type safety and prevents invalid tool calls.
 *
 * @module services/agent/tool-schemas
 */

import { z } from 'zod';

/**
 * List All Entities Tool Args
 */
export const listAllEntitiesArgsSchema = z.object({
  filter_by_operations: z.array(z.string()).optional(),
  search_term: z.string().optional(),
});

export type ListAllEntitiesArgs = z.infer<typeof listAllEntitiesArgsSchema>;

/**
 * Search Entity Operations Tool Args
 */
export const searchEntityOperationsArgsSchema = z.object({
  entity_name: z.string().min(1, 'Entity name is required'),
  operation_type: z.enum(['GET', 'POST', 'PATCH', 'DELETE', 'ALL']).optional(),
  search_keywords: z.array(z.string()).optional(),
});

export type SearchEntityOperationsArgs = z.infer<typeof searchEntityOperationsArgsSchema>;

/**
 * Get Entity Details Tool Args
 */
export const getEntityDetailsArgsSchema = z.object({
  entity_name: z.string().min(1, 'Entity name is required'),
  include_examples: z.boolean().default(true),
});

export type GetEntityDetailsArgs = z.infer<typeof getEntityDetailsArgsSchema>;

/**
 * Get Operation Details Tool Args
 */
export const getOperationDetailsArgsSchema = z.object({
  entity_name: z.string().min(1, 'Entity name is required'),
  operation_id: z.string().min(1, 'Operation ID is required'),
});

export type GetOperationDetailsArgs = z.infer<typeof getOperationDetailsArgsSchema>;

/**
 * Search All Schemas Tool Args
 */
export const searchAllSchemasArgsSchema = z.object({
  property_name: z.string().optional(),
  property_type: z.string().optional(),
  required_only: z.boolean().default(false),
});

export type SearchAllSchemasArgs = z.infer<typeof searchAllSchemasArgsSchema>;

/**
 * Find Operations by Path Tool Args
 */
export const findOperationsByPathArgsSchema = z.object({
  path_pattern: z.string().min(1, 'Path pattern is required'),
  method: z.enum(['GET', 'POST', 'PATCH', 'DELETE', 'ALL']).optional(),
});

export type FindOperationsByPathArgs = z.infer<typeof findOperationsByPathArgsSchema>;

/**
 * Get Related Operations Tool Args
 */
export const getRelatedOperationsArgsSchema = z.object({
  entity_name: z.string().min(1, 'Entity name is required'),
  operation_type: z.enum(['GET', 'POST', 'PATCH', 'DELETE', 'ALL']).optional(),
  max_results: z.number().int().min(1).max(50).default(10),
});

export type GetRelatedOperationsArgs = z.infer<typeof getRelatedOperationsArgsSchema>;

/**
 * Tool Schema Registry
 * Maps tool names to their validation schemas
 */
export const TOOL_SCHEMAS = {
  list_all_entities: listAllEntitiesArgsSchema,
  search_entity_operations: searchEntityOperationsArgsSchema,
  get_entity_details: getEntityDetailsArgsSchema,
  get_operation_details: getOperationDetailsArgsSchema,
  search_all_schemas: searchAllSchemasArgsSchema,
  find_operations_by_path: findOperationsByPathArgsSchema,
  get_related_operations: getRelatedOperationsArgsSchema,
} as const;

export type ToolName = keyof typeof TOOL_SCHEMAS;

/**
 * Validate Tool Arguments
 *
 * @param toolName - Name of the tool
 * @param args - Arguments to validate
 * @returns Validated arguments or throws ZodError
 *
 * @example
 * ```typescript
 * try {
 *   const validated = validateToolArgs('search_entity_operations', {
 *     entity_name: 'customers',
 *     operation_type: 'GET'
 *   });
 *   // Use validated args
 * } catch (error) {
 *   if (error instanceof z.ZodError) {
 *     console.error('Invalid tool arguments:', error.errors);
 *   }
 * }
 * ```
 */
export function validateToolArgs<T extends ToolName>(
  toolName: T,
  args: unknown
): z.infer<typeof TOOL_SCHEMAS[T]> {
  const schema = TOOL_SCHEMAS[toolName];
  if (!schema) {
    throw new Error(`Unknown tool: ${toolName}`);
  }
  return schema.parse(args);
}

/**
 * Validate Tool Arguments (Safe)
 *
 * @param toolName - Name of the tool
 * @param args - Arguments to validate
 * @returns { success: true, data } or { success: false, error }
 */
export function validateToolArgsSafe<T extends ToolName>(
  toolName: T,
  args: unknown
): { success: true; data: z.infer<typeof TOOL_SCHEMAS[T]> } | { success: false; error: z.ZodError } {
  const schema = TOOL_SCHEMAS[toolName];
  if (!schema) {
    return {
      success: false,
      error: new z.ZodError([
        {
          code: 'custom',
          path: ['toolName'],
          message: `Unknown tool: ${toolName}`,
        },
      ]),
    };
  }

  const result = schema.safeParse(args);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}
