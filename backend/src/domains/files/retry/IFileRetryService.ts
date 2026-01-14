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

import type { EmbeddingStatus } from '@bc-agent/shared';

/**
 * Scope for clearing failed status.
 * - 'full': Clears all retry fields (processing + embedding)
 * - 'embedding_only': Clears only embedding retry fields
 */
export type ClearFailedScope = 'full' | 'embedding_only';

/**
 * Interface for file retry tracking service.
 *
 * Single Responsibility: Only handles retry-related state mutations.
 * Does NOT handle file CRUD, folder operations, or general processing status updates.
 *
 * Methods:
 * - incrementProcessingRetryCount: Track processing retry attempts
 * - incrementEmbeddingRetryCount: Track embedding retry attempts
 * - setLastProcessingError: Store last processing error message
 * - setLastEmbeddingError: Store last embedding error message
 * - markAsPermanentlyFailed: Mark file as permanently failed
 * - clearFailedStatus: Reset retry state for manual retry
 * - updateEmbeddingStatus: Update embedding status
 */
export interface IFileRetryService {
  /**
   * Increment processing retry count.
   *
   * Called by BullMQ workers when processing fails and will be retried.
   * Uses OUTPUT INSERTED to return the new count atomically.
   *
   * @param userId - User ID for multi-tenant isolation
   * @param fileId - File ID to update
   * @returns New retry count after increment
   * @throws Error if file not found or unauthorized
   */
  incrementProcessingRetryCount(userId: string, fileId: string): Promise<number>;

  /**
   * Increment embedding retry count.
   *
   * Called by BullMQ workers when embedding generation fails and will be retried.
   * Uses OUTPUT INSERTED to return the new count atomically.
   *
   * @param userId - User ID for multi-tenant isolation
   * @param fileId - File ID to update
   * @returns New retry count after increment
   * @throws Error if file not found or unauthorized
   */
  incrementEmbeddingRetryCount(userId: string, fileId: string): Promise<number>;

  /**
   * Set last processing error message.
   *
   * Stores the error message for debugging and user display.
   * Automatically truncates to 1000 characters (DB column limit).
   *
   * @param userId - User ID for multi-tenant isolation
   * @param fileId - File ID to update
   * @param errorMessage - Error message to store
   * @throws Error if file not found or unauthorized
   */
  setLastProcessingError(userId: string, fileId: string, errorMessage: string): Promise<void>;

  /**
   * Set last embedding error message.
   *
   * Stores the error message for debugging and user display.
   * Automatically truncates to 1000 characters (DB column limit).
   *
   * @param userId - User ID for multi-tenant isolation
   * @param fileId - File ID to update
   * @param errorMessage - Error message to store
   * @throws Error if file not found or unauthorized
   */
  setLastEmbeddingError(userId: string, fileId: string, errorMessage: string): Promise<void>;

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
   * Resets retry counts, error messages, and failed_at timestamp.
   * Called when user manually retries a failed file.
   *
   * @param userId - User ID for multi-tenant isolation
   * @param fileId - File ID to update
   * @param scope - Which fields to clear ('full' | 'embedding_only')
   * @throws Error if file not found or unauthorized
   */
  clearFailedStatus(userId: string, fileId: string, scope?: ClearFailedScope): Promise<void>;

  /**
   * Update embedding status.
   *
   * Updates the embedding_status column for a file.
   *
   * @param userId - User ID for multi-tenant isolation
   * @param fileId - File ID to update
   * @param status - New embedding status
   * @throws Error if file not found or unauthorized
   */
  updateEmbeddingStatus(
    userId: string,
    fileId: string,
    status: EmbeddingStatus
  ): Promise<void>;
}
