/**
 * Handoff Tools (PRD-040)
 *
 * Factory function for creating LangGraph Command-based handoff tools.
 * Follows the official LangGraph pattern for agent-to-agent transfers.
 *
 * @module modules/agents/handoffs/handoff-tools
 */

import { Command, getCurrentTaskInput } from '@langchain/langgraph';
import { tool } from '@langchain/core/tools';
import { ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { z } from 'zod';

/**
 * Parameters for creating a handoff tool.
 */
export interface CreateHandoffToolParams {
  /** Target agent name (used as LangGraph node name) */
  agentName: string;
  /** Tool description for the LLM to understand when to hand off */
  description: string;
}

/**
 * Create a handoff tool that transfers control to another agent.
 *
 * The tool uses LangGraph's Command pattern to:
 * 1. Create a ToolMessage confirming the transfer
 * 2. Get the current state via getCurrentTaskInput()
 * 3. Return a Command that navigates to the target agent in the parent graph
 *
 * @param params - Agent name and description
 * @returns A LangGraph tool that triggers agent handoff
 */
export function createAgentHandoffTool({ agentName, description }: CreateHandoffToolParams) {
  const toolName = `transfer_to_${agentName}`;

  return tool(
    async (_input, config) => {
      const toolMessage = new ToolMessage({
        content: `Successfully transferred to ${agentName}`,
        name: toolName,
        tool_call_id: config.toolCall.id,
      });

      const state = getCurrentTaskInput() as { messages: BaseMessage[] };

      return new Command({
        goto: agentName,
        update: { messages: state.messages.concat(toolMessage) },
        graph: Command.PARENT,
      });
    },
    {
      name: toolName,
      schema: z.object({}),
      description,
    }
  );
}
