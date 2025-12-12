
import { AgentState } from '../orchestrator/state';
import { BaseAgent } from '../core/AgentFactory';
import { ModelFactory } from '../../../core/langchain/ModelFactory';
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
import { SystemMessage } from '@langchain/core/messages';

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
    const model = ModelFactory.create({
      provider: 'anthropic',
      modelName: 'claude-3-5-sonnet-20241022',
      temperature: 0.1,
    });

    // Bind all 7 BC meta-tools to the model
    const tools = [
      listAllEntitiesTool,
      searchEntityOperationsTool,
      getEntityDetailsTool,
      getEntityRelationshipsTool,
      validateWorkflowStructureTool,
      buildKnowledgeBaseWorkflowTool,
      getEndpointDocumentationTool,
    ];
    const modelWithTools = model.bindTools(tools);

    // Prepend system message if not present
    const messages = state.messages;
    const hasSystemMessage = messages.length > 0 && messages[0]._getType?.() === 'system';

    const messagesWithSystem = hasSystemMessage
      ? messages
      : [new SystemMessage(BC_AGENT_SYSTEM_PROMPT), ...messages];

    // Invoke model
    const response = await modelWithTools.invoke(messagesWithSystem, config);

    // Return the response as a partial state update (appending to messages)
    return {
      messages: [response],
    };
  }
}

export const bcAgentNode = async (state: AgentState, config?: RunnableConfig) => {
  const agent = new BusinessCentralAgent();
  return agent.invoke(state, config);
};
