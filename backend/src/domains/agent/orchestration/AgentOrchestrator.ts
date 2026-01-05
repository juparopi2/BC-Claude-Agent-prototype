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
} from '@domains/agent/persistence';

/**
 * Dependencies for AgentOrchestrator (for testing).
 */
export interface AgentOrchestratorDependencies {
  fileContextPreparer?: IFileContextPreparer;
  persistenceCoordinator?: IPersistenceCoordinator;
  normalizer?: BatchResultNormalizer;
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

  constructor(deps?: AgentOrchestratorDependencies) {
    this.fileContextPreparer = deps?.fileContextPreparer ?? createFileContextPreparer();
    this.persistenceCoordinator = deps?.persistenceCoordinator ?? getPersistenceCoordinator();
    this.normalizer = deps?.normalizer ?? getBatchResultNormalizer();
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
      // 6. PROCESS EVENTS IN ORDER (no conditionals!)
      // =========================================================================
      let finalContent = '';
      let finalMessageId = agentMessageId;
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
   * Process a single normalized event: emit + persist based on strategy.
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
    // Convert to AgentEvent for emission
    const agentEvent = this.toAgentEvent(event, ctx, agentMessageId);

    // Emit to WebSocket
    this.emitEventSync(ctx, agentEvent);

    // Persist based on strategy
    switch (event.persistenceStrategy) {
      case 'transient':
        // No persistence needed
        break;

      case 'sync_required':
        await this.persistSyncEvent(event, sessionId, agentMessageId);
        break;

      case 'async_allowed':
        this.persistAsyncEvent(event, sessionId);
        break;
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
          args: toolReqEvent.args,
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
        };
      }

      default:
        // Fallback for other event types
        return baseEvent as AgentEvent;
    }
  }

  /**
   * Persist an event synchronously (for sync_required events).
   */
  private async persistSyncEvent(
    event: NormalizedAgentEvent,
    sessionId: string,
    agentMessageId: string
  ): Promise<void> {
    switch (event.type) {
      case 'thinking': {
        const thinkingEvent = event as NormalizedThinkingEvent;
        await this.persistenceCoordinator.persistThinking(sessionId, {
          messageId: agentMessageId,
          content: thinkingEvent.content,
          tokenUsage: thinkingEvent.tokenUsage ?? {
            inputTokens: 0,
            outputTokens: 0,
          },
        });
        break;
      }

      case 'assistant_message': {
        const msgEvent = event as NormalizedAssistantMessageEvent;
        const persistResult = await this.persistenceCoordinator.persistAgentMessage(sessionId, {
          messageId: agentMessageId,
          content: msgEvent.content,
          stopReason: msgEvent.stopReason,
          model: msgEvent.model,
          tokenUsage: {
            inputTokens: msgEvent.tokenUsage.inputTokens,
            outputTokens: msgEvent.tokenUsage.outputTokens,
          },
        });

        // Wait for BullMQ to complete DB write
        if (persistResult.jobId) {
          try {
            await this.persistenceCoordinator.awaitPersistence(persistResult.jobId, 10000);
          } catch (err) {
            this.logger.warn({ sessionId, jobId: persistResult.jobId, err }, 'Timeout awaiting persistence');
          }
        }
        break;
      }
    }
  }

  /**
   * Persist an event asynchronously (for async_allowed events).
   */
  private persistAsyncEvent(
    event: NormalizedAgentEvent,
    sessionId: string
  ): void {
    // Handle tool_request and tool_response events
    if (event.type === 'tool_request') {
      const toolReqEvent = event as NormalizedToolRequestEvent;
      const persistenceExec: PersistenceToolExecution = {
        toolUseId: toolReqEvent.toolUseId,
        toolName: toolReqEvent.toolName,
        toolInput: toolReqEvent.args,
        toolOutput: '', // Will be filled by tool_response
        success: true,
        timestamp: toolReqEvent.timestamp,
      };
      // Fire-and-forget
      this.persistenceCoordinator.persistToolEventsAsync(sessionId, [persistenceExec]);
    } else if (event.type === 'tool_response') {
      const toolRespEvent = event as NormalizedToolResponseEvent;
      const persistenceExec: PersistenceToolExecution = {
        toolUseId: toolRespEvent.toolUseId,
        toolName: toolRespEvent.toolName,
        toolInput: {},
        toolOutput: toolRespEvent.result ?? '',
        success: toolRespEvent.success,
        error: toolRespEvent.error,
        timestamp: toolRespEvent.timestamp,
      };
      // Fire-and-forget
      this.persistenceCoordinator.persistToolEventsAsync(sessionId, [persistenceExec]);
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
