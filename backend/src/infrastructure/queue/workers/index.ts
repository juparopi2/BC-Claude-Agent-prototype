/**
 * Queue Workers - Public Exports
 *
 * @module infrastructure/queue/workers
 */

// Tool Execution Worker (not implemented)
export {
  ToolExecutionWorker,
  getToolExecutionWorker,
  __resetToolExecutionWorker,
} from './ToolExecutionWorker';
export type { ToolExecutionWorkerDependencies } from './ToolExecutionWorker';

// Event Processing Worker
export {
  EventProcessingWorker,
  getEventProcessingWorker,
  __resetEventProcessingWorker,
} from './EventProcessingWorker';
export type { EventProcessingWorkerDependencies } from './EventProcessingWorker';

// Citation Persistence Worker
export {
  CitationPersistenceWorker,
  getCitationPersistenceWorker,
  __resetCitationPersistenceWorker,
} from './CitationPersistenceWorker';
export type { CitationPersistenceWorkerDependencies } from './CitationPersistenceWorker';

// File Deletion Worker
export {
  FileDeletionWorker,
  getFileDeletionWorker,
  __resetFileDeletionWorker,
} from './FileDeletionWorker';
export type { FileDeletionWorkerDependencies } from './FileDeletionWorker';

// Usage Aggregation Worker
export {
  UsageAggregationWorker,
  getUsageAggregationWorker,
  __resetUsageAggregationWorker,
} from './UsageAggregationWorker';
export type { UsageAggregationWorkerDependencies } from './UsageAggregationWorker';

// Message Persistence Worker
export {
  MessagePersistenceWorker,
  getMessagePersistenceWorker,
  __resetMessagePersistenceWorker,
} from './MessagePersistenceWorker';
export type { MessagePersistenceWorkerDependencies } from './MessagePersistenceWorker';

// File pipeline workers
export {
  FileExtractWorker,
  getFileExtractWorker,
  type ExtractJobData,
  type FileExtractWorkerDependencies,
} from './FileExtractWorker';

export {
  FileChunkWorker,
  getFileChunkWorker,
  type ChunkJobData,
  type FileChunkWorkerDependencies,
} from './FileChunkWorker';

export {
  FileEmbedWorker,
  getFileEmbedWorker,
  type EmbedJobData,
  type FileEmbedWorkerDependencies,
} from './FileEmbedWorker';

export {
  FilePipelineCompleteWorker,
  getFilePipelineCompleteWorker,
  type PipelineCompleteJobData,
  type FilePipelineCompleteWorkerDependencies,
} from './FilePipelineCompleteWorker';

export {
  MaintenanceWorker,
  getMaintenanceWorker,
  __resetMaintenanceWorker,
  type MaintenanceJobData,
  type MaintenanceWorkerDeps,
} from './MaintenanceWorker';
