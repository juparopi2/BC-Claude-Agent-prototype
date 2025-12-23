/**
 * @module domains/agent/streaming/types
 *
 * Types for streaming domain.
 * Used by ThinkingAccumulator, ContentAccumulator, and GraphStreamProcessor.
 */

import type { StreamEvent } from '@langchain/core/tracers/log_stream';
import type { INormalizedStreamEvent } from '@shared/providers/interfaces/INormalizedEvent';
import type { IStreamAdapter } from '@shared/providers/interfaces/IStreamAdapter';
import type { RawToolExecution } from '@domains/agent/tools/types';

/**
 * Interface for ThinkingAccumulator.
 * Accumulates thinking chunks during streaming and tracks completion.
 */
export interface IThinkingAccumulator {
  /** Append a thinking chunk */
  append(chunk: string): void;

  /** Check if thinking has been marked as complete */
  isComplete(): boolean;

  /** Mark thinking as complete (called when text content starts) */
  markComplete(): void;

  /** Get accumulated thinking content */
  getContent(): string;

  /** Get number of chunks accumulated */
  getChunkCount(): number;

  /** Reset accumulator for new session */
  reset(): void;

  /** Check if any thinking has been accumulated */
  hasContent(): boolean;
}

/**
 * Interface for ContentAccumulator.
 * Accumulates message content chunks during streaming.
 */
export interface IContentAccumulator {
  /** Append a content chunk */
  append(chunk: string): void;

  /** Get accumulated content */
  getContent(): string;

  /** Get number of chunks accumulated */
  getChunkCount(): number;

  /** Reset accumulator for new session */
  reset(): void;

  /** Check if any content has been accumulated */
  hasContent(): boolean;
}

/**
 * Processed stream event types from GraphStreamProcessor.
 */
export type ProcessedStreamEvent =
  | { type: 'thinking_chunk'; content: string; blockIndex: number }
  | { type: 'message_chunk'; content: string; blockIndex: number }
  | { type: 'thinking_complete'; content: string; blockIndex: number }
  | { type: 'tool_execution'; execution: ToolExecution }
  | { type: 'turn_end'; content: string; stopReason: string }
  | { type: 'final_response'; content: string; stopReason: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number };

/**
 * Tool execution details.
 */
export interface ToolExecution {
  toolUseId: string;
  toolName: string;
  input: unknown;
  output?: unknown;
  error?: string;
}

// === StreamEventRouter Types ===

/**
 * Discriminated union of events routed from LangGraph stream.
 * StreamEventRouter separates:
 * - 'normalized': Events from StreamAdapter (on_chat_model_stream)
 * - 'tool_executions': Events from on_chain_end with toolExecutions
 */
export type RoutedEvent =
  | { type: 'normalized'; event: INormalizedStreamEvent }
  | { type: 'tool_executions'; executions: RawToolExecution[]; agentName: string };

/**
 * Interface for StreamEventRouter.
 * Routes LangGraph stream events to appropriate processors.
 */
export interface IStreamEventRouter {
  /**
   * Route events from LangGraph stream.
   * @param eventStream - Raw LangGraph streamEvents
   * @param adapter - StreamAdapter for normalizing chat model events
   * @yields RoutedEvent - Either normalized event or tool executions
   */
  route(
    eventStream: AsyncIterable<StreamEvent>,
    adapter: IStreamAdapter
  ): AsyncGenerator<RoutedEvent>;
}
