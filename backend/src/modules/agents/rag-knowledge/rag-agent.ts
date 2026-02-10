
import { AgentState, ToolExecution } from '../orchestrator/state';
import { ModelFactory } from '../../../core/langchain/ModelFactory';
import { getModelConfig } from '@/infrastructure/config/models';
import { RunnableConfig } from '@langchain/core/runnables';
import { AIMessage, ToolMessage, BaseMessage } from '@langchain/core/messages';
import { createKnowledgeSearchTool } from './tools';
import { createChildLogger } from '@/shared/utils/logger';
import { StructuredToolInterface } from '@langchain/core/tools';
import { AGENT_ID, AGENT_DISPLAY_NAME, AGENT_ICON, AGENT_COLOR } from '@bc-agent/shared';

const logger = createChildLogger({ service: 'RAGAgent' });

/**
 * RAG Knowledge Agent Node
 *
 * Handles semantic search and context retrieval.
 * Uses the SemanticSearchService to find relevant documents based on user queries.
 */
/**
 * @deprecated Use createReactAgent from supervisor/agent-builders.ts instead.
 * Kept for backward compatibility during migration.
 */
export class RAGAgent {
  name = "rag-knowledge";
  description = "Agent for searching and retrieving information from the semantic knowledge base.";

  async invoke(state: AgentState, config?: RunnableConfig): Promise<Partial<AgentState>> {
     const userId = state.context.userId;

     logger.info({
       userId,
       messageCount: state.messages.length,
       sessionId: state.context.sessionId
     }, 'RAGAgent: Starting invocation');

     if (!userId) {
         // Fallback if no user context (should not happen in real flow)
         logger.error('RAGAgent: No user context found for knowledge retrieval');
         return {
             messages: [new AIMessage({ content: "Error: No user context found for knowledge retrieval." })]
         };
     }

     // Use centralized model configuration for RAG Agent role
     const ragConfig = getModelConfig('rag_agent');
     const model = await ModelFactory.create('rag_agent');

     logger.debug({
       modelString: ragConfig.modelString,
     }, 'RAGAgent: Model initialized');

     // Create tool instance bound to the current user
     const searchTool = createKnowledgeSearchTool(userId);
     const toolsMap = new Map<string, StructuredToolInterface>([[searchTool.name, searchTool]]);

     logger.debug({ userId, toolName: searchTool.name }, 'RAGAgent: Created knowledge search tool');

     // Ensure model supports tool binding (all Anthropic models do)
     if (!model.bindTools) {
       throw new Error('Model does not support tool binding');
     }

     // Bind tools to the model
     const modelWithTools = model.bindTools([searchTool]);

     logger.debug({ toolCount: 1 }, 'RAGAgent: Bound tools to model');

     // ReAct Loop: invoke model, execute tools, repeat until done
     const MAX_ITERATIONS = 5;
     let iteration = 0;
     const newMessages: BaseMessage[] = [];
     const toolExecutions: ToolExecution[] = []; // Track tool executions for event emission
     let currentMessages = [...state.messages];

     while (iteration < MAX_ITERATIONS) {
       iteration++;
       logger.debug({ iteration, messageCount: currentMessages.length }, 'RAGAgent: Invoking model (iteration)');

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
       }, 'RAGAgent: Model response received');

       // If no tool calls, we're done
       if (!toolCalls || toolCalls.length === 0) {
         logger.debug({ iteration }, 'RAGAgent: No more tool calls, finishing');
         break;
       }

       // Execute each tool call
       for (const toolCall of toolCalls) {
         const toolName = toolCall.name;
         const toolArgs = toolCall.args;
         const toolCallId = toolCall.id;

         logger.debug({ toolName, toolCallId, args: toolArgs }, 'RAGAgent: Executing tool');

         const tool = toolsMap.get(toolName);
         if (!tool) {
           logger.warn({ toolName }, 'RAGAgent: Unknown tool requested');
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

           logger.info({ toolName, toolCallId, resultLength: resultStr.length }, 'RAGAgent: Tool executed successfully');

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
           logger.error({ toolName, toolCallId, error: errorMsg }, 'RAGAgent: Tool execution failed');

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
       logger.warn({ maxIterations: MAX_ITERATIONS }, 'RAGAgent: Max iterations reached');
     }

     logger.info({
       totalNewMessages: newMessages.length,
       iterations: iteration,
       toolExecutionsCount: toolExecutions.length
     }, 'RAGAgent: Invocation complete');

     return {
        messages: newMessages,
        toolExecutions: toolExecutions, // Return tool executions for event emission
        usedModel: ragConfig.modelName, // Track model for billing and traceability
        currentAgentIdentity: {
          agentId: AGENT_ID.RAG_AGENT,
          agentName: AGENT_DISPLAY_NAME[AGENT_ID.RAG_AGENT],
          agentIcon: AGENT_ICON[AGENT_ID.RAG_AGENT],
          agentColor: AGENT_COLOR[AGENT_ID.RAG_AGENT],
        },
     };
  }
}

export const ragAgentNode = async (state: AgentState, config?: RunnableConfig) => {
  const agent = new RAGAgent();
  return agent.invoke(state, config);
};
