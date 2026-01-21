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
  const { timeoutMs, recursionLimit = 50 } = options;

  logger.debug(
    { timeoutMs, recursionLimit },
    'Starting graph execution'
  );

  const result = await graph.invoke(inputs, {
    recursionLimit,
    signal: AbortSignal.timeout(timeoutMs),
  });

  logger.debug(
    {
      messageCount: result.messages?.length ?? 0,
      toolExecutionCount: result.toolExecutions?.length ?? 0,
    },
    'Graph execution completed'
  );

  return result;
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
