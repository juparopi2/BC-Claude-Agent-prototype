
import { AgentState } from '../orchestrator/state';
import { BaseAgent } from '../core/AgentFactory';
import { ModelFactory } from '../../../core/langchain/ModelFactory';
import { getModelConfig } from '../../../config/models';
import { RunnableConfig } from '@langchain/core/runnables';
import { AIMessage } from '@langchain/core/messages';
import { createKnowledgeSearchTool } from './tools';
import { createChildLogger } from '@/utils/logger';

const logger = createChildLogger({ service: 'RAGAgent' });

/**
 * RAG Knowledge Agent Node
 *
 * Handles semantic search and context retrieval.
 * Uses the SemanticSearchService to find relevant documents based on user queries.
 */
export class RAGAgent extends BaseAgent {
  name = "rag-knowledge";
  description = "Agent for searching and retrieving information from the semantic knowledge base.";

  async invoke(state: AgentState, config?: RunnableConfig): Promise<Partial<AgentState>> {
     const userId = state.context.userId;

     logger.info({
       userId,
       messageCount: state.messages.length,
       sessionId: state.sessionId
     }, 'RAGAgent: Starting invocation');

     if (!userId) {
         // Fallback if no user context (should not happen in real flow)
         logger.error('RAGAgent: No user context found for knowledge retrieval');
         return {
             messages: [new AIMessage({ content: "Error: No user context found for knowledge retrieval." })]
         };
     }

     // Use centralized model configuration for RAG Agent role (economic model)
     const ragConfig = getModelConfig('rag_agent');
     const model = ModelFactory.create(ragConfig);

     // Create tool instance bound to the current user
     const searchTool = createKnowledgeSearchTool(userId);

     logger.debug({ userId, toolName: searchTool.name }, 'RAGAgent: Created knowledge search tool');

     // Ensure model supports tool binding (all Anthropic models do)
     if (!model.bindTools) {
       throw new Error('Model does not support tool binding');
     }

     // Bind tools to the model
     const modelWithTools = model.bindTools([searchTool]);

     logger.debug({ toolCount: 1 }, 'RAGAgent: Bound tools to model');

     // Invoke model
     logger.debug({ messageCount: state.messages.length }, 'RAGAgent: Invoking model with tools');

     const response = await modelWithTools.invoke(state.messages, config);

     logger.info({
       responseType: response._getType?.() || 'unknown',
       hasContent: !!(response as { content?: unknown }).content,
       hasToolCalls: !!(response as { tool_calls?: unknown[] }).tool_calls?.length,
       toolCallCount: (response as { tool_calls?: unknown[] }).tool_calls?.length || 0
     }, 'RAGAgent: Model response received');

     return {
        messages: [response]
     };
  }
}

export const ragAgentNode = async (state: AgentState, config?: RunnableConfig) => {
  const agent = new RAGAgent();
  return agent.invoke(state, config);
};
