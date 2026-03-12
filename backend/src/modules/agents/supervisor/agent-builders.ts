/**
 * Agent Builders
 *
 * Builds createReactAgent() instances from the AgentRegistry.
 * Each agent is compiled once at startup with its static tools.
 *
 * Tool enforcement: ALL worker agents use FirstCallToolEnforcer to guarantee
 * at least one domain tool call per invocation (tool_choice: 'any' on first call,
 * 'auto' on subsequent calls for natural termination). This applies to both
 * client-side tools (StructuredToolInterface) and server-side tools (ServerTool).
 *
 * @module modules/agents/supervisor/agent-builders
 */

import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { SystemMessage } from '@langchain/core/messages';
import { RunnableBinding } from '@langchain/core/runnables';
import { AGENT_ID, type AgentId, type SessionFileReference } from '@bc-agent/shared';
import { HumanMessage, type BaseMessage } from '@langchain/core/messages';
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

    // Unified enforcement: ALL worker agents use FirstCallToolEnforcer.
    // The enforcer accepts both client-side (StructuredToolInterface) and server-side (ServerTool) tools.
    // It returns a pre-bound RunnableBinding that createReactAgent detects as already bound
    // (_shouldBindTools → false), so it won't re-bind.
    const enforcedModel = createFirstCallEnforcer(model, domainTools);
    if (!RunnableBinding.isRunnableBinding(enforcedModel)) {
      logger.error(
        { agentId: agentDef.id },
        'CRITICAL: Enforcer is NOT a RunnableBinding — _shouldBindTools will re-bind and bypass enforcement!'
      );
    }
    const modelToUse = enforcedModel;

    const allServerTools = domainTools.every(t => isAnthropicServerTool(t));
    if (allServerTools) {
      logger.info({ agentId: agentDef.id }, 'Server-side tools — enforcement via FirstCallToolEnforcer');
    }

    const agent = createReactAgent({
      llm: modelToUse,
      tools: domainTools,
      name: agentDef.id,
      prompt,
    });

    // Wrap invoke with diagnostic logging and session file re-injection
    const _originalInvoke = agent.invoke.bind(agent);
    // Use stream for step-by-step ReAct loop visibility (diagnostic)
    const originalStream = agent.stream.bind(agent);
    (agent as unknown as { invoke: typeof _originalInvoke }).invoke = async function(
      state: Record<string, unknown>,
      config?: Record<string, unknown>,
    ) {
      const configurable = config?.configurable as Record<string, unknown> | undefined;
      const msgs = (state?.messages ?? []) as BaseMessage[];

      // Re-inject session file references as container_upload blocks for research-agent.
      // On subsequent turns (message 2+), the current HumanMessage won't have container_upload
      // blocks because the user didn't attach new files. But the session still has files uploaded
      // to Anthropic's Files API that should be available in the code_execution sandbox.
      if (agentDef.id === AGENT_ID.RESEARCH_AGENT) {
        const sessionFileRefs = configurable?.sessionFileReferences as SessionFileReference[] | undefined;
        if (sessionFileRefs?.length) {
          // Find the last HumanMessage to inject into
          let lastHumanMsg: BaseMessage | undefined;
          let lastHumanIdx = -1;
          for (let i = msgs.length - 1; i >= 0; i--) {
            const m = msgs[i];
            if (m && m._getType() === 'human') { lastHumanMsg = m; lastHumanIdx = i; break; }
          }
          if (lastHumanMsg && lastHumanIdx >= 0) {
            const content = Array.isArray(lastHumanMsg.content)
              ? lastHumanMsg.content as Array<{ type: string; file_id?: string; [key: string]: unknown }>
              : [{ type: 'text' as const, text: lastHumanMsg.content as string }];

            // Find existing container_upload file IDs to avoid duplicates
            const existingFileIds = new Set(
              content
                .filter(b => b.type === 'container_upload' && b.file_id)
                .map(b => b.file_id as string)
            );

            const missingRefs = sessionFileRefs.filter(
              r => !existingFileIds.has(r.anthropicFileId)
            );

            if (missingRefs.length > 0) {
              const newBlocks = missingRefs.map(r => ({
                type: 'container_upload' as const,
                file_id: r.anthropicFileId,
              }));

              // Replace the last HumanMessage with injected container_upload blocks
              const updatedContent = [...newBlocks, ...content];
              msgs[lastHumanIdx] = new HumanMessage({ content: updatedContent });

              logger.info({
                agentId: agentDef.id,
                injectedCount: missingRefs.length,
                existingCount: existingFileIds.size,
                totalSessionFiles: sessionFileRefs.length,
              }, 'Injected session file references as container_upload blocks');
            }
          }
        }
      }

      const containerUploadCount = msgs.reduce((count, m) => {
        if (!Array.isArray(m.content)) return count;
        return count + (m.content as Array<{ type?: string }>).filter(b => b.type === 'container_upload').length;
      }, 0);

      // Extract container_upload file IDs for diagnostic tracing
      const containerUploadFileIds = containerUploadCount > 0
        ? msgs.flatMap(m => {
            if (!Array.isArray(m.content)) return [];
            return (m.content as Array<{ type?: string; file_id?: string }>)
              .filter(b => b.type === 'container_upload')
              .map(b => b.file_id);
          })
        : undefined;

      logger.info({
        agentId: agentDef.id,
        messageCount: msgs.length,
        hasContainerUploads: containerUploadCount > 0,
        containerUploadCount,
        containerUploadFileIds,
        threadId: configurable?.thread_id,
        invocationId: configurable?.invocationId,
      }, 'Worker agent invocation STARTED');

      const start = Date.now();
      try {
        // Use stream with 'values' mode for step-by-step diagnostic visibility.
        // Equivalent to invoke() but yields intermediate ReAct loop states,
        // allowing us to trace exactly which step hangs (LLM call, tool execution, etc.)
        let stepCount = 0;
        let lastState: unknown;

        const stream = await originalStream(state, {
          ...config,
          streamMode: 'values',
        } as Record<string, unknown>);

        for await (const stepState of stream as AsyncIterable<Record<string, unknown>>) {
          stepCount++;
          const typedState = stepState as { messages?: BaseMessage[] };
          const stepMsgs = typedState?.messages ?? [];
          const lastMsg = stepMsgs[stepMsgs.length - 1];

          // Extract diagnostic info from last message
          const toolCalls = (lastMsg as unknown as { tool_calls?: Array<{ name?: string }> })?.tool_calls;
          const hasToolCalls = Array.isArray(toolCalls) && toolCalls.length > 0;

          logger.info({
            agentId: agentDef.id,
            step: stepCount,
            stepElapsedMs: Date.now() - start,
            lastMessageType: lastMsg?.constructor?.name ?? 'unknown',
            lastMessageName: (lastMsg as { name?: string })?.name,
            messageCount: stepMsgs.length,
            hasToolCalls,
            toolNames: hasToolCalls ? toolCalls!.map(tc => tc.name).join(',') : undefined,
          }, 'Worker agent ReAct step');

          lastState = stepState;
        }

        const finalResult = lastState as Awaited<ReturnType<typeof _originalInvoke>>;
        logger.info({
          agentId: agentDef.id,
          durationMs: Date.now() - start,
          totalSteps: stepCount,
          resultMessageCount: (finalResult as { messages?: unknown[] })?.messages?.length ?? 0,
        }, 'Worker agent invocation COMPLETED');
        return finalResult;
      } catch (error) {
        const errorInfo = error instanceof Error
          ? { message: error.message, name: error.name, code: (error as unknown as Record<string, unknown>).code }
          : { value: String(error) };
        logger.error({
          agentId: agentDef.id,
          durationMs: Date.now() - start,
          error: errorInfo,
        }, 'Worker agent invocation FAILED');
        throw error;
      }
    };

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
