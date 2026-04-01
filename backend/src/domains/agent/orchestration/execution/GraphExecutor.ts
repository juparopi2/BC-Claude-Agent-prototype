/**
 * @module domains/agent/orchestration/execution/GraphExecutor
 *
 * Executes the LangGraph orchestrator graph in streaming mode.
 *
 * ## Responsibilities
 *
 * 1. Execute graph.stream() with timeout signal
 * 2. Yield one StreamingGraphStep per graph node boundary
 * 3. Handle execution errors
 *
 * @example
 * ```typescript
 * const executor = createGraphExecutor(supervisorGraphAdapter);
 * for await (const step of executor.executeStreaming(inputs, { timeoutMs: 60000 })) {
 *   // process step
 * }
 * ```
 */

import type { BaseMessage } from '@langchain/core/messages';
import type { ToolExecution } from '@/modules/agents/orchestrator/state';
import { createChildLogger } from '@/shared/utils/logger';

const logger = createChildLogger({ service: 'GraphExecutor' });

/**
 * A single step yielded during streaming graph execution.
 * Contains the full accumulated state at that graph node boundary.
 */
export interface StreamingGraphStep {
  /** Full accumulated messages array at this graph node boundary */
  messages: BaseMessage[];
  /** Tool executions accumulated so far */
  toolExecutions: ToolExecution[];
  /** Step number (1-based) */
  stepNumber: number;
  /** Model used at this step (from state.usedModel) */
  usedModel: string | null;
  /** Full accumulated agent identity for attribution */
  currentAgentIdentity?: import('@bc-agent/shared').AgentIdentity;
}

/**
 * Interface for graphs that support progressive streaming delivery.
 * GraphExecutor.executeStreaming() uses this interface for all execution.
 */
export interface IStreamableGraph {
  stream(
    inputs: unknown,
    options?: {
      recursionLimit?: number;
      signal?: AbortSignal;
    }
  ): AsyncIterable<StreamingGraphStep>;
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
 * GraphExecutor class for dependency injection.
 */
export class GraphExecutor {
  constructor(private readonly graph: IStreamableGraph) {}

  /**
   * Execute the graph in streaming mode, yielding one StreamingGraphStep per graph node boundary.
   *
   * @param inputs - Graph inputs
   * @param options - Execution options
   * @yields StreamingGraphStep for each graph step
   */
  async *executeStreaming(
    inputs: unknown,
    options: GraphExecutionOptions
  ): AsyncIterable<StreamingGraphStep> {
    const { timeoutMs, recursionLimit = 100 } = options;

    if (typeof this.graph.stream !== 'function') {
      throw new Error('Graph does not support streaming.');
    }

    const signal = AbortSignal.timeout(timeoutMs);
    let stepNumber = 0;
    const startTime = Date.now();

    logger.info(
      { timeoutMs, recursionLimit },
      'Starting streaming graph execution'
    );

    try {
      for await (const state of this.graph.stream(inputs, { recursionLimit, signal })) {
        stepNumber++;
        logger.debug(
          {
            stepNumber,
            messageCount: state.messages?.length ?? 0,
            durationMs: Date.now() - startTime,
          },
          'Streaming graph step'
        );
        yield state;
      }

      logger.info(
        { totalSteps: stepNumber, durationMs: Date.now() - startTime },
        'Streaming graph execution completed'
      );
    } catch (error) {
      const errorInfo = error instanceof Error
        ? { message: error.message, name: error.name }
        : { value: String(error) };
      logger.error(
        {
          stepNumber,
          durationMs: Date.now() - startTime,
          error: errorInfo,
        },
        'Streaming graph execution failed'
      );
      throw error;
    }
  }
}

/**
 * Create a GraphExecutor instance.
 *
 * @param graph - Streamable graph instance
 * @returns GraphExecutor instance
 */
export function createGraphExecutor(graph: IStreamableGraph): GraphExecutor {
  return new GraphExecutor(graph);
}
