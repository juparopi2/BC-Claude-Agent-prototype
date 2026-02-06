/**
 * Agent Builders
 *
 * Builds createReactAgent() instances from the AgentRegistry.
 * Each agent is compiled once at startup with its static tools.
 *
 * @module modules/agents/supervisor/agent-builders
 */

import { createReactAgent } from '@langchain/langgraph/prebuilt';
import type { CompiledStateGraph } from '@langchain/langgraph';
import type { AgentId } from '@bc-agent/shared';
import { ModelFactory } from '@/core/langchain/ModelFactory';
import { getAgentRegistry } from '../core/registry/AgentRegistry';
import { createChildLogger } from '@/shared/utils/logger';

const logger = createChildLogger({ service: 'AgentBuilders' });

/**
 * A built ReAct agent with its metadata.
 */
export interface BuiltAgent {
  id: AgentId;
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agent: CompiledStateGraph<any, any, any>;
}

/**
 * Build ReAct agent instances from the registry.
 *
 * For each worker agent (non-system):
 * 1. Resolve static tools from registry
 * 2. Create model for the agent's role
 * 3. Build createReactAgent with tools, model, name, and prompt
 *
 * @returns Array of built agent instances
 */
export async function buildReactAgents(): Promise<BuiltAgent[]> {
  const registry = getAgentRegistry();
  const workerAgents = registry.getWorkerAgents();
  const builtAgents: BuiltAgent[] = [];

  for (const agentDef of workerAgents) {
    const tools = registry.getToolsForAgent(agentDef.id);

    if (tools.length === 0) {
      logger.warn(
        { agentId: agentDef.id },
        'Skipping agent with no tools'
      );
      continue;
    }

    const model = await ModelFactory.create(agentDef.modelRole);

    const agent = createReactAgent({
      llm: model,
      tools,
      name: agentDef.id,
      prompt: agentDef.systemPrompt,
    });

    builtAgents.push({
      id: agentDef.id,
      name: agentDef.name,
      agent,
    });

    logger.info(
      { agentId: agentDef.id, toolCount: tools.length, modelRole: agentDef.modelRole },
      'Built ReAct agent'
    );
  }

  return builtAgents;
}
