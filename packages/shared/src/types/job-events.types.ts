/**
 * Job Failure Event Types
 *
 * Types for WebSocket events related to background job failures.
 * Used to notify users when BullMQ jobs fail after all retries.
 *
 * Phase 3, Task 3.3
 *
 * @module @bc-agent/shared/types/job-events
 */

/**
 * Queue names that can emit job failure events.
 */
export type JobQueueName =
  | 'file-processing'
  | 'file-chunking'
  | 'embedding-generation'
  | 'message-persistence'
  | 'tool-execution'
  | 'file-bulk-upload'
  | 'file-deletion';

/**
 * Context for job failure event emission.
 * Used to determine which rooms to emit to.
 */
export interface JobFailureContext {
  /** User ID (for user:${userId} room) */
  userId: string;
  /** Session ID (for ${sessionId} room) - optional */
  sessionId?: string;
}

/**
 * Payload for job:failed WebSocket event.
 * Sent to frontend when a background job fails permanently.
 */
export interface JobFailedPayload {
  /** Unique job ID */
  jobId: string;
  /** Queue name where job failed */
  queueName: JobQueueName;
  /** Human-readable error message */
  error: string;
  /** Number of attempts made before giving up */
  attemptsMade: number;
  /** Maximum attempts that were configured */
  maxAttempts: number;
  /** ISO timestamp of failure */
  failedAt: string;
  /** Optional context data for debugging */
  context?: {
    /** File ID if this was a file-related job */
    fileId?: string;
    /** File name for display */
    fileName?: string;
    /** Session ID if this was a session-related job */
    sessionId?: string;
    /** Additional metadata */
    [key: string]: unknown;
  };
}

/**
 * User-friendly queue name mapping for display.
 * Maps internal queue names to human-readable labels.
 */
export const JOB_QUEUE_DISPLAY_NAMES: Record<JobQueueName, string> = {
  'file-processing': 'File Processing',
  'file-chunking': 'File Chunking',
  'embedding-generation': 'Embedding Generation',
  'message-persistence': 'Message Save',
  'tool-execution': 'Tool Execution',
  'file-bulk-upload': 'File Upload',
  'file-deletion': 'File Deletion',
};

/**
 * Get user-friendly queue name for display.
 */
export function getQueueDisplayName(queueName: JobQueueName): string {
  return JOB_QUEUE_DISPLAY_NAMES[queueName] ?? queueName;
}
