import { StateGraph, START, END } from '@langchain/langgraph';
import { AgentStateAnnotation, AgentState } from './state';
import { routeIntent } from './router';
import { bcAgentNode } from '../business-central/bc-agent';
import { ragAgentNode } from '../rag-knowledge/rag-agent';
import { HumanMessage } from '@langchain/core/messages';

// Orchestrator Node
const orchestratorNode = async (_state: AgentState) => {
    return {
        messages: [new HumanMessage({ content: "[Orchestrator] I am here to help. Please clarify your intent." })]
    };
};

// Define the Graph
export const orchestratorGraph = new StateGraph(AgentStateAnnotation)
  .addNode("router", routeIntent)
  .addNode("orchestrator", orchestratorNode)
  .addNode("business-central", bcAgentNode)
  .addNode("rag-knowledge", ragAgentNode)
  
  .addEdge(START, "router")
  
  // Conditional Edge based on the 'activeAgent' set by the router
  .addConditionalEdges(
    "router",
    (state) => state.activeAgent,
    {
      "business-central": "business-central",
      "rag-knowledge": "rag-knowledge",
      "orchestrator": "orchestrator"
    }
  )

  .addEdge("business-central", END)
  .addEdge("rag-knowledge", END)
  .addEdge("orchestrator", END)
  
  .compile();
