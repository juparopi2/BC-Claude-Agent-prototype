/**
 * @module domains/agent/orchestration/AgentOrchestrator
 *
 * Main orchestration class for synchronous agent execution.
 * Acts as a thin coordinator that delegates to specialized modules.
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
 * Delegates to:
 * - MessageContextBuilder - Prepares file context and attachments
 * - GraphExecutor - Executes LangGraph with timeout
 * - ExecutionPipeline - Composed execution flow
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
import { getSupervisorGraphAdapter } from '@/modules/agents/supervisor';
import { getBatchResultNormalizer, type BatchResultNormalizer } from '@shared/providers/normalizers/BatchResultNormalizer';
import { randomUUID } from 'crypto';
import type {
  IAgentOrchestrator,
  AgentExecutionResult,
  AgentEvent,
} from './types';
import {
  createExecutionContextSync,
  getNextEventIndex,
} from './ExecutionContextSync';
import type { ExecutionContextSync, ExecuteSyncOptions } from './ExecutionContextSync';
import { createFileContextPreparer, type IFileContextPreparer } from '@domains/agent/context';
import { getAttachmentContentResolver, type AttachmentContentResolver } from '@/domains/chat-attachments';
import { getChatAttachmentService } from '@/domains/chat-attachments';
import {
  getPersistenceCoordinator,
  type IPersistenceCoordinator,
} from '@domains/agent/persistence';
import { getEventStore, type EventStore } from '@services/events/EventStore';
import { getCitationExtractor, type ICitationExtractor } from '@/domains/agent/citations';
import { createMessageContextBuilder, type MessageContextBuilder } from './context/MessageContextBuilder';
import { createGraphExecutor, type GraphExecutor } from './execution/GraphExecutor';
import type { ICompiledGraph } from './execution/GraphExecutor';
import { createExecutionPipeline, type ExecutionPipeline } from './execution/ExecutionPipeline';
import { getUsageTrackingService } from '@/domains/billing/tracking/UsageTrackingService';

/**
 * Dependencies for AgentOrchestrator (for testing).
 */
export interface AgentOrchestratorDependencies {
  fileContextPreparer?: IFileContextPreparer;
  persistenceCoordinator?: IPersistenceCoordinator;
  normalizer?: BatchResultNormalizer;
  eventStore?: EventStore;
  citationExtractor?: ICitationExtractor;
  attachmentContentResolver?: AttachmentContentResolver;
  graph?: ICompiledGraph;
}

/**
 * Main orchestrator for agent execution.
 * Coordinates all phases of agent execution using stateless components.
 * All per-execution state lives in ExecutionContextSync.
 */
export class AgentOrchestrator implements IAgentOrchestrator {
  private readonly logger = createChildLogger({ service: 'AgentOrchestrator' });

  // Core dependencies
  private readonly persistenceCoordinator: IPersistenceCoordinator;
  private readonly eventStore: EventStore;

  // Composed components
  private readonly messageContextBuilder: MessageContextBuilder;
  private readonly graphExecutor: GraphExecutor;
  private readonly executionPipeline: ExecutionPipeline;

  constructor(deps?: AgentOrchestratorDependencies) {
    const fileContextPreparer = deps?.fileContextPreparer ?? createFileContextPreparer();
    this.persistenceCoordinator = deps?.persistenceCoordinator ?? getPersistenceCoordinator();
    const normalizer = deps?.normalizer ?? getBatchResultNormalizer();
    this.eventStore = deps?.eventStore ?? getEventStore();
    const citationExtractor = deps?.citationExtractor ?? getCitationExtractor();
    const attachmentContentResolver = deps?.attachmentContentResolver ?? getAttachmentContentResolver();

    // Create composed components
    this.messageContextBuilder = createMessageContextBuilder(
      fileContextPreparer,
      attachmentContentResolver
    );
    this.graphExecutor = createGraphExecutor(deps?.graph ?? getSupervisorGraphAdapter());
    this.executionPipeline = createExecutionPipeline({
      messageContextBuilder: this.messageContextBuilder,
      graphExecutor: this.graphExecutor,
      normalizer,
      persistenceCoordinator: this.persistenceCoordinator,
      eventStore: this.eventStore,
      citationExtractor,
    });
  }

  /**
   * Execute agent synchronously, emitting only complete messages.
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
    const requiresUserId = !!(options?.attachments?.length || options?.enableAutoSemanticSearch);
    if (requiresUserId && !userId) {
      throw new Error('UserId required for file attachments or semantic search');
    }

    // =========================================================================
    // 2. CREATE EXECUTION CONTEXT
    // =========================================================================
    const ctx = createExecutionContextSync(sessionId, userId ?? '', onEvent, options);

    this.logger.info(
      { sessionId, userId, executionId: ctx.executionId },
      'Starting synchronous agent execution'
    );

    // =========================================================================
    // 3. EMIT SESSION_START
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
    // 4. PERSIST USER MESSAGE
    // =========================================================================
    const userMessageResult = await this.persistenceCoordinator.persistUserMessage(
      sessionId,
      prompt,
      { chatAttachmentIds: options?.chatAttachments }
    );

    // Fetch attachment summaries for frontend rendering
    let chatAttachmentSummaries: import('@bc-agent/shared').ChatAttachmentSummary[] | undefined;
    if (options?.chatAttachments?.length && userId) {
      const attachmentService = getChatAttachmentService();
      chatAttachmentSummaries = await attachmentService.getAttachmentSummaries(
        userId,
        options.chatAttachments
      );
    }

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
      chatAttachmentIds: options?.chatAttachments,
      chatAttachments: chatAttachmentSummaries,
    });

    try {
      // =========================================================================
      // 5. DELEGATE TO EXECUTION PIPELINE
      // =========================================================================
      const pipelineResult = await this.executionPipeline.execute(
        prompt,
        sessionId,
        userId ?? '',
        ctx,
        {
          attachments: options?.attachments,
          enableAutoSemanticSearch: options?.enableAutoSemanticSearch,
          chatAttachments: options?.chatAttachments,
          enableThinking: options?.enableThinking,
          thinkingBudget: options?.thinkingBudget,
          timeoutMs: ctx.timeoutMs,
          targetAgentId: options?.targetAgentId,
        }
      );

      this.logger.info(
        { sessionId, executionId: ctx.executionId },
        'Synchronous agent execution completed'
      );

      // Fire-and-forget AI usage tracking (billing)
      const tokenUsage = pipelineResult.result.tokenUsage;
      if (userId && tokenUsage && (tokenUsage.inputTokens > 0 || tokenUsage.outputTokens > 0)) {
        getUsageTrackingService().trackClaudeUsage(
          userId,
          sessionId,
          tokenUsage.inputTokens,
          tokenUsage.outputTokens,
          pipelineResult.usedModel ?? 'unknown',
          { messageId: pipelineResult.result.messageId }
        ).catch((err: unknown) => {
          this.logger.warn({
            error: err instanceof Error ? err.message : String(err),
            userId, sessionId,
          }, 'Failed to track Claude usage (non-blocking)');
        });
      }

      return pipelineResult.result;
    } catch (error) {
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
   * Emit an event with auto-incrementing index.
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
