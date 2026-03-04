/**
 * Supervisor Graph
 *
 * Core module that builds, compiles, and adapts the createSupervisor() graph.
 * Implements ICompiledGraph interface so it integrates seamlessly with
 * the existing GraphExecutor → ExecutionPipeline → EventProcessor chain.
 *
 * @module modules/agents/supervisor/supervisor-graph
 */

import { Command } from '@langchain/langgraph';
import { createSupervisor } from '@langchain/langgraph-supervisor';
import { HumanMessage, SystemMessage, type BaseMessage, type MessageContent } from '@langchain/core/messages';
import type { LanguageModelLike } from '@langchain/core/language_models/base';
import { AGENT_ID, type AgentId, type SessionFileReference } from '@bc-agent/shared';
import { ModelFactory } from '@/core/langchain/ModelFactory';
import { getModelConfig } from '@/infrastructure/config/models';
import type { ICompiledGraph } from '@/domains/agent/orchestration/execution/GraphExecutor';
import type { AgentState } from '../orchestrator/state';
import { buildSupervisorPrompt } from './supervisor-prompt';
import { buildReactAgents, type BuiltAgent } from './agent-builders';

import { adaptSupervisorResult, detectAgentIdentity } from './result-adapter';
import { createChildLogger } from '@/shared/utils/logger';
import { getCheckpointer } from '@/infrastructure/checkpointer';
import { getAgentAnalyticsService } from '@/domains/analytics';

const logger = createChildLogger({ service: 'SupervisorGraph' });

/** Supervisor graph state shape */
interface SupervisorState {
  messages: BaseMessage[];
}

/** Graph task with optional interrupts (from getState) */
interface GraphTask {
  interrupts?: Array<{ value: unknown }>;
}

/** Compiled supervisor graph interface (subset we actually use) */
interface CompiledSupervisorGraph {
  invoke(
    input: SupervisorState | Command,
    config?: Record<string, unknown>
  ): Promise<SupervisorState>;
  stream(
    input: SupervisorState,
    config?: Record<string, unknown>
  ): AsyncIterable<SupervisorState>;
  getState(config: Record<string, unknown>): Promise<{
    tasks?: GraphTask[];
  }>;
}

/**
 * Module-level singleton state.
 */
let compiledSupervisor: CompiledSupervisorGraph | null = null;
let agentMap: Map<AgentId, BuiltAgent> = new Map();
let initialized = false;

/**
 * Strip `container_upload` blocks from messages before the supervisor LLM sees them.
 *
 * The Anthropic API rejects `container_upload` blocks when `code_execution` is not
 * in the tools list. The supervisor only has transfer/routing tools, so it would fail.
 * Worker agents (research-agent) that DO have code_execution receive the original
 * messages from graph state — this only affects what the supervisor LLM sees.
 *
 * Replaced blocks are substituted with a text hint so the supervisor knows files
 * were attached and can route to research-agent accordingly.
 */
function stripContainerUploads(messages: BaseMessage[]): BaseMessage[] {
  // Find the last HumanMessage index — only this message gets the routing hint.
  // Historical messages: silently strip container_upload blocks (no hint) to avoid
  // biasing the supervisor toward research-agent for unrelated follow-up requests.
  let lastHumanIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m._getType() === 'human') { lastHumanIdx = i; break; }
  }

  return messages.map((msg, idx) => {
    if (msg._getType() !== 'human' || !Array.isArray(msg.content)) return msg;

    const contentBlocks = msg.content as Array<{ type: string; [key: string]: unknown }>;
    const filtered = contentBlocks.filter(block => block.type !== 'container_upload');

    if (filtered.length === contentBlocks.length) return msg; // nothing stripped

    const containerCount = contentBlocks.length - filtered.length;

    if (idx === lastHumanIdx) {
      // Current turn: add routing hint for supervisor
      logger.info(
        { containerCount, totalBlocks: contentBlocks.length, remainingBlocks: filtered.length },
        'Stripped container_upload blocks from supervisor LLM input (current turn — hint added)'
      );
      const hint = {
        type: 'text' as const,
        text: `[FILE PROCESSING REQUIRED: ${containerCount} file(s) uploaded for sandbox processing via code_execution]`,
      };
      return new HumanMessage({ content: [hint, ...filtered] });
    } else {
      // Historical turn: silently strip to avoid routing bias
      logger.debug(
        { containerCount, messageIndex: idx },
        'Stripped container_upload blocks from historical message (no hint)'
      );
      return filtered.length > 0
        ? new HumanMessage({ content: filtered })
        : msg;
    }
  });
}

/**
 * Initialize the supervisor graph.
 *
 * Called once at server startup after registerAgents().
 * Builds all ReAct agents, compiles the supervisor, and stores the singleton.
 */
export async function initializeSupervisorGraph(): Promise<void> {
  if (initialized) {
    logger.info('Supervisor graph already initialized, skipping');
    return;
  }

  logger.info('Initializing supervisor graph...');

  // 1. Build ReAct agents from registry
  const builtAgents = await buildReactAgents();

  // Store in map for direct agent invocation (targetAgentId bypass)
  agentMap = new Map();
  for (const built of builtAgents) {
    agentMap.set(built.id, built);
  }

  // 2. Create supervisor model
  const supervisorModel = await ModelFactory.create('supervisor');

  // 3. Build dynamic prompt with optional cache_control for prompt caching
  const promptText = buildSupervisorPrompt();
  const supervisorConfig = getModelConfig('supervisor');
  const prompt = supervisorConfig.promptCaching
    ? new SystemMessage({
        content: [{
          type: 'text',
          text: promptText,
          cache_control: { type: 'ephemeral' } as { type: 'ephemeral' },
        }],
      })
    : promptText;

  // 4. Get durable checkpointer (initialized in server.ts before this)
  const checkpointer = getCheckpointer();

  // 5. Create and compile supervisor
  // NOTE: Type casts required due to duplicate @langchain/core packages
  // (root node_modules has different version than backend node_modules).
  // Structurally identical at runtime. Fix: root package.json overrides.
  const workflow = createSupervisor({
    agents: builtAgents.map(a => a.agent) as Parameters<typeof createSupervisor>[0]['agents'],
    llm: supervisorModel as LanguageModelLike,
    prompt,
    addHandoffBackMessages: true,
    outputMode: 'full_history',
    // Strip container_upload blocks before the supervisor LLM processes them.
    // The original messages (with container_upload) remain in graph state and
    // propagate to worker agents like research-agent which has code_execution.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    preModelHook: (state: Record<string, any>) => {
      const messages = (state.messages ?? []) as BaseMessage[];
      return { llmInputMessages: stripContainerUploads(messages) };
    },
  } as Parameters<typeof createSupervisor>[0]);

  compiledSupervisor = workflow.compile({ checkpointer }) as unknown as CompiledSupervisorGraph;

  initialized = true;

  logger.info(
    {
      agentCount: builtAgents.length,
      agentIds: builtAgents.map(a => a.id),
    },
    'Supervisor graph initialized successfully'
  );
}

/**
 * Supervisor Graph Adapter
 *
 * Implements ICompiledGraph so it can be used as a drop-in replacement
 * for the old orchestratorGraph in GraphExecutor.
 *
 * Flow:
 * 1. Extract userId/sessionId from inputs.context
 * 2. Check for targetAgentId → direct agent invocation (bypass supervisor LLM)
 * 3. Normal → supervisor.invoke() with configurable userId
 * 4. Adapt result → AgentState for event pipeline
 */
class SupervisorGraphAdapter implements ICompiledGraph {
  async invoke(
    inputs: unknown,
    options?: { recursionLimit?: number; signal?: AbortSignal }
  ): Promise<AgentState> {
    if (!compiledSupervisor) {
      throw new Error('Supervisor graph not initialized. Call initializeSupervisorGraph() first.');
    }

    const typedInputs = inputs as {
      messages: unknown[];
      context?: {
        userId?: string;
        sessionId?: string;
        options?: {
          targetAgentId?: string;
          enableWebSearch?: boolean;
          [key: string]: unknown;
        };
      };
    };

    const userId = typedInputs.context?.userId ?? '';
    const sessionId = typedInputs.context?.sessionId ?? '';
    const messages = typedInputs.messages ?? [];

    // Get the user's message content (may be string or content block array)
    const lastMessage = messages[messages.length - 1];
    const messageContent: MessageContent =
      typeof lastMessage === 'object' && lastMessage !== null && 'content' in lastMessage
        ? (lastMessage as { content: MessageContent }).content
        : '';

    // 1. Check for targetAgentId (direct agent invocation, bypass supervisor LLM)
    const targetAgentId = typedInputs.context?.options?.targetAgentId;
    const enableWebSearch = typedInputs.context?.options?.enableWebSearch;
    const scopeFileIds = typedInputs.context?.options?.scopeFileIds as string[] | undefined;
    const chatImageEmbeddings = typedInputs.context?.options?.chatImageEmbeddings as
      | Array<{ attachmentId: string; name: string; embedding: number[] }>
      | undefined;
    const sessionFileReferences = typedInputs.context?.options?.sessionFileReferences as
      | SessionFileReference[]
      | undefined;

    if (targetAgentId && targetAgentId !== 'auto' && targetAgentId !== 'supervisor') {
      // When web search is enabled with a non-research target, fall through to supervisor
      // so it can coordinate research-agent first, then the target agent.
      if (enableWebSearch && targetAgentId !== AGENT_ID.RESEARCH_AGENT) {
        logger.info(
          { targetAgentId, sessionId },
          'Web search enabled with non-research target — using supervisor for coordination'
        );
        // Fall through to supervisor routing below
      } else {
        const targetAgent = agentMap.get(targetAgentId as AgentId);
        if (targetAgent) {
          logger.info(
            { targetAgentId },
            'Direct agent invocation via targetAgentId, bypassing supervisor LLM'
          );

          const agentResult = await targetAgent.agent.invoke(
            {
              messages: [new HumanMessage({ content: messageContent })],
            },
            {
              configurable: {
                thread_id: `directed-${sessionId}-${Date.now()}`,
                userId,
                invocationId: `inv-${Date.now()}`,
                scopeFileIds,
                chatImageEmbeddings,
                sessionFileReferences,
              },
              recursionLimit: options?.recursionLimit ?? 100,
              signal: options?.signal,
            }
          );

          return adaptSupervisorResult(agentResult as { messages: BaseMessage[] }, sessionId);
        }
        logger.debug(
          { targetAgentId },
          'targetAgentId not found in worker agentMap, using supervisor routing'
        );
      }
    }

    // 2. Normal flow → supervisor LLM routes (auto mode)
    // Note: container_upload blocks are stripped by preModelHook before the supervisor
    // LLM sees them. Worker agents (research-agent) receive the original messages
    // from graph state with container_upload blocks intact.

    // Augment prompt with web search hint when enableWebSearch is true.
    // This guides the supervisor to prefer the research-agent for the current request.
    // Preserve content blocks (string or array) — prepend hint as a text block when needed.
    const supervisorContent: MessageContent = enableWebSearch
      ? (typeof messageContent === 'string'
        ? `[WEB SEARCH ENABLED] You MUST route this request to research-agent for web research.\n\n${messageContent}`
        : [{ type: 'text' as const, text: '[WEB SEARCH ENABLED] You MUST route this request to research-agent for web research.' }, ...(Array.isArray(messageContent) ? messageContent : [])])
      : messageContent;

    if (enableWebSearch) {
      logger.info({ sessionId }, 'Web search enabled — augmenting supervisor prompt with research-agent hint');
    }

    logger.info(
      { hasScopeFileIds: !!scopeFileIds?.length, scopeCount: scopeFileIds?.length ?? 0 },
      'Invoking supervisor with scope'
    );

    const invocationId = `inv-${Date.now()}`;
    logger.info(
      { sessionId, userId, messageCount: messages.length, invocationId },
      'Invoking supervisor graph'
    );

    const threadId = `session-${sessionId}`;
    const startTime = Date.now();

    let result: SupervisorState = { messages: [] };
    let stepCount = 0;
    try {
      const stream = await compiledSupervisor.stream(
        { messages: [new HumanMessage({ content: supervisorContent })] },
        {
          configurable: { thread_id: threadId, userId, invocationId, scopeFileIds, chatImageEmbeddings, sessionFileReferences },
          recursionLimit: options?.recursionLimit ?? 100,
          signal: options?.signal,
          streamMode: 'values',
        }
      );
      let lastStepTime = startTime;
      for await (const state of stream) {
        stepCount++;
        const now = Date.now();
        const lastMsg = state.messages?.at(-1);

        // Check if current state messages contain container_upload blocks
        const stateMessages = (state.messages ?? []) as BaseMessage[];
        const hasContainerUploads = stateMessages.some(m => {
          if (!Array.isArray(m.content)) return false;
          return (m.content as Array<{ type?: string }>).some(b => b.type === 'container_upload');
        });

        logger.info(
          {
            sessionId,
            invocationId,
            step: stepCount,
            stepDurationMs: now - lastStepTime,
            totalElapsedMs: now - startTime,
            messageCount: state.messages?.length ?? 0,
            lastMessageType: lastMsg?.constructor?.name ?? 'unknown',
            lastMessageName: (lastMsg as { name?: string })?.name,
            hasContainerUploads,
          },
          'Graph step completed'
        );
        lastStepTime = now;
        result = state;
      }

      logger.info({ sessionId, totalSteps: stepCount }, 'Supervisor graph completed');
    } catch (error) {
      const totalElapsedMs = Date.now() - startTime;
      const errorInfo = error instanceof Error
        ? { message: error.message, name: error.name, code: (error as unknown as Record<string, unknown>).code }
        : { value: String(error) };
      logger.error(
        {
          sessionId,
          invocationId,
          totalSteps: stepCount,
          totalElapsedMs,
          error: errorInfo,
        },
        'Supervisor graph execution failed'
      );

      // Record failed invocation analytics (fire-and-forget)
      getAgentAnalyticsService().recordInvocation({
        agentId: AGENT_ID.SUPERVISOR,
        success: false,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: totalElapsedMs,
      });
      throw error;
    }

    // Record successful invocation analytics (fire-and-forget)
    const identity = detectAgentIdentity(result.messages);
    getAgentAnalyticsService().recordInvocation({
      agentId: identity.agentId,
      success: true,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: Date.now() - startTime,
    });

    // 3. Check for interrupts
    const state = await compiledSupervisor.getState({ configurable: { thread_id: threadId } });
    const isInterrupted = state?.tasks?.some(
      (t: GraphTask) => t.interrupts && t.interrupts.length > 0
    );

    if (isInterrupted) {
      logger.info({ sessionId, threadId }, 'Supervisor execution interrupted, awaiting user input');

      const interruptValue = state.tasks
        ?.flatMap((t: GraphTask) => t.interrupts || [])
        ?.map((i: { value: unknown }) => i.value)?.[0];

      return adaptSupervisorResult(result, sessionId, {
        isInterrupted: true,
        question: typeof interruptValue === 'string' ? interruptValue : JSON.stringify(interruptValue),
      });
    }

    return adaptSupervisorResult(result, sessionId);
  }
}

/**
 * Resume a supervisor execution after an interrupt.
 *
 * @param sessionId - Session ID (maps to thread_id)
 * @param userResponse - User's response to the interrupt
 * @returns AgentState result
 */
export async function resumeSupervisor(
  sessionId: string,
  userResponse: unknown
): Promise<AgentState> {
  if (!compiledSupervisor) {
    throw new Error('Supervisor graph not initialized');
  }

  const threadId = `session-${sessionId}`;

  logger.info({ sessionId, threadId }, 'Resuming supervisor after interrupt');

  const result = await compiledSupervisor.invoke(
    new Command({ resume: userResponse }),
    {
      configurable: { thread_id: threadId },
    }
  );

  return adaptSupervisorResult(result, sessionId);
}

/**
 * Get the SupervisorGraphAdapter singleton.
 * Implements ICompiledGraph for drop-in replacement in GraphExecutor.
 */
let adapterInstance: SupervisorGraphAdapter | null = null;

export function getSupervisorGraphAdapter(): ICompiledGraph {
  if (!adapterInstance) {
    adapterInstance = new SupervisorGraphAdapter();
  }
  return adapterInstance;
}

/**
 * Reset supervisor state (for testing).
 * @internal
 */
export function __resetSupervisorGraph(): void {
  compiledSupervisor = null;
  agentMap = new Map();
  initialized = false;
  adapterInstance = null;
}
