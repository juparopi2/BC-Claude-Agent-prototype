import { AgentState } from '../orchestrator/state';
import { RunnableConfig } from '@langchain/core/runnables';

/**
 * Interface that all Agent Nodes must implement.
 * 
 * Each agent is essentially a Runnable that takes the AgentState
 * and returns a partial state update (usually just adding messages).
 */
export interface IAgentNode {
  name: string;
  description: string;
  
  /**
   * The main execution function for the agent.
   * Takes the current state and returns a partial update.
   */
  invoke(state: AgentState, config?: RunnableConfig): Promise<Partial<AgentState>>;
}

/**
 * Abstract Base Agent for standardizing behavior
 */
export abstract class BaseAgent implements IAgentNode {
  abstract name: string;
  abstract description: string;

  abstract invoke(state: AgentState, config?: RunnableConfig): Promise<Partial<AgentState>>;
}
