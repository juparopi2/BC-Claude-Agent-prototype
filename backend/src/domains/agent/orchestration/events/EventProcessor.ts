/**
 * @module domains/agent/orchestration/events/EventProcessor
 *
 * Processes normalized events: persist (if required) then emit.
 * Extracted from AgentOrchestrator.processNormalizedEvent().
 *
 * ## Processing Order
 *
 * For each event:
 * 1. Get pre-allocated sequence number (assigned earlier)
 * 2. If sync_required: Persist FIRST, then emit with sequence
 * 3. Convert to AgentEvent for emission
 * 4. Set sequenceNumber and persistenceState on event
 * 5. Emit to WebSocket
 * 6. Extract citations from tool_response events
 * 7. If async_allowed: Persist AFTER emission
 *
 * @example
 * ```typescript
 * const processor = new EventProcessor(persistenceCoordinator, citationExtractor, logger);
 * await processor.processEvent(event, ctx, sessionId, agentMessageId);
 * ```
 */

import type {
  NormalizedAgentEvent,
  NormalizedAssistantMessageEvent,
  NormalizedToolResponseEvent,
} from '@bc-agent/shared';
import type { IPersistenceCoordinator, PersistedEvent } from '@domains/agent/persistence';
import type { ICitationExtractor } from '@/domains/agent/citations';
import type { ExecutionContextSync } from '../ExecutionContextSync';
import type { AgentEvent, AgentEventWithSequence } from '../types';
import { getNextEventIndex, setUsageSync } from '../ExecutionContextSync';
import { convertToAgentEvent } from './EventConverter';
import {
  persistSyncEvent,
  persistAsyncEvent,
  requiresSyncPersistence,
  allowsAsyncPersistence,
} from '../persistence/EventPersister';
import { createChildLogger } from '@/shared/utils/logger';

const logger = createChildLogger({ service: 'EventProcessor' });

/**
 * Dependencies for EventProcessor.
 */
export interface EventProcessorDependencies {
  persistenceCoordinator: IPersistenceCoordinator;
  citationExtractor: ICitationExtractor;
}

/**
 * Process a single normalized event: persist (if required) then emit.
 *
 * @param event - Normalized event to process
 * @param ctx - Execution context
 * @param sessionId - Session ID
 * @param agentMessageId - Agent message ID for thinking persistence
 * @param deps - Dependencies (persistence, citations)
 */
export async function processNormalizedEvent(
  event: NormalizedAgentEvent,
  ctx: ExecutionContextSync,
  sessionId: string,
  agentMessageId: string,
  deps: EventProcessorDependencies,
  agentId?: string
): Promise<void> {
  const { persistenceCoordinator, citationExtractor } = deps;

  // Get pre-allocated sequence number
  const preAllocatedSeq = event.preAllocatedSequenceNumber;

  // STEP 1: Persist FIRST for sync_required events
  let persistResult: PersistedEvent | undefined;
  if (requiresSyncPersistence(event)) {
    persistResult = await persistSyncEvent(
      event,
      sessionId,
      agentMessageId,
      persistenceCoordinator,
      preAllocatedSeq,
      agentId
    );
  }

  // FIX: For thinking events, use agentMessageId as eventId for consistency
  if (event.type === 'thinking') {
    event.eventId = agentMessageId;
  }

  // STEP 2: Convert to AgentEvent for emission
  const agentEvent: AgentEventWithSequence = convertToAgentEvent(event, ctx);

  // STEP 3: Set sequenceNumber from pre-allocated OR persist result
  if (preAllocatedSeq !== undefined) {
    agentEvent.sequenceNumber = preAllocatedSeq;
    agentEvent.persistenceState = event.persistenceStrategy === 'transient'
      ? 'transient'
      : 'persisted';
  } else if (persistResult?.sequenceNumber !== undefined) {
    agentEvent.persistenceState = 'persisted';
    agentEvent.sequenceNumber = persistResult.sequenceNumber;
  }

  // STEP 4: Emit to WebSocket
  emitEventSync(ctx, agentEvent);

  // STEP 5: Extract citations from tool_response events
  if (event.type === 'tool_response') {
    extractCitations(event as NormalizedToolResponseEvent, ctx, citationExtractor);
  }

  // STEP 6: Persist citations when complete event is emitted
  if (event.type === 'complete' && ctx.citedSources.length > 0 && ctx.lastAssistantMessageId) {
    persistCitations(ctx, sessionId, persistenceCoordinator);
  }

  // STEP 7: Handle async persistence
  if (allowsAsyncPersistence(event)) {
    persistAsyncEvent(event, sessionId, ctx, persistenceCoordinator, preAllocatedSeq);
  }
}

/**
 * Track state from assistant_message events.
 * Updates context with message info and token usage.
 *
 * @param event - Normalized event (may not be assistant_message)
 * @param ctx - Execution context to update
 * @returns Object with tracked state for result building
 */
export function trackAssistantMessageState(
  event: NormalizedAgentEvent,
  ctx: ExecutionContextSync
): {
  finalContent?: string;
  finalMessageId?: string;
  finalStopReason?: string;
} {
  if (event.type !== 'assistant_message') {
    return {};
  }

  const msgEvent = event as NormalizedAssistantMessageEvent;
  ctx.lastAssistantMessageId = msgEvent.messageId;
  setUsageSync(ctx, {
    inputTokens: msgEvent.tokenUsage.inputTokens,
    outputTokens: msgEvent.tokenUsage.outputTokens,
  });

  return {
    finalContent: msgEvent.content,
    finalMessageId: msgEvent.messageId,
    finalStopReason: msgEvent.stopReason,
  };
}

/**
 * Extract citations from tool_response events.
 */
function extractCitations(
  event: NormalizedToolResponseEvent,
  ctx: ExecutionContextSync,
  citationExtractor: ICitationExtractor
): void {
  if (!event.result || !citationExtractor.producesCitations(event.toolName)) {
    return;
  }

  const extractedCitations = citationExtractor.extract(event.toolName, event.result);
  if (extractedCitations.length > 0) {
    ctx.citedSources.push(...extractedCitations);
    logger.debug(
      {
        toolName: event.toolName,
        citationCount: extractedCitations.length,
        fileNames: extractedCitations.map(c => c.fileName),
      },
      'Citations extracted from tool response'
    );
  }
}

/**
 * Persist citations when complete event is emitted.
 */
function persistCitations(
  ctx: ExecutionContextSync,
  sessionId: string,
  persistenceCoordinator: IPersistenceCoordinator
): void {
  persistenceCoordinator.persistCitationsAsync(
    sessionId,
    ctx.lastAssistantMessageId!,
    ctx.citedSources.map(cite => ({
      fileName: cite.fileName,
      fileId: cite.fileId,
      sourceType: cite.sourceType,
      mimeType: cite.mimeType,
      relevanceScore: cite.relevanceScore,
      isImage: cite.isImage,
    }))
  );
  logger.info(
    {
      sessionId,
      messageId: ctx.lastAssistantMessageId,
      citationCount: ctx.citedSources.length,
    },
    'Citation persistence triggered'
  );
}

/**
 * Emit an event with auto-incrementing index.
 */
function emitEventSync(ctx: ExecutionContextSync, event: AgentEvent): void {
  if (ctx.callback) {
    const eventWithIndex = {
      ...event,
      eventIndex: getNextEventIndex(ctx),
    };
    ctx.callback(eventWithIndex);
  }
}
