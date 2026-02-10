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
import type { NormalizedAgentEvent, NormalizedToolRequestEvent } from '@bc-agent/shared';
import type { IBatchResultNormalizer } from '@shared/providers/interfaces/IBatchResultNormalizer';
import type { IPersistenceCoordinator } from '@domains/agent/persistence';
import type { ICitationExtractor } from '@/domains/agent/citations';
import type { EventStore } from '@services/events/EventStore';
import type { ExecutionContextSync } from '../ExecutionContextSync';
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

    // Stage 2: Execute graph
    const graphResult = await graphExecutor.execute(inputs, {
      timeoutMs: options?.timeoutMs ?? ctx.timeoutMs,
    });

    // Stage 3: Normalize results
    const normalizedEvents = normalizer.normalize(graphResult, sessionId, {
      includeComplete: true,
    });

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

    // Stage 5: Process and emit events
    // Extract agentId from graph result for per-message attribution (PRD-070)
    const agentId = graphResult.currentAgentIdentity?.agentId;

    let finalContent = '';
    let finalMessageId: string = agentMessageId;
    const toolsUsed: string[] = [];

    for (const event of normalizedEvents) {
      await processNormalizedEvent(
        event,
        ctx,
        sessionId,
        agentMessageId,
        { persistenceCoordinator, citationExtractor },
        agentId
      );

      // Track state from assistant_message
      const tracked = trackAssistantMessageState(event, ctx);
      if (tracked.finalContent) {
        finalContent = tracked.finalContent;
        finalMessageId = tracked.finalMessageId!;
      }

      // Track tools used
      if (event.type === 'tool_request') {
        const toolEvent = event as NormalizedToolRequestEvent;
        toolsUsed.push(toolEvent.toolName);
      }
    }

    // Stage 6: Finalize tool lifecycle
    await ctx.toolLifecycleManager.finalizeAndPersistOrphans(sessionId, persistenceCoordinator);

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
