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
import { StreamAdapterFactory } from '@shared/providers/adapters/StreamAdapterFactory';
import { HumanMessage } from '@langchain/core/messages';
import { randomUUID } from 'crypto';
import type {
  IAgentOrchestrator,
  AgentExecutionResult,
  AgentEvent,
} from './types';
import {
  createExecutionContextSync,
  setUsageSync,
  getNextEventIndex,
  markToolSeenSync,
} from './ExecutionContextSync';
import type { ExecutionContextSync, ExecuteSyncOptions } from './ExecutionContextSync';
import { extractContent } from './ResultExtractor';
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
}

/**
 * Main orchestrator for agent execution.
 * Coordinates all phases of agent execution using stateless components.
 * All per-execution state lives in ExecutionContextSync.
 */
export class AgentOrchestrator implements IAgentOrchestrator {
  private readonly logger = createChildLogger({ service: 'AgentOrchestrator' });

  // Dependencies that don't hold per-execution state
  private readonly fileContextPreparer: IFileContextPreparer;
  private readonly persistenceCoordinator: IPersistenceCoordinator;

  constructor(deps?: AgentOrchestratorDependencies) {
    this.fileContextPreparer = deps?.fileContextPreparer ?? createFileContextPreparer();
    this.persistenceCoordinator = deps?.persistenceCoordinator ?? getPersistenceCoordinator();
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
    // 1. CREATE EXECUTION CONTEXT (Simplified)
    // =========================================================================
    const ctx = createExecutionContextSync(sessionId, userId ?? '', onEvent, options);

    this.logger.info(
      { sessionId, userId, executionId: ctx.executionId },
      'Starting synchronous agent execution'
    );

    // Validate userId for file operations
    if (!userId) {
      this.logger.warn({ sessionId }, 'No userId provided, file operations disabled');
    }

    // Setup stream adapter (for stop reason normalization)
    const adapter = StreamAdapterFactory.create('anthropic', sessionId);

    // Prepare file context
    const fileOptions: ExecuteStreamingOptions = {
      enableThinking: options?.enableThinking,
      thinkingBudget: options?.thinkingBudget,
    };
    const contextResult = await this.fileContextPreparer.prepare(userId ?? '', prompt, fileOptions);
    const enhancedPrompt = contextResult.contextText
      ? `${contextResult.contextText}\n\n${prompt}`
      : prompt;

    // Build graph inputs
    const inputs = {
      messages: [new HumanMessage(enhancedPrompt)],
      activeAgent: 'orchestrator',
      sessionId,
      context: {
        userId,
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
      role: 'user',
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
      // 5. EXTRACT CONTENT FROM RESULT
      // =========================================================================
      const { thinking, content, toolExecutions, stopReason, usage } = extractContent(result);

      // Update usage in context
      setUsageSync(ctx, { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });

      // =========================================================================
      // 6. EMIT EVENTS IN STRICT ORDER
      // =========================================================================

      // 6.1 Thinking complete (if present)
      if (thinking) {
        // Persist thinking
        await this.persistenceCoordinator.persistThinking(sessionId, {
          messageId: agentMessageId,
          content: thinking,
          tokenUsage: usage,
        });

        this.emitEventSync(ctx, {
          type: 'thinking_complete',
          content: thinking,
          timestamp: new Date().toISOString(),
          eventId: randomUUID(),
          persistenceState: 'transient',
          sessionId,
        });
      }

      // 6.2 Tool events (pairs: tool_use + tool_result)
      const toolsUsed: string[] = [];
      for (const exec of toolExecutions) {
        // Check deduplication
        const { isDuplicate } = markToolSeenSync(ctx, exec.toolUseId);
        if (isDuplicate) {
          continue;
        }

        toolsUsed.push(exec.toolName);

        // Emit tool_use
        this.emitEventSync(ctx, {
          type: 'tool_use',
          toolUseId: exec.toolUseId,
          toolName: exec.toolName,
          args: exec.args,
          timestamp: new Date().toISOString(),
          eventId: randomUUID(),
          persistenceState: 'pending',
          sessionId,
        });

        // Emit tool_result
        this.emitEventSync(ctx, {
          type: 'tool_result',
          toolUseId: exec.toolUseId,
          toolName: exec.toolName,
          result: exec.result,
          success: exec.success,
          error: exec.error,
          timestamp: new Date().toISOString(),
          eventId: randomUUID(),
          persistenceState: 'pending',
          sessionId,
        });

        // Persist tool events asynchronously (fire-and-forget)
        // Map state's ToolExecution to persistence's format
        const persistenceExec: PersistenceToolExecution = {
          toolUseId: exec.toolUseId,
          toolName: exec.toolName,
          toolInput: exec.args,
          toolOutput: exec.result ?? '',
          success: exec.success,
          error: exec.error,
          timestamp: new Date().toISOString(),
        };
        this.persistenceCoordinator.persistToolEventsAsync(sessionId, [persistenceExec]).catch((err) => {
          this.logger.error({ err, toolUseId: exec.toolUseId }, 'Failed to persist tool event');
        });
      }

      // =========================================================================
      // 7. PERSIST AGENT MESSAGE
      // =========================================================================
      const persistResult = await this.persistenceCoordinator.persistAgentMessage(sessionId, {
        messageId: agentMessageId,
        content,
        stopReason,
        model: 'claude-3-5-sonnet-20241022',
        tokenUsage: usage,
      });

      // Wait for BullMQ to complete DB write
      if (persistResult.jobId) {
        try {
          await this.persistenceCoordinator.awaitPersistence(persistResult.jobId, 10000);
        } catch (err) {
          this.logger.warn({ sessionId, jobId: persistResult.jobId, err }, 'Timeout awaiting persistence');
        }
      }

      // 6.3 Final message
      this.emitEventSync(ctx, {
        type: 'message',
        content,
        messageId: agentMessageId,
        role: 'assistant',
        stopReason,
        timestamp: persistResult.timestamp,
        eventId: persistResult.eventId,
        sequenceNumber: persistResult.sequenceNumber,
        persistenceState: 'persisted',
        sessionId,
      });

      // 6.4 Complete
      const normalizedReason = adapter.normalizeStopReason(stopReason);
      this.emitEventSync(ctx, {
        type: 'complete',
        sessionId,
        timestamp: new Date().toISOString(),
        stopReason,
        reason: normalizedReason,
      });

      this.logger.info(
        { sessionId, executionId: ctx.executionId, stopReason },
        'Synchronous agent execution completed'
      );

      return {
        sessionId,
        response: content,
        messageId: agentMessageId,
        tokenUsage: {
          inputTokens: ctx.totalInputTokens,
          outputTokens: ctx.totalOutputTokens,
          totalTokens: ctx.totalInputTokens + ctx.totalOutputTokens,
        },
        toolsUsed,
        success: true,
      };
    } catch (error) {
      this.logger.error({ error, sessionId, executionId: ctx.executionId }, 'Synchronous execution failed');

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
