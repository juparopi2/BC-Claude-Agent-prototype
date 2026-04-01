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
import type { NormalizedAgentEvent, NormalizedToolRequestEvent, NormalizedCompleteEvent, AgentIdentity } from '@bc-agent/shared';
import { isInternalTool } from '@bc-agent/shared';
import {
  AGENT_ID,
  AGENT_DISPLAY_NAME,
  AGENT_ICON,
  AGENT_COLOR,
  type AgentId,
} from '@bc-agent/shared';
import type { IDeltaNormalizer } from '@shared/providers/interfaces/IDeltaNormalizer';
import type { IPersistenceCoordinator } from '@domains/agent/persistence';
import type { ICitationExtractor } from '@/domains/agent/citations';
import type { EventStore } from '@services/events/EventStore';
import type { ExecutionContextSync } from '../ExecutionContextSync';
import { getNextEventIndex } from '../ExecutionContextSync';
import type { AgentExecutionResult } from '../types';
import type { MessageContextBuilder, MessageContextOptions } from '../context/MessageContextBuilder';
import type { GraphExecutor } from './GraphExecutor';
import {
  getSequenceDebugInfo,
  reserveAndAssignSequences,
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
  deltaNormalizer: IDeltaNormalizer;
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
   * Execute the full pipeline in progressive (streaming) mode.
   *
   * Events are emitted to the client incrementally at each graph node boundary,
   * rather than buffered until graph execution completes. This provides a
   * sub-2-second first-event latency for all turns, including direct agent
   * invocations which are handled via a single-yield streaming path.
   *
   * @param prompt - User's message prompt
   * @param sessionId - Session ID
   * @param userId - User ID
   * @param ctx - Execution context
   * @param options - Execution options
   * @returns Pipeline result
   */
  async executeProgressive(
    prompt: string,
    sessionId: string,
    userId: string,
    ctx: ExecutionContextSync,
    options?: PipelineExecutionOptions
  ): Promise<PipelineExecutionResult> {
    const {
      messageContextBuilder,
      graphExecutor,
      deltaNormalizer,
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
      'Message context built (progressive)'
    );

    // Stage 1.5: Read historical message count for delta tracking (PRD-100)
    const checkpointMessageCount = await persistenceCoordinator.getCheckpointMessageCount(sessionId);

    // Stage 2: Execute graph in streaming mode — yields one step per graph node boundary
    const streamingOptions = {
      timeoutMs: options?.timeoutMs ?? ctx.timeoutMs,
    };

    // Accumulators across all deltas
    let previousMessageCount = checkpointMessageCount;
    let previousToolExecutionCount = 0;
    let finalContent = '';
    let finalMessageId: string = agentMessageId;
    const toolsUsed: string[] = [];
    let previousAgentId: string | undefined;
    const allEmittedEvents: NormalizedAgentEvent[] = [];
    let lastStepRef: import('./GraphExecutor').StreamingGraphStep | null = null;

    try {
      for await (const step of graphExecutor.executeStreaming(inputs, streamingOptions)) {
        lastStepRef = step;

        // Delta detection: slice only NEW messages from this graph step
        const deltaMessages = step.messages.slice(previousMessageCount);
        const deltaToolExecutions = (step.toolExecutions ?? []).slice(previousToolExecutionCount);

        if (deltaMessages.length === 0 && deltaToolExecutions.length === 0) {
          logger.debug({ sessionId, stepNumber: step.stepNumber }, 'Empty delta — skipping');
          continue;
        }

        previousMessageCount = step.messages.length;
        previousToolExecutionCount = (step.toolExecutions ?? []).length;

        logger.debug({
          sessionId,
          stepNumber: step.stepNumber,
          deltaMessageCount: deltaMessages.length,
          deltaToolExecutionCount: deltaToolExecutions.length,
        }, 'Processing streaming delta');

        // Stage 3 (per delta): Normalize delta messages into events
        // NOTE: We do NOT pass isLastStep here for complete event generation.
        // Instead, the complete event is created manually after the loop ends
        // to avoid lookahead complexity and keep the approach cleaner.
        const deltaEvents = deltaNormalizer.normalizeDelta(
          { messages: deltaMessages, toolExecutions: deltaToolExecutions, isLastStep: false },
          sessionId
        );

        if (deltaEvents.length === 0) {
          logger.debug({ sessionId, stepNumber: step.stepNumber }, 'Delta normalization produced zero events — skipping');
          continue;
        }

        // Stage 4 (per delta): Reserve and assign sequence numbers incrementally
        await reserveAndAssignSequences(deltaEvents, sessionId, eventStore);

        logger.debug({
          sessionId,
          stepNumber: step.stepNumber,
          eventCount: deltaEvents.length,
          eventTypes: deltaEvents.map(e => e.type),
          assignments: getSequenceDebugInfo(deltaEvents),
        }, 'Delta events sequenced');

        // Stage 5 (per delta): Process and emit events with per-event agent attribution
        // Fallback agentId from step-level identity (used when sourceAgentId missing)
        const fallbackAgentId = step.currentAgentIdentity?.agentId;

        for (const event of deltaEvents) {
          // Per-event agent attribution: prefer sourceAgentId, fall back to step identity
          const eventAgentId = event.sourceAgentId || fallbackAgentId;

          // Emit agent_changed when agent transitions (skip for 'complete' events)
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

        allEmittedEvents.push(...deltaEvents);
      }

      // After stream loop: manually create and emit the complete event.
      // We do NOT pass isLastStep:true into normalizeDelta because DeltaNormalizer
      // returns early when messages.length === 0. The complete event is simpler
      // to construct directly here — cleaner than encoding lookahead into normalizeDelta.
      const completeEvent: NormalizedCompleteEvent = {
        type: 'complete',
        eventId: randomUUID(),
        sessionId,
        timestamp: new Date().toISOString(),
        originalIndex: allEmittedEvents.length,
        persistenceStrategy: 'transient',
        reason: 'success',
        stopReason: 'end_turn',
        usedModel: lastStepRef?.usedModel ?? undefined,
      };

      await processNormalizedEvent(
        completeEvent,
        ctx,
        sessionId,
        agentMessageId,
        { persistenceCoordinator, citationExtractor },
        undefined
      );
      allEmittedEvents.push(completeEvent);
    } catch (error) {
      // Stage 6 (on error): Finalize tool lifecycle before rethrowing
      await ctx.toolLifecycleManager.finalizeAndPersistOrphans(sessionId, persistenceCoordinator);
      throw error;
    }

    // Stage 6: Finalize tool lifecycle (normal path)
    await ctx.toolLifecycleManager.finalizeAndPersistOrphans(sessionId, persistenceCoordinator);

    // Stage 7: Update checkpoint message count for next turn (PRD-100)
    const totalMessages = lastStepRef?.messages.length ?? 0;
    if (totalMessages > 0) {
      await persistenceCoordinator.updateCheckpointMessageCount(sessionId, totalMessages);
    }

    logger.info({
      sessionId,
      totalDeltaEvents: allEmittedEvents.length,
      eventTypes: allEmittedEvents.map(e => e.type),
    }, 'Progressive pipeline completed');

    return {
      result: {
        sessionId,
        response: finalContent,
        messageId: finalMessageId,
        tokenUsage: {
          inputTokens: ctx.totalInputTokens,
          outputTokens: ctx.totalOutputTokens,
          totalTokens: ctx.totalInputTokens + ctx.totalOutputTokens,
          cacheCreationTokens: ctx.totalCacheCreationTokens || undefined,
          cacheReadTokens: ctx.totalCacheReadTokens || undefined,
        },
        toolsUsed,
        success: true,
      },
      events: allEmittedEvents,
      usedModel: lastStepRef?.usedModel ?? null,
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
