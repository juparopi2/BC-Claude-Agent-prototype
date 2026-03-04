/**
 * @module domains/agent/orchestration/execution/GraphExecutor
 *
 * Executes the LangGraph orchestrator graph with timeout handling.
 * Extracted from AgentOrchestrator (lines 304-328).
 *
 * ## Responsibilities
 *
 * 1. Execute graph.invoke() with timeout signal
 * 2. Handle execution errors
 * 3. Return AgentState result
 *
 * @example
 * ```typescript
 * const executor = new GraphExecutor(orchestratorGraph);
 * const result = await executor.execute(inputs, timeoutMs);
 * ```
 */

import type { AgentState } from '@/modules/agents/orchestrator/state';
import { createChildLogger } from '@/shared/utils/logger';
import { retryWithBackoff } from '@/shared/utils/retry';
import { isRetryableLlmError } from '@/shared/errors/LlmErrorClassifier';

const logger = createChildLogger({ service: 'GraphExecutor' });

/**
 * Graph interface for dependency injection.
 */
export interface ICompiledGraph {
  invoke(
    inputs: unknown,
    options?: {
      recursionLimit?: number;
      signal?: AbortSignal;
    }
  ): Promise<AgentState>;
}

/**
 * Graph execution options.
 */
export interface GraphExecutionOptions {
  /** Timeout in milliseconds */
  timeoutMs: number;
  /** Recursion limit for graph traversal */
  recursionLimit?: number;
}

/**
 * Execute the LangGraph orchestrator graph.
 *
 * @param graph - Compiled graph instance
 * @param inputs - Graph inputs
 * @param options - Execution options
 * @returns AgentState result
 * @throws Error if execution fails or times out
 */
export async function executeGraph(
  graph: ICompiledGraph,
  inputs: unknown,
  options: GraphExecutionOptions
): Promise<AgentState> {
  const { timeoutMs, recursionLimit = 100 } = options;

  logger.info(
    { timeoutMs, recursionLimit },
    'Starting graph execution'
  );

  const startTime = Date.now();
  try {
    const result = await retryWithBackoff(
      async () => graph.invoke(inputs, {
        recursionLimit,
        signal: AbortSignal.timeout(timeoutMs),
      }),
      {
        maxRetries: 0,
        baseDelay: 1500,
        maxDelay: 10000,
        factor: 2,
        jitter: 0.1,
        isRetryable: isRetryableLlmError,
        onRetry: (attempt, error, nextDelay) => {
          logger.warn(
            { attempt, errorMessage: error.message, nextDelayMs: nextDelay },
            'Retrying graph execution after transient LLM error'
          );
        },
      }
    );

    logger.info(
      {
        durationMs: Date.now() - startTime,
        messageCount: result.messages?.length ?? 0,
        toolExecutionCount: result.toolExecutions?.length ?? 0,
      },
      'Graph execution completed'
    );

    return result;
  } catch (error) {
    const errorInfo = error instanceof Error
      ? { message: error.message, name: error.name, code: (error as unknown as Record<string, unknown>).code }
      : { value: String(error) };
    logger.error(
      {
        durationMs: Date.now() - startTime,
        error: errorInfo,
      },
      'Graph execution failed'
    );
    throw error;
  }
}

/**
 * GraphExecutor class for dependency injection.
 */
export class GraphExecutor {
  constructor(private readonly graph: ICompiledGraph) {}

  /**
   * Execute the graph with timeout handling.
   *
   * @param inputs - Graph inputs
   * @param options - Execution options
   * @returns AgentState result
   */
  async execute(inputs: unknown, options: GraphExecutionOptions): Promise<AgentState> {
    return executeGraph(this.graph, inputs, options);
  }
}

/**
 * Create a GraphExecutor instance.
 *
 * @param graph - Compiled graph instance
 * @returns GraphExecutor instance
 */
export function createGraphExecutor(graph: ICompiledGraph): GraphExecutor {
  return new GraphExecutor(graph);
}
