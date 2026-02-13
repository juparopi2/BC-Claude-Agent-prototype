/**
 * @module domains/agent/orchestration/execution/ExecutionPipeline
 *
 * Composes all execution stages into a unified pipeline.
 * Coordinates MessageContextBuilder, GraphExecutor, and EventProcessor.
 *
 * ## Pipeline Stages
 *
 * 1. Build message context (files, attachments)
 * 2. Execute graph
 * 3. Normalize results
 * 4. Pre-allocate sequences
 * 5. Process and emit events
 *
 * @example
 * ```typescript
 * const pipeline = new ExecutionPipeline(deps);
 * const result = await pipeline.execute(prompt, sessionId, ctx, options);
 * ```
 */

import { randomUUID } from 'crypto';
import type { NormalizedAgentEvent, NormalizedToolRequestEvent, AgentIdentity } from '@bc-agent/shared';
import { isInternalTool } from '@bc-agent/shared';
import {
  AGENT_ID,
  AGENT_DISPLAY_NAME,
  AGENT_ICON,
  AGENT_COLOR,
  type AgentId,
} from '@bc-agent/shared';
import type { IBatchResultNormalizer } from '@shared/providers/interfaces/IBatchResultNormalizer';
import type { IPersistenceCoordinator } from '@domains/agent/persistence';
import type { ICitationExtractor } from '@/domains/agent/citations';
import type { EventStore } from '@services/events/EventStore';
import type { ExecutionContextSync } from '../ExecutionContextSync';
import { getNextEventIndex } from '../ExecutionContextSync';
import type { AgentExecutionResult } from '../types';
import type { MessageContextBuilder, MessageContextOptions } from '../context/MessageContextBuilder';
import type { GraphExecutor } from './GraphExecutor';
import {
  countPersistableEvents,
  assignPreAllocatedSequences,
  getSequenceDebugInfo,
} from '../events/EventSequencer';
import { processNormalizedEvent, trackAssistantMessageState } from '../events/EventProcessor';
import { createChildLogger } from '@/shared/utils/logger';

const logger = createChildLogger({ service: 'ExecutionPipeline' });

/**
 * Dependencies for ExecutionPipeline.
 */
export interface ExecutionPipelineDependencies {
  messageContextBuilder: MessageContextBuilder;
  graphExecutor: GraphExecutor;
  normalizer: IBatchResultNormalizer;
  persistenceCoordinator: IPersistenceCoordinator;
  eventStore: EventStore;
  citationExtractor: ICitationExtractor;
}

/**
 * Pipeline execution options.
 */
export interface PipelineExecutionOptions extends MessageContextOptions {
  /** Timeout in milliseconds */
  timeoutMs?: number;
}

/**
 * Result of pipeline execution.
 */
export interface PipelineExecutionResult {
  /** Execution result for caller */
  result: AgentExecutionResult;
  /** Normalized events processed */
  events: NormalizedAgentEvent[];
  /** Model used by the agent (for billing) */
  usedModel: string | null;
}

/**
 * Execute the full agent pipeline.
 */
export class ExecutionPipeline {
  constructor(private readonly deps: ExecutionPipelineDependencies) {}

  /**
   * Execute the full pipeline.
   *
   * @param prompt - User's message prompt
   * @param sessionId - Session ID
   * @param userId - User ID
   * @param ctx - Execution context
   * @param options - Execution options
   * @returns Pipeline result
   */
  async execute(
    prompt: string,
    sessionId: string,
    userId: string,
    ctx: ExecutionContextSync,
    options?: PipelineExecutionOptions
  ): Promise<PipelineExecutionResult> {
    const {
      messageContextBuilder,
      graphExecutor,
      normalizer,
      persistenceCoordinator,
      eventStore,
      citationExtractor,
    } = this.deps;

    const agentMessageId = randomUUID();

    // Stage 1: Build message context
    const { inputs, contextResult } = await messageContextBuilder.build(
      prompt,
      userId,
      sessionId,
      options
    );

    logger.debug(
      {
        sessionId,
        hasContextText: !!contextResult.contextText,
        attachedFiles: contextResult.filesIncluded?.length ?? 0,
      },
      'Message context built'
    );

    // Stage 1.5: Read historical message count for delta tracking (PRD-100)
    const checkpointMessageCount = await persistenceCoordinator.getCheckpointMessageCount(sessionId);

    // Stage 2: Execute graph
    const graphResult = await graphExecutor.execute(inputs, {
      timeoutMs: options?.timeoutMs ?? ctx.timeoutMs,
    });

    // Stage 3: Normalize results (skip historical messages from previous turns)
    const normalizedEvents = normalizer.normalize(graphResult, sessionId, {
      includeComplete: true,
      skipMessages: checkpointMessageCount,
    });

    if (checkpointMessageCount > 0) {
      logger.info({
        sessionId,
        checkpointMessageCount,
        totalMessagesAfterExecution: graphResult.messages?.length ?? 0,
        newMessages: (graphResult.messages?.length ?? 0) - checkpointMessageCount,
      }, 'Delta tracking: skipping historical messages');
    }

    logger.info({
      sessionId,
      eventCount: normalizedEvents.length,
      eventTypes: normalizedEvents.map(e => e.type),
    }, 'Normalized events from graph result');

    // Stage 4: Pre-allocate sequences
    const sequencesNeeded = countPersistableEvents(normalizedEvents);
    const reservedSeqs = await eventStore.reserveSequenceNumbers(sessionId, sequencesNeeded);
    assignPreAllocatedSequences(normalizedEvents, reservedSeqs);

    logger.debug({
      sessionId,
      sequencesNeeded,
      assignments: getSequenceDebugInfo(normalizedEvents),
    }, 'Pre-allocated sequence numbers for events');

    // Stage 5: Process and emit events with per-event agent attribution
    // Fallback agentId from batch-level detection (used when sourceAgentId missing)
    const fallbackAgentId = graphResult.currentAgentIdentity?.agentId;

    let finalContent = '';
    let finalMessageId: string = agentMessageId;
    const toolsUsed: string[] = [];
    let previousAgentId: string | undefined;

    for (const event of normalizedEvents) {
      // Per-event agent attribution: prefer sourceAgentId, fall back to batch identity
      const eventAgentId = event.sourceAgentId || fallbackAgentId;

      // Emit agent_changed event when agent transitions (skip for 'complete' events)
      if (eventAgentId && eventAgentId !== previousAgentId && event.type !== 'complete') {
        emitAgentChanged(ctx, sessionId, previousAgentId, eventAgentId);

        // Persist agent transition for audit trail
        persistenceCoordinator.persistAgentChangedAsync(sessionId, {
          eventId: randomUUID(),
          previousAgentId,
          currentAgentId: eventAgentId,
          handoffType: previousAgentId ? 'agent_handoff' : 'supervisor_routing',
          timestamp: new Date().toISOString(),
        });

        previousAgentId = eventAgentId;
      }

      await processNormalizedEvent(
        event,
        ctx,
        sessionId,
        agentMessageId,
        { persistenceCoordinator, citationExtractor },
        eventAgentId
      );

      // Track state from assistant_message
      const tracked = trackAssistantMessageState(event, ctx);
      if (tracked.finalContent) {
        finalContent = tracked.finalContent;
        finalMessageId = tracked.finalMessageId!;
      }

      // Track tools used (skip internal infrastructure tools)
      if (event.type === 'tool_request') {
        const toolEvent = event as NormalizedToolRequestEvent;
        if (!isInternalTool(toolEvent.toolName)) {
          toolsUsed.push(toolEvent.toolName);
        }
      }
    }

    // Stage 6: Finalize tool lifecycle
    await ctx.toolLifecycleManager.finalizeAndPersistOrphans(sessionId, persistenceCoordinator);

    // Stage 7: Update checkpoint message count for next turn (PRD-100)
    const totalMessages = graphResult.messages?.length ?? 0;
    if (totalMessages > 0) {
      await persistenceCoordinator.updateCheckpointMessageCount(sessionId, totalMessages);
    }

    return {
      result: {
        sessionId,
        response: finalContent,
        messageId: finalMessageId,
        tokenUsage: {
          inputTokens: ctx.totalInputTokens,
          outputTokens: ctx.totalOutputTokens,
          totalTokens: ctx.totalInputTokens + ctx.totalOutputTokens,
        },
        toolsUsed,
        success: true,
      },
      events: normalizedEvents,
      usedModel: graphResult.usedModel ?? null,
    };
  }
}

/**
 * Create an ExecutionPipeline instance.
 *
 * @param deps - Pipeline dependencies
 * @returns ExecutionPipeline instance
 */
export function createExecutionPipeline(
  deps: ExecutionPipelineDependencies
): ExecutionPipeline {
  return new ExecutionPipeline(deps);
}

// ============================================================================
// Agent Changed Emission
// ============================================================================

/** Known agent IDs for identity lookup */
const KNOWN_AGENT_IDS = new Set(Object.values(AGENT_ID));

/**
 * Build AgentIdentity from an agent ID string.
 * Returns undefined if the agentId is not a known agent.
 */
function buildAgentIdentity(agentId: string): AgentIdentity | undefined {
  if (!KNOWN_AGENT_IDS.has(agentId as AgentId)) return undefined;
  const id = agentId as AgentId;
  return {
    agentId: id,
    agentName: AGENT_DISPLAY_NAME[id],
    agentIcon: AGENT_ICON[id],
    agentColor: AGENT_COLOR[id],
  };
}

/**
 * Emit an agent_changed event when the active agent transitions.
 *
 * @param ctx - Execution context with callback
 * @param sessionId - Session ID
 * @param previousAgentId - Previous agent ID (undefined for first agent)
 * @param currentAgentId - New active agent ID
 */
function emitAgentChanged(
  ctx: ExecutionContextSync,
  sessionId: string,
  previousAgentId: string | undefined,
  currentAgentId: string
): void {
  if (!ctx.callback) return;

  const currentIdentity = buildAgentIdentity(currentAgentId);
  if (!currentIdentity) return;

  const previousIdentity = previousAgentId
    ? buildAgentIdentity(previousAgentId) ?? { agentId: previousAgentId as AgentId, agentName: previousAgentId }
    : { agentId: 'supervisor' as AgentId, agentName: 'Orchestrator', agentIcon: '🎯', agentColor: '#8B5CF6' };

  ctx.callback({
    type: 'agent_changed',
    eventId: randomUUID(),
    sessionId,
    timestamp: new Date().toISOString(),
    eventIndex: getNextEventIndex(ctx),
    persistenceState: 'transient',
    previousAgent: previousIdentity,
    currentAgent: currentIdentity,
    handoffType: previousAgentId ? 'agent_handoff' : 'supervisor_routing',
  });

  logger.debug(
    {
      sessionId,
      previousAgentId,
      currentAgentId,
      currentAgentName: currentIdentity.agentName,
    },
    'Emitted agent_changed event'
  );
}
