/**
 * @module domains/agent/orchestration/AgentOrchestrator
 *
 * Main orchestration class that coordinates all agent execution phases.
 * Extracted from DirectAgentService.runGraph() (lines 304-1200).
 *
 * ## Stateless Architecture
 *
 * All components are STATELESS singletons. Per-execution state lives in ExecutionContext.
 * This pattern solves multi-tenant race conditions by:
 * 1. Creating a new ExecutionContext for each executeAgent() call
 * 2. Passing ctx to all stateless components
 * 3. All mutable state lives in ctx, not in singleton instances
 *
 * Benefits:
 * - Guaranteed isolation between concurrent executions
 * - Compatible with Azure Container Apps horizontal scaling
 * - Low GC pressure (~310 bytes per context base size)
 * - No cleanup required (context is garbage collected)
 *
 * Coordinates:
 * 1. FileContextPreparer - Prepares file context (attachments + semantic search)
 * 2. StreamEventRouter - Routes LangGraph events to processors
 * 3. GraphStreamProcessor - Processes normalized events (stateless)
 * 4. ToolExecutionProcessor - Handles tool execution deduplication (stateless)
 * 5. PersistenceCoordinator - Coordinates EventStore + MessageQueue
 * 6. AgentEventEmitter - Emits events with auto-incrementing index (stateless)
 * 7. UsageTracker - Tracks token usage
 *
 * @example
 * ```typescript
 * const orchestrator = getAgentOrchestrator();
 * const result = await orchestrator.executeAgent(
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
  ExecuteStreamingOptions,
  AgentExecutionResult,
  AgentEvent,
} from './types';
import type { ProcessedStreamEvent } from '@domains/agent/streaming/types';
import {
  createExecutionContext,
  getResponseContent,
  getThinkingContent,
  addUsage,
} from './ExecutionContext';
import type { ExecutionContext } from './ExecutionContext';
import { createFileContextPreparer, type IFileContextPreparer } from '@domains/agent/context';
import { createStreamEventRouter, type IStreamEventRouter } from '@domains/agent/streaming';
import { getGraphStreamProcessor } from '@domains/agent/streaming/GraphStreamProcessor';
import { getToolExecutionProcessor } from '@domains/agent/tools';
import { getPersistenceCoordinator, type IPersistenceCoordinator } from '@domains/agent/persistence';
import { getAgentEventEmitter } from '@domains/agent/emission';

/**
 * Dependencies for AgentOrchestrator (for testing).
 */
export interface AgentOrchestratorDependencies {
  fileContextPreparer?: IFileContextPreparer;
  persistenceCoordinator?: IPersistenceCoordinator;
  streamEventRouter?: IStreamEventRouter;
}

/**
 * Main orchestrator for agent execution.
 * Coordinates all phases of agent execution using stateless components.
 * All per-execution state lives in ExecutionContext.
 */
export class AgentOrchestrator implements IAgentOrchestrator {
  private readonly logger = createChildLogger({ service: 'AgentOrchestrator' });

  // Dependencies that don't hold per-execution state
  private readonly fileContextPreparer: IFileContextPreparer;
  private readonly persistenceCoordinator: IPersistenceCoordinator;
  private readonly streamEventRouter: IStreamEventRouter;

  constructor(deps?: AgentOrchestratorDependencies) {
    this.fileContextPreparer = deps?.fileContextPreparer ?? createFileContextPreparer();
    this.persistenceCoordinator = deps?.persistenceCoordinator ?? getPersistenceCoordinator();
    this.streamEventRouter = deps?.streamEventRouter ?? createStreamEventRouter();
  }

  async executeAgent(
    prompt: string,
    sessionId: string,
    onEvent?: (event: AgentEvent) => void,
    userId?: string,
    options?: ExecuteStreamingOptions
  ): Promise<AgentExecutionResult> {
    // =========================================================================
    // 1. CREATE EXECUTION CONTEXT
    // All per-execution state lives here, not in singleton components
    // =========================================================================
    const ctx = createExecutionContext(sessionId, userId ?? '', onEvent, options);

    this.logger.info(
      { sessionId, userId, executionId: ctx.executionId },
      'Starting agent execution'
    );

    // Validate userId for file operations
    if ((options?.attachments?.length || options?.enableAutoSemanticSearch) && !userId) {
      throw new Error('UserId required for file attachments or semantic search');
    }

    // Get stateless singleton components
    const graphStreamProcessor = getGraphStreamProcessor();
    const toolExecutionProcessor = getToolExecutionProcessor();
    const agentEventEmitter = getAgentEventEmitter();

    // Setup stream adapter
    const adapter = StreamAdapterFactory.create('anthropic', sessionId);

    // Prepare file context
    const contextResult = await this.fileContextPreparer.prepare(userId ?? '', prompt, options);
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
          attachments: options?.attachments,
          enableAutoSemanticSearch: options?.enableAutoSemanticSearch,
        },
      },
    };

    // =========================================================================
    // 2. EMIT SESSION_START (Signals new turn to frontend)
    // Must be emitted BEFORE user_message_confirmed to match FakeAgentOrchestrator
    // =========================================================================
    agentEventEmitter.emit(
      {
        type: 'session_start',
        sessionId,
        userId: userId ?? '',
        timestamp: new Date().toISOString(),
        eventId: randomUUID(),
        persistenceState: 'transient',
      },
      ctx
    );

    // =========================================================================
    // 3. PERSIST USER MESSAGE
    // =========================================================================
    const userMessageResult = await this.persistenceCoordinator.persistUserMessage(
      sessionId,
      prompt
    );
    agentEventEmitter.emitUserMessageConfirmed(
      sessionId,
      {
        messageId: userMessageResult.messageId,
        sequenceNumber: userMessageResult.sequenceNumber,
        eventId: userMessageResult.eventId,
        content: prompt,
        userId: userId ?? '',
      },
      ctx
    );

    const agentMessageId = randomUUID();

    try {
      // =========================================================================
      // 4. STREAM EXECUTION
      // =========================================================================
      const eventStream = await orchestratorGraph.streamEvents(inputs, {
        version: 'v2',
        recursionLimit: 50,
      });

      // Track tool execution promises for parallel processing
      const toolExecutionPromises: Promise<string[]>[] = [];
      const self = this;

      // Create generator that yields normalized events while handling tools in parallel
      async function* createNormalizedEventStream() {
        for await (const routed of self.streamEventRouter.route(eventStream, adapter)) {
          if (routed.type === 'normalized') {
            yield routed.event;
          } else if (routed.type === 'tool_executions') {
            // Process tool executions asynchronously (don't block the stream)
            // Pass ctx for deduplication and event emission
            const toolPromise = toolExecutionProcessor.processExecutions(routed.executions, ctx);
            toolExecutionPromises.push(toolPromise);
            self.logger.debug(
              { sessionId, count: routed.executions.length },
              'Tool executions dispatched'
            );
          }
        }
      }

      // =========================================================================
      // 5. PROCESS STREAM EVENTS
      // GraphStreamProcessor uses ctx for accumulation and deduplication
      // =========================================================================
      const processedEvents = graphStreamProcessor.process(createNormalizedEventStream(), ctx);

      for await (const processed of processedEvents) {
        await this.handleProcessedEvent(processed, ctx, agentEventEmitter);
      }

      // Wait for all tool executions to complete
      const allToolResults = await Promise.all(toolExecutionPromises);
      const toolsUsed = allToolResults.flat();
      if (toolsUsed.length > 0) {
        this.logger.debug(
          { sessionId, toolsUsed, count: toolsUsed.length },
          'All tool executions completed'
        );
      }

      // =========================================================================
      // 6. GET ACCUMULATED CONTENT FROM CONTEXT
      // =========================================================================
      const thinkingContent = getThinkingContent(ctx);
      const finalResponseContent = getResponseContent(ctx);
      const finalStopReason = ctx.lastStopReason;

      // =========================================================================
      // 7. PERSIST RESULTS
      // =========================================================================

      // Persist thinking if present
      if (thinkingContent) {
        await this.persistenceCoordinator.persistThinking(sessionId, {
          messageId: agentMessageId,
          content: thinkingContent,
          tokenUsage: {
            inputTokens: ctx.totalInputTokens,
            outputTokens: ctx.totalOutputTokens,
          },
        });
      }

      // Persist agent message
      const persistResult = await this.persistenceCoordinator.persistAgentMessage(sessionId, {
        messageId: agentMessageId,
        content: finalResponseContent,
        stopReason: finalStopReason,
        model: 'claude-3-5-sonnet-20241022',
        tokenUsage: {
          inputTokens: ctx.totalInputTokens,
          outputTokens: ctx.totalOutputTokens,
        },
      });

      // Emit final message event
      agentEventEmitter.emit(
        {
          type: 'message',
          content: finalResponseContent,
          messageId: agentMessageId,
          role: 'assistant',
          stopReason: finalStopReason,
          timestamp: persistResult.timestamp,
          eventId: persistResult.eventId,
          sequenceNumber: persistResult.sequenceNumber,
          persistenceState: 'persisted',
          sessionId,
        },
        ctx
      );

      // Use adapter to normalize provider-specific stopReason to canonical format
      const normalizedReason = adapter.normalizeStopReason(finalStopReason);

      // Emit complete event with normalized reason
      agentEventEmitter.emit(
        {
          type: 'complete',
          sessionId,
          timestamp: new Date().toISOString(),
          stopReason: finalStopReason,
          reason: normalizedReason,
        },
        ctx
      );

      this.logger.info(
        { sessionId, executionId: ctx.executionId, stopReason: finalStopReason },
        'Agent execution completed'
      );

      return {
        sessionId,
        response: finalResponseContent,
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
      this.logger.error({ error, sessionId, executionId: ctx.executionId }, 'Agent execution failed');

      agentEventEmitter.emitError(
        sessionId,
        error instanceof Error ? error.message : String(error),
        'EXECUTION_FAILED',
        ctx
      );

      throw error;
    }
  }

  /**
   * Handle processed stream events from GraphStreamProcessor.
   */
  private async handleProcessedEvent(
    event: ProcessedStreamEvent,
    ctx: ExecutionContext,
    emitter: ReturnType<typeof getAgentEventEmitter>
  ): Promise<void> {
    switch (event.type) {
      case 'thinking_chunk':
        emitter.emit(
          {
            type: 'thinking_chunk',
            content: event.content,
            blockIndex: event.blockIndex,
            timestamp: new Date().toISOString(),
            eventId: randomUUID(),
            persistenceState: 'transient',
            sessionId: ctx.sessionId,
          },
          ctx
        );
        break;

      case 'message_chunk':
        emitter.emit(
          {
            type: 'message_chunk',
            content: event.content,
            blockIndex: event.blockIndex,
            timestamp: new Date().toISOString(),
            eventId: randomUUID(),
            persistenceState: 'transient',
            sessionId: ctx.sessionId,
          },
          ctx
        );
        break;

      case 'thinking_complete':
        emitter.emit(
          {
            type: 'thinking_complete',
            content: event.content,
            timestamp: new Date().toISOString(),
            eventId: randomUUID(),
            persistenceState: 'transient',
            sessionId: ctx.sessionId,
          },
          ctx
        );
        break;

      case 'usage':
        addUsage(ctx, {
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
        });
        break;

      case 'tool_execution':
        // Tool executions are handled by ToolExecutionProcessor
        // via routed events, not here
        break;

      case 'final_response':
        // Captured for persistence in main flow (already in ctx)
        break;
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
