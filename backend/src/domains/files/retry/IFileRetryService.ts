/**
 * IFileRetryService Interface
 *
 * Defines the contract for file retry tracking operations.
 * Follows ISP (Interface Segregation Principle) - only retry-related methods.
 *
 * Design Principles:
 * - Single Responsibility: Only retry-related state mutations
 * - Multi-tenant isolation: All operations require userId
 * - Testability: Interface enables easy mocking
 *
 * @module domains/files/retry
 */

import type { PipelineStatus } from '@bc-agent/shared';

/**
 * Interface for file retry tracking service.
 *
 * Single Responsibility: Only handles retry-related state mutations.
 * Does NOT handle file CRUD, folder operations, or general processing status updates.
 *
 * Methods:
 * - incrementRetryCount: Track pipeline retry attempts
 * - setLastError: Store last error message
 * - markAsPermanentlyFailed: Mark file as permanently failed
 * - clearFailedStatus: Reset retry state for manual retry
 * - updatePipelineStatus: Update pipeline status
 */
export interface IFileRetryService {
  /**
   * Increment pipeline retry count.
   *
   * Called when a file processing attempt fails and will be retried.
   * Uses OUTPUT INSERTED to return the new count atomically.
   *
   * @param userId - User ID for multi-tenant isolation
   * @param fileId - File ID to update
   * @returns New retry count after increment
   * @throws Error if file not found or unauthorized
   */
  incrementRetryCount(userId: string, fileId: string): Promise<number>;

  /**
   * Set last error message.
   *
   * Stores the error message for debugging and user display.
   * Automatically truncates to 1000 characters (DB column limit).
   *
   * @param userId - User ID for multi-tenant isolation
   * @param fileId - File ID to update
   * @param errorMessage - Error message to store
   * @throws Error if file not found or unauthorized
   */
  setLastError(userId: string, fileId: string, errorMessage: string): Promise<void>;

  /**
   * Mark file as permanently failed.
   *
   * Sets the failed_at timestamp when a file has exhausted all retries.
   * Used by cleanup jobs to identify files that failed > N days ago.
   *
   * @param userId - User ID for multi-tenant isolation
   * @param fileId - File ID to update
   * @throws Error if file not found or unauthorized
   */
  markAsPermanentlyFailed(userId: string, fileId: string): Promise<void>;

  /**
   * Clear failed status to allow retry.
   *
   * Resets retry count, error message, and failed_at timestamp.
   * Called when user manually retries a failed file.
   *
   * @param userId - User ID for multi-tenant isolation
   * @param fileId - File ID to update
   * @throws Error if file not found or unauthorized
   */
  clearFailedStatus(userId: string, fileId: string): Promise<void>;

  /**
   * Update pipeline status.
   *
   * Updates the pipeline_status column for a file.
   *
   * @param userId - User ID for multi-tenant isolation
   * @param fileId - File ID to update
   * @param status - New pipeline status
   * @throws Error if file not found or unauthorized
   */
  updatePipelineStatus(
    userId: string,
    fileId: string,
    status: PipelineStatus
  ): Promise<void>;
}
