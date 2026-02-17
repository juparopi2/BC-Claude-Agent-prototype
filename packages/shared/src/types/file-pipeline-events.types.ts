/**
 * V2 File Pipeline Event Types (PRD-04)
 *
 * WebSocket event types for the V2 event-driven processing pipeline.
 * These coexist with existing V1 events (file:readiness_changed, etc.)
 * and will eventually replace them.
 *
 * @module @bc-agent/shared/types/file-pipeline-events
 */

import type { PipelineStatus } from '../constants/pipeline-status';

/**
 * Emitted when a file's pipeline status changes.
 * Fired by each V2 worker after a successful CAS state transition.
 */
export interface FilePipelineStatusChangedEvent {
  fileId: string;
  userId: string;
  batchId: string;
  previousStatus: PipelineStatus;
  newStatus: PipelineStatus;
  /** ISO 8601 timestamp */
  timestamp: string;
}

/**
 * Emitted when a single file completes all pipeline stages
 * (regardless of success or failure).
 */
export interface BatchFileProcessedEvent {
  fileId: string;
  batchId: string;
  userId: string;
  /** Final pipeline status (ready or failed) */
  finalStatus: PipelineStatus;
  /** Current batch progress */
  batchProgress: {
    total: number;
    processed: number;
    isComplete: boolean;
  };
}

/**
 * Emitted when all files in a batch have reached a terminal state.
 */
export interface BatchCompletedEvent {
  batchId: string;
  userId: string;
  totalFiles: number;
  /** Count of files that completed successfully (status = ready) */
  successCount: number;
  /** Count of files that failed (status = failed) */
  failedCount: number;
}
