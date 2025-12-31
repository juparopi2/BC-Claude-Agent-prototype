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
import type { ExecuteSyncOptions } from './ExecutionContextSync';

// Re-export for convenience
export type { AgentEvent, SharedAgentExecutionResult as AgentExecutionResult };

// Re-export ExecutionContextSync types
export type { ExecutionContextSync, ExecuteSyncOptions, EventEmitCallback } from './ExecutionContextSync';

/**
 * Interface for AgentOrchestrator.
 * Main entry point for agent execution.
 */
export interface IAgentOrchestrator {
  /**
   * Execute the agent synchronously, emitting only complete messages.
   *
   * @param prompt - User's message prompt
   * @param sessionId - Session ID for conversation context
   * @param onEvent - Callback for events
   * @param userId - User ID (required for file operations)
   * @param options - Execution options (thinking, timeout)
   * @returns Promise with execution result
   */
  executeAgentSync(
    prompt: string,
    sessionId: string,
    onEvent?: (event: AgentEvent) => void,
    userId?: string,
    options?: ExecuteSyncOptions
  ): Promise<SharedAgentExecutionResult>;
}

/**
 * Dependencies for AgentOrchestrator (for testing).
 */
export interface AgentOrchestratorDependencies {
  /** File context preparation (attachments + semantic search) */
  fileContextPreparer?: IFileContextPreparer;

  /** Persistence coordination (EventStore + MessageQueue) */
  persistenceCoordinator?: IPersistenceCoordinator;
}
