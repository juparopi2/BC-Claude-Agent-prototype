/**
 * File Processing Scheduler Module
 *
 * Exports the FileProcessingScheduler for controlled job enqueuing
 * with backpressure management.
 *
 * @module domains/files/scheduler
 */

export {
  FileProcessingScheduler,
  getFileProcessingScheduler,
  __resetFileProcessingScheduler,
  type SchedulerConfig,
  type FileProcessingSchedulerDependencies,
} from './FileProcessingScheduler';
