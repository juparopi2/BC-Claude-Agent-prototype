
import * as path from 'path';
import * as fs from 'fs';
import { z } from 'zod';
import { tool } from '@langchain/core/tools';

// ============================================
// Helper Types & Validations
// ============================================

export const VALID_OPERATION_TYPES = ['list', 'get', 'create', 'update', 'delete'] as const;
export type ValidOperationType = typeof VALID_OPERATION_TYPES[number];

export interface BCEndpoint {
  id: string;
  method: string;
  path?: string;
  summary: string;
  operationType: string;
  riskLevel: string;
  requiresAuth?: boolean;
  requiresHumanApproval?: boolean;
  destructive?: boolean;
  warningMessage?: string;
  requiredFields?: string[];
  optionalFields?: string[];
  selectableFields?: string[];
  expandableRelations?: string[];
  pathParams?: string[];
  queryParams?: string[];
  headers?: string[];
  successStatus?: number;
  errorCodes?: string[];
  requestBodySchema?: unknown;
  responseSchema?: unknown;
}

export interface BCIndexEntity {
  entity: string;
  displayName: string;
  description: string;
  operations: string[];
  endpoints: BCEndpoint[];
  relationships?: BCRelationship[];
  commonWorkflows?: string[];
}

export interface BCRelationship {
  entity: string;
  type?: string;
}

export interface BCIndex {
  entities: BCIndexEntity[];
  operationIndex: Record<string, string>;
}

export interface WorkflowValidationResult {
  step_number: number;
  operation_id: string;
  entity: string;
  entity_display_name?: string;
  valid: boolean;
  risk_level: string;
  requires_approval: boolean;
  operation_type?: string;
  issues?: string[];
  dependencies?: string[];
}

// ============================================
// Helper Functions (Extracted from DirectAgentService)
// ============================================

export function isValidOperationType(operationType: unknown): operationType is ValidOperationType {
  if (typeof operationType !== 'string') return false;
  return VALID_OPERATION_TYPES.includes(operationType as ValidOperationType);
}

export function sanitizeKeyword(keyword: unknown): string {
  if (typeof keyword !== 'string') return '';
  // Remove special chars that could be unsafe for regex or path finding, keep logic simple safe
  let sanitized = keyword.trim().toLowerCase();
  sanitized = sanitized.replace(/[^a-z0-9\s-_]/g, ''); 
  return sanitized.slice(0, 100); 
}

export function sanitizeEntityName(entityName: unknown): string {
  if (typeof entityName !== 'string') {
    throw new Error('Entity name must be a string');
  }
  const sanitized = entityName.toLowerCase().replace(/[^a-z0-9_-]/g, '');

  if (sanitized.includes('..') || sanitized.includes('/') || sanitized.includes('\\')) {
    throw new Error('Invalid entity name');
  }

  if (sanitized.length > 50) {
    throw new Error('Entity name too long');
  }

  return sanitized;
}

export function sanitizeOperationId(operationId: unknown): string {
  if (typeof operationId !== 'string') {
    throw new Error('Operation ID must be a string');
  }

  const id = operationId.trim();

  if (id.length === 0) {
    throw new Error('Operation ID cannot be empty');
  }

  if (id.length > 100) {
    throw new Error('Operation ID too long (max 100 characters)');
  }

  // Operation IDs follow camelCase convention (e.g., "postCustomer", "listSalesInvoices")
  if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(id)) {
    throw new Error('Invalid operation ID format');
  }

  return id;
}

// ============================================
// Tool Implementations
// ============================================

export class BCToolService {
  private mcpDataPath: string;

  constructor() {
    // Replicate path logic from DirectAgentService
    this.mcpDataPath = path.join(process.cwd(), 'mcp-server', 'data', 'v1.0');
  }

  async listAllEntities(filterByOperations?: string[]) {
    const indexPath = path.join(this.mcpDataPath, 'bc_index.json');
    if (!fs.existsSync(indexPath)) {
      throw new Error(`Master index not found at ${indexPath}`);
    }

    const content = fs.readFileSync(indexPath, 'utf8');
    const index = JSON.parse(content);
    let entities = index.entities;

    if (filterByOperations && Array.isArray(filterByOperations)) {
      const validOps = filterByOperations.filter(isValidOperationType);
      if (validOps.length > 0) {
        entities = entities.filter((entity: BCIndexEntity) => {
          return validOps.every(op => entity.operations.includes(op));
        });
      }
    }

    const allOperationTypes = new Set<string>();
    index.entities.forEach((entity: BCIndexEntity) => {
      entity.operations.forEach((op: string) => allOperationTypes.add(op));
    });

    return JSON.stringify({
      total_entities: entities.length,
      entities: entities,
      available_operation_types: Array.from(allOperationTypes).sort(),
    }, null, 2);
  }

  async searchEntityOperations(keyword: string, filterByRisk?: string, filterByOperationType?: string) {
    const indexPath = path.join(this.mcpDataPath, 'bc_index.json');
    if (!fs.existsSync(indexPath)) {
      throw new Error(`Master index not found at ${indexPath}`);
    }

    const content = fs.readFileSync(indexPath, 'utf8');
    const index = JSON.parse(content) as BCIndex;

    const safeKeyword = sanitizeKeyword(keyword);

    // Search entities matching keyword (with null safety for entity fields)
    const results = index.entities.filter((e: BCIndexEntity) =>
      (e.entity?.toLowerCase() ?? '').includes(safeKeyword) ||
      (e.displayName?.toLowerCase() ?? '').includes(safeKeyword) ||
      (e.description?.toLowerCase() ?? '').includes(safeKeyword)
    );

    // Apply filters if provided
    let filteredResults = results;
    if (filterByRisk) {
      filteredResults = filteredResults.filter((e: BCIndexEntity) =>
        e.endpoints.some((ep: BCEndpoint) => ep.riskLevel === filterByRisk)
      );
    }
    if (filterByOperationType && isValidOperationType(filterByOperationType)) {
      filteredResults = filteredResults.filter((e: BCIndexEntity) =>
        e.operations.includes(filterByOperationType)
      );
    }

    return JSON.stringify({
      total_matches: filteredResults.length,
      keyword: safeKeyword,
      filters: { risk: filterByRisk, operationType: filterByOperationType },
      results: filteredResults,
    }, null, 2);
  }

  /**
   * Get complete details for a specific entity
   */
  async getEntityDetails(entityName: string): Promise<string> {
    const sanitized = sanitizeEntityName(entityName);
    const entityPath = path.join(this.mcpDataPath, 'entities', `${sanitized}.json`);

    if (!fs.existsSync(entityPath)) {
      throw new Error(`Entity '${sanitized}' not found`);
    }

    const content = fs.readFileSync(entityPath, 'utf8');
    return content;
  }

  /**
   * Get relationships for a specific entity
   */
  async getEntityRelationships(entityName: string): Promise<string> {
    const sanitized = sanitizeEntityName(entityName);
    const entityPath = path.join(this.mcpDataPath, 'entities', `${sanitized}.json`);

    if (!fs.existsSync(entityPath)) {
      throw new Error(`Entity '${sanitized}' not found`);
    }

    const content = fs.readFileSync(entityPath, 'utf8');
    const entity = JSON.parse(content) as BCIndexEntity;

    const result = {
      entity: entity.entity,
      displayName: entity.displayName,
      description: entity.description,
      relationships: entity.relationships || [],
      common_workflows: entity.commonWorkflows || [],
      relationship_summary: {
        total_relationships: (entity.relationships || []).length,
        total_workflows: (entity.commonWorkflows || []).length,
        related_entities: (entity.relationships || []).map((r: BCRelationship) => r.entity),
      },
    };

    return JSON.stringify(result, null, 2);
  }

  /**
   * Validate a workflow structure
   */
  async validateWorkflowStructure(
    workflow: Array<{ operation_id: string; label?: string }>
  ): Promise<string> {
    if (!workflow || !Array.isArray(workflow)) {
      throw new Error('workflow parameter must be an array of steps');
    }

    const indexPath = path.join(this.mcpDataPath, 'bc_index.json');
    if (!fs.existsSync(indexPath)) {
      throw new Error(`Master index not found at ${indexPath}`);
    }

    const indexContent = fs.readFileSync(indexPath, 'utf8');
    const index = JSON.parse(indexContent) as BCIndex;

    const validationResults: WorkflowValidationResult[] = [];
    let hasErrors = false;
    let stepNumber = 0;

    for (const step of workflow) {
      stepNumber++;
      const issues: string[] = [];
      const dependencies: string[] = [];

      let sanitizedOperationId: string;
      try {
        sanitizedOperationId = sanitizeOperationId(step.operation_id);
      } catch {
        hasErrors = true;
        validationResults.push({
          step_number: stepNumber,
          operation_id: String(step.operation_id || 'invalid'),
          entity: 'unknown',
          valid: false,
          risk_level: 'HIGH',
          requires_approval: true,
          issues: ['Invalid operation ID format'],
        });
        continue;
      }

      const entityName = index.operationIndex[sanitizedOperationId];

      if (!entityName) {
        hasErrors = true;
        validationResults.push({
          step_number: stepNumber,
          operation_id: sanitizedOperationId,
          entity: 'unknown',
          valid: false,
          risk_level: 'HIGH',
          requires_approval: true,
          issues: [`Operation ID "${sanitizedOperationId}" not found in index`],
        });
        continue;
      }

      const entityPath = path.join(this.mcpDataPath, 'entities', `${entityName}.json`);
      if (!fs.existsSync(entityPath)) {
        hasErrors = true;
        validationResults.push({
          step_number: stepNumber,
          operation_id: sanitizedOperationId,
          entity: entityName,
          valid: false,
          risk_level: 'HIGH',
          requires_approval: true,
          issues: [`Entity file not found for "${entityName}"`],
        });
        continue;
      }

      const entityContent = fs.readFileSync(entityPath, 'utf8');
      const entity = JSON.parse(entityContent) as BCIndexEntity;

      const endpoint = entity.endpoints.find((ep: BCEndpoint) => ep.id === sanitizedOperationId);

      if (!endpoint) {
        hasErrors = true;
        validationResults.push({
          step_number: stepNumber,
          operation_id: sanitizedOperationId,
          entity: entityName,
          valid: false,
          risk_level: 'HIGH',
          requires_approval: true,
          issues: [`Operation "${sanitizedOperationId}" not found in entity "${entityName}"`],
        });
        continue;
      }

      // Check for dependencies (fields ending in Id)
      if (endpoint.requiredFields) {
        const foreignKeys = endpoint.requiredFields.filter(
          (field: string) => field.endsWith('Id') && field !== 'id'
        );
        if (foreignKeys.length > 0) {
          dependencies.push(...foreignKeys.map((fk: string) => `Required field: ${fk}`));
        }
      }

      const valid = issues.length === 0;
      if (!valid) hasErrors = true;

      validationResults.push({
        step_number: stepNumber,
        operation_id: sanitizedOperationId,
        entity: entityName,
        entity_display_name: entity.displayName,
        valid,
        risk_level: endpoint.riskLevel,
        requires_approval: endpoint.requiresHumanApproval ?? false,
        operation_type: endpoint.operationType,
        issues: issues.length > 0 ? issues : undefined,
        dependencies: dependencies.length > 0 ? dependencies : undefined,
      });
    }

    const result = {
      workflow_valid: !hasErrors,
      total_steps: workflow.length,
      validation_results: validationResults,
      summary: {
        total_valid: validationResults.filter(r => r.valid).length,
        total_invalid: validationResults.filter(r => !r.valid).length,
        total_high_risk: validationResults.filter(r => r.risk_level === 'HIGH').length,
        total_requiring_approval: validationResults.filter(r => r.requires_approval).length,
      },
    };

    return JSON.stringify(result, null, 2);
  }

  /**
   * Build a comprehensive knowledge base workflow
   */
  async buildKnowledgeBaseWorkflow(
    workflowName: string,
    steps: Array<{ operation_id: string; label?: string }>,
    workflowDescription?: string
  ): Promise<string> {
    if (!workflowName || !steps || !Array.isArray(steps)) {
      throw new Error('workflow_name and steps are required');
    }

    const indexPath = path.join(this.mcpDataPath, 'bc_index.json');
    if (!fs.existsSync(indexPath)) {
      throw new Error(`Master index not found at ${indexPath}`);
    }

    const indexContent = fs.readFileSync(indexPath, 'utf8');
    const index = JSON.parse(indexContent) as BCIndex;

    const enrichedSteps: Record<string, unknown>[] = [];
    let stepNumber = 0;

    for (const step of steps) {
      stepNumber++;

      const sanitizedOperationId = sanitizeOperationId(step.operation_id);
      const entityName = index.operationIndex[sanitizedOperationId];

      if (!entityName) {
        throw new Error(`Operation ID "${sanitizedOperationId}" not found`);
      }

      const entityPath = path.join(this.mcpDataPath, 'entities', `${entityName}.json`);
      const entityContent = fs.readFileSync(entityPath, 'utf8');
      const entity = JSON.parse(entityContent) as BCIndexEntity;

      const endpoint = entity.endpoints.find((ep: BCEndpoint) => ep.id === sanitizedOperationId);

      if (!endpoint) {
        throw new Error(`Operation "${sanitizedOperationId}" not found in entity "${entityName}"`);
      }

      // Find alternatives (same operation type, different endpoint)
      const alternatives = entity.endpoints
        .filter((ep: BCEndpoint) => ep.operationType === endpoint.operationType && ep.id !== endpoint.id)
        .map((ep: BCEndpoint) => ({
          operation_id: ep.id,
          summary: ep.summary,
          risk_level: ep.riskLevel,
        }));

      // Define expected outcomes
      const outcomes = [
        {
          type: 'success',
          status: endpoint.successStatus,
          description: `${endpoint.operationType} operation completed successfully`,
        },
        { type: 'error', status: 400, description: 'Bad request - invalid input data' },
        { type: 'error', status: 401, description: 'Unauthorized - authentication required' },
        { type: 'error', status: 404, description: 'Not found - resource does not exist' },
      ];

      if (endpoint.operationType === 'create') {
        outcomes.push({ type: 'error', status: 409, description: 'Conflict - resource already exists' });
      }

      enrichedSteps.push({
        step_number: stepNumber,
        operation_id: sanitizedOperationId,
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
      });
    }

    const result = {
      workflow_name: workflowName,
      workflow_description: workflowDescription,
      total_steps: steps.length,
      created_at: new Date().toISOString(),
      enriched_steps: enrichedSteps,
      risk_summary: {
        high_risk_steps: enrichedSteps.filter((s) => s.risk_level === 'HIGH').length,
        requires_approval_count: enrichedSteps.filter((s) => s.requires_approval).length,
      },
    };

    return JSON.stringify(result, null, 2);
  }

  /**
   * Get detailed endpoint documentation
   */
  async getEndpointDocumentation(operationId: string): Promise<string> {
    const sanitizedOperationId = sanitizeOperationId(operationId);

    const indexPath = path.join(this.mcpDataPath, 'bc_index.json');
    if (!fs.existsSync(indexPath)) {
      throw new Error(`Master index not found at ${indexPath}`);
    }

    const indexContent = fs.readFileSync(indexPath, 'utf8');
    const index = JSON.parse(indexContent) as BCIndex;

    const entityName = index.operationIndex[sanitizedOperationId];

    if (!entityName) {
      throw new Error(`Operation ID "${sanitizedOperationId}" not found`);
    }

    const entityPath = path.join(this.mcpDataPath, 'entities', `${entityName}.json`);
    const entityContent = fs.readFileSync(entityPath, 'utf8');
    const entity = JSON.parse(entityContent) as BCIndexEntity;

    const endpoint = entity.endpoints.find((ep: BCEndpoint) => ep.id === sanitizedOperationId);

    if (!endpoint) {
      throw new Error(`Operation "${sanitizedOperationId}" not found in entity "${entityName}"`);
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
      request_body_schema: endpoint.requestBodySchema,
      response_schema: endpoint.responseSchema,
    };

    return JSON.stringify(result, null, 2);
  }
}

// ============================================
// LangChain Tool Definitions
// Note: @ts-expect-error comments suppress "Type instantiation is excessively deep"
// This is a known TypeScript limitation with LangChain's tool() generic inference
// and complex Zod schemas. The tools work correctly at runtime.
// ============================================

const toolService = new BCToolService();

export const listAllEntitiesTool = tool(
  async (input) => {
    const { filter_by_operations } = input;
    return toolService.listAllEntities(filter_by_operations);
  },
  {
    name: 'list_all_entities',
    description: 'Returns a complete list of all Business Central entities.',
    schema: z.object({
      filter_by_operations: z.array(z.string()).optional()
    })
  }
);

export const searchEntityOperationsTool = tool(
  async (input) => {
    const { keyword, filter_by_risk, filter_by_operation_type } = input;
    return toolService.searchEntityOperations(keyword, filter_by_risk, filter_by_operation_type);
  },
  {
    name: 'search_entity_operations',
    description: 'Search for entities and operations by keyword.',
    schema: z.object({
      keyword: z.string(),
      filter_by_risk: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
      filter_by_operation_type: z.enum(['list', 'get', 'create', 'update', 'delete']).optional(),
    }),
  }
);

export const getEntityDetailsTool = tool(
  async (input) => {
    const { entity_name } = input;
    return toolService.getEntityDetails(entity_name);
  },
  {
    name: 'get_entity_details',
    description:
      'Get complete details for a specific entity including all endpoints, parameters, and schemas.',
    schema: z.object({
      entity_name: z.string().describe('Name of the entity (exact match)'),
    }),
  }
);

export const getEntityRelationshipsTool = tool(
  async (input) => {
    const { entity_name } = input;
    return toolService.getEntityRelationships(entity_name);
  },
  {
    name: 'get_entity_relationships',
    description: 'Discover relationships between entities and common multi-entity workflows.',
    schema: z.object({
      entity_name: z.string().describe('Name of the entity'),
    }),
  }
);

export const validateWorkflowStructureTool = tool(
  async (input) => {
    const { workflow } = input;
    return toolService.validateWorkflowStructure(workflow);
  },
  {
    name: 'validate_workflow_structure',
    description:
      'Validates a workflow structure using operation_ids. Checks for dependencies, risk levels, and sequencing.',
    schema: z.object({
      workflow: z
        .array(
          z.object({
            operation_id: z.string().describe('Unique operation ID (e.g., "postCustomer")'),
            label: z.string().optional().describe('Optional human-readable label'),
          })
        )
        .describe('Array of workflow steps with operation_ids'),
    }),
  }
);

export const buildKnowledgeBaseWorkflowTool = tool(
  async (input) => {
    const { workflow_name, steps, workflow_description } = input;
    return toolService.buildKnowledgeBaseWorkflow(workflow_name, steps, workflow_description);
  },
  {
    name: 'build_knowledge_base_workflow',
    description:
      'Builds a comprehensive knowledge base workflow with full metadata, alternatives, outcomes, and business scenarios.',
    schema: z.object({
      workflow_name: z.string().describe('Name of the workflow'),
      workflow_description: z.string().optional().describe('Description of what the workflow does'),
      steps: z
        .array(
          z.object({
            operation_id: z.string().describe('Unique operation ID'),
            label: z.string().optional().describe('Optional human-readable label'),
          })
        )
        .describe('Array of workflow steps'),
    }),
  }
);

export const getEndpointDocumentationTool = tool(
  async (input) => {
    const { operation_id } = input;
    return toolService.getEndpointDocumentation(operation_id);
  },
  {
    name: 'get_endpoint_documentation',
    description:
      'Get detailed documentation for a specific operation_id including all parameters, schemas, and examples.',
    schema: z.object({
      operation_id: z.string().describe('The operation ID to get documentation for'),
    }),
  }
);
