/**
 * @module domains/agent/orchestration/types
 *
 * Types for agent orchestration, extending @bc-agent/shared types.
 */
import type {
  AgentEvent,
  AgentExecutionResult as SharedAgentExecutionResult,
} from '@bc-agent/shared';
import type { IFileContextPreparer } from '@domains/agent/context/types';
import type { IPersistenceCoordinator } from '@domains/agent/persistence/types';
import type { IToolExecutionProcessor } from '@domains/agent/tools/types';
import type { IStreamEventRouter } from '@domains/agent/streaming/types';
import type { IGraphStreamProcessor } from '@domains/agent/streaming/GraphStreamProcessor';
import type { IAgentEventEmitter } from '@domains/agent/emission/types';
import type { IUsageTracker } from '@domains/agent/usage/types';

// Re-export for convenience
export type { AgentEvent, SharedAgentExecutionResult as AgentExecutionResult };

/**
 * Options for executeAgent method.
 * Combines thinking options with file context options.
 */
export interface ExecuteStreamingOptions {
  /**
   * Enable Extended Thinking mode.
   * When enabled, Claude will show its internal reasoning process.
   * @default false (uses env.ENABLE_EXTENDED_THINKING as fallback)
   */
  enableThinking?: boolean;

  /**
   * Budget tokens for extended thinking (minimum 1024).
   * Must be less than max_tokens.
   * @default 10000
   */
  thinkingBudget?: number;

  /**
   * List of file IDs to attach to the message context.
   * @default undefined
   */
  attachments?: string[];

  /**
   * Enable automatic semantic file search when no attachments provided.
   * Set to true to use "Use My Context" feature that searches user's files.
   * @default false
   */
  enableAutoSemanticSearch?: boolean;

  /**
   * Semantic search relevance threshold (0.0 to 1.0).
   * @default 0.7
   */
  semanticThreshold?: number;

  /**
   * Maximum files from semantic search.
   * @default 3
   */
  maxSemanticFiles?: number;
}

/**
 * Interface for AgentOrchestrator.
 * Main entry point for agent execution, replaces DirectAgentService.runGraph().
 */
export interface IAgentOrchestrator {
  /**
   * Execute the agent with streaming events.
   *
   * @param prompt - User's message prompt
   * @param sessionId - Session ID for conversation context
   * @param onEvent - Callback for streaming events
   * @param userId - User ID (required for file operations)
   * @param options - Execution options (thinking, attachments, semantic search)
   * @returns Promise with execution result
   */
  executeAgent(
    prompt: string,
    sessionId: string,
    onEvent?: (event: AgentEvent) => void,
    userId?: string,
    options?: ExecuteStreamingOptions
  ): Promise<SharedAgentExecutionResult>;
}

/**
 * Dependencies for AgentOrchestrator.
 * All dependencies are optional for testing with mocks.
 */
export interface AgentOrchestratorDependencies {
  /** File context preparation (attachments + semantic search) */
  fileContextPreparer?: IFileContextPreparer;

  /** Persistence coordination (EventStore + MessageQueue) */
  persistenceCoordinator?: IPersistenceCoordinator;

  /** Tool execution processing */
  toolExecutionProcessor?: IToolExecutionProcessor;

  /** Stream event routing (LangGraph events → processors) */
  streamEventRouter?: IStreamEventRouter;

  /** Stream processing (normalized events → processed events) */
  graphStreamProcessor?: IGraphStreamProcessor;

  /** Event emission with indexing */
  agentEventEmitter?: IAgentEventEmitter;

  /** Token usage tracking */
  usageTracker?: IUsageTracker;
}
