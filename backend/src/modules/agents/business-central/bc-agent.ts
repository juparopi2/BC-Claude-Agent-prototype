
import { AgentState, ToolExecution } from '../orchestrator/state';
import { ModelFactory } from '../../../core/langchain/ModelFactory';
import { getModelConfig } from '@/infrastructure/config/models';
import { RunnableConfig } from '@langchain/core/runnables';
import {
  listAllEntitiesTool,
  searchEntityOperationsTool,
  getEntityDetailsTool,
  getEntityRelationshipsTool,
  validateWorkflowStructureTool,
  buildKnowledgeBaseWorkflowTool,
  getEndpointDocumentationTool,
} from './tools';
import { SystemMessage, ToolMessage, BaseMessage } from '@langchain/core/messages';
import { createChildLogger } from '@/shared/utils/logger';
import { StructuredToolInterface } from '@langchain/core/tools';
import { AGENT_ID, AGENT_DISPLAY_NAME, AGENT_ICON, AGENT_COLOR } from '@bc-agent/shared';

const logger = createChildLogger({ service: 'BCAgent' });

// System prompt for the Business Central agent (used by legacy class below)
const BC_AGENT_SYSTEM_PROMPT = `You are the Business Central specialist within MyWorkMate, a multi-agent AI business assistant.
You are one of several expert agents coordinated by a supervisor to help users work with their business systems.

YOUR CAPABILITIES:
- Query Business Central entity metadata (customers, vendors, invoices, sales orders, inventory, items, purchase orders, chart of accounts)
- Search operations and API endpoints for any BC entity
- Explore entity relationships and dependencies
- Validate workflow structures and build knowledge base workflows
- Provide endpoint documentation with request/response schemas

IMPORTANT — PROTOTYPE STATUS:
- You are currently in a READ-ONLY prototype phase
- You can explore, document, and explain BC entities and their API endpoints
- You CANNOT execute real operations against the user's Business Central environment yet
- When users ask to create, update, or delete records, explain that this capability is coming soon and show them the API endpoint documentation they would need
- Always be transparent: "This is currently a prototype that helps you understand your BC data. Direct ERP operations are coming in a future release."

RULES:
- ALWAYS use the available tools for ALL queries — never answer from memory
- Call the appropriate tool first, then format the results clearly
- If you cannot find information, explain what you searched for and suggest alternatives`;

/**
 * Business Central Agent Node
 *
 * Handles all ERP-related tasks:
 * - Entity discovery and details
 * - Operation search and documentation
 * - Workflow validation and building
 * - Customer lookup
 * - Invoice creation
 * - Inventory checks
 */
/**
 * @deprecated Use createReactAgent from supervisor/agent-builders.ts instead.
 * Kept for backward compatibility during migration.
 */
export class BusinessCentralAgent {
  name = 'business-central';
  description = 'Specialized agent for Microsoft Business Central ERP operations.';

  async invoke(state: AgentState, config?: RunnableConfig): Promise<Partial<AgentState>> {
    logger.info({
      messageCount: state.messages.length,
      sessionId: state.context.sessionId
    }, 'BCAgent: Starting invocation');

    // Use centralized model configuration for BC Agent role
    const bcConfig = getModelConfig('bc_agent');
    const model = await ModelFactory.create('bc_agent');

    logger.debug({
      modelString: bcConfig.modelString,
    }, 'BCAgent: Model initialized');

    // Bind all 7 BC meta-tools to the model
    const tools: StructuredToolInterface[] = [
      listAllEntitiesTool,
      searchEntityOperationsTool,
      getEntityDetailsTool,
      getEntityRelationshipsTool,
      validateWorkflowStructureTool,
      buildKnowledgeBaseWorkflowTool,
      getEndpointDocumentationTool,
    ];

    // Create tool map for lookup during execution
    const toolsMap = new Map<string, StructuredToolInterface>();
    for (const t of tools) {
      toolsMap.set(t.name, t);
    }

    logger.debug({
      toolCount: tools.length,
      toolNames: tools.map(t => t.name)
    }, 'BCAgent: Binding tools to model');

    // Ensure model supports tool binding (all Anthropic models do)
    if (!model.bindTools) {
      throw new Error('Model does not support tool binding');
    }
    const modelWithTools = model.bindTools(tools);

    // Prepend system message if not present
    const messages = state.messages;
    const hasSystemMessage = messages.length > 0 && messages[0]?._getType?.() === 'system';

    logger.debug({ hasSystemMessage }, 'BCAgent: System message handling');

    const messagesWithSystem = hasSystemMessage
      ? messages
      : [new SystemMessage(BC_AGENT_SYSTEM_PROMPT), ...messages];

    // ReAct Loop: invoke model, execute tools, repeat until done
    const MAX_ITERATIONS = 10; // Higher limit for BC agent due to multiple tool calls
    let iteration = 0;
    const newMessages: BaseMessage[] = [];
    const toolExecutions: ToolExecution[] = []; // Track tool executions for event emission
    let currentMessages = [...messagesWithSystem];

    while (iteration < MAX_ITERATIONS) {
      iteration++;
      logger.debug({ iteration, messageCount: currentMessages.length }, 'BCAgent: Invoking model (iteration)');

      const response = await modelWithTools.invoke(currentMessages, config);
      newMessages.push(response);
      currentMessages = [...currentMessages, response];

      // Check for tool calls
      const toolCalls = (response as { tool_calls?: Array<{ name: string; args: Record<string, unknown>; id: string }> }).tool_calls;

      logger.info({
        responseType: response._getType?.() || 'unknown',
        hasContent: !!(response as { content?: unknown }).content,
        hasToolCalls: !!toolCalls?.length,
        toolCallCount: toolCalls?.length || 0,
        iteration
      }, 'BCAgent: Model response received');

      // If no tool calls, we're done
      if (!toolCalls || toolCalls.length === 0) {
        logger.debug({ iteration }, 'BCAgent: No more tool calls, finishing');
        break;
      }

      // Execute each tool call
      for (const toolCall of toolCalls) {
        const toolName = toolCall.name;
        const toolArgs = toolCall.args;
        const toolCallId = toolCall.id;

        logger.debug({ toolName, toolCallId, args: toolArgs }, 'BCAgent: Executing tool');

        const tool = toolsMap.get(toolName);
        if (!tool) {
          logger.warn({ toolName }, 'BCAgent: Unknown tool requested');
          const errorMessage = new ToolMessage({
            content: `Error: Unknown tool "${toolName}"`,
            tool_call_id: toolCallId
          });
          newMessages.push(errorMessage);
          currentMessages = [...currentMessages, errorMessage];
          continue;
        }

        try {
          // Execute the tool
          const result = await tool.invoke(toolArgs);
          const resultStr = typeof result === 'string' ? result : JSON.stringify(result);

          logger.info({ toolName, toolCallId, resultLength: resultStr.length }, 'BCAgent: Tool executed successfully');

          // Track tool execution for event emission
          toolExecutions.push({
            toolUseId: toolCallId,
            toolName: toolName,
            args: toolArgs,
            result: resultStr,
            success: true,
          });

          // Create ToolMessage with result
          const toolMessage = new ToolMessage({
            content: resultStr,
            tool_call_id: toolCallId
          });
          newMessages.push(toolMessage);
          currentMessages = [...currentMessages, toolMessage];

        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          logger.error({ toolName, toolCallId, error: errorMsg }, 'BCAgent: Tool execution failed');

          // Track failed tool execution for event emission
          toolExecutions.push({
            toolUseId: toolCallId,
            toolName: toolName,
            args: toolArgs,
            result: errorMsg,
            success: false,
            error: errorMsg,
          });

          const errorMessage = new ToolMessage({
            content: `Error executing tool ${toolName}: ${errorMsg}`,
            tool_call_id: toolCallId
          });
          newMessages.push(errorMessage);
          currentMessages = [...currentMessages, errorMessage];
        }
      }
    }

    if (iteration >= MAX_ITERATIONS) {
      logger.warn({ maxIterations: MAX_ITERATIONS }, 'BCAgent: Max iterations reached');
    }

    logger.info({
      totalNewMessages: newMessages.length,
      iterations: iteration,
      toolExecutionsCount: toolExecutions.length
    }, 'BCAgent: Invocation complete');

    // Return the response as a partial state update (appending to messages)
    return {
      messages: newMessages,
      toolExecutions: toolExecutions, // Return tool executions for event emission
      usedModel: bcConfig.modelName, // Track model for billing and traceability
      currentAgentIdentity: {
        agentId: AGENT_ID.BC_AGENT,
        agentName: AGENT_DISPLAY_NAME[AGENT_ID.BC_AGENT],
        agentIcon: AGENT_ICON[AGENT_ID.BC_AGENT],
        agentColor: AGENT_COLOR[AGENT_ID.BC_AGENT],
      },
    };
  }
}

export const bcAgentNode = async (state: AgentState, config?: RunnableConfig) => {
  const agent = new BusinessCentralAgent();
  return agent.invoke(state, config);
};
