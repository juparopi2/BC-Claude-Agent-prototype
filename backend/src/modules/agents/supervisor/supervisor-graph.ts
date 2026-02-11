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
import { HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import type { LanguageModelLike } from '@langchain/core/language_models/base';
import { AGENT_ID, type AgentId } from '@bc-agent/shared';
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
  });

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
          [key: string]: unknown;
        };
      };
    };

    const userId = typedInputs.context?.userId ?? '';
    const sessionId = typedInputs.context?.sessionId ?? '';
    const messages = typedInputs.messages ?? [];

    // Get the user's prompt from the last message
    const lastMessage = messages[messages.length - 1];
    const prompt = typeof lastMessage === 'object' && lastMessage !== null && 'content' in lastMessage
      ? String((lastMessage as { content: unknown }).content)
      : '';

    // 1. Check for targetAgentId (direct agent invocation, bypass supervisor LLM)
    const targetAgentId = typedInputs.context?.options?.targetAgentId;
    if (targetAgentId && targetAgentId !== 'auto' && targetAgentId !== 'supervisor') {
      const targetAgent = agentMap.get(targetAgentId as AgentId);
      if (targetAgent) {
        logger.info(
          { targetAgentId },
          'Direct agent invocation via targetAgentId, bypassing supervisor LLM'
        );

        const agentResult = await targetAgent.agent.invoke(
          {
            messages: [new HumanMessage(prompt)],
          },
          {
            configurable: {
              thread_id: `directed-${sessionId}-${Date.now()}`,
              userId,
              invocationId: `inv-${Date.now()}`,
            },
            recursionLimit: options?.recursionLimit ?? 50,
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

    // 2. Normal flow → supervisor LLM routes (auto mode)
    logger.debug(
      { sessionId, userId, messageCount: messages.length },
      'Invoking supervisor graph'
    );

    const threadId = `session-${sessionId}`;
    const startTime = Date.now();

    let result: SupervisorState = { messages: [] };
    try {
      const invocationId = `inv-${Date.now()}`;
      const stream = await compiledSupervisor.stream(
        { messages: [new HumanMessage(prompt)] },
        {
          configurable: { thread_id: threadId, userId, invocationId },
          recursionLimit: options?.recursionLimit ?? 50,
          signal: options?.signal,
          streamMode: 'values',
        }
      );

      let stepCount = 0;
      for await (const state of stream) {
        stepCount++;
        const lastMsg = state.messages?.at(-1);
        logger.debug(
          {
            sessionId,
            step: stepCount,
            messageCount: state.messages?.length ?? 0,
            lastMessageType: lastMsg?.constructor?.name ?? 'unknown',
            lastMessageName: (lastMsg as { name?: string })?.name,
          },
          'Graph step'
        );
        result = state;
      }

      logger.info({ sessionId, totalSteps: stepCount }, 'Supervisor graph completed');
    } catch (error) {
      // Record failed invocation analytics (fire-and-forget)
      getAgentAnalyticsService().recordInvocation({
        agentId: AGENT_ID.SUPERVISOR,
        success: false,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: Date.now() - startTime,
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
