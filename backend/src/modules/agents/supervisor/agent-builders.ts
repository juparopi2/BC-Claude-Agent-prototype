/**
 * Agent Builders
 *
 * Builds createReactAgent() instances from the AgentRegistry.
 * Each agent is compiled once at startup with its static tools.
 *
 * Tool enforcement: Workers with client-side tools use FirstCallToolEnforcer to
 * guarantee at least one domain tool call per invocation (tool_choice: 'any' on
 * first call, 'auto' on subsequent calls for natural termination).
 * Workers with Anthropic server-side tools skip enforcement — Anthropic handles
 * their execution and they bind directly without FirstCallToolEnforcer.
 *
 * @module modules/agents/supervisor/agent-builders
 */

import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { SystemMessage } from '@langchain/core/messages';
import { RunnableBinding } from '@langchain/core/runnables';
import type { AgentId } from '@bc-agent/shared';
import { ModelFactory } from '@/core/langchain/ModelFactory';
import { getModelConfig } from '@/infrastructure/config/models';
import { createFirstCallEnforcer } from '@/core/langchain/FirstCallToolEnforcer';
import { getAgentRegistry } from '../core/registry/AgentRegistry';
import { createChildLogger } from '@/shared/utils/logger';

const logger = createChildLogger({ service: 'AgentBuilders' });

/** Return type of createReactAgent — complex internal generics, extract via ReturnType */
type ReactAgentGraph = ReturnType<typeof createReactAgent>;

/**
 * Known Anthropic server-side tool type prefixes.
 * These tools run on Anthropic's servers and don't need FirstCallToolEnforcer.
 */
const SERVER_TOOL_TYPE_PREFIXES = [
  'web_search_',
  'web_fetch_',
  'code_execution_',
  'text_editor_',
  'computer_',
  'bash_',
];

/**
 * Check if a tool is an Anthropic server-side tool.
 * Server tools have a `type` field matching known prefixes (e.g., 'web_search_20250305').
 */
function isAnthropicServerTool(tool: unknown): boolean {
  const t = tool as { type?: string };
  if (typeof t?.type !== 'string') return false;
  return SERVER_TOOL_TYPE_PREFIXES.some(prefix => t.type!.startsWith(prefix));
}

/**
 * A built ReAct agent with its metadata.
 */
export interface BuiltAgent {
  id: AgentId;
  name: string;
  agent: ReactAgentGraph;
}

/**
 * Build ReAct agent instances from the registry.
 *
 * For each worker agent (non-system):
 * 1. Resolve static tools from registry
 * 2. Create model for the agent's role
 * 3. Build createReactAgent with tools, model, name, and prompt
 *
 * Routing between agents is handled exclusively by the supervisor.
 * Workers do NOT have handoff tools — they complete their task and return.
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

    const model = await ModelFactory.create(agentDef.modelRole);

    // Guard: tool_choice enforcement is incompatible with Anthropic thinking
    const modelConfig = getModelConfig(agentDef.modelRole);
    if (modelConfig.thinking?.type === 'enabled' && domainTools.length > 0) {
      throw new Error(
        `Agent "${agentDef.id}" (role: ${agentDef.modelRole}) cannot use tool_choice enforcement ` +
        'with thinking enabled. Anthropic API constraint: tool_choice must be "auto" when ' +
        'thinking is enabled. Disable thinking or remove tools.'
      );
    }

    // Use SystemMessage with cache_control for prompt caching when enabled
    const prompt = modelConfig.promptCaching
      ? new SystemMessage({
          content: [{
            type: 'text',
            text: agentDef.systemPrompt,
            cache_control: { type: 'ephemeral' } as { type: 'ephemeral' },
          }],
        })
      : agentDef.systemPrompt;

    // Detect if all tools are Anthropic server-side tools.
    // Server tools don't need FirstCallToolEnforcer — Anthropic handles execution.
    const allServerTools = domainTools.every(t => isAnthropicServerTool(t));

    let modelToUse;
    if (allServerTools) {
      // Server-side tools: bind directly without enforcement.
      // BaseChatModel.bindTools is optional — guard to ensure it exists at runtime.
      if (!('bindTools' in model) || typeof model.bindTools !== 'function') {
        throw new Error(
          `Agent "${agentDef.id}" model does not support bindTools — cannot bind server-side tools`
        );
      }
      modelToUse = model.bindTools(domainTools);
      logger.info(
        { agentId: agentDef.id },
        'Using server-side tools — skipping FirstCallToolEnforcer'
      );
    } else {
      // Custom client tools: apply hybrid enforcement (tool_choice 'any' first, then 'auto').
      // The enforcer returns a pre-bound RunnableBinding that createReactAgent
      // detects as already bound (_shouldBindTools → false), so it won't re-bind.
      // Cast is safe: non-server-tools path means all entries are StructuredToolInterface.
      const clientTools = domainTools as import('@langchain/core/tools').StructuredToolInterface[];
      const enforcedModel = createFirstCallEnforcer(model, clientTools);
      if (!RunnableBinding.isRunnableBinding(enforcedModel)) {
        logger.error(
          { agentId: agentDef.id },
          'CRITICAL: Enforcer is NOT a RunnableBinding — _shouldBindTools will re-bind and bypass enforcement!'
        );
      }
      modelToUse = enforcedModel;
    }

    const agent = createReactAgent({
      llm: modelToUse,
      tools: domainTools,
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
        toolCount: domainTools.length,
        modelRole: agentDef.modelRole,
      },
      'Built ReAct agent'
    );
  }

  return builtAgents;
}
