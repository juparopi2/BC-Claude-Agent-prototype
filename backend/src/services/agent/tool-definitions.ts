/**
 * @deprecated Tool definitions are now located in src/modules/agents/business-central/tools.ts
 *
 * MCP Tool Definitions
 *
 * Claude-compatible tool definitions for MCP server operations.
 * These tools allow the agent to query Business Central metadata and documentation.
 *
 * @module services/agent/tool-definitions
 */

import type { Tool } from '@anthropic-ai/sdk/resources/messages';  // ⭐ Use native SDK type

/**
 * MCP Tool Definitions
 *
 * Array of tool definitions that can be used by Claude Agent SDK.
 * These tools provide access to Business Central metadata via the MCP server.
 */
export const MCP_TOOLS: Tool[] = [
  {
    name: 'list_all_entities',
    description:
      'Returns a complete list of all Business Central entities. Use this first to discover available entities.',
    input_schema: {
      type: 'object',
      properties: {
        filter_by_operations: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['list', 'get', 'create', 'update', 'delete'],
          },
          description:
            'Optional: Filter entities that support specific operations',
        },
      },
      required: [],
    },
  },
  {
    name: 'search_entity_operations',
    description:
      'Search for entities and operations by keyword. Returns matching entities with their operation_ids.',
    input_schema: {
      type: 'object',
      properties: {
        keyword: {
          type: 'string',
          description:
            'Search keyword (searches entity names, descriptions, and operation summaries)',
        },
        filter_by_risk: {
          type: 'string',
          enum: ['LOW', 'MEDIUM', 'HIGH'],
          description: 'Optional: Filter by risk level',
        },
        filter_by_operation_type: {
          type: 'string',
          enum: ['list', 'get', 'create', 'update', 'delete'],
          description: 'Optional: Filter by operation type',
        },
      },
      required: ['keyword'],
    },
  },
  {
    name: 'get_entity_details',
    description:
      'Get complete details for a specific entity including all endpoints, parameters, and schemas.',
    input_schema: {
      type: 'object',
      properties: {
        entity_name: {
          type: 'string',
          description: 'Name of the entity (exact match)',
        },
      },
      required: ['entity_name'],
    },
  },
  {
    name: 'get_entity_relationships',
    description:
      'Discover relationships between entities and common multi-entity workflows.',
    input_schema: {
      type: 'object',
      properties: {
        entity_name: {
          type: 'string',
          description: 'Name of the entity',
        },
      },
      required: ['entity_name'],
    },
  },
  {
    name: 'validate_workflow_structure',
    description:
      'Validates a workflow structure using operation_ids. Checks for dependencies, risk levels, and sequencing.',
    input_schema: {
      type: 'object',
      properties: {
        workflow: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              operation_id: {
                type: 'string',
                description:
                  'Unique operation ID (e.g., "postCustomer", "listSalesInvoices")',
              },
              label: {
                type: 'string',
                description: 'Optional human-readable label for the step',
              },
            },
            required: ['operation_id'],
          },
          description: 'Array of workflow steps with operation_ids',
        },
      },
      required: ['workflow'],
    },
  },
  {
    name: 'build_knowledge_base_workflow',
    description:
      'Builds a comprehensive knowledge base workflow with full metadata, alternatives, outcomes, and business scenarios.',
    input_schema: {
      type: 'object',
      properties: {
        workflow_name: {
          type: 'string',
          description: 'Name of the workflow',
        },
        workflow_description: {
          type: 'string',
          description: 'Description of what the workflow does',
        },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              operation_id: {
                type: 'string',
                description: 'Unique operation ID',
              },
              label: {
                type: 'string',
                description: 'Optional human-readable label',
              },
            },
            required: ['operation_id'],
          },
          description: 'Array of workflow steps',
        },
      },
      required: ['workflow_name', 'steps'],
    },
  },
  {
    name: 'get_endpoint_documentation',
    description:
      'Get detailed documentation for a specific operation_id including all parameters, schemas, and examples.',
    input_schema: {
      type: 'object',
      properties: {
        operation_id: {
          type: 'string',
          description: 'The operation ID to get documentation for',
        },
      },
      required: ['operation_id'],
    },
  },
];

/**
 * Get MCP Tool Definitions
 *
 * Returns the array of MCP tool definitions.
 * Convenience function for importing.
 *
 * @returns Array of Claude tool definitions
 */
export function getMCPToolDefinitions(): Tool[] {
  return MCP_TOOLS;
}

/**
 * Get Tool Definition by Name
 *
 * Retrieves a specific tool definition by its name.
 *
 * @param toolName - Name of the tool
 * @returns Tool definition or undefined if not found
 */
export function getToolDefinition(toolName: string): Tool | undefined {
  return MCP_TOOLS.find((tool) => tool.name === toolName);
}

/**
 * Get Tool Names
 *
 * Returns an array of all tool names.
 *
 * @returns Array of tool names
 */
export function getToolNames(): string[] {
  return MCP_TOOLS.map((tool) => tool.name);
}
