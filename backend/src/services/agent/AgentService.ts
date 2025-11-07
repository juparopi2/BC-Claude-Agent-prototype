/**
 * Agent Service
 *
 * Provides agent execution capabilities using Claude Agent SDK.
 * Integrates with MCP servers for Business Central operations.
 * Includes hooks for approval and todo tracking.
 */

import {
  query,
  type PermissionResult,
  type PermissionUpdate,
  type SDKMessage,
  type HookInput,
  type HookJSONOutput,
} from '@anthropic-ai/claude-agent-sdk';
import type {
  BetaContentBlock,
  BetaToolUseBlock,
  BetaTextBlock,
} from '@anthropic-ai/sdk/resources/beta';
import { env } from '@/config';
import { getMCPService } from '../mcp';
import { getDatabase } from '@/config/database';
import type { AgentEvent, AgentExecutionResult } from '@/types';
import type { ApprovalManager } from '../approval/ApprovalManager';
import type { TodoManager } from '../todo/TodoManager';
import { isWriteOperation } from './helpers/permissions';

/**
 * Agent Service Class
 *
 * Handles agent execution with Claude Agent SDK and MCP integration.
 * Integrates with ApprovalManager and TodoManager for HITL and progress tracking.
 */
export class AgentService {
  private apiKey: string;
  private approvalManager?: ApprovalManager;
  private todoManager?: TodoManager;

  constructor(approvalManager?: ApprovalManager, todoManager?: TodoManager) {
    this.apiKey = env.ANTHROPIC_API_KEY || '';
    this.approvalManager = approvalManager;
    this.todoManager = todoManager;

    if (!this.apiKey) {
      console.warn('[AgentService] ANTHROPIC_API_KEY not configured');
    }
  }

  /**
   * Execute Query with Agent SDK
   *
   * Runs a query using Claude Agent SDK with automatic MCP tool discovery and calling.
   * Integrates with ApprovalManager and TodoManager via SDK hooks.
   *
   * @param prompt - User prompt/query
   * @param sessionId - Optional session ID for context
   * @param onEvent - Optional callback for streaming events
   * @returns Promise resolving to execution result
   *
   * @example
   * ```typescript
   * const agentService = new AgentService(approvalManager, todoManager);
   *
   * const result = await agentService.executeQuery(
   *   'Create customer Acme Corp',
   *   'session-123',
   *   (event) => {
   *     console.log('Event:', event.type);
   *   }
   * );
   *
   * console.log('Response:', result.response);
   * ```
   */
  async executeQuery(
    prompt: string,
    sessionId?: string,
    onEvent?: (event: AgentEvent) => void
  ): Promise<AgentExecutionResult> {
    const startTime = Date.now();
    const toolsUsed: string[] = [];
    let finalResponse = '';
    let finalMessageId = '';
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      // Get MCP configuration
      const mcpService = getMCPService();
      const mcpServers = mcpService.isConfigured()
        ? mcpService.getMCPServersConfig()
        : {};

      // Set API key in environment for SDK
      process.env.ANTHROPIC_API_KEY = this.apiKey;

      // Execute query with Agent SDK
      const result = query({
        prompt,
        options: {
          mcpServers,
          model: env.ANTHROPIC_MODEL,
          includePartialMessages: true,
          resume: sessionId,

          // 🔥 NATIVE SDK SUBAGENTS - Automatic routing based on intent
          agents: {
            'bc-query': {
              description: 'Expert in querying and retrieving Business Central data. Use for listing, searching, filtering, and reading BC entities (customers, vendors, items, sales orders, etc.).',
              prompt: `You are a specialized Business Central Query Agent.

Your responsibilities:
- Understand user queries about Business Central data
- Construct optimal OData filters for queries
- Query BC entities via MCP tools (bc_get_*, bc_query_*, bc_list_*)
- Format results in human-readable format
- Explain data relationships and insights
- NEVER modify data - you are read-only

Available entities:
- Customers: Query customer records, filter by name, email, status
- Vendors: Query vendor records and payment terms
- Items: Query inventory items, prices, and availability
- Sales Orders: Query sales documents and line items
- Purchase Orders: Query purchase documents

Best practices:
- Use appropriate filters to narrow results
- Limit results to avoid overwhelming the user
- Format currency and dates appropriately
- Provide context for the data (e.g., "Found 5 customers matching...")`,
              tools: ['Read', 'Grep', 'Glob'],
              model: 'sonnet',
            },
            'bc-write': {
              description: 'Expert in creating and updating Business Central entities. Use for data modifications, creates, updates with user approval (Human-in-the-Loop).',
              prompt: `You are a specialized Business Central Write Agent.

Your responsibilities:
- Validate data before creating/updating records
- Create and update BC entities via MCP tools
- ALWAYS request user approval before modifications
- Handle errors and provide clear feedback
- Never delete records without explicit confirmation
- Provide clear summaries of what will change

Critical rules:
1. ALWAYS validate required fields before requesting approval
2. ALWAYS request approval for changes (do not proceed without it)
3. Provide clear, human-readable summary of what will change
4. Handle validation errors gracefully with clear messages
5. Confirm successful writes with the user

Validation checklist (before requesting approval):
- Customer: name (required), valid email format, unique email
- Vendor: name (required), valid tax ID format
- Item: number (required), description (required), positive price

Write workflow:
1. Validate the data
2. Request approval from user
3. If approved, execute the write operation
4. Confirm success or handle errors`,
              tools: ['Read', 'Grep', 'Glob'],
              model: 'sonnet',
            },
            'bc-validation': {
              description: 'Expert in validating Business Central data without execution. Use for checking data validity, format validation, business rules verification.',
              prompt: `You are a specialized Business Central Validation Agent.

Your responsibilities:
- Validate BC entity data against business rules
- Check format compliance (email, phone, tax IDs)
- Verify required fields and data integrity
- Provide clear validation feedback
- NEVER execute writes - validation only
- Suggest corrections for invalid data

Validation rules:
- Customers: valid email, phone format, no duplicate emails
- Vendors: valid tax ID, payment terms exist
- Items: positive prices, valid UOM, unique item numbers
- All entities: required fields present, proper formats

Output format:
- List validation errors clearly
- Provide specific field names
- Suggest corrections
- Rate severity (error, warning, info)`,
              tools: ['Read', 'Grep', 'Glob'],
              model: 'haiku',
            },
            'bc-analysis': {
              description: 'Expert in analyzing Business Central data and providing insights, trends, summaries. Use for analytics, reporting, data interpretation.',
              prompt: `You are a specialized Business Central Analysis Agent.

Your responsibilities:
- Analyze BC data to identify trends and patterns
- Generate insights from sales, inventory, customer data
- Create summaries and reports
- Identify anomalies and opportunities
- Provide actionable recommendations
- Never modify data - analysis only

Analysis capabilities:
- Sales trends over time
- Top customers by revenue
- Inventory turnover analysis
- Pricing analysis and comparisons
- Customer behavior patterns
- Vendor performance metrics

Output format:
- Clear summary with key findings
- Support findings with data
- Use charts/tables when appropriate
- Provide actionable recommendations
- Highlight important insights`,
              tools: ['Read', 'Grep', 'Glob'],
              model: 'sonnet',
            },
          },

          // Permission control via canUseTool callback
          canUseTool: async (
            toolName: string,
            input: Record<string, unknown>,
            _options: { signal: AbortSignal; suggestions?: PermissionUpdate[]; toolUseID: string }
          ): Promise<PermissionResult> => {
            console.log(`[Agent] Checking permission for tool: ${toolName}`);

            // Mark todo as in_progress
            if (this.todoManager && sessionId) {
              const currentTodo = await this.findCurrentTodo(sessionId);
              if (currentTodo) {
                await this.todoManager.markInProgress(sessionId, currentTodo.id);
              }
            }

            // Request approval for write operations
            if (isWriteOperation(toolName) && this.approvalManager && sessionId) {
              try {
                const approved = await this.approvalManager.request({
                  sessionId,
                  toolName,
                  toolArgs: input,
                });

                if (!approved) {
                  console.log(`[Agent] ❌ Operation rejected by user: ${toolName}`);
                  return {
                    behavior: 'deny',
                    message: 'Operation rejected by user',
                    interrupt: true,
                  };
                }

                console.log(`[Agent] ✅ Operation approved by user: ${toolName}`);
              } catch (error) {
                console.error(`[Agent] Approval request failed:`, error);
                return {
                  behavior: 'deny',
                  message: `Approval request failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                  interrupt: true,
                };
              }
            }

            // Allow tool execution
            return {
              behavior: 'allow',
              updatedInput: input,
            };
          },

          // PostToolUse hook for tracking tool execution results
          hooks: {
            PostToolUse: [
              {
                hooks: [
                  async (input: HookInput): Promise<HookJSONOutput> => {
                    // Type guard to ensure this is a PostToolUse hook
                    if (input.hook_event_name !== 'PostToolUse') {
                      return {};
                    }

                    const toolName = input.tool_name;
                    const toolResponse = input.tool_response;

                    // Determine if tool execution was successful
                    const isError = typeof toolResponse === 'object' &&
                                   toolResponse !== null &&
                                   'is_error' in toolResponse &&
                                   toolResponse.is_error === true;

                    console.log(`[Agent] Tool executed: ${toolName}, success: ${!isError}`);

                    // Mark todo as completed/failed
                    if (this.todoManager && sessionId) {
                      const currentTodo = await this.findCurrentTodo(sessionId);
                      if (currentTodo) {
                        await this.todoManager.markCompleted(sessionId, currentTodo.id, !isError);
                      }
                    }

                    // Log to audit_log
                    if (sessionId) {
                      await this.logToolExecution(sessionId, toolName, {
                        success: !isError,
                        result: toolResponse,
                      });
                    }

                    // Continue execution
                    return {};
                  },
                ],
              },
            ],
          },
        },
      });

      // Stream events and track which tools were used
      for await (const sdkMessage of result) {
        // Emit event to callback if provided
        if (onEvent) {
          const agentEvent = this.mapSDKMessageToAgentEvent(sdkMessage, sessionId);
          if (agentEvent) {
            onEvent(agentEvent);
          }
        }

        // Extract final response and tokens from result message
        if (sdkMessage.type === 'result') {
          if (sdkMessage.subtype === 'success') {
            finalResponse = sdkMessage.result;
            inputTokens = sdkMessage.usage.input_tokens;
            outputTokens = sdkMessage.usage.output_tokens;
          }
          finalMessageId = sdkMessage.uuid;
        }

        // Track which tools were used (for response metadata)
        if (sdkMessage.type === 'assistant') {
          for (const content of sdkMessage.message.content) {
            if (content.type === 'tool_use') {
              const toolUseBlock = content as BetaToolUseBlock;
              const toolName = toolUseBlock.name;

              if (!toolsUsed.includes(toolName)) {
                toolsUsed.push(toolName);
              }
            }
          }
        }
      }

      const duration = Date.now() - startTime;

      return {
        sessionId: sessionId || '',
        response: finalResponse,
        messageId: finalMessageId,
        tokenUsage: {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
        },
        toolsUsed,
        durationMs: duration,
        success: true,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      console.error('[AgentService] Query execution failed:', error);

      // Emit error event if callback provided
      if (onEvent) {
        onEvent({
          type: 'error',
          sessionId,
          timestamp: new Date(),
          error: errorMessage,
        });
      }

      return {
        sessionId: sessionId || '',
        response: '',
        messageId: '',
        tokenUsage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        },
        toolsUsed,
        durationMs: duration,
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Find the current (first pending) todo for a session
   *
   * @param sessionId - Session ID
   * @returns Current todo or null
   */
  private async findCurrentTodo(sessionId: string): Promise<{ id: string; status: string } | null> {
    if (!this.todoManager) {
      return null;
    }

    try {
      const todos = await this.todoManager.getTodosBySession(sessionId);
      // Find first pending or in_progress todo
      return todos.find(t => t.status === 'pending' || t.status === 'in_progress') || null;
    } catch (error) {
      console.error('[AgentService] Failed to find current todo:', error);
      return null;
    }
  }

  /**
   * Log tool execution to audit_log
   *
   * @param sessionId - Session ID
   * @param toolName - Tool name
   * @param result - Tool result
   */
  private async logToolExecution(sessionId: string, toolName: string, result: unknown): Promise<void> {
    const db = getDatabase();
    if (!db) {
      return;
    }

    try {
      await db.request()
        .input('session_id', sessionId)
        .input('event_type', 'tool_executed')
        .input('event_data', JSON.stringify({ toolName, result }))
        .input('timestamp', new Date())
        .query(`
          INSERT INTO audit_log (session_id, event_type, event_data, timestamp)
          VALUES (@session_id, @event_type, @event_data, @timestamp)
        `);
    } catch (error) {
      console.error('[AgentService] Failed to log tool execution:', error);
    }
  }

  // Note: updateSessionAgentId method removed as it was unused
  // If needed in the future, it can be re-added to track SDK session IDs

  /**
   * Map SDK Message to Agent Event
   *
   * Converts Agent SDK messages to our internal AgentEvent format.
   *
   * @param sdkMessage - Message from Agent SDK
   * @param sessionId - Session ID
   * @returns Mapped AgentEvent or null if not convertible
   */
  private mapSDKMessageToAgentEvent(
    sdkMessage: SDKMessage,
    sessionId?: string
  ): AgentEvent | null {
    const timestamp = new Date();

    try {
      switch (sdkMessage.type) {
        case 'system':
          if (sdkMessage.subtype === 'init') {
            return {
              type: 'session_start',
              sessionId: sdkMessage.session_id || sessionId || '',
              userId: '',
              timestamp,
            };
          }
          return null;

        case 'user':
          return {
            type: 'message',
            sessionId: sdkMessage.session_id || sessionId,
            timestamp,
            content: JSON.stringify(sdkMessage.message),
            messageId: sdkMessage.uuid || '',
            role: 'user',
          };

        case 'assistant':
          // Extract text content from assistant message
          const textContent = sdkMessage.message.content
            .filter((c: BetaContentBlock): c is BetaTextBlock => c.type === 'text')
            .map((c: BetaTextBlock) => c.text)
            .join('\n');

          return {
            type: 'message',
            sessionId: sdkMessage.session_id || sessionId,
            timestamp,
            content: textContent,
            messageId: sdkMessage.message.id || sdkMessage.uuid,
            role: 'assistant',
          };

        case 'stream_event':
          // Handle streaming events
          const event = sdkMessage.event;
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            return {
              type: 'message_partial',
              sessionId: sdkMessage.session_id || sessionId,
              timestamp,
              content: event.delta.text,
              messageId: sdkMessage.uuid,
            };
          }
          return null;

        case 'result':
          return {
            type: 'session_end',
            sessionId: sdkMessage.session_id || sessionId || '',
            timestamp,
            reason: sdkMessage.subtype === 'success' ? 'completed' : 'error',
          };

        default:
          return null;
      }
    } catch (error) {
      console.error('[AgentService] Error mapping SDK message:', error);
      return null;
    }
  }

  /**
   * Check if Agent SDK is configured
   *
   * @returns True if ANTHROPIC_API_KEY is set
   */
  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.length > 0);
  }

  /**
   * Get Configuration Status
   *
   * @returns Configuration info
   */
  getConfigStatus(): {
    hasApiKey: boolean;
    mcpConfigured: boolean;
    model: string;
  } {
    const mcpService = getMCPService();

    return {
      hasApiKey: this.isConfigured(),
      mcpConfigured: mcpService.isConfigured(),
      model: env.ANTHROPIC_MODEL,
    };
  }

  /**
   * Set Approval Manager
   *
   * @param approvalManager - Approval manager instance
   */
  setApprovalManager(approvalManager: ApprovalManager): void {
    this.approvalManager = approvalManager;
  }

  /**
   * Set Todo Manager
   *
   * @param todoManager - Todo manager instance
   */
  setTodoManager(todoManager: TodoManager): void {
    this.todoManager = todoManager;
  }
}

// Singleton instance
let agentServiceInstance: AgentService | null = null;

/**
 * Get Agent Service Singleton Instance
 *
 * @param approvalManager - Optional approval manager (required on first call)
 * @param todoManager - Optional todo manager (required on first call)
 * @returns The shared AgentService instance
 */
export function getAgentService(
  approvalManager?: ApprovalManager,
  todoManager?: TodoManager
): AgentService {
  if (!agentServiceInstance) {
    agentServiceInstance = new AgentService(approvalManager, todoManager);
  } else {
    // Update managers if provided
    if (approvalManager) {
      agentServiceInstance.setApprovalManager(approvalManager);
    }
    if (todoManager) {
      agentServiceInstance.setTodoManager(todoManager);
    }
  }
  return agentServiceInstance;
}
