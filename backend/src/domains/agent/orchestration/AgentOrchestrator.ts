/**
 * @module domains/agent/orchestration/AgentOrchestrator
 *
 * Main orchestration class that coordinates all agent execution phases.
 * Extracted from DirectAgentService.runGraph() (lines 304-1200).
 *
 * Coordinates:
 * 1. FileContextPreparer - Prepares file context (attachments + semantic search)
 * 2. StreamEventRouter - Routes LangGraph events to processors
 * 3. GraphStreamProcessor - Processes normalized events
 * 4. ToolExecutionProcessor - Handles tool execution deduplication and emission
 * 5. PersistenceCoordinator - Coordinates EventStore + MessageQueue
 * 6. AgentEventEmitter - Emits events with auto-incrementing index
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
  AgentOrchestratorDependencies,
  ExecuteStreamingOptions,
  AgentExecutionResult,
  AgentEvent,
} from './types';
import type { ProcessedStreamEvent } from '@domains/agent/streaming/types';
import { createFileContextPreparer } from '@domains/agent/context';
import { createStreamEventRouter } from '@domains/agent/streaming';
import { createGraphStreamProcessor } from '@domains/agent/streaming/GraphStreamProcessor';
import { createThinkingAccumulator, createContentAccumulator } from '@domains/agent/streaming';
import { createToolEventDeduplicator } from '@domains/agent/tools';
import { createToolExecutionProcessor } from '@domains/agent/tools';
import { getPersistenceCoordinator } from '@domains/agent/persistence';
import { createAgentEventEmitter } from '@domains/agent/emission';
import { createUsageTracker } from '@domains/agent/usage';

/**
 * Main orchestrator for agent execution.
 * Coordinates all phases of agent execution in ~100 LOC.
 */
export class AgentOrchestrator implements IAgentOrchestrator {
  private readonly logger = createChildLogger({ service: 'AgentOrchestrator' });

  constructor(
    private readonly fileContextPreparer = createFileContextPreparer(),
    private readonly persistenceCoordinator = getPersistenceCoordinator(),
    private readonly toolExecutionProcessor = createToolExecutionProcessor(),
    private readonly streamEventRouter = createStreamEventRouter(),
    private readonly graphStreamProcessor = createGraphStreamProcessor(
      createThinkingAccumulator(),
      createContentAccumulator(),
      createToolEventDeduplicator()
    ),
    private readonly agentEventEmitter = createAgentEventEmitter(),
    private readonly usageTracker = createUsageTracker()
  ) {}

  async executeAgent(
    prompt: string,
    sessionId: string,
    onEvent?: (event: AgentEvent) => void,
    userId?: string,
    options?: ExecuteStreamingOptions
  ): Promise<AgentExecutionResult> {
    this.logger.info({ sessionId, userId }, 'Starting agent execution');

    // Validate userId for file operations
    if ((options?.attachments?.length || options?.enableAutoSemanticSearch) && !userId) {
      throw new Error('UserId required for file attachments or semantic search');
    }

    // Setup
    const adapter = StreamAdapterFactory.create('anthropic', sessionId);
    this.agentEventEmitter.setCallback(onEvent);
    this.usageTracker.reset();

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

    // Persist user message and emit confirmation event
    const userMessageResult = await this.persistenceCoordinator.persistUserMessage(sessionId, prompt);
    this.agentEventEmitter.emitUserMessageConfirmed(sessionId, {
      messageId: userMessageResult.messageId,
      sequenceNumber: userMessageResult.sequenceNumber,
      eventId: userMessageResult.eventId,
      content: prompt,
      userId: userId ?? '',
    });

    // Track thinking and final response
    let thinkingContent = '';
    let finalResponseContent = '';
    let finalStopReason = 'end_turn';
    const agentMessageId = randomUUID();

    try {
      // Stream execution
      const eventStream = await orchestratorGraph.streamEvents(inputs, {
        version: 'v2',
        recursionLimit: 50,
      });

      // Track tool execution promises for parallel processing
      const toolExecutionPromises: Promise<string[]>[] = [];
      const self = this;

      // Create generator that yields normalized events while handling tools in parallel
      // This ensures ContentAccumulator sees ALL events in a single stream
      async function* createNormalizedEventStream() {
        for await (const routed of self.streamEventRouter.route(eventStream, adapter)) {
          if (routed.type === 'normalized') {
            yield routed.event;
          } else if (routed.type === 'tool_executions') {
            // Process tool executions asynchronously (don't block the stream)
            const toolPromise = self.toolExecutionProcessor.processExecutions(
              routed.executions,
              { sessionId, onEvent: (event) => self.agentEventEmitter.emit(event) }
            );
            toolExecutionPromises.push(toolPromise);
            self.logger.debug(
              { sessionId, count: routed.executions.length },
              'Tool executions dispatched'
            );
          }
        }
      }

      // Process ALL normalized events through a SINGLE GraphStreamProcessor call
      // This allows ContentAccumulator to accumulate content across all events
      const processedEvents = this.graphStreamProcessor.process(
        createNormalizedEventStream(),
        { sessionId, userId: userId ?? '', enableThinking: options?.enableThinking }
      );

      for await (const processed of processedEvents) {
        await this.handleProcessedEvent(processed, sessionId);

        // Track thinking and final response
        if (processed.type === 'thinking_complete') {
          thinkingContent = processed.content;
        } else if (processed.type === 'final_response') {
          finalResponseContent = processed.content;
          finalStopReason = processed.stopReason;
        }
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

      // Persist thinking if present
      if (thinkingContent) {
        await this.persistenceCoordinator.persistThinking(sessionId, {
          messageId: agentMessageId,
          content: thinkingContent,
          tokenUsage: {
            inputTokens: this.usageTracker.getInputTokens(),
            outputTokens: this.usageTracker.getOutputTokens(),
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
          inputTokens: this.usageTracker.getInputTokens(),
          outputTokens: this.usageTracker.getOutputTokens(),
        },
      });

      // Emit final message event
      this.agentEventEmitter.emit({
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
      });

      // Emit complete event
      this.agentEventEmitter.emit({
        type: 'complete',
        sessionId,
        timestamp: new Date().toISOString(),
        stopReason: finalStopReason,
      });

      this.logger.info({ sessionId, stopReason: finalStopReason }, 'Agent execution completed');

      return {
        sessionId,
        response: finalResponseContent,
        messageId: agentMessageId,
        tokenUsage: {
          inputTokens: this.usageTracker.getInputTokens(),
          outputTokens: this.usageTracker.getOutputTokens(),
          totalTokens: this.usageTracker.getTotalTokens(),
        },
        toolsUsed: [],
        success: true,
      };
    } catch (error) {
      this.logger.error({ error, sessionId }, 'Agent execution failed');

      this.agentEventEmitter.emitError(
        sessionId,
        error instanceof Error ? error.message : String(error),
        'EXECUTION_FAILED'
      );

      throw error;
    }
  }

  /**
   * Handle processed stream events from GraphStreamProcessor.
   */
  private async handleProcessedEvent(
    event: ProcessedStreamEvent,
    sessionId: string
  ): Promise<void> {
    switch (event.type) {
      case 'thinking_chunk':
        this.agentEventEmitter.emit({
          type: 'thinking_chunk',
          content: event.content,
          blockIndex: event.blockIndex,
          timestamp: new Date().toISOString(),
          eventId: randomUUID(),
          persistenceState: 'transient',
          sessionId,
        });
        break;

      case 'message_chunk':
        this.agentEventEmitter.emit({
          type: 'message_chunk',
          content: event.content,
          blockIndex: event.blockIndex,
          timestamp: new Date().toISOString(),
          eventId: randomUUID(),
          persistenceState: 'transient',
          sessionId,
        });
        break;

      case 'thinking_complete':
        this.agentEventEmitter.emit({
          type: 'thinking_complete',
          content: event.content,
          timestamp: new Date().toISOString(),
          eventId: randomUUID(),
          persistenceState: 'transient',
          sessionId,
        });
        break;

      case 'usage':
        this.usageTracker.addUsage({
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
        });
        break;

      case 'tool_execution':
        // Tool executions are handled by ToolExecutionProcessor
        // via routed events, not here
        break;

      case 'final_response':
        // Captured for persistence in main flow
        break;
    }
  }
}

/**
 * Singleton instance.
 */
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
export function createAgentOrchestrator(
  deps?: AgentOrchestratorDependencies
): AgentOrchestrator {
  return new AgentOrchestrator(
    deps?.fileContextPreparer,
    deps?.persistenceCoordinator,
    deps?.toolExecutionProcessor,
    deps?.streamEventRouter,
    deps?.graphStreamProcessor,
    deps?.agentEventEmitter,
    deps?.usageTracker
  );
}

/**
 * Reset singleton for testing.
 * @internal Only for unit tests
 */
export function __resetAgentOrchestrator(): void {
  instance = null;
}
