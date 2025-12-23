/**
 * @module domains/agent/streaming
 *
 * Streaming domain for the agent orchestration system.
 * Handles stream processing and content accumulation.
 *
 * Implemented Classes:
 * - ThinkingAccumulator: Accumulates thinking chunks (~60 LOC)
 * - ContentAccumulator: Accumulates message chunks (~60 LOC)
 * - GraphStreamProcessor: Processes LangGraph events (~120 LOC)
 * - StreamEventRouter: Routes LangGraph events to appropriate processors (~60 LOC)
 */

// Types
export * from './types';

// Implemented classes
export {
  ThinkingAccumulator,
  createThinkingAccumulator,
} from './ThinkingAccumulator';

export {
  ContentAccumulator,
  createContentAccumulator,
} from './ContentAccumulator';

export {
  GraphStreamProcessor,
  createGraphStreamProcessor,
} from './GraphStreamProcessor';

export type {
  IGraphStreamProcessor,
  StreamProcessorContext,
} from './GraphStreamProcessor';

export {
  StreamEventRouter,
  createStreamEventRouter,
} from './StreamEventRouter';
