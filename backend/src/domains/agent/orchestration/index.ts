/**
 * @module domains/agent/orchestration
 *
 * Orchestration domain for the agent execution system.
 * Main entry point that coordinates all agent execution phases.
 *
 * ## Architecture
 *
 * Modular design with separation of concerns:
 * - AgentOrchestrator: Main coordinator (~150 LOC)
 * - EventConverter: NormalizedEvent -> AgentEvent conversion
 * - EventSequencer: Sequence number pre-allocation
 * - EventPersister: Persistence strategy handling
 * - EventProcessor: Event processing pipeline
 * - MessageContextBuilder: File context and attachments
 * - GraphExecutor: LangGraph execution with timeout
 * - ExecutionPipeline: Composed execution flow
 */

export * from './types';

// Main Orchestrator
export {
  AgentOrchestrator,
  getAgentOrchestrator,
  createAgentOrchestrator,
  __resetAgentOrchestrator,
} from './AgentOrchestrator';

// Fake Orchestrator for Testing
export {
  FakeAgentOrchestrator,
  getFakeAgentOrchestrator,
  __resetFakeAgentOrchestrator,
} from './FakeAgentOrchestrator';
export type { FakeScenario } from './FakeAgentOrchestrator';

// ExecutionContextSync
export {
  createExecutionContextSync,
  getNextEventIndex,
  setUsageSync,
  getTotalTokensSync,
  isToolSeenSync,
  markToolSeenSync,
} from './ExecutionContextSync';
export type { ExecutionContextSync, ExecuteSyncOptions, EventEmitCallback } from './ExecutionContextSync';

// Event Conversion
export { convertToAgentEvent } from './events/EventConverter';

// Event Sequencing
export {
  countPersistableEvents,
  assignPreAllocatedSequences,
  reserveAndAssignSequences,
  getSequenceDebugInfo,
} from './events/EventSequencer';
export type { ISequenceReserver } from './events/EventSequencer';

// Event Persistence
export {
  persistSyncEvent,
  persistAsyncEvent,
  requiresSyncPersistence,
  allowsAsyncPersistence,
  isTransient,
} from './persistence/EventPersister';

// Event Processing
export {
  processNormalizedEvent,
  trackAssistantMessageState,
} from './events/EventProcessor';
export type { EventProcessorDependencies } from './events/EventProcessor';

// Message Context Building
export {
  MessageContextBuilder,
  createMessageContextBuilder,
  buildMessageContent,
  buildGraphInputs,
} from './context/MessageContextBuilder';
export type {
  MessageContextOptions,
  MessageContextBuildResult,
} from './context/MessageContextBuilder';

// Graph Execution
export {
  GraphExecutor,
  createGraphExecutor,
  executeGraph,
} from './execution/GraphExecutor';
export type { ICompiledGraph, GraphExecutionOptions } from './execution/GraphExecutor';

// Execution Pipeline
export {
  ExecutionPipeline,
  createExecutionPipeline,
} from './execution/ExecutionPipeline';
export type {
  ExecutionPipelineDependencies,
  PipelineExecutionOptions,
  PipelineExecutionResult,
} from './execution/ExecutionPipeline';
