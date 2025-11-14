/**
 * SDK In-Process MCP Server for Business Central
 *
 * This replaces the stdio subprocess approach with an SDK in-process MCP server.
 * This eliminates ProcessTransport errors and improves performance.
 *
 * Migration from: backend/mcp-server (stdio subprocess)
 * Migration to: SDK createSdkMcpServer (in-process)
 *
 * Tools provided:
 * 1. list_all_entities
 * 2. search_entity_operations
 * 3. get_entity_details
 * 4. get_entity_relationships
 * 5. validate_workflow_structure
 * 6. build_knowledge_base_workflow
 * 7. get_endpoint_documentation
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Type Definitions (from mcp-server/src/types.ts)
// ============================================================================

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';
type OperationType = 'list' | 'get' | 'create' | 'update' | 'delete' | 'action';

interface Parameter {
  name: string;
  type: string;
  format?: string;
  required: boolean;
  description: string;
  enum?: string[];
  maxLength?: number;
}

interface Endpoint {
  id: string;
  method: HttpMethod;
  path: string;
  summary: string;
  operationType: OperationType;
  riskLevel: RiskLevel;
  requiresAuth: boolean;
  requiresHumanApproval: boolean;
  destructive?: boolean;
  warningMessage?: string;
  pathParams?: Parameter[];
  queryParams?: string[];
  headers?: string[];
  requestBodySchema?: string;
  responseSchema?: string;
  requiredFields?: string[];
  optionalFields?: string[];
  selectableFields?: string[];
  expandableRelations?: string[];
  successStatus: number;
  errorCodes?: number[];
}

interface EntityRelationship {
  entity: string;
  type: 'one-to-one' | 'one-to-many' | 'many-to-many';
  description?: string;
}

interface CommonWorkflow {
  name: string;
  description?: string;
  steps: string[];
}

interface EntityDefinition {
  entity: string;
  displayName: string;
  description: string;
  endpoints: Endpoint[];
  relationships?: EntityRelationship[];
  commonWorkflows?: CommonWorkflow[];
}

interface EntitySummary {
  name: string;
  displayName: string;
  description?: string;
  endpointCount: number;
  operations: OperationType[];
  hasHighRiskOps: boolean;
  relatedEntities?: string[];
  filePath: string;
}

interface MasterIndex {
  version: string;
  totalEndpoints: number;
  totalEntities: number;
  generatedAt: string;
  entities: EntitySummary[];
  quickSearch: Record<string, string[]>;
  operationIndex: Record<string, string>;
}

interface Schema {
  type: 'object' | 'array' | 'string' | 'number' | 'boolean';
  properties?: Record<string, unknown>;
  required?: string[];
  description?: string;
}

interface EnrichedStep {
  step_number: number;
  operation_id: string;
  label: string;
  entity: string;
  entity_display_name: string;
  method: HttpMethod;
  path: string;
  operation_type: OperationType;
  risk_level: RiskLevel;
  requires_approval: boolean;
  required_fields: string[];
  optional_fields: string[];
  selectable_fields: string[];
  expandable_relations: string[];
  path_parameters: Parameter[];
  query_parameters: string[];
  alternatives?: Array<{
    operation_id: string;
    summary: string;
    risk_level: RiskLevel;
  }>;
  expected_outcomes: Array<{
    type: string;
    status: number;
    description: string;
  }>;
  schema?: {
    type: string;
    description?: string;
  };
}

// ============================================================================
// Data Loading Utilities
// ============================================================================

/**
 * Gets the MCP server data directory path
 */
function getDataPath(): string {
  const mcpServerDir = path.join(process.cwd(), 'mcp-server');
  return path.join(mcpServerDir, 'data', 'v1.0');
}

/**
 * Loads the master index
 */
function loadMasterIndex(): MasterIndex {
  const dataPath = getDataPath();
  const indexPath = path.join(dataPath, 'bc_index.json');

  if (!fs.existsSync(indexPath)) {
    throw new Error(`Master index not found at ${indexPath}`);
  }

  const content = fs.readFileSync(indexPath, 'utf8');
  return JSON.parse(content) as MasterIndex;
}

/**
 * Loads an entity definition
 */
function loadEntityDefinition(entityName: string): EntityDefinition {
  const dataPath = getDataPath();
  const entityPath = path.join(dataPath, 'entities', `${entityName}.json`);

  if (!fs.existsSync(entityPath)) {
    throw new Error(`Entity ${entityName} not found at ${entityPath}`);
  }

  const content = fs.readFileSync(entityPath, 'utf8');
  return JSON.parse(content) as EntityDefinition;
}

/**
 * Loads a schema
 */
function loadSchema(schemaName: string): Schema {
  const dataPath = getDataPath();
  const schemaPath = path.join(dataPath, 'schemas', `${schemaName}.schema.json`);

  if (!fs.existsSync(schemaPath)) {
    throw new Error(`Schema ${schemaName} not found at ${schemaPath}`);
  }

  const content = fs.readFileSync(schemaPath, 'utf8');
  return JSON.parse(content) as Schema;
}

// ============================================================================
// MCP Tools Implementation
// ============================================================================

/**
 * Tool 1: list_all_entities
 * Returns a complete list of all Business Central entities available in the system
 */
const listAllEntities = tool(
  'list_all_entities',
  'Returns a complete list of all Business Central entities. Use this first to discover available entities.',
  {
    filter_by_operations: z.array(z.enum(['list', 'get', 'create', 'update', 'delete', 'action']))
      .optional()
      .describe('Optional: Filter entities that support specific operations'),
  },
  async (args: { filter_by_operations?: Array<'list' | 'get' | 'create' | 'update' | 'delete' | 'action'> }) => {
    const index = loadMasterIndex();
    let entities = index.entities;

    if (args.filter_by_operations && args.filter_by_operations.length > 0) {
      entities = entities.filter(entity => {
        return args.filter_by_operations!.every(op => entity.operations.includes(op as OperationType));
      });
    }

    const allOperationTypes = new Set<OperationType>();
    index.entities.forEach(entity => {
      entity.operations.forEach(op => allOperationTypes.add(op));
    });

    const result = {
      total_entities: entities.length,
      entities: entities,
      available_operation_types: Array.from(allOperationTypes).sort(),
    };

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  }
);

/**
 * Tool 2: search_entity_operations
 * Search for entities and operations by keyword
 */
const searchEntityOperations = tool(
  'search_entity_operations',
  'Search for entities and operations by keyword. Returns matching entities with their operation_ids.',
  {
    keyword: z.string().describe('Search keyword (searches entity names, descriptions, and operation summaries)'),
    filter_by_risk: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional()
      .describe('Optional: Filter by risk level'),
    filter_by_operation_type: z.enum(['list', 'get', 'create', 'update', 'delete', 'action']).optional()
      .describe('Optional: Filter by operation type'),
  },
  async (args: { keyword: string; filter_by_risk?: 'LOW' | 'MEDIUM' | 'HIGH'; filter_by_operation_type?: 'list' | 'get' | 'create' | 'update' | 'delete' | 'action' }) => {
    const index = loadMasterIndex();
    const keywordLower = args.keyword.toLowerCase();
    const results: Array<{
      entity: string;
      displayName: string;
      description: string;
      matching_operations: Array<{
        operation_id: string;
        method: string;
        summary: string;
        operation_type: OperationType;
        risk_level: RiskLevel;
      }>;
    }> = [];

    for (const entitySummary of index.entities) {
      const matches =
        entitySummary.name.toLowerCase().includes(keywordLower) ||
        entitySummary.displayName.toLowerCase().includes(keywordLower) ||
        (entitySummary.description?.toLowerCase().includes(keywordLower) ?? false);

      if (!matches) continue;

      const entity = loadEntityDefinition(entitySummary.name);
      let matchingOps = entity.endpoints;

      if (args.filter_by_risk) {
        matchingOps = matchingOps.filter(ep => ep.riskLevel === args.filter_by_risk);
      }
      if (args.filter_by_operation_type) {
        matchingOps = matchingOps.filter(ep => ep.operationType === args.filter_by_operation_type);
      }

      if (matchingOps.length > 0) {
        results.push({
          entity: entity.entity,
          displayName: entity.displayName,
          description: entity.description,
          matching_operations: matchingOps.map(ep => ({
            operation_id: ep.id,
            method: ep.method,
            summary: ep.summary,
            operation_type: ep.operationType,
            risk_level: ep.riskLevel,
          })),
        });
      }
    }

    const result = {
      total_matches: results.length,
      results: results,
    };

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  }
);

/**
 * Tool 3: get_entity_details
 * Retrieves complete details for a specific Business Central entity
 */
const getEntityDetails = tool(
  'get_entity_details',
  'Get complete details for a specific entity including all endpoints, parameters, and schemas.',
  {
    entity_name: z.string().describe('Name of the entity (exact match)'),
  },
  async (args: { entity_name: string }) => {
    try {
      const entity = loadEntityDefinition(args.entity_name);

      const operationGroups = new Map<OperationType, Endpoint[]>();
      entity.endpoints.forEach(endpoint => {
        const existing = operationGroups.get(endpoint.operationType) || [];
        existing.push(endpoint);
        operationGroups.set(endpoint.operationType, existing);
      });

      const operations_summary = Array.from(operationGroups.entries()).map(([op_type, endpoints]) => {
        let highestRisk: RiskLevel = 'LOW';
        for (const ep of endpoints) {
          if (ep.riskLevel === 'HIGH') {
            highestRisk = 'HIGH';
            break;
          } else if (ep.riskLevel === 'MEDIUM') {
            highestRisk = 'MEDIUM';
          }
        }

        return {
          operation_type: op_type,
          endpoint_count: endpoints.length,
          highest_risk_level: highestRisk,
          endpoints: endpoints.map(ep => ({
            operation_id: ep.id,
            method: ep.method,
            path: ep.path,
            summary: ep.summary,
            risk_level: ep.riskLevel,
            requires_approval: ep.requiresHumanApproval,
          })),
        };
      });

      const hasHighRiskOps = entity.endpoints.some(ep => ep.riskLevel === 'HIGH');

      const result = {
        entity: entity.entity,
        displayName: entity.displayName,
        description: entity.description,
        total_endpoints: entity.endpoints.length,
        operations_summary,
        has_high_risk_operations: hasHighRiskOps,
        relationships: entity.relationships,
        common_workflows: entity.commonWorkflows,
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch {
      throw new Error(
        `Entity "${args.entity_name}" not found. Use list_all_entities tool to see available entities.`
      );
    }
  }
);

/**
 * Tool 4: get_entity_relationships
 * Discover entity relationships and common workflows
 */
const getEntityRelationships = tool(
  'get_entity_relationships',
  'Discover relationships between entities and common multi-entity workflows.',
  {
    entity_name: z.string().describe('Name of the entity'),
  },
  async (args: { entity_name: string }) => {
    const entity = loadEntityDefinition(args.entity_name);

    const result = {
      entity: entity.entity,
      displayName: entity.displayName,
      relationships: entity.relationships || [],
      common_workflows: entity.commonWorkflows || [],
    };

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  }
);

/**
 * Tool 5: validate_workflow_structure
 * Validates a proposed workflow structure (V2: using operation_ids)
 */
const validateWorkflowStructure = tool(
  'validate_workflow_structure',
  'Validates a workflow structure using operation_ids. Checks for dependencies, risk levels, and sequencing.',
  {
    workflow: z.array(z.object({
      operation_id: z.string().describe('Unique operation ID (e.g., "postCustomer", "listSalesInvoices")'),
      label: z.string().optional().describe('Optional human-readable label for the step'),
    })).describe('Array of workflow steps with operation_ids'),
  },
  async (args: { workflow: Array<{ operation_id: string; label?: string }> }) => {
    const index = loadMasterIndex();
    const validationResults: Array<{
      step_number: number;
      operation_id: string;
      entity: string;
      valid: boolean;
      risk_level: RiskLevel;
      requires_approval: boolean;
      issues?: string[];
      dependencies?: string[];
    }> = [];

    let hasErrors = false;
    let stepNumber = 0;

    for (const step of args.workflow) {
      stepNumber++;
      const issues: string[] = [];
      const dependencies: string[] = [];

      const entityName = index.operationIndex[step.operation_id];

      if (!entityName) {
        hasErrors = true;
        validationResults.push({
          step_number: stepNumber,
          operation_id: step.operation_id,
          entity: 'unknown',
          valid: false,
          risk_level: 'HIGH',
          requires_approval: true,
          issues: [`Operation ID "${step.operation_id}" not found in index`],
        });
        continue;
      }

      const entity = loadEntityDefinition(entityName);
      const endpoint = entity.endpoints.find(ep => ep.id === step.operation_id);

      if (!endpoint) {
        hasErrors = true;
        validationResults.push({
          step_number: stepNumber,
          operation_id: step.operation_id,
          entity: entityName,
          valid: false,
          risk_level: 'HIGH',
          requires_approval: true,
          issues: [`Operation "${step.operation_id}" not found in entity "${entityName}"`],
        });
        continue;
      }

      if (endpoint.requiredFields) {
        const foreignKeys = endpoint.requiredFields.filter(field => field.endsWith('Id') && field !== 'id');
        if (foreignKeys.length > 0) {
          dependencies.push(...foreignKeys.map(fk => `Required field: ${fk}`));
        }
      }

      const valid = issues.length === 0;
      if (!valid) {
        hasErrors = true;
      }

      validationResults.push({
        step_number: stepNumber,
        operation_id: step.operation_id,
        entity: entityName,
        valid,
        risk_level: endpoint.riskLevel,
        requires_approval: endpoint.requiresHumanApproval,
        issues: issues.length > 0 ? issues : undefined,
        dependencies: dependencies.length > 0 ? dependencies : undefined,
      });
    }

    const result = {
      workflow_valid: !hasErrors,
      total_steps: args.workflow.length,
      validation_results: validationResults,
      summary: {
        total_high_risk: validationResults.filter(r => r.risk_level === 'HIGH').length,
        total_requiring_approval: validationResults.filter(r => r.requires_approval).length,
        total_errors: validationResults.filter(r => !r.valid).length,
      },
    };

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  }
);

/**
 * Tool 6: build_knowledge_base_workflow
 * Builds an enriched knowledge base workflow with complete metadata
 */
const buildKnowledgeBaseWorkflow = tool(
  'build_knowledge_base_workflow',
  'Builds a comprehensive knowledge base workflow with full metadata, alternatives, outcomes, and business scenarios.',
  {
    workflow_name: z.string().describe('Name of the workflow'),
    workflow_description: z.string().optional().describe('Description of what the workflow does'),
    steps: z.array(z.object({
      operation_id: z.string().describe('Unique operation ID'),
      label: z.string().optional().describe('Optional human-readable label'),
    })).describe('Array of workflow steps'),
  },
  async (args: { workflow_name: string; workflow_description?: string; steps: Array<{ operation_id: string; label?: string }> }) => {
    const index = loadMasterIndex();
    const enrichedSteps: EnrichedStep[] = [];
    let stepNumber = 0;

    for (const step of args.steps) {
      stepNumber++;
      const entityName = index.operationIndex[step.operation_id];

      if (!entityName) {
        throw new Error(`Operation ID "${step.operation_id}" not found`);
      }

      const entity = loadEntityDefinition(entityName);
      const endpoint = entity.endpoints.find(ep => ep.id === step.operation_id);

      if (!endpoint) {
        throw new Error(`Operation "${step.operation_id}" not found in entity "${entityName}"`);
      }

      let schema: Schema | null = null;
      if (endpoint.requestBodySchema || endpoint.responseSchema) {
        const schemaName = (endpoint.requestBodySchema || endpoint.responseSchema)?.replace('schemas/', '').replace('.schema.json', '');
        if (schemaName) {
          try {
            schema = loadSchema(schemaName);
          } catch {
            // Schema not found, continue without it
          }
        }
      }

      const alternatives = entity.endpoints
        .filter(ep => ep.operationType === endpoint.operationType && ep.id !== endpoint.id)
        .map(ep => ({
          operation_id: ep.id,
          summary: ep.summary,
          risk_level: ep.riskLevel,
        }));

      const outcomes = [
        { type: 'success', status: endpoint.successStatus, description: `${endpoint.operationType} operation completed successfully` },
        { type: 'error', status: 400, description: 'Bad request - invalid input data' },
        { type: 'error', status: 401, description: 'Unauthorized - authentication required' },
        { type: 'error', status: 404, description: 'Not found - resource does not exist' },
      ];

      if (endpoint.operationType === 'create') {
        outcomes.push({ type: 'error', status: 409, description: 'Conflict - resource already exists' });
      }

      enrichedSteps.push({
        step_number: stepNumber,
        operation_id: step.operation_id,
        label: step.label || endpoint.summary,
        entity: entityName,
        entity_display_name: entity.displayName,
        method: endpoint.method,
        path: endpoint.path,
        operation_type: endpoint.operationType,
        risk_level: endpoint.riskLevel,
        requires_approval: endpoint.requiresHumanApproval,
        required_fields: endpoint.requiredFields || [],
        optional_fields: endpoint.optionalFields || [],
        selectable_fields: endpoint.selectableFields || [],
        expandable_relations: endpoint.expandableRelations || [],
        path_parameters: endpoint.pathParams || [],
        query_parameters: endpoint.queryParams || [],
        alternatives: alternatives.length > 0 ? alternatives : undefined,
        expected_outcomes: outcomes,
        schema: schema ? { type: schema.type, description: schema.description } : undefined,
      });
    }

    const result = {
      workflow_name: args.workflow_name,
      workflow_description: args.workflow_description,
      total_steps: args.steps.length,
      created_at: new Date().toISOString(),
      enriched_steps: enrichedSteps,
      risk_summary: {
        high_risk_steps: enrichedSteps.filter(s => s.risk_level === 'HIGH').length,
        requires_approval_count: enrichedSteps.filter(s => s.requires_approval).length,
      },
    };

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  }
);

/**
 * Tool 7: get_endpoint_documentation
 * Gets detailed documentation for a specific operation_id
 */
const getEndpointDocumentation = tool(
  'get_endpoint_documentation',
  'Get detailed documentation for a specific operation_id including all parameters, schemas, and examples.',
  {
    operation_id: z.string().describe('The operation ID to get documentation for'),
  },
  async (args: { operation_id: string }) => {
    const index = loadMasterIndex();
    const entityName = index.operationIndex[args.operation_id];

    if (!entityName) {
      throw new Error(`Operation ID "${args.operation_id}" not found`);
    }

    const entity = loadEntityDefinition(entityName);
    const endpoint = entity.endpoints.find(ep => ep.id === args.operation_id);

    if (!endpoint) {
      throw new Error(`Operation "${args.operation_id}" not found in entity "${entityName}"`);
    }

    let requestSchema: Schema | null = null;
    let responseSchema: Schema | null = null;

    if (endpoint.requestBodySchema) {
      const schemaName = endpoint.requestBodySchema.replace('schemas/', '').replace('.schema.json', '');
      try {
        requestSchema = loadSchema(schemaName);
      } catch {
        // Schema not found
      }
    }

    if (endpoint.responseSchema) {
      const schemaName = endpoint.responseSchema.replace('schemas/', '').replace('.schema.json', '');
      try {
        responseSchema = loadSchema(schemaName);
      } catch {
        // Schema not found
      }
    }

    const result = {
      operation_id: endpoint.id,
      entity: entityName,
      entity_display_name: entity.displayName,
      method: endpoint.method,
      path: endpoint.path,
      summary: endpoint.summary,
      operation_type: endpoint.operationType,
      risk_level: endpoint.riskLevel,
      requires_auth: endpoint.requiresAuth,
      requires_approval: endpoint.requiresHumanApproval,
      destructive: endpoint.destructive,
      warning_message: endpoint.warningMessage,
      path_parameters: endpoint.pathParams || [],
      query_parameters: endpoint.queryParams || [],
      headers: endpoint.headers || [],
      required_fields: endpoint.requiredFields || [],
      optional_fields: endpoint.optionalFields || [],
      selectable_fields: endpoint.selectableFields || [],
      expandable_relations: endpoint.expandableRelations || [],
      success_status: endpoint.successStatus,
      error_codes: endpoint.errorCodes || [],
      request_schema: requestSchema,
      response_schema: responseSchema,
    };

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ============================================================================
// Export SDK MCP Server
// ============================================================================

/**
 * Creates and exports the SDK in-process MCP server for Business Central
 *
 * Usage in AgentService.ts:
 * ```typescript
 * import { bcMCPServer } from './mcp/SDKMCPServer';
 *
 * const mcpServers = {
 *   'bc-mcp': bcMCPServer
 * };
 * ```
 */
export const bcMCPServer = createSdkMcpServer({
  name: 'bc-mcp',
  version: '1.0.0',
  tools: [
    listAllEntities,
    searchEntityOperations,
    getEntityDetails,
    getEntityRelationships,
    validateWorkflowStructure,
    buildKnowledgeBaseWorkflow,
    getEndpointDocumentation,
  ],
});

console.log('[SDKMCPServer] Business Central MCP Server initialized (in-process, 7 tools)');
