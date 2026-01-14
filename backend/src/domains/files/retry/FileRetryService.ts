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
 * Methods (extracted from FileService):
 * - incrementProcessingRetryCount (was method 15)
 * - incrementEmbeddingRetryCount (was method 16)
 * - setLastProcessingError (was method 17)
 * - setLastEmbeddingError (was method 18)
 * - markAsPermanentlyFailed (was method 19)
 * - clearFailedStatus (was method 20)
 * - updateEmbeddingStatus (was method 21)
 *
 * @module domains/files/retry
 */

import { createChildLogger } from '@/shared/utils/logger';
import { executeQuery, SqlParams } from '@/infrastructure/database/database';
import type { Logger } from 'pino';
import type { EmbeddingStatus } from '@bc-agent/shared';
import type { IFileRetryService, ClearFailedScope } from './IFileRetryService';

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
   * Increment processing retry count.
   *
   * @param userId - User ID for ownership check
   * @param fileId - File ID
   * @returns Updated retry count
   */
  public async incrementProcessingRetryCount(
    userId: string,
    fileId: string
  ): Promise<number> {
    this.logger.info({ userId, fileId }, 'Incrementing processing retry count');

    try {
      const query = `
        UPDATE files
        SET processing_retry_count = processing_retry_count + 1,
            updated_at = GETUTCDATE()
        OUTPUT INSERTED.processing_retry_count
        WHERE id = @id AND user_id = @user_id
      `;

      const params: SqlParams = {
        id: fileId,
        user_id: userId,
      };

      const result = await executeQuery<{ processing_retry_count: number }>(query, params);

      if (result.recordset.length === 0) {
        throw new Error('File not found or unauthorized');
      }

      const newCount = result.recordset[0]!.processing_retry_count;
      this.logger.info({ userId, fileId, newCount }, 'Processing retry count incremented');

      return newCount;
    } catch (error) {
      this.logger.error({ error, userId, fileId }, 'Failed to increment processing retry count');
      throw error;
    }
  }

  /**
   * Increment embedding retry count.
   *
   * @param userId - User ID for ownership check
   * @param fileId - File ID
   * @returns Updated retry count
   */
  public async incrementEmbeddingRetryCount(
    userId: string,
    fileId: string
  ): Promise<number> {
    this.logger.info({ userId, fileId }, 'Incrementing embedding retry count');

    try {
      const query = `
        UPDATE files
        SET embedding_retry_count = embedding_retry_count + 1,
            updated_at = GETUTCDATE()
        OUTPUT INSERTED.embedding_retry_count
        WHERE id = @id AND user_id = @user_id
      `;

      const params: SqlParams = {
        id: fileId,
        user_id: userId,
      };

      const result = await executeQuery<{ embedding_retry_count: number }>(query, params);

      if (result.recordset.length === 0) {
        throw new Error('File not found or unauthorized');
      }

      const newCount = result.recordset[0]!.embedding_retry_count;
      this.logger.info({ userId, fileId, newCount }, 'Embedding retry count incremented');

      return newCount;
    } catch (error) {
      this.logger.error({ error, userId, fileId }, 'Failed to increment embedding retry count');
      throw error;
    }
  }

  /**
   * Set last processing error message.
   * Truncates to 1000 characters if necessary.
   *
   * @param userId - User ID for ownership check
   * @param fileId - File ID
   * @param errorMessage - Error message to store
   */
  public async setLastProcessingError(
    userId: string,
    fileId: string,
    errorMessage: string
  ): Promise<void> {
    this.logger.info({ userId, fileId, errorLength: errorMessage.length }, 'Setting last processing error');

    try {
      // Truncate to 1000 characters (DB column limit)
      const truncatedError = errorMessage.substring(0, 1000);

      const query = `
        UPDATE files
        SET last_processing_error = @error,
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

      this.logger.info({ userId, fileId }, 'Last processing error set');
    } catch (error) {
      this.logger.error({ error, userId, fileId }, 'Failed to set last processing error');
      throw error;
    }
  }

  /**
   * Set last embedding error message.
   * Truncates to 1000 characters if necessary.
   *
   * @param userId - User ID for ownership check
   * @param fileId - File ID
   * @param errorMessage - Error message to store
   */
  public async setLastEmbeddingError(
    userId: string,
    fileId: string,
    errorMessage: string
  ): Promise<void> {
    this.logger.info({ userId, fileId, errorLength: errorMessage.length }, 'Setting last embedding error');

    try {
      // Truncate to 1000 characters (DB column limit)
      const truncatedError = errorMessage.substring(0, 1000);

      const query = `
        UPDATE files
        SET last_embedding_error = @error,
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

      this.logger.info({ userId, fileId }, 'Last embedding error set');
    } catch (error) {
      this.logger.error({ error, userId, fileId }, 'Failed to set last embedding error');
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
   * Resets retry counts and error messages based on scope.
   *
   * @param userId - User ID for ownership check
   * @param fileId - File ID
   * @param scope - Which retry counts to reset ('full' | 'embedding_only')
   */
  public async clearFailedStatus(
    userId: string,
    fileId: string,
    scope: ClearFailedScope = 'full'
  ): Promise<void> {
    this.logger.info({ userId, fileId, scope }, 'Clearing failed status for retry');

    try {
      const setClauses: string[] = [
        'failed_at = NULL',
        'last_embedding_error = NULL',
        'embedding_retry_count = 0',
        'updated_at = GETUTCDATE()',
      ];

      if (scope === 'full') {
        setClauses.push('last_processing_error = NULL');
        setClauses.push('processing_retry_count = 0');
      }

      const query = `
        UPDATE files
        SET ${setClauses.join(', ')}
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

      this.logger.info({ userId, fileId, scope }, 'Failed status cleared for retry');
    } catch (error) {
      this.logger.error({ error, userId, fileId, scope }, 'Failed to clear failed status');
      throw error;
    }
  }

  /**
   * Update embedding status.
   *
   * @param userId - User ID for ownership check
   * @param fileId - File ID
   * @param status - New embedding status
   */
  public async updateEmbeddingStatus(
    userId: string,
    fileId: string,
    status: EmbeddingStatus
  ): Promise<void> {
    this.logger.info({ userId, fileId, status }, 'Updating embedding status');

    try {
      const query = `
        UPDATE files
        SET embedding_status = @status,
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

      this.logger.info({ userId, fileId, status }, 'Embedding status updated');
    } catch (error) {
      this.logger.error({ error, userId, fileId, status }, 'Failed to update embedding status');
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
