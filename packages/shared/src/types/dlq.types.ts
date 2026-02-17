/**
 * Dead Letter Queue Types (PRD-04)
 *
 * Types for the V2 dead letter queue that captures permanently failed
 * file processing jobs for manual inspection and retry.
 *
 * @module @bc-agent/shared/types/dlq
 */

/**
 * Pipeline stage where the failure occurred.
 */
export type FailedPipelineStage = 'extract' | 'chunk' | 'embed';

/**
 * A single DLQ entry representing a permanently failed file.
 */
export interface DLQEntry {
  /** File ID (UPPERCASE UUID) */
  fileId: string;
  /** Batch ID (UPPERCASE UUID) */
  batchId: string;
  /** Owner user ID (UPPERCASE UUID) */
  userId: string;
  /** Pipeline stage where the failure occurred */
  stage: FailedPipelineStage;
  /** Error message from the last failure */
  error: string;
  /** Error stack trace (if available) */
  stack?: string;
  /** Number of attempts made before giving up */
  attempts: number;
  /** ISO 8601 timestamp when the failure was recorded */
  failedAt: string;
  /** ISO 8601 timestamp when the file was retried (if applicable) */
  retriedAt?: string;
}

/**
 * Paginated DLQ list response.
 */
export interface DLQListResponse {
  entries: DLQEntry[];
  total: number;
  page: number;
  pageSize: number;
}
