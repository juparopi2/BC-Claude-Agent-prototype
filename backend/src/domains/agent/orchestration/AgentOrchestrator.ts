/**
 * @module domains/agent/orchestration/AgentOrchestrator
 *
 * Main orchestration class for synchronous agent execution.
 * Uses graph.invoke() to wait for complete responses, eliminating streaming complexity.
 *
 * ## Architecture
 *
 * Per-execution state lives in ExecutionContextSync.
 * Events are emitted in strict order after execution completes:
 * 1. session_start
 * 2. user_message_confirmed
 * 3. thinking_complete (if enabled)
 * 4. tool_use + tool_result (pairs)
 * 5. message (complete response)
 * 6. complete
 *
 * Coordinates:
 * 1. FileContextPreparer - Prepares file context (attachments + semantic search)
 * 2. PersistenceCoordinator - Coordinates EventStore + MessageQueue
 *
 * @example
 * ```typescript
 * const orchestrator = getAgentOrchestrator();
 * const result = await orchestrator.executeAgentSync(
 *   'Create a sales order',
 *   sessionId,
 *   (event) => socket.emit('agent:event', event),
 *   userId,
 *   { enableThinking: true }
 * );
 * ```
 */

import { createChildLogger } from '@/shared/utils/logger';
import { orchestratorGraph } from '@/modules/agents/orchestrator/graph';
import { AnthropicAdapter } from '@shared/providers/adapters/AnthropicAdapter';
import { getBatchResultNormalizer, type BatchResultNormalizer } from '@shared/providers/normalizers/BatchResultNormalizer';
import { HumanMessage } from '@langchain/core/messages';
import { randomUUID } from 'crypto';
import type {
  IAgentOrchestrator,
  AgentExecutionResult,
  AgentEvent,
  MessageWithMetadata,
  AgentEventWithSequence,
} from './types';
import type {
  StopReason,
  NormalizedAgentEvent,
  NormalizedThinkingEvent,
  NormalizedToolRequestEvent,
  NormalizedToolResponseEvent,
  NormalizedAssistantMessageEvent,
  NormalizedCompleteEvent,
} from '@bc-agent/shared';
import {
  createExecutionContextSync,
  setUsageSync,
  getNextEventIndex,
} from './ExecutionContextSync';
import type { ExecutionContextSync, ExecuteSyncOptions } from './ExecutionContextSync';
import { createFileContextPreparer, type IFileContextPreparer } from '@domains/agent/context';
import {
  getPersistenceCoordinator,
  type IPersistenceCoordinator,
  type ToolExecution as PersistenceToolExecution,
  type PersistedEvent,
} from '@domains/agent/persistence';
import { getEventStore, type EventStore } from '@services/events/EventStore';
import { normalizeToolArgs } from '@domains/agent/tools';
import { getCitationExtractor, type ICitationExtractor } from '@/domains/agent/citations';

/**
 * Dependencies for AgentOrchestrator (for testing).
 */
export interface AgentOrchestratorDependencies {
  fileContextPreparer?: IFileContextPreparer;
  persistenceCoordinator?: IPersistenceCoordinator;
  normalizer?: BatchResultNormalizer;
  eventStore?: EventStore;
  citationExtractor?: ICitationExtractor;
}

/**
 * Main orchestrator for agent execution.
 * Coordinates all phases of agent execution using stateless components.
 * All per-execution state lives in ExecutionContextSync.
 *
 * ## Event Normalization Architecture
 *
 * Uses BatchResultNormalizer to convert graph results into normalized events:
 * 1. graph.invoke() returns AgentState
 * 2. BatchResultNormalizer.normalize() converts to NormalizedAgentEvent[]
 * 3. Events are processed in order without conditional logic
 * 4. Each event is emitted and persisted based on its strategy
 */
export class AgentOrchestrator implements IAgentOrchestrator {
  private readonly logger = createChildLogger({ service: 'AgentOrchestrator' });

  // Dependencies that don't hold per-execution state
  private readonly fileContextPreparer: IFileContextPreparer;
  private readonly persistenceCoordinator: IPersistenceCoordinator;
  private readonly normalizer: BatchResultNormalizer;
  private readonly eventStore: EventStore;
  private readonly citationExtractor: ICitationExtractor;

  constructor(deps?: AgentOrchestratorDependencies) {
    this.fileContextPreparer = deps?.fileContextPreparer ?? createFileContextPreparer();
    this.persistenceCoordinator = deps?.persistenceCoordinator ?? getPersistenceCoordinator();
    this.normalizer = deps?.normalizer ?? getBatchResultNormalizer();
    this.eventStore = deps?.eventStore ?? getEventStore();
    this.citationExtractor = deps?.citationExtractor ?? getCitationExtractor();
  }

  /**
   * Execute agent synchronously, emitting only complete messages.
   *
   * Uses graph.invoke() instead of streamEvents() to wait for complete response.
   * Events are emitted in strict order after execution completes:
   * 1. session_start
   * 2. user_message_confirmed
   * 3. thinking_complete (if thinking enabled)
   * 4. tool_use + tool_result (pairs, in execution order)
   * 5. message (complete response)
   * 6. complete
   *
   * @param prompt - User message
   * @param sessionId - Session ID
   * @param onEvent - Callback for event emission
   * @param userId - User ID for multi-tenant isolation
   * @param options - Execution options
   * @returns Execution result
   */
  async executeAgentSync(
    prompt: string,
    sessionId: string,
    onEvent?: (event: AgentEvent) => void,
    userId?: string,
    options?: ExecuteSyncOptions
  ): Promise<AgentExecutionResult> {
    // =========================================================================
    // 1. INPUT VALIDATION
    // =========================================================================
    // Early validation: userId is REQUIRED for file operations
    const requiresUserId = !!(options?.attachments?.length || options?.enableAutoSemanticSearch);
    if (requiresUserId && !userId) {
      throw new Error('UserId required for file attachments or semantic search');
    }

    // =========================================================================
    // 2. CREATE EXECUTION CONTEXT (Simplified)
    // =========================================================================
    const ctx = createExecutionContextSync(sessionId, userId ?? '', onEvent, options);

    this.logger.info(
      { sessionId, userId, executionId: ctx.executionId },
      'Starting synchronous agent execution'
    );

    // Setup provider adapter for batch result normalization
    const adapter = new AnthropicAdapter(sessionId);

    // Prepare file context (options for attachments and semantic search)
    // Note: Thinking options are passed to the graph, not to file context preparer
    const contextResult = await this.fileContextPreparer.prepare(userId ?? '', prompt, {
      attachments: options?.attachments,
      enableAutoSemanticSearch: options?.enableAutoSemanticSearch,
    });
    const enhancedPrompt = contextResult.contextText
      ? `${contextResult.contextText}\n\n${prompt}`
      : prompt;

    // Build graph inputs
    const inputs = {
      messages: [new HumanMessage(enhancedPrompt)],
      activeAgent: 'orchestrator',
      context: {
        userId,
        sessionId,
        fileContext: contextResult,
        options: {
          enableThinking: options?.enableThinking ?? false,
          thinkingBudget: options?.thinkingBudget ?? 10000,
        },
      },
    };

    // =========================================================================
    // 2. EMIT SESSION_START
    // =========================================================================
    this.emitEventSync(ctx, {
      type: 'session_start',
      sessionId,
      userId: userId ?? '',
      timestamp: new Date().toISOString(),
      eventId: randomUUID(),
      persistenceState: 'transient',
    });

    // =========================================================================
    // 3. PERSIST USER MESSAGE
    // =========================================================================
    const userMessageResult = await this.persistenceCoordinator.persistUserMessage(
      sessionId,
      prompt
    );
    this.emitEventSync(ctx, {
      type: 'user_message_confirmed',
      sessionId,
      messageId: userMessageResult.messageId,
      sequenceNumber: userMessageResult.sequenceNumber,
      eventId: userMessageResult.eventId,
      content: prompt,
      userId: userId ?? '',
      timestamp: new Date().toISOString(),
      persistenceState: 'persisted',
    });

    const agentMessageId = randomUUID();

    try {
      // =========================================================================
      // 4. EXECUTE GRAPH (Synchronous - waits for complete response)
      // =========================================================================
      const result = await orchestratorGraph.invoke(inputs, {
        recursionLimit: 50,
        signal: AbortSignal.timeout(ctx.timeoutMs),
      });

      // DEBUG: Log raw Anthropic response structure
      this.logger.debug({
        sessionId,
        rawMessageCount: result.messages?.length ?? 0,
        rawMessages: result.messages?.map((msg, idx) => {
          const msgWithMeta = msg as MessageWithMetadata;
          return {
            index: idx,
            type: msg._getType?.(),
            contentType: typeof msg.content,
            blockCount: Array.isArray(msg.content) ? msg.content.length : 1,
            stopReason: msgWithMeta.response_metadata?.stop_reason,
            messageId: msgWithMeta.id,
          };
        }),
      }, 'RAW_ANTHROPIC: Graph invoke result');

      // =========================================================================
      // 5. NORMALIZE RESULT (replaces extractContent)
      // =========================================================================
      const normalizedEvents = this.normalizer.normalize(result, adapter, {
        includeComplete: true,
      });

      // Diagnostic logging
      this.logger.info({
        eventCount: normalizedEvents.length,
        eventTypes: normalizedEvents.map(e => e.type),
        messagesCount: result.messages?.length ?? 0,
        enableThinking: options?.enableThinking,
        thinkingBudget: options?.thinkingBudget,
      }, 'Normalized events from graph result');

      // =========================================================================
      // 5.1 PRE-ALLOCATE SEQUENCE NUMBERS (fixes race condition)
      // =========================================================================
      // Count events that need persistence (non-transient events)
      // Each tool needs 2 sequences: tool_use_requested + tool_use_completed
      let sequencesNeeded = 0;
      for (const event of normalizedEvents) {
        if (event.persistenceStrategy !== 'transient') {
          sequencesNeeded++;
        }
      }

      // Reserve all sequences atomically via Redis INCRBY
      const reservedSeqs = await this.eventStore.reserveSequenceNumbers(
        sessionId,
        sequencesNeeded
      );

      // Assign pre-allocated sequences to events in order
      let seqIndex = 0;
      for (const event of normalizedEvents) {
        if (event.persistenceStrategy !== 'transient') {
          event.preAllocatedSequenceNumber = reservedSeqs[seqIndex++];
        }
      }

      this.logger.debug({
        sessionId,
        sequencesNeeded,
        reservedSeqs,
        assignments: normalizedEvents.map(e => ({
          type: e.type,
          seq: e.preAllocatedSequenceNumber,
        })),
      }, 'Pre-allocated sequence numbers for events');

      // =========================================================================
      // 6. PROCESS EVENTS IN ORDER (no conditionals!)
      // =========================================================================
      let finalContent = '';
      let finalMessageId: string = agentMessageId;
      const toolsUsed: string[] = [];
      let finalStopReason: string = 'end_turn';

      for (const event of normalizedEvents) {
        await this.processNormalizedEvent(ctx, event, sessionId, agentMessageId);

        // Track state for result
        if (event.type === 'assistant_message') {
          const msgEvent = event as NormalizedAssistantMessageEvent;
          finalContent = msgEvent.content;
          finalMessageId = msgEvent.messageId;
          finalStopReason = msgEvent.stopReason;
          // Store messageId for citation association in CompleteEvent
          ctx.lastAssistantMessageId = msgEvent.messageId;
          setUsageSync(ctx, {
            inputTokens: msgEvent.tokenUsage.inputTokens,
            outputTokens: msgEvent.tokenUsage.outputTokens,
          });
        }
        if (event.type === 'tool_request') {
          const toolEvent = event as NormalizedToolRequestEvent;
          toolsUsed.push(toolEvent.toolName);
        }
      }

      this.logger.info(
        { sessionId, executionId: ctx.executionId, stopReason: finalStopReason },
        'Synchronous agent execution completed'
      );

      // =========================================================================
      // 7. FINALIZE TOOL LIFECYCLE (persist any orphaned tools)
      // =========================================================================
      await ctx.toolLifecycleManager.finalizeAndPersistOrphans(
        sessionId,
        this.persistenceCoordinator
      );

      return {
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
      };
    } catch (error) {
      // Serialize error properly - Error objects don't serialize to JSON by default
      const errorInfo = error instanceof Error
        ? { message: error.message, stack: error.stack, name: error.name, cause: error.cause }
        : { value: String(error) };
      this.logger.error({ error: errorInfo, sessionId, executionId: ctx.executionId }, 'Synchronous execution failed');

      this.emitEventSync(ctx, {
        type: 'error',
        sessionId,
        error: error instanceof Error ? error.message : String(error),
        code: 'EXECUTION_FAILED',
        timestamp: new Date().toISOString(),
        eventId: randomUUID(),
        persistenceState: 'transient',
      });

      throw error;
    }
  }

  /**
   * Emit an event with auto-incrementing index (for sync execution).
   */
  private emitEventSync(ctx: ExecutionContextSync, event: AgentEvent): void {
    if (ctx.callback) {
      const eventWithIndex = {
        ...event,
        eventIndex: getNextEventIndex(ctx),
      };
      ctx.callback(eventWithIndex);
    }
  }

  /**
   * Process a single normalized event: persist (if required) then emit.
   *
   * CRITICAL: Events now have pre-allocated sequence numbers from Phase 5.1.
   * This fixes the race condition where async tool events would get sequence
   * numbers after sync events had already been emitted.
   *
   * This is the key simplification: one method handles all event types
   * based on their persistenceStrategy, not their type.
   */
  private async processNormalizedEvent(
    ctx: ExecutionContextSync,
    event: NormalizedAgentEvent,
    sessionId: string,
    agentMessageId: string
  ): Promise<void> {
    // Get pre-allocated sequence number (assigned in Phase 5.1)
    const preAllocatedSeq = event.preAllocatedSequenceNumber;

    // STEP 1: Persist FIRST for sync_required events (with pre-allocated seq)
    let persistResult: PersistedEvent | undefined;
    if (event.persistenceStrategy === 'sync_required') {
      persistResult = await this.persistSyncEvent(event, sessionId, agentMessageId, preAllocatedSeq);
    }

    // FIX: For thinking events, use agentMessageId as eventId for consistency with persistence
    // This ensures the emitted eventId matches the messageId stored in DB
    if (event.type === 'thinking') {
      event.eventId = agentMessageId;
    }

    // STEP 2: Convert to AgentEvent for emission
    const agentEvent: AgentEventWithSequence = this.toAgentEvent(event, ctx, agentMessageId);

    // STEP 3: Set sequenceNumber from pre-allocated OR persist result
    // Pre-allocated takes precedence for consistent ordering
    if (preAllocatedSeq !== undefined) {
      agentEvent.sequenceNumber = preAllocatedSeq;
      agentEvent.persistenceState = event.persistenceStrategy === 'transient'
        ? 'transient'
        : 'persisted';
    } else if (persistResult?.sequenceNumber !== undefined) {
      agentEvent.persistenceState = 'persisted';
      agentEvent.sequenceNumber = persistResult.sequenceNumber;
    }

    // STEP 4: Emit to WebSocket (now with correct sequenceNumber)
    this.emitEventSync(ctx, agentEvent);

    // STEP 4.1: Extract citations from tool_response events (for RAG tools)
    if (event.type === 'tool_response') {
      const toolRespEvent = event as NormalizedToolResponseEvent;
      if (toolRespEvent.result && this.citationExtractor.producesCitations(toolRespEvent.toolName)) {
        const extractedCitations = this.citationExtractor.extract(
          toolRespEvent.toolName,
          toolRespEvent.result
        );
        if (extractedCitations.length > 0) {
          ctx.citedSources.push(...extractedCitations);
          this.logger.debug(
            {
              toolName: toolRespEvent.toolName,
              citationCount: extractedCitations.length,
              fileNames: extractedCitations.map(c => c.fileName),
            },
            'Citations extracted from tool response'
          );
        }
      }
    }

    // STEP 4.2: Persist citations asynchronously when complete event is emitted
    if (event.type === 'complete' && ctx.citedSources.length > 0 && ctx.lastAssistantMessageId) {
      this.persistenceCoordinator.persistCitationsAsync(
        sessionId,
        ctx.lastAssistantMessageId,
        ctx.citedSources.map(cite => ({
          fileName: cite.fileName,
          fileId: cite.fileId,
          sourceType: cite.sourceType,
          mimeType: cite.mimeType,
          relevanceScore: cite.relevanceScore,
          isImage: cite.isImage,
        }))
      );
      this.logger.info(
        {
          sessionId,
          messageId: ctx.lastAssistantMessageId,
          citationCount: ctx.citedSources.length,
        },
        'Citation persistence triggered'
      );
    }

    // STEP 5: Handle async persistence (tools) with pre-allocated seq
    if (event.persistenceStrategy === 'async_allowed') {
      this.persistAsyncEvent(event, sessionId, ctx, preAllocatedSeq);
    }
  }

  /**
   * Convert NormalizedAgentEvent to AgentEvent for WebSocket emission.
   */
  private toAgentEvent(
    normalized: NormalizedAgentEvent,
    _ctx: ExecutionContextSync,
    _agentMessageId: string
  ): AgentEvent {
    // Base event fields
    const baseEvent = {
      eventId: normalized.eventId,
      sessionId: normalized.sessionId,
      timestamp: normalized.timestamp,
      persistenceState: normalized.persistenceStrategy === 'transient'
        ? 'transient' as const
        : 'pending' as const,
    };

    switch (normalized.type) {
      case 'thinking': {
        const thinkingEvent = normalized as NormalizedThinkingEvent;
        return {
          ...baseEvent,
          type: 'thinking_complete' as const,
          content: thinkingEvent.content,
        };
      }

      case 'tool_request': {
        const toolReqEvent = normalized as NormalizedToolRequestEvent;
        return {
          ...baseEvent,
          type: 'tool_use' as const,
          toolName: toolReqEvent.toolName,
          toolUseId: toolReqEvent.toolUseId,
          args: normalizeToolArgs(toolReqEvent.args, toolReqEvent.toolName),
        };
      }

      case 'tool_response': {
        const toolRespEvent = normalized as NormalizedToolResponseEvent;
        return {
          ...baseEvent,
          type: 'tool_result' as const,
          toolName: toolRespEvent.toolName,
          toolUseId: toolRespEvent.toolUseId,
          result: toolRespEvent.result ?? '',
          success: toolRespEvent.success,
          error: toolRespEvent.error,
        };
      }

      case 'assistant_message': {
        const msgEvent = normalized as NormalizedAssistantMessageEvent;
        return {
          ...baseEvent,
          type: 'message' as const,
          content: msgEvent.content,
          messageId: msgEvent.messageId,
          role: 'assistant' as const,
          stopReason: msgEvent.stopReason as StopReason,
          model: msgEvent.model,
          tokenUsage: {
            inputTokens: msgEvent.tokenUsage.inputTokens,
            outputTokens: msgEvent.tokenUsage.outputTokens,
          },
        };
      }

      case 'complete': {
        const completeEvent = normalized as NormalizedCompleteEvent;
        return {
          ...baseEvent,
          type: 'complete' as const,
          reason: completeEvent.reason,
          stopReason: completeEvent.stopReason,
          // Include cited files from RAG tool results (if any)
          citedFiles: _ctx.citedSources.length > 0 ? _ctx.citedSources : undefined,
          // Include messageId for citation association on frontend
          messageId: _ctx.lastAssistantMessageId ?? undefined,
        };
      }

      default:
        // Fallback for other event types
        return baseEvent as AgentEvent;
    }
  }

  /**
   * Persist an event synchronously (for sync_required events).
   * Uses pre-allocated sequence number if provided for deterministic ordering.
   * Returns PersistedEvent with sequenceNumber for updating the emitted event.
   */
  private async persistSyncEvent(
    event: NormalizedAgentEvent,
    sessionId: string,
    agentMessageId: string,
    preAllocatedSeq?: number
  ): Promise<PersistedEvent | undefined> {
    switch (event.type) {
      case 'thinking': {
        const thinkingEvent = event as NormalizedThinkingEvent;
        const result = await this.persistenceCoordinator.persistThinking(
          sessionId,
          {
            messageId: agentMessageId,
            content: thinkingEvent.content,
            tokenUsage: thinkingEvent.tokenUsage ?? {
              inputTokens: 0,
              outputTokens: 0,
            },
          },
          preAllocatedSeq
        );
        return result;
      }

      case 'assistant_message': {
        const msgEvent = event as NormalizedAssistantMessageEvent;
        // FIX: Use Anthropic's messageId (msg_*) This ensures each assistant message gets a unique ID for persistence
        const persistResult = await this.persistenceCoordinator.persistAgentMessage(
          sessionId,
          {
            messageId: msgEvent.messageId,
            content: msgEvent.content,
            stopReason: msgEvent.stopReason,
            model: msgEvent.model,
            tokenUsage: {
              inputTokens: msgEvent.tokenUsage.inputTokens,
              outputTokens: msgEvent.tokenUsage.outputTokens,
            },
          },
          preAllocatedSeq
        );

        // Wait for BullMQ to complete DB write
        if (persistResult.jobId) {
          try {
            await this.persistenceCoordinator.awaitPersistence(persistResult.jobId, 10000);
          } catch (err) {
            this.logger.warn({ sessionId, jobId: persistResult.jobId, err }, 'Timeout awaiting persistence');
          }
        }
        return persistResult;
      }

      default:
        return undefined;
    }
  }

  /**
   * Persist an event asynchronously (for async_allowed events).
   *
   * Uses ToolLifecycleManager for unified persistence:
   * - tool_request: Register in memory with pre-allocated sequence, DO NOT persist yet
   * - tool_response: Combine with stored request, persist with complete input+output and sequences
   *
   * This fixes the bug where tool_request and tool_response were persisted separately,
   * resulting in 5+ events per tool instead of 2.
   */
  private persistAsyncEvent(
    event: NormalizedAgentEvent,
    sessionId: string,
    ctx: ExecutionContextSync,
    preAllocatedSeq?: number
  ): void {
    // Handle tool_request: Register in lifecycle manager with pre-allocated seq, NO persistence yet
    if (event.type === 'tool_request') {
      const toolReqEvent = event as NormalizedToolRequestEvent;

      // Normalize args to ensure they are always an object (handles double-serialization bug)
      const normalizedArgs = normalizeToolArgs(toolReqEvent.args, toolReqEvent.toolName);

      // Register tool request in memory - will be combined with response later
      // Pass preAllocatedSeq to store it for later persistence
      ctx.toolLifecycleManager.onToolRequested(
        sessionId,
        toolReqEvent.toolUseId,
        toolReqEvent.toolName,
        normalizedArgs,
        preAllocatedSeq
      );

      this.logger.debug(
        {
          toolUseId: toolReqEvent.toolUseId,
          toolName: toolReqEvent.toolName,
          preAllocatedSeq,
        },
        'Tool request registered in lifecycle manager (awaiting response)'
      );
      return; // DO NOT persist yet - wait for tool_response
    }

    // Handle tool_response: Complete and persist with unified input+output and sequences
    if (event.type === 'tool_response') {
      const toolRespEvent = event as NormalizedToolResponseEvent;

      // Complete the tool lifecycle and get unified state (includes stored preAllocatedSeq)
      const completeState = ctx.toolLifecycleManager.onToolCompleted(
        sessionId,
        toolRespEvent.toolUseId,
        toolRespEvent.result ?? '',
        toolRespEvent.success,
        toolRespEvent.error,
        preAllocatedSeq // tool_response's pre-allocated sequence
      );

      if (completeState) {
        // NOW persist with complete input+output
        const persistenceExec: PersistenceToolExecution = {
          toolUseId: completeState.toolUseId,
          toolName: completeState.toolName,
          toolInput: completeState.args,           // From tool_request
          toolOutput: completeState.result ?? '',   // From tool_response
          success: completeState.state === 'completed',
          error: completeState.error,
          timestamp: completeState.completedAt?.toISOString() ?? new Date().toISOString(),
          // Pre-allocated sequences for deterministic ordering
          preAllocatedToolUseSeq: completeState.preAllocatedToolUseSeq,
          preAllocatedToolResultSeq: completeState.preAllocatedToolResultSeq,
        };

        // Fire-and-forget persistence with unified data and pre-allocated sequences
        this.persistenceCoordinator.persistToolEventsAsync(sessionId, [persistenceExec]);

        this.logger.debug(
          {
            toolUseId: completeState.toolUseId,
            toolName: completeState.toolName,
            hasInput: Object.keys(completeState.args).length > 0,
            hasOutput: !!completeState.result,
            success: completeState.state === 'completed',
            preAllocatedToolUseSeq: completeState.preAllocatedToolUseSeq,
            preAllocatedToolResultSeq: completeState.preAllocatedToolResultSeq,
          },
          'Tool persisted with unified input+output and pre-allocated sequences'
        );
      } else {
        // Orphan response - tool_response without matching tool_request
        this.logger.warn(
          { toolUseId: toolRespEvent.toolUseId },
          'Tool response without matching request - skipping persistence'
        );
      }
    }
  }
}

// ============================================================================
// Singleton Pattern
// ============================================================================

let instance: AgentOrchestrator | null = null;

/**
 * Get the singleton AgentOrchestrator instance.
 */
export function getAgentOrchestrator(): AgentOrchestrator {
  if (!instance) {
    instance = createAgentOrchestrator();
  }
  return instance;
}

/**
 * Create a new AgentOrchestrator instance.
 * Allows dependency injection for testing.
 */
export function createAgentOrchestrator(deps?: AgentOrchestratorDependencies): AgentOrchestrator {
  return new AgentOrchestrator(deps);
}

/**
 * Reset singleton for testing.
 * @internal Only for unit tests
 */
export function __resetAgentOrchestrator(): void {
  instance = null;
}
