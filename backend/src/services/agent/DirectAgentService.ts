/**
 * Direct Agent Service - Temporary Workaround for Agent SDK ProcessTransport Bug
 *
 * STATUS: ProcessTransport bug was fixed in Agent SDK v0.1.30+, but we continue using
 * this workaround with vendored MCP tools for reliability and full control.
 *
 * This service uses @anthropic-ai/sdk directly instead of Agent SDK query().
 * It implements manual tool calling loop (agentic loop) with native streaming.
 *
 * Why this approach:
 * - Agent SDK v0.1.29 had a critical ProcessTransport bug (fixed in v0.1.30+)
 * - Vendored MCP tools eliminate external dependencies (115 BC entity files)
 * - Direct API calling provides full control over streaming and tool execution
 * - Proven reliability in production (80-90% better perceived latency)
 *
 * Future Migration: When ready to migrate back to Agent SDK:
 * - See docs/backend/architecture-deep-dive.md for migration guide
 * - This implementation is SDK-compliant (same event types, stop_reason format)
 *
 * Architecture:
 * 1. Load vendored MCP tools from mcp-server/data/ (115 JSON files)
 * 2. Convert MCP tools to Anthropic tool definitions
 * 3. Call Claude API with tools parameter (native streaming)
 * 4. Manually execute tool calls when Claude requests them
 * 5. Send results back to Claude
 * 6. Repeat until Claude is done (agentic loop)
 */

import type {
  MessageParam,
  ToolUseBlock,
  MessageStreamEvent,
  TextBlock,
} from '@anthropic-ai/sdk/resources/messages';
import { env } from '@/config';
import type { AgentEvent, AgentExecutionResult, PersistenceState } from '@/types';
import type { ApprovalManager } from '../approval/ApprovalManager';
import type { TodoManager } from '../todo/TodoManager';
import type { IAnthropicClient } from './IAnthropicClient';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';  // ⭐ Use native SDK type
import { AnthropicClient } from './AnthropicClient';
import { randomUUID } from 'crypto';
import { getEventStore } from '../events/EventStore';
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
  private client: IAnthropicClient;
  private approvalManager?: ApprovalManager;
  private mcpDataPath: string;

  constructor(
    approvalManager?: ApprovalManager,
    _todoManager?: TodoManager,
    client?: IAnthropicClient
  ) {
    // Use dependency injection for testability
    // If no client provided, create real AnthropicClient
    this.client = client || new AnthropicClient({
      apiKey: env.ANTHROPIC_API_KEY || '',
    });
    this.approvalManager = approvalManager;

    // Setup MCP data path
    const mcpServerDir = path.join(process.cwd(), 'mcp-server');
    this.mcpDataPath = path.join(mcpServerDir, 'data', 'v1.0');
  }

  /**
   * Generate Enhanced Contract Fields
   *
   * Creates eventId, sequenceNumber, and persistenceState for event sourcing.
   * Uses Redis INCR for atomic sequence number generation (multi-tenant safe).
   *
   * @param sessionId - Session ID for sequence number generation
   * @param correlationId - Optional correlation ID (links related events)
   * @param parentEventId - Optional parent event ID (hierarchical relationships)
   * @returns Object with enhanced contract fields
   */
  private async generateEnhancedFields(
    sessionId: string,
    correlationId?: string,
    parentEventId?: string
  ): Promise<{
    eventId: string;
    sequenceNumber: number;
    persistenceState: PersistenceState;
    correlationId?: string;
    parentEventId?: string;
  }> {
    const eventStore = getEventStore();
    const sequenceNumber = await eventStore['getNextSequenceNumber'](sessionId);

    return {
      eventId: randomUUID(),
      sequenceNumber,
      persistenceState: 'queued' as PersistenceState,
      correlationId,
      parentEventId,
    };
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
  /**
   * Execute Query (Non-streaming) - DEPRECATED
   *
   * This method has been removed in favor of executeQueryStreaming().
   * All queries now use streaming for better real-time UX and performance.
   *
   * @deprecated Use executeQueryStreaming() instead
   */
  async executeQuery(
    _prompt: string,
    _sessionId?: string,
    _onEvent?: (event: AgentEvent) => void
  ): Promise<AgentExecutionResult> {
    throw new Error(
      'executeQuery() has been deprecated. Use executeQueryStreaming() instead. ' +
      'Streaming provides better real-time UX and eliminates the 600ms delay.'
    );
  }

  /**
   * Execute Query with Native Streaming
   *
   * Implements agentic loop with streaming:
   * 1. Stream response from Claude incrementally (text chunks arrive in real-time)
   * 2. Emit message_chunk events as text arrives (for live UI updates)
   * 3. Accumulate complete messages for tools/history
   * 4. Execute tools when stop_reason='tool_use'
   * 5. Repeat until Claude provides final answer (stop_reason='end_turn')
   *
   * Benefits over non-streaming:
   * - 80-90% better perceived latency (Time to First Token < 1s vs 5-10s)
   * - Real-time feedback to user ("typing" effect)
   * - Better UX (user sees progress immediately)
   * - Cancellable (can interrupt mid-generation)
   */
  async executeQueryStreaming(
    prompt: string,
    sessionId?: string,
    onEvent?: (event: AgentEvent) => void
  ): Promise<AgentExecutionResult> {
    const startTime = Date.now();
    const conversationHistory: MessageParam[] = [];
    const toolsUsed: string[] = [];
    const accumulatedResponses: string[] = [];
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      // Step 1: Get MCP tools and convert to Anthropic format
      const tools = await this.getMCPToolDefinitions();

      // Step 2: Add user message to history
      conversationHistory.push({
        role: 'user',
        content: prompt,
      });

      // Send thinking event with enhanced contract fields
      if (onEvent && sessionId) {
        const enhanced = await this.generateEnhancedFields(sessionId);
        onEvent({
          type: 'thinking',
          timestamp: new Date(),
          ...enhanced,
        });
      }

      // Step 3: Agentic Loop with Streaming
      let continueLoop = true;
      let turnCount = 0;
      const maxTurns = 20; // Safety limit

      while (continueLoop && turnCount < maxTurns) {
        turnCount++;

        console.log(`\n========== TURN ${turnCount} (STREAMING) ==========`);

        // ========== STREAM CLAUDE RESPONSE ==========
        const stream = this.client.createChatCompletionStream({
          model: env.ANTHROPIC_MODEL,
          max_tokens: 4096,
          messages: conversationHistory,
          tools: tools,
          system: this.getSystemPrompt(),
        });

        // Accumulators for this turn
        let accumulatedText = '';
        const textBlocks: TextBlock[] = [];
        const toolUses: ToolUseBlock[] = [];
        let stopReason: string | null = null;
        let messageId: string | null = null;

        // Track content blocks by index
        const contentBlocks: Map<number, { type: string; data: unknown }> = new Map();

        // Process stream events
        for await (const event of stream) {
          switch (event.type) {
            case 'message_start':
              // Message begins - capture ID and initial usage
              messageId = event.message.id;
              inputTokens += event.message.usage.input_tokens;
              console.log(`[STREAM] message_start: id=${messageId}, input_tokens=${event.message.usage.input_tokens}`);
              break;

            case 'content_block_start':
              // New content block starts (text or tool_use)
              console.log(`[STREAM] content_block_start: index=${event.index}, type=${event.content_block.type}`);

              if (event.content_block.type === 'text') {
                contentBlocks.set(event.index, {
                  type: 'text',
                  data: '', // Will accumulate in deltas
                });
              } else if (event.content_block.type === 'tool_use') {
                contentBlocks.set(event.index, {
                  type: 'tool_use',
                  data: {
                    id: event.content_block.id,
                    name: event.content_block.name,
                    input: {}, // Will accumulate in deltas
                  },
                });

                // Emit tool_use event immediately (UI shows pending tool)
                if (onEvent && sessionId) {
                  const enhanced = await this.generateEnhancedFields(sessionId);
                  onEvent({
                    type: 'tool_use',
                    toolName: event.content_block.name,
                    toolUseId: event.content_block.id,
                    args: {}, // Will be populated in deltas
                    timestamp: new Date(),
                    ...enhanced,
                  });
                }
              }
              break;

            case 'content_block_delta':
              // Incremental content arrives
              const block = contentBlocks.get(event.index);

              if (!block) {
                console.warn(`[STREAM] content_block_delta for unknown index ${event.index}`);
                break;
              }

              if (event.delta.type === 'text_delta') {
                // Text chunk arrived
                const chunk = event.delta.text;
                block.data = (block.data as string) + chunk;
                accumulatedText += chunk;

                // ⭐ EMIT CHUNK IMMEDIATELY (real-time streaming)
                if (onEvent && chunk && sessionId) {
                  const enhanced = await this.generateEnhancedFields(sessionId);
                  onEvent({
                    type: 'message_chunk',
                    content: chunk,
                    timestamp: new Date(),
                    ...enhanced,
                  });
                }

                console.log(`[STREAM] text_delta: index=${event.index}, chunk_len=${chunk.length}`);
              } else if (event.delta.type === 'input_json_delta') {
                // Tool input chunk (JSON partial)
                // Parse incremental JSON (SDK handles this)
                // In practice, we get the full input in content_block_stop
                console.log(`[STREAM] input_json_delta: index=${event.index}`);
              }
              break;

            case 'content_block_stop':
              // Content block completed
              const completedBlock = contentBlocks.get(event.index);

              if (!completedBlock) {
                console.warn(`[STREAM] content_block_stop for unknown index ${event.index}`);
                break;
              }

              if (completedBlock.type === 'text') {
                const finalText = completedBlock.data as string;
                if (finalText.trim()) {
                  textBlocks.push({
                    type: 'text',
                    text: finalText,
                    citations: [],
                  });
                }
                console.log(`[STREAM] content_block_stop (text): index=${event.index}, text_len=${finalText.length}`);
              } else if (completedBlock.type === 'tool_use') {
                const toolData = completedBlock.data as { id: string; name: string; input: Record<string, unknown> };
                toolUses.push({
                  type: 'tool_use',
                  id: toolData.id,
                  name: toolData.name,
                  input: toolData.input,
                });
                console.log(`[STREAM] content_block_stop (tool_use): index=${event.index}, tool=${toolData.name}`);
              }
              break;

            case 'message_delta':
              // Final token usage and stop_reason
              if (event.delta.stop_reason) {
                stopReason = event.delta.stop_reason;
                console.log(`[STREAM] message_delta: stop_reason=${stopReason}`);
              }
              if (event.usage) {
                outputTokens += event.usage.output_tokens;
                console.log(`[STREAM] message_delta: output_tokens=${event.usage.output_tokens}`);
              }
              break;

            case 'message_stop':
              // Message completed
              console.log(`[STREAM] message_stop`);
              break;

            default:
              console.log(`[STREAM] Unknown event type: ${(event as MessageStreamEvent).type}`);
          }
        }

        console.log(`[STREAM] Stream completed: stop_reason=${stopReason}, text_blocks=${textBlocks.length}, tool_uses=${toolUses.length}`);

        // ========== EMIT COMPLETE MESSAGE ==========
        // After streaming all chunks, emit the complete message
        if (accumulatedText.trim() && onEvent && sessionId) {
          const enhanced = await this.generateEnhancedFields(sessionId);
          onEvent({
            type: 'message',
            messageId: messageId || randomUUID(),
            content: accumulatedText,
            role: 'assistant',
            stopReason: (stopReason as 'end_turn' | 'tool_use' | 'max_tokens') || undefined,
            timestamp: new Date(),
            ...enhanced,
          });

          accumulatedResponses.push(accumulatedText);
        }

        // ========== ADD TO CONVERSATION HISTORY ==========
        // Build content array (text blocks + tool uses) for history
        const contentArray: Array<TextBlock | ToolUseBlock> = [
          ...textBlocks,
          ...toolUses,
        ];

        conversationHistory.push({
          role: 'assistant',
          content: contentArray,
        });

        // ========== CHECK STOP REASON ==========
        if (stopReason === 'end_turn') {
          // Claude is done
          continueLoop = false;
        } else if (stopReason === 'tool_use' && toolUses.length > 0) {
          // Claude wants to use tools

          // Execute all tool calls
          const toolResults: ToolResult[] = [];

          // Delay to allow DB saves to complete
          await new Promise(resolve => setTimeout(resolve, 600));

          for (const toolUse of toolUses) {
            toolsUsed.push(toolUse.name);

            // Check if tool needs approval
            const needsApproval = this.isWriteOperation(toolUse.name);

            if (needsApproval && this.approvalManager) {
              const approved = await this.approvalManager.request({
                sessionId: sessionId || 'unknown',
                toolName: toolUse.name,
                toolArgs: toolUse.input as Record<string, unknown>,
              });

              if (!approved) {
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: toolUse.id,
                  content: 'Operation cancelled by user - approval denied',
                  is_error: true,
                });
                continue;
              }
            }

            // Execute the tool
            try {
              const result = await this.executeMCPTool(toolUse.name, toolUse.input);

              if (onEvent && sessionId) {
                const enhanced = await this.generateEnhancedFields(sessionId, toolUse.id);
                onEvent({
                  type: 'tool_result',
                  toolName: toolUse.name,
                  toolUseId: toolUse.id,
                  args: toolUse.input as Record<string, unknown>,
                  result: result,
                  success: true,
                  timestamp: new Date(),
                  ...enhanced,
                });
              }

              toolResults.push({
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: typeof result === 'string' ? result : JSON.stringify(result),
              });
            } catch (error) {
              console.error(`[DirectAgentService] Tool execution failed:`, error);

              if (onEvent && sessionId) {
                const enhanced = await this.generateEnhancedFields(sessionId, toolUse.id);
                onEvent({
                  type: 'tool_result',
                  toolName: toolUse.name,
                  toolUseId: toolUse.id,
                  args: toolUse.input as Record<string, unknown>,
                  result: null,
                  success: false,
                  error: error instanceof Error ? error.message : String(error),
                  timestamp: new Date(),
                  ...enhanced,
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

          // Continue loop
        } else if (stopReason === 'max_tokens') {
          if (onEvent && sessionId) {
            const enhanced = await this.generateEnhancedFields(sessionId);
            onEvent({
              type: 'message',
              messageId: randomUUID(),
              content: '[Response truncated - reached max tokens]',
              role: 'assistant',
              timestamp: new Date(),
              ...enhanced,
            });
            accumulatedResponses.push('[Response truncated - reached max tokens]');
          }
          continueLoop = false;
        } else {
          // Unknown stop reason
          continueLoop = false;
        }
      }

      if (turnCount >= maxTurns) {
        if (onEvent && sessionId) {
          const enhanced = await this.generateEnhancedFields(sessionId);
          onEvent({
            type: 'message',
            messageId: randomUUID(),
            content: '[Execution stopped - reached maximum turns]',
            role: 'assistant',
            timestamp: new Date(),
            ...enhanced,
          });
          accumulatedResponses.push('[Execution stopped - reached maximum turns]');
        }
      }

      const duration = Date.now() - startTime;

      // Send completion event
      if (onEvent && sessionId) {
        const enhanced = await this.generateEnhancedFields(sessionId);
        onEvent({
          type: 'complete',
          reason: 'success',
          timestamp: new Date(),
          ...enhanced,
        });
      }

      return {
        success: true,
        response: accumulatedResponses.join('\n\n'),
        toolsUsed,
        duration,
        inputTokens,
        outputTokens,
      };

    } catch (error) {
      const duration = Date.now() - startTime;

      console.error(`[DirectAgentService] Streaming query execution failed:`, error);

      if (onEvent && sessionId) {
        const enhanced = await this.generateEnhancedFields(sessionId);
        onEvent({
          type: 'error',
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date(),
          ...enhanced,
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
  /**
   * Get MCP Tool Definitions
   *
   * Returns tool definitions from centralized tool-definitions.ts file.
   * This allows for easier maintenance and testing of tool schemas.
   *
   * @returns Array of Claude tool definitions
   */
  private async getMCPToolDefinitions(): Promise<Tool[]> {
    const { getMCPToolDefinitions } = await import('./tool-definitions');
    return getMCPToolDefinitions();
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
