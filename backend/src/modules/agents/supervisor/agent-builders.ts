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
import { SystemMessage } from '@langchain/core/messages';
import type { AgentId } from '@bc-agent/shared';
import { ModelFactory } from '@/core/langchain/ModelFactory';
import { getModelConfig } from '@/infrastructure/config/models';
import { getAgentRegistry } from '../core/registry/AgentRegistry';
import { buildHandoffToolsForAgent } from '../handoffs';
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
    const domainTools = registry.getToolsForAgent(agentDef.id);

    if (domainTools.length === 0) {
      logger.warn(
        { agentId: agentDef.id },
        'Skipping agent with no tools'
      );
      continue;
    }

    const handoffTools = buildHandoffToolsForAgent(agentDef.id);
    const allTools = [...domainTools, ...handoffTools];

    const model = await ModelFactory.create(agentDef.modelRole);

    // Use SystemMessage with cache_control for prompt caching when enabled
    const modelConfig = getModelConfig(agentDef.modelRole);
    const prompt = modelConfig.promptCaching
      ? new SystemMessage({
          content: [{
            type: 'text',
            text: agentDef.systemPrompt,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            cache_control: { type: 'ephemeral' } as any,
          }],
        })
      : agentDef.systemPrompt;

    // Bind tools with tool_choice to force tool usage
    // All our providers (Anthropic, OpenAI, Google) support bindTools
    const llmWithToolChoice = model.bindTools!(allTools, { tool_choice: 'any' });

    const agent = createReactAgent({
      llm: llmWithToolChoice,
      tools: allTools,
      name: agentDef.id,
      prompt,
    });

    builtAgents.push({
      id: agentDef.id,
      name: agentDef.name,
      agent,
    });

    logger.info(
      {
        agentId: agentDef.id,
        domainToolCount: domainTools.length,
        handoffToolCount: handoffTools.length,
        totalToolCount: allTools.length,
        modelRole: agentDef.modelRole,
        toolChoiceEnforced: true,
      },
      'Built ReAct agent'
    );
  }

  return builtAgents;
}
