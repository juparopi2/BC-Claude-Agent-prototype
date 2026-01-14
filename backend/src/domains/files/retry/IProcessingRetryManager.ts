/**
 * Processing Retry Manager Interface
 *
 * Orchestrates retry decisions and execution for file processing.
 * Single Responsibility: Only retry orchestration, delegates state mutations to FileRetryService.
 *
 * @module domains/files/retry
 */

import type {
  RetryDecisionResult,
  ManualRetryResult,
  RetryScope,
  RetryPhase,
} from '@bc-agent/shared';

/**
 * Processing Retry Manager Interface
 *
 * Orchestrates retry decisions and execution for file processing.
 */
export interface IProcessingRetryManager {
  /**
   * Decide whether a file should be retried based on current retry count.
   *
   * Called by BullMQ workers when processing fails.
   * Uses exponential backoff calculation.
   *
   * @param userId - User ID for multi-tenant isolation
   * @param fileId - File ID
   * @param phase - Which phase failed ('processing' | 'embedding')
   * @returns Retry decision with backoff delay
   */
  shouldRetry(
    userId: string,
    fileId: string,
    phase: RetryPhase
  ): Promise<RetryDecisionResult>;

  /**
   * Execute retry for a file (manual retry from user).
   *
   * Validates file is in failed state, clears retry counters,
   * and re-enqueues the appropriate job.
   *
   * @param userId - User ID for multi-tenant isolation
   * @param fileId - File ID
   * @param scope - What to retry ('full' | 'embedding_only')
   * @returns Retry result with new job ID
   */
  executeManualRetry(
    userId: string,
    fileId: string,
    scope: RetryScope
  ): Promise<ManualRetryResult>;

  /**
   * Handle permanent failure after max retries exceeded.
   *
   * Marks file as permanently failed and triggers cleanup.
   *
   * @param userId - User ID for multi-tenant isolation
   * @param fileId - File ID
   * @param errorMessage - Error message to store
   */
  handlePermanentFailure(
    userId: string,
    fileId: string,
    errorMessage: string
  ): Promise<void>;

  /**
   * Calculate backoff delay using exponential backoff formula.
   *
   * @param retryCount - Current retry count (0-based)
   * @returns Delay in milliseconds
   */
  calculateBackoffDelay(retryCount: number): number;
}
