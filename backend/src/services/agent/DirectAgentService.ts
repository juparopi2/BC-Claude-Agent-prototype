/**
 * Direct Agent Service - Workaround for Agent SDK ProcessTransport Bug
 *
 * This service uses @anthropic-ai/sdk directly instead of the buggy Agent SDK query().
 * It implements manual tool calling loop (agentic loop) to avoid ProcessTransport errors.
 *
 * Why this approach:
 * - Agent SDK v0.1.29 and v0.1.30 have a critical ProcessTransport bug
 * - Even in-process MCP servers trigger the bug
 * - Direct API calling gives us full control and reliability
 *
 * Architecture:
 * 1. Convert MCP tools to Anthropic tool definitions
 * 2. Call Claude API with tools parameter
 * 3. Manually execute tool calls when Claude requests them
 * 4. Send results back to Claude
 * 5. Repeat until Claude is done (agentic loop)
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  MessageParam,
  TextBlock,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/messages';
import { env } from '@/config';
import type { AgentEvent, AgentExecutionResult } from '@/types';
import type { ApprovalManager } from '../approval/ApprovalManager';
import type { TodoManager } from '../todo/TodoManager';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Type Definitions for BC Index and MCP Tools
 */

interface BCEndpoint {
  id: string;
  method: string;
  path?: string;
  summary: string;
  operationType: string;
  riskLevel: string;
  requiresHumanApproval?: boolean;
  requiredFields?: string[];
  optionalFields?: string[];
}

interface BCRelationship {
  entity: string;
  type?: string;
}

interface BCIndexEntity {
  entity: string;
  displayName: string;
  description: string;
  operations: string[];
  endpoints: BCEndpoint[];
  relationships?: BCRelationship[];
  commonWorkflows?: unknown[];
}

interface BCIndex {
  entities: BCIndexEntity[];
  operationIndex: Record<string, string>;
}

interface ToolResult {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

interface WorkflowValidationResult {
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

/**
 * Direct Agent Service
 *
 * Bypasses the buggy Agent SDK by using Anthropic API directly.
 */
export class DirectAgentService {
  private anthropic: Anthropic;
  private approvalManager?: ApprovalManager;
  private mcpDataPath: string;

  constructor(approvalManager?: ApprovalManager, _todoManager?: TodoManager) {
    this.anthropic = new Anthropic({
      apiKey: env.ANTHROPIC_API_KEY,
    });
    this.approvalManager = approvalManager;

    // Setup MCP data path
    const mcpServerDir = path.join(process.cwd(), 'mcp-server');
    this.mcpDataPath = path.join(mcpServerDir, 'data', 'v1.0');

    console.log('[DirectAgentService] Initialized with direct API calling (bypassing Agent SDK)');
  }

  /**
   * Execute Query with Direct API Calling
   *
   * Implements manual agentic loop:
   * 1. Send user prompt to Claude with available tools
   * 2. If Claude wants to use a tool, execute it
   * 3. Send tool result back to Claude
   * 4. Repeat until Claude provides final answer
   */
  async executeQuery(
    prompt: string,
    sessionId?: string,
    onEvent?: (event: AgentEvent) => void
  ): Promise<AgentExecutionResult> {
    const startTime = Date.now();
    const conversationHistory: MessageParam[] = [];
    const toolsUsed: string[] = [];
    let finalResponse = '';
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      console.log(`[DirectAgentService] Starting query with direct API`);
      console.log(`[DirectAgentService] Prompt: "${prompt.substring(0, 80)}..."`);
      console.log(`[DirectAgentService] Session ID: ${sessionId}`);

      // Step 1: Get MCP tools and convert to Anthropic format
      const tools = await this.getMCPToolDefinitions();
      console.log(`[DirectAgentService] Loaded ${tools.length} MCP tools`);

      // Step 2: Add user message to history
      conversationHistory.push({
        role: 'user',
        content: prompt,
      });

      // Send thinking event
      if (onEvent) {
        onEvent({
          type: 'thinking',
          timestamp: new Date(),
        });
      }

      // Step 3: Agentic Loop - keep calling Claude until done
      let continueLoop = true;
      let turnCount = 0;
      const maxTurns = 20; // Safety limit

      while (continueLoop && turnCount < maxTurns) {
        turnCount++;
        console.log(`[DirectAgentService] Turn ${turnCount}/${maxTurns}`);

        // Call Claude API
        const response = await this.anthropic.messages.create({
          model: env.ANTHROPIC_MODEL,
          max_tokens: 4096,
          messages: conversationHistory,
          tools: tools,
          system: this.getSystemPrompt(),
        });

        // Track token usage
        inputTokens += response.usage.input_tokens;
        outputTokens += response.usage.output_tokens;

        console.log(`[DirectAgentService] Response stop_reason: ${response.stop_reason}`);
        console.log(`[DirectAgentService] Content blocks: ${response.content.length}`);

        // Process response content
        const toolUses: ToolUseBlock[] = [];
        const textBlocks: TextBlock[] = [];

        for (const block of response.content) {
          if (block.type === 'text') {
            textBlocks.push(block);
            console.log(`[DirectAgentService] Text: ${block.text.substring(0, 100)}...`);
          } else if (block.type === 'tool_use') {
            toolUses.push(block);
            console.log(`[DirectAgentService] Tool use: ${block.name}`);
          }
        }

        // Send text content to user if any
        for (const textBlock of textBlocks) {
          if (onEvent) {
            onEvent({
              type: 'message_chunk',
              content: textBlock.text,
              timestamp: new Date(),
            });
          }
        }

        // Add assistant response to history
        conversationHistory.push({
          role: 'assistant',
          content: response.content,
        });

        // Check stop reason
        if (response.stop_reason === 'end_turn') {
          // Claude is done, no more tools needed
          finalResponse = textBlocks.map(b => b.text).join('\n');
          continueLoop = false;
          console.log(`[DirectAgentService] Completed with end_turn`);
        } else if (response.stop_reason === 'tool_use' && toolUses.length > 0) {
          // Claude wants to use tools
          console.log(`[DirectAgentService] Executing ${toolUses.length} tool(s)`);

          // Execute all tool calls
          const toolResults: ToolResult[] = [];

          for (const toolUse of toolUses) {
            if (onEvent) {
              onEvent({
                type: 'tool_use',
                toolName: toolUse.name,
                args: toolUse.input as Record<string, unknown>,
                timestamp: new Date(),
              });
            }

            toolsUsed.push(toolUse.name);

            // Check if tool needs approval (write operations)
            const needsApproval = this.isWriteOperation(toolUse.name);

            if (needsApproval && this.approvalManager) {
              console.log(`[DirectAgentService] Tool ${toolUse.name} requires approval`);

              // Request approval
              const approved = await this.approvalManager.request({
                sessionId: sessionId || 'unknown',
                toolName: toolUse.name,
                toolArgs: toolUse.input as Record<string, unknown>,
              });

              if (!approved) {
                // Approval denied
                console.log(`[DirectAgentService] Approval denied for ${toolUse.name}`);

                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: toolUse.id,
                  content: 'Operation cancelled by user - approval denied',
                  is_error: true,
                });

                continue;
              }

              console.log(`[DirectAgentService] Approval granted for ${toolUse.name}`);
            }

            // Execute the tool
            try {
              const result = await this.executeMCPTool(toolUse.name, toolUse.input);

              if (onEvent) {
                onEvent({
                  type: 'tool_result',
                  toolName: toolUse.name,
                  result: result,
                  success: true,
                  timestamp: new Date(),
                });
              }

              toolResults.push({
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: typeof result === 'string' ? result : JSON.stringify(result),
              });
            } catch (error) {
              console.error(`[DirectAgentService] Tool execution failed:`, error);

              if (onEvent) {
                onEvent({
                  type: 'tool_result',
                  toolName: toolUse.name,
                  result: null,
                  success: false,
                  error: error instanceof Error ? error.message : String(error),
                  timestamp: new Date(),
                });
              }

              toolResults.push({
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: `Error: ${error instanceof Error ? error.message : String(error)}`,
                is_error: true,
              });
            }
          }

          // Add tool results to conversation
          conversationHistory.push({
            role: 'user',
            content: toolResults,
          });

          // Continue loop to let Claude process tool results
        } else if (response.stop_reason === 'max_tokens') {
          console.log(`[DirectAgentService] Reached max tokens`);
          finalResponse = textBlocks.map(b => b.text).join('\n') + '\n\n[Response truncated - reached max tokens]';
          continueLoop = false;
        } else {
          // Unknown stop reason
          console.log(`[DirectAgentService] Unknown stop_reason: ${response.stop_reason}`);
          finalResponse = textBlocks.map(b => b.text).join('\n');
          continueLoop = false;
        }
      }

      if (turnCount >= maxTurns) {
        console.log(`[DirectAgentService] Reached max turns limit`);
        finalResponse += '\n\n[Execution stopped - reached maximum turns]';
      }

      const duration = Date.now() - startTime;

      // Send completion event
      if (onEvent) {
        onEvent({
          type: 'complete',
          reason: 'success',
          timestamp: new Date(),
        });
      }

      console.log(`[DirectAgentService] Query completed in ${duration}ms`);
      console.log(`[DirectAgentService] Turns: ${turnCount}, Tools used: ${toolsUsed.length}`);

      return {
        success: true,
        response: finalResponse,
        toolsUsed,
        duration,
        inputTokens,
        outputTokens,
      };

    } catch (error) {
      const duration = Date.now() - startTime;

      console.error(`[DirectAgentService] Query execution failed:`, error);

      if (onEvent) {
        onEvent({
          type: 'error',
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date(),
        });
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        response: '',
        toolsUsed,
        duration,
        inputTokens,
        outputTokens,
      };
    }
  }

  /**
   * Get MCP Tool Definitions
   *
   * Converts SDK MCP server tools to Anthropic tool format
   */
  private async getMCPToolDefinitions(): Promise<Anthropic.Messages.Tool[]> {
    // Import tools from our SDK MCP server
    const tools: Anthropic.Messages.Tool[] = [
      {
        name: 'list_all_entities',
        description: 'Returns a complete list of all Business Central entities. Use this first to discover available entities.',
        input_schema: {
          type: 'object',
          properties: {
            filter_by_operations: {
              type: 'array',
              items: {
                type: 'string',
                enum: ['list', 'get', 'create', 'update', 'delete', 'action']
              },
              description: 'Optional: Filter entities that support specific operations'
            }
          },
          required: []
        }
      },
      {
        name: 'search_entity_operations',
        description: 'Search for entities and operations by keyword. Returns matching entities with their operation_ids.',
        input_schema: {
          type: 'object',
          properties: {
            keyword: {
              type: 'string',
              description: 'Search keyword (searches entity names, descriptions, and operation summaries)'
            },
            filter_by_risk: {
              type: 'string',
              enum: ['LOW', 'MEDIUM', 'HIGH'],
              description: 'Optional: Filter by risk level'
            },
            filter_by_operation_type: {
              type: 'string',
              enum: ['list', 'get', 'create', 'update', 'delete', 'action'],
              description: 'Optional: Filter by operation type'
            }
          },
          required: ['keyword']
        }
      },
      {
        name: 'get_entity_details',
        description: 'Get complete details for a specific entity including all endpoints, parameters, and schemas.',
        input_schema: {
          type: 'object',
          properties: {
            entity_name: {
              type: 'string',
              description: 'Name of the entity (exact match)'
            }
          },
          required: ['entity_name']
        }
      },
      {
        name: 'get_entity_relationships',
        description: 'Discover relationships between entities and common multi-entity workflows.',
        input_schema: {
          type: 'object',
          properties: {
            entity_name: {
              type: 'string',
              description: 'Name of the entity'
            }
          },
          required: ['entity_name']
        }
      },
      {
        name: 'validate_workflow_structure',
        description: 'Validates a workflow structure using operation_ids. Checks for dependencies, risk levels, and sequencing.',
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
                    description: 'Unique operation ID (e.g., "postCustomer", "listSalesInvoices")'
                  },
                  label: {
                    type: 'string',
                    description: 'Optional human-readable label for the step'
                  }
                },
                required: ['operation_id']
              },
              description: 'Array of workflow steps with operation_ids'
            }
          },
          required: ['workflow']
        }
      },
      {
        name: 'build_knowledge_base_workflow',
        description: 'Builds a comprehensive knowledge base workflow with full metadata, alternatives, outcomes, and business scenarios.',
        input_schema: {
          type: 'object',
          properties: {
            workflow_name: {
              type: 'string',
              description: 'Name of the workflow'
            },
            workflow_description: {
              type: 'string',
              description: 'Description of what the workflow does'
            },
            steps: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  operation_id: {
                    type: 'string',
                    description: 'Unique operation ID'
                  },
                  label: {
                    type: 'string',
                    description: 'Optional human-readable label'
                  }
                },
                required: ['operation_id']
              },
              description: 'Array of workflow steps'
            }
          },
          required: ['workflow_name', 'steps']
        }
      },
      {
        name: 'get_endpoint_documentation',
        description: 'Get detailed documentation for a specific operation_id including all parameters, schemas, and examples.',
        input_schema: {
          type: 'object',
          properties: {
            operation_id: {
              type: 'string',
              description: 'The operation ID to get documentation for'
            }
          },
          required: ['operation_id']
        }
      }
    ];

    return tools;
  }

  /**
   * Execute MCP Tool
   *
   * Implements MCP tool logic directly (bypassing SDK MCP server)
   */
  private async executeMCPTool(toolName: string, input: unknown): Promise<unknown> {
    console.log(`[DirectAgentService] Executing MCP tool: ${toolName}`);

    const args = input as Record<string, unknown>;

    switch (toolName) {
      case 'list_all_entities': {
        return this.toolListAllEntities(args);
      }

      case 'search_entity_operations': {
        return this.toolSearchEntityOperations(args);
      }

      case 'get_entity_details': {
        return this.toolGetEntityDetails(args);
      }

      case 'get_entity_relationships': {
        return this.toolGetEntityRelationships(args);
      }

      case 'validate_workflow_structure': {
        return this.toolValidateWorkflowStructure(args);
      }

      case 'build_knowledge_base_workflow': {
        return this.toolBuildKnowledgeBaseWorkflow(args);
      }

      case 'get_endpoint_documentation': {
        return this.toolGetEndpointDocumentation(args);
      }

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  /**
   * Tool Implementation: list_all_entities
   */
  private async toolListAllEntities(args: Record<string, unknown>): Promise<string> {
    const indexPath = path.join(this.mcpDataPath, 'bc_index.json');
    if (!fs.existsSync(indexPath)) {
      throw new Error(`Master index not found at ${indexPath}`);
    }

    const content = fs.readFileSync(indexPath, 'utf8');
    const index = JSON.parse(content);

    let entities = index.entities;

    if (args.filter_by_operations && Array.isArray(args.filter_by_operations)) {
      entities = entities.filter((entity: BCIndexEntity) => {
        return (args.filter_by_operations as string[]).every(op => entity.operations.includes(op));
      });
    }

    const allOperationTypes = new Set<string>();
    index.entities.forEach((entity: BCIndexEntity) => {
      entity.operations.forEach((op: string) => allOperationTypes.add(op));
    });

    const result = {
      total_entities: entities.length,
      entities: entities,
      available_operation_types: Array.from(allOperationTypes).sort(),
    };

    return JSON.stringify(result, null, 2);
  }

  /**
   * Tool Implementation: search_entity_operations
   */
  private async toolSearchEntityOperations(args: Record<string, unknown>): Promise<string> {
    const indexPath = path.join(this.mcpDataPath, 'bc_index.json');
    if (!fs.existsSync(indexPath)) {
      throw new Error(`Master index not found at ${indexPath}`);
    }

    const content = fs.readFileSync(indexPath, 'utf8');
    const index = JSON.parse(content);

    const keyword = (args.keyword as string || '').toLowerCase();
    const filterByRisk = args.filter_by_risk as string | undefined;
    const filterByOperationType = args.filter_by_operation_type as string | undefined;

    const results: Array<{
      entity: string;
      displayName: string;
      description: string;
      matching_operations: Array<{
        operation_id: string;
        method: string;
        summary: string;
        operation_type: string;
        risk_level: string;
      }>;
    }> = [];

    // Search through entities
    for (const entitySummary of index.entities) {
      const matches =
        entitySummary.name.toLowerCase().includes(keyword) ||
        entitySummary.displayName.toLowerCase().includes(keyword) ||
        (entitySummary.description && entitySummary.description.toLowerCase().includes(keyword));

      if (!matches) continue;

      // Load entity details
      const entityPath = path.join(this.mcpDataPath, 'entities', `${entitySummary.name}.json`);
      if (!fs.existsSync(entityPath)) continue;

      const entityContent = fs.readFileSync(entityPath, 'utf8');
      const entity = JSON.parse(entityContent);

      let matchingOps = entity.endpoints || [];

      // Apply filters
      if (filterByRisk) {
        matchingOps = matchingOps.filter((ep: BCEndpoint) => ep.riskLevel === filterByRisk);
      }
      if (filterByOperationType) {
        matchingOps = matchingOps.filter((ep: BCEndpoint) => ep.operationType === filterByOperationType);
      }

      if (matchingOps.length > 0) {
        results.push({
          entity: entity.entity,
          displayName: entity.displayName,
          description: entity.description,
          matching_operations: matchingOps.map((ep: BCEndpoint) => ({
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
      keyword: keyword,
      filters: {
        risk_level: filterByRisk || 'none',
        operation_type: filterByOperationType || 'none',
      },
      results: results,
    };

    return JSON.stringify(result, null, 2);
  }

  /**
   * Tool Implementation: get_entity_details
   */
  private async toolGetEntityDetails(args: Record<string, unknown>): Promise<string> {
    const entityPath = path.join(this.mcpDataPath, 'entities', `${args.entity_name}.json`);
    if (!fs.existsSync(entityPath)) {
      throw new Error(`Entity ${args.entity_name} not found`);
    }

    const content = fs.readFileSync(entityPath, 'utf8');
    return content;
  }

  /**
   * Tool Implementation: get_entity_relationships
   */
  private async toolGetEntityRelationships(args: Record<string, unknown>): Promise<string> {
    const entityName = args.entity_name as string;
    const entityPath = path.join(this.mcpDataPath, 'entities', `${entityName}.json`);

    if (!fs.existsSync(entityPath)) {
      throw new Error(`Entity ${entityName} not found`);
    }

    const content = fs.readFileSync(entityPath, 'utf8');
    const entity = JSON.parse(content);

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
   * Tool Implementation: validate_workflow_structure
   */
  private async toolValidateWorkflowStructure(args: Record<string, unknown>): Promise<string> {
    const workflow = args.workflow as Array<{ operation_id: string; label?: string }>;

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

      // Find entity for this operation_id
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

      // Load entity details
      const entityPath = path.join(this.mcpDataPath, 'entities', `${entityName}.json`);
      if (!fs.existsSync(entityPath)) {
        hasErrors = true;
        validationResults.push({
          step_number: stepNumber,
          operation_id: step.operation_id,
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

      // Find endpoint
      const endpoint = entity.endpoints.find((ep: BCEndpoint) => ep.id === step.operation_id);

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

      // Check for dependencies (fields ending in Id)
      if (endpoint.requiredFields) {
        const foreignKeys = endpoint.requiredFields.filter((field: string) =>
          field.endsWith('Id') && field !== 'id'
        );
        if (foreignKeys.length > 0) {
          dependencies.push(...foreignKeys.map((fk: string) => `Required field: ${fk}`));
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
   * Tool Implementation: build_knowledge_base_workflow
   */
  private async toolBuildKnowledgeBaseWorkflow(args: Record<string, unknown>): Promise<string> {
    const workflowName = args.workflow_name as string;
    const workflowDescription = args.workflow_description as string | undefined;
    const steps = args.steps as Array<{ operation_id: string; label?: string }>;

    if (!workflowName || !steps || !Array.isArray(steps)) {
      throw new Error('workflow_name and steps are required');
    }

    const indexPath = path.join(this.mcpDataPath, 'bc_index.json');
    if (!fs.existsSync(indexPath)) {
      throw new Error(`Master index not found at ${indexPath}`);
    }

    const indexContent = fs.readFileSync(indexPath, 'utf8');
    const index = JSON.parse(indexContent);

    const enrichedSteps: Record<string, unknown>[] = [];
    let stepNumber = 0;

    for (const step of steps) {
      stepNumber++;
      const entityName = index.operationIndex[step.operation_id];

      if (!entityName) {
        throw new Error(`Operation ID "${step.operation_id}" not found`);
      }

      const entityPath = path.join(this.mcpDataPath, 'entities', `${entityName}.json`);
      const entityContent = fs.readFileSync(entityPath, 'utf8');
      const entity = JSON.parse(entityContent);

      const endpoint = entity.endpoints.find((ep: Record<string, unknown>) => ep.id === step.operation_id);

      if (!endpoint) {
        throw new Error(`Operation "${step.operation_id}" not found in entity "${entityName}"`);
      }

      // Find alternatives (same operation type, different endpoint)
      const alternatives = entity.endpoints
        .filter((ep: Record<string, unknown>) =>
          ep.operationType === endpoint.operationType && ep.id !== endpoint.id
        )
        .map((ep: Record<string, unknown>) => ({
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
        outcomes.push({
          type: 'error',
          status: 409,
          description: 'Conflict - resource already exists',
        });
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
      });
    }

    const result = {
      workflow_name: workflowName,
      workflow_description: workflowDescription,
      total_steps: steps.length,
      created_at: new Date().toISOString(),
      enriched_steps: enrichedSteps,
      risk_summary: {
        high_risk_steps: enrichedSteps.filter((s: Record<string, unknown>) => s.risk_level === 'HIGH').length,
        requires_approval_count: enrichedSteps.filter((s: Record<string, unknown>) => s.requires_approval).length,
      },
    };

    return JSON.stringify(result, null, 2);
  }

  /**
   * Tool Implementation: get_endpoint_documentation
   */
  private async toolGetEndpointDocumentation(args: Record<string, unknown>): Promise<string> {
    const operationId = args.operation_id as string;

    if (!operationId) {
      throw new Error('operation_id is required');
    }

    const indexPath = path.join(this.mcpDataPath, 'bc_index.json');
    if (!fs.existsSync(indexPath)) {
      throw new Error(`Master index not found at ${indexPath}`);
    }

    const indexContent = fs.readFileSync(indexPath, 'utf8');
    const index = JSON.parse(indexContent);

    const entityName = index.operationIndex[operationId];

    if (!entityName) {
      throw new Error(`Operation ID "${operationId}" not found`);
    }

    const entityPath = path.join(this.mcpDataPath, 'entities', `${entityName}.json`);
    const entityContent = fs.readFileSync(entityPath, 'utf8');
    const entity = JSON.parse(entityContent);

    const endpoint = entity.endpoints.find((ep: Record<string, unknown>) => ep.id === operationId);

    if (!endpoint) {
      throw new Error(`Operation "${operationId}" not found in entity "${entityName}"`);
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

  /**
   * Check if operation is a write operation (needs approval)
   */
  private isWriteOperation(toolName: string): boolean {
    // In our MCP server, all tools are read-only for now
    // But we can add logic here for future write operations
    const writePatterns = ['create', 'update', 'delete', 'post', 'patch', 'put'];
    const lowerToolName = toolName.toLowerCase();

    return writePatterns.some(pattern => lowerToolName.includes(pattern));
  }

  /**
   * Get System Prompt
   */
  private getSystemPrompt(): string {
    return `You are a specialized Business Central assistant with access to tools for querying BC entities and operations.

Your responsibilities:
- Help users understand and query Business Central data
- Use the available tools to discover entities, search operations, and get detailed information
- Provide clear, helpful explanations of BC concepts and data
- Format results in a user-friendly way

Available tools:
- list_all_entities: Get a complete list of all BC entities
- search_entity_operations: Search for specific operations by keyword
- get_entity_details: Get detailed information about a specific entity
- get_entity_relationships: Discover relationships between entities
- validate_workflow_structure: Validate multi-step workflows
- build_knowledge_base_workflow: Build comprehensive workflow documentation
- get_endpoint_documentation: Get detailed API documentation

Always use tools to provide accurate, up-to-date information from Business Central.`;
  }
}

// Export singleton getter
let directAgentServiceInstance: DirectAgentService | null = null;

export function getDirectAgentService(
  approvalManager?: ApprovalManager,
  todoManager?: TodoManager
): DirectAgentService {
  if (!directAgentServiceInstance) {
    directAgentServiceInstance = new DirectAgentService(approvalManager, todoManager);
  }
  return directAgentServiceInstance;
}
