
import { AgentState } from '../orchestrator/state';
import { BaseAgent } from '../core/AgentFactory';
import { ModelFactory } from '../../../core/langchain/ModelFactory';
import { RunnableConfig } from '@langchain/core/runnables';
import { AIMessage } from '@langchain/core/messages';
import { createKnowledgeSearchTool } from './tools';

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

     if (!userId) {
         // Fallback if no user context (should not happen in real flow)
         return {
             messages: [new AIMessage({ content: "Error: No user context found for knowledge retrieval." })]
         };
     }

     const model = ModelFactory.create({
        provider: 'anthropic',
        modelName: 'claude-3-5-sonnet-20241022',
        temperature: 0.2 // Low temp for accurate information retrieval
     });

     // Create tool instance bound to the current user
     const searchTool = createKnowledgeSearchTool(userId);
     
     // Bind tools to the model
     const modelWithTools = model.bindTools([searchTool]);
     
     // Invoke model
     const response = await modelWithTools.invoke(state.messages, config);
     
     return {
        messages: [response]
     };
  }
}

export const ragAgentNode = async (state: AgentState, config?: RunnableConfig) => {
  const agent = new RAGAgent();
  return agent.invoke(state, config);
};
