/**
 * Handoff Tool Builder (PRD-040)
 *
 * Builds per-agent handoff tools from the AgentRegistry.
 * Each worker agent gets transfer tools to all OTHER worker agents.
 *
 * @module modules/agents/handoffs/handoff-tool-builder
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { AgentId } from '@bc-agent/shared';
import { AGENT_DISPLAY_NAME } from '@bc-agent/shared';
import { getAgentRegistry } from '../core/registry/AgentRegistry';
import { createAgentHandoffTool } from './handoff-tools';
import { createChildLogger } from '@/shared/utils/logger';

const logger = createChildLogger({ service: 'HandoffToolBuilder' });

/**
 * Build handoff tools for a specific agent.
 *
 * Creates one `transfer_to_<agent>` tool for each OTHER worker agent
 * in the registry. Excludes:
 * - Self-transfer (agent cannot hand off to itself)
 * - System agents (e.g., supervisor)
 *
 * @param agentId - The agent to build handoff tools for
 * @returns Array of handoff tools for the agent
 */
export function buildHandoffToolsForAgent(agentId: AgentId): StructuredToolInterface[] {
  const registry = getAgentRegistry();
  const workerAgents = registry.getWorkerAgents();

  const handoffTools: StructuredToolInterface[] = [];

  for (const agentDef of workerAgents) {
    if (agentDef.id === agentId) continue;

    const handoffTool = createAgentHandoffTool({
      agentName: agentDef.id,
      description: `Transfer the conversation to ${AGENT_DISPLAY_NAME[agentDef.id]}. ${agentDef.description}`,
    });

    handoffTools.push(handoffTool as unknown as StructuredToolInterface);
  }

  logger.debug(
    { agentId, handoffToolCount: handoffTools.length, targets: handoffTools.map(t => t.name) },
    'Built handoff tools for agent'
  );

  return handoffTools;
}
