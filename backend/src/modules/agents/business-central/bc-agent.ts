
import { AgentState, ToolExecution } from '../orchestrator/state';
import { BaseAgent } from '../core/AgentFactory';
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

const logger = createChildLogger({ service: 'BCAgent' });

// System prompt for the Business Central agent
const BC_AGENT_SYSTEM_PROMPT = `You are a specialized Business Central assistant with access to tools for querying BC entities and operations.

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

CRITICAL INSTRUCTIONS:
- You MUST use the available tools for ALL Business Central queries
- NEVER respond from memory or general knowledge about Business Central
- ALWAYS call the appropriate tool first, then format the results for the user
- For ANY question about BC entities, operations, or data, use the tools
- Do not make assumptions - use tools to get accurate, current information`;

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
export class BusinessCentralAgent extends BaseAgent {
  name = 'business-central';
  description = 'Specialized agent for Microsoft Business Central ERP operations.';

  async invoke(state: AgentState, config?: RunnableConfig): Promise<Partial<AgentState>> {
    logger.info({
      messageCount: state.messages.length,
      sessionId: state.context.sessionId
    }, 'BCAgent: Starting invocation');

    // Use centralized model configuration for BC Agent role
    // Read enableThinking from state.context.options (passed from user's frontend toggle)
    const enableThinking = state.context?.options?.enableThinking ?? false;
    const thinkingBudget = state.context?.options?.thinkingBudget ?? 10000;

    const bcConfig = getModelConfig('bc_agent');
    const model = ModelFactory.create({
      ...bcConfig,
      enableThinking,
      thinkingBudget,
    });

    logger.debug({
      enableThinking,
      thinkingBudget: enableThinking ? thinkingBudget : undefined,
    }, 'BCAgent: Model config with thinking settings');

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
    };
  }
}

export const bcAgentNode = async (state: AgentState, config?: RunnableConfig) => {
  const agent = new BusinessCentralAgent();
  return agent.invoke(state, config);
};
