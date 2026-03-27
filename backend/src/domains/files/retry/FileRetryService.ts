/**
 * FileRetryService
 *
 * Handles file retry tracking operations.
 * Extracted from FileService following SRP (Single Responsibility Principle).
 *
 * Design Principles:
 * - Single Responsibility: Only retry-related state mutations
 * - Multi-tenant isolation: All operations require userId
 * - Dependency Injection: Logger injected for testability
 * - Singleton Pattern: One instance per process
 *
 * Methods:
 * - incrementRetryCount: Track pipeline retry attempts
 * - setLastError: Store last error message
 * - markAsPermanentlyFailed: Mark file as permanently failed
 * - clearFailedStatus: Reset retry state for manual retry
 * - updatePipelineStatus: Update pipeline status
 *
 * @module domains/files/retry
 */

import { createChildLogger } from '@/shared/utils/logger';
import { executeQuery, SqlParams } from '@/infrastructure/database/database';
import type { Logger } from 'pino';
import type { PipelineStatus } from '@bc-agent/shared';
import type { IFileRetryService } from './IFileRetryService';

export class FileRetryService implements IFileRetryService {
  private static instance: FileRetryService | null = null;
  private logger: Logger;

  private constructor() {
    this.logger = createChildLogger({ service: 'FileRetryService' });
    this.logger.info('FileRetryService initialized');
  }

  public static getInstance(): FileRetryService {
    if (!FileRetryService.instance) {
      FileRetryService.instance = new FileRetryService();
    }
    return FileRetryService.instance;
  }

  /**
   * Increment pipeline retry count.
   *
   * @param userId - User ID for ownership check
   * @param fileId - File ID
   * @returns Updated retry count
   */
  public async incrementRetryCount(
    userId: string,
    fileId: string
  ): Promise<number> {
    this.logger.info({ userId, fileId }, 'Incrementing pipeline retry count');

    try {
      const query = `
        UPDATE files
        SET pipeline_retry_count = pipeline_retry_count + 1,
            updated_at = GETUTCDATE()
        OUTPUT INSERTED.pipeline_retry_count
        WHERE id = @id AND user_id = @user_id
      `;

      const params: SqlParams = {
        id: fileId,
        user_id: userId,
      };

      const result = await executeQuery<{ pipeline_retry_count: number }>(query, params);

      if (result.recordset.length === 0) {
        throw new Error('File not found or unauthorized');
      }

      const newCount = result.recordset[0]!.pipeline_retry_count;
      this.logger.info({ userId, fileId, newCount }, 'Pipeline retry count incremented');

      return newCount;
    } catch (error) {
      this.logger.error({ error, userId, fileId }, 'Failed to increment pipeline retry count');
      throw error;
    }
  }

  /**
   * Set last error message.
   * Truncates to 1000 characters if necessary.
   *
   * @param userId - User ID for ownership check
   * @param fileId - File ID
   * @param errorMessage - Error message to store
   */
  public async setLastError(
    userId: string,
    fileId: string,
    errorMessage: string
  ): Promise<void> {
    this.logger.info({ userId, fileId, errorLength: errorMessage.length }, 'Setting last error');

    try {
      // Truncate to 1000 characters (DB column limit)
      const truncatedError = errorMessage.substring(0, 1000);

      const query = `
        UPDATE files
        SET last_error = @error,
            updated_at = GETUTCDATE()
        WHERE id = @id AND user_id = @user_id
      `;

      const params: SqlParams = {
        id: fileId,
        user_id: userId,
        error: truncatedError,
      };

      const result = await executeQuery(query, params);

      if (result.rowsAffected[0] === 0) {
        throw new Error('File not found or unauthorized');
      }

      this.logger.info({ userId, fileId }, 'Last error set');
    } catch (error) {
      this.logger.error({ error, userId, fileId }, 'Failed to set last error');
      throw error;
    }
  }

  /**
   * Mark file as permanently failed.
   * Sets failed_at timestamp for cleanup job identification.
   *
   * @param userId - User ID for ownership check
   * @param fileId - File ID
   */
  public async markAsPermanentlyFailed(
    userId: string,
    fileId: string
  ): Promise<void> {
    this.logger.info({ userId, fileId }, 'Marking file as permanently failed');

    try {
      const query = `
        UPDATE files
        SET failed_at = GETUTCDATE(),
            updated_at = GETUTCDATE()
        WHERE id = @id AND user_id = @user_id
      `;

      const params: SqlParams = {
        id: fileId,
        user_id: userId,
      };

      const result = await executeQuery(query, params);

      if (result.rowsAffected[0] === 0) {
        throw new Error('File not found or unauthorized');
      }

      this.logger.info({ userId, fileId }, 'File marked as permanently failed');
    } catch (error) {
      this.logger.error({ error, userId, fileId }, 'Failed to mark file as permanently failed');
      throw error;
    }
  }

  /**
   * Clear failed status to allow retry.
   * Resets retry count, error message, and failed_at timestamp.
   *
   * @param userId - User ID for ownership check
   * @param fileId - File ID
   */
  public async clearFailedStatus(
    userId: string,
    fileId: string
  ): Promise<void> {
    this.logger.info({ userId, fileId }, 'Clearing failed status for retry');

    try {
      const query = `
        UPDATE files
        SET failed_at = NULL,
            last_error = NULL,
            pipeline_retry_count = 0,
            updated_at = GETUTCDATE()
        WHERE id = @id AND user_id = @user_id
      `;

      const params: SqlParams = {
        id: fileId,
        user_id: userId,
      };

      const result = await executeQuery(query, params);

      if (result.rowsAffected[0] === 0) {
        throw new Error('File not found or unauthorized');
      }

      this.logger.info({ userId, fileId }, 'Failed status cleared for retry');
    } catch (error) {
      this.logger.error({ error, userId, fileId }, 'Failed to clear failed status');
      throw error;
    }
  }

  /**
   * Update pipeline status.
   *
   * @param userId - User ID for ownership check
   * @param fileId - File ID
   * @param status - New pipeline status
   */
  public async updatePipelineStatus(
    userId: string,
    fileId: string,
    status: PipelineStatus
  ): Promise<void> {
    this.logger.info({ userId, fileId, status }, 'Updating pipeline status');

    try {
      const query = `
        UPDATE files
        SET pipeline_status = @status,
            updated_at = GETUTCDATE()
        WHERE id = @id AND user_id = @user_id
      `;

      const params: SqlParams = {
        id: fileId,
        user_id: userId,
        status,
      };

      const result = await executeQuery(query, params);

      if (result.rowsAffected[0] === 0) {
        throw new Error('File not found or unauthorized');
      }

      this.logger.info({ userId, fileId, status }, 'Pipeline status updated');
    } catch (error) {
      this.logger.error({ error, userId, fileId, status }, 'Failed to update pipeline status');
      throw error;
    }
  }
}

// Convenience getter
export function getFileRetryService(): FileRetryService {
  return FileRetryService.getInstance();
}

// Reset for testing
export function __resetFileRetryService(): void {
  (FileRetryService as unknown as { instance: FileRetryService | null }).instance = null;
}
