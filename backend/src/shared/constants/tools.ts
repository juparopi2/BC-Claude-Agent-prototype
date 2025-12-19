/**
 * Tool Constants
 *
 * Centralized tool names and metadata for type-safe tool handling.
 * Multi-tenant safe: All tools are scoped per session.
 *
 * @module constants/tools
 */

/**
 * Tool Names (Read-Only)
 *
 * Centralized enum for all MCP and built-in tool names.
 * Use these constants instead of hardcoded strings throughout the codebase.
 */
export const TOOL_NAMES = {
  // System Tools (Claude Agent SDK built-in)
  TODO_WRITE: 'TodoWrite',

  // Business Central Tools (MCP Server)
  BC_QUERY: 'bc_query',
  BC_CREATE: 'bc_create',
  BC_UPDATE: 'bc_update',
  BC_DELETE: 'bc_delete',

  // MCP Knowledge Base Tools
  LIST_ALL_ENTITIES: 'list_all_entities',
  SEARCH_ENTITY_OPERATIONS: 'search_entity_operations',
  GET_ENTITY_DETAILS: 'get_entity_details',
  GET_ENTITY_RELATIONSHIPS: 'get_entity_relationships',
  VALIDATE_WORKFLOW_STRUCTURE: 'validate_workflow_structure',
  BUILD_KNOWLEDGE_BASE_WORKFLOW: 'build_knowledge_base_workflow',
  GET_ENDPOINT_DOCUMENTATION: 'get_endpoint_documentation',
} as const;

/**
 * Tool Name Type
 *
 * Type-safe union of all tool names.
 */
export type ToolName = (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES];

/**
 * Tool Category
 *
 * Categorization for tool behavior and permissions.
 */
export enum ToolCategory {
  SYSTEM = 'system',
  READ = 'read',
  WRITE = 'write',
  DELETE = 'delete',
  KNOWLEDGE = 'knowledge',
}

/**
 * Tool Metadata
 *
 * Configuration for each tool including approval requirements and categorization.
 * Used for Human-in-the-Loop (HITL) validation.
 */
export const TOOL_METADATA: Record<
  ToolName,
  {
    requiresApproval: boolean;
    category: ToolCategory;
    description?: string;
  }
> = {
  // System Tools - No approval needed
  [TOOL_NAMES.TODO_WRITE]: {
    requiresApproval: false,
    category: ToolCategory.SYSTEM,
    description: 'Creates and manages TODO lists for tracking task progress',
  },

  // Write Operations - Approval required (HITL)
  [TOOL_NAMES.BC_CREATE]: {
    requiresApproval: true,
    category: ToolCategory.WRITE,
    description: 'Creates new records in Business Central',
  },
  [TOOL_NAMES.BC_UPDATE]: {
    requiresApproval: true,
    category: ToolCategory.WRITE,
    description: 'Updates existing records in Business Central',
  },
  [TOOL_NAMES.BC_DELETE]: {
    requiresApproval: true,
    category: ToolCategory.DELETE,
    description: 'Deletes records from Business Central (destructive)',
  },

  // Read Operations - No approval needed
  [TOOL_NAMES.BC_QUERY]: {
    requiresApproval: false,
    category: ToolCategory.READ,
    description: 'Queries Business Central data',
  },

  // Knowledge Base Tools - No approval needed (read-only)
  [TOOL_NAMES.LIST_ALL_ENTITIES]: {
    requiresApproval: false,
    category: ToolCategory.KNOWLEDGE,
    description: 'Lists all available Business Central entities',
  },
  [TOOL_NAMES.SEARCH_ENTITY_OPERATIONS]: {
    requiresApproval: false,
    category: ToolCategory.KNOWLEDGE,
    description: 'Searches for operations by keyword',
  },
  [TOOL_NAMES.GET_ENTITY_DETAILS]: {
    requiresApproval: false,
    category: ToolCategory.KNOWLEDGE,
    description: 'Gets detailed information about a specific entity',
  },
  [TOOL_NAMES.GET_ENTITY_RELATIONSHIPS]: {
    requiresApproval: false,
    category: ToolCategory.KNOWLEDGE,
    description: 'Discovers relationships between entities',
  },
  [TOOL_NAMES.VALIDATE_WORKFLOW_STRUCTURE]: {
    requiresApproval: false,
    category: ToolCategory.KNOWLEDGE,
    description: 'Validates multi-step workflows for correctness',
  },
  [TOOL_NAMES.BUILD_KNOWLEDGE_BASE_WORKFLOW]: {
    requiresApproval: false,
    category: ToolCategory.KNOWLEDGE,
    description: 'Builds comprehensive workflow documentation',
  },
  [TOOL_NAMES.GET_ENDPOINT_DOCUMENTATION]: {
    requiresApproval: false,
    category: ToolCategory.KNOWLEDGE,
    description: 'Gets detailed API endpoint documentation',
  },
};

/**
 * Check if tool requires human approval
 *
 * @param toolName - Name of the tool to check
 * @returns True if tool requires approval, false otherwise
 */
export function requiresApproval(toolName: string): boolean {
  const metadata = TOOL_METADATA[toolName as ToolName];
  return metadata ? metadata.requiresApproval : false;
}

/**
 * Get tool category
 *
 * @param toolName - Name of the tool
 * @returns Tool category
 */
export function getToolCategory(toolName: string): ToolCategory | undefined {
  const metadata = TOOL_METADATA[toolName as ToolName];
  return metadata?.category;
}
