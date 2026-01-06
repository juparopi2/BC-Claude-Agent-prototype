/**
 * Image Embedding Repository
 *
 * Handles persistence of image embeddings for semantic image search.
 * Embeddings are stored as JSON-serialized arrays in SQL Server.
 *
 * @module repositories/ImageEmbeddingRepository
 */

import { v4 as uuidv4 } from 'uuid';
import { executeQuery } from '@/infrastructure/database/database';
import { createChildLogger } from '@/shared/utils/logger';

const logger = createChildLogger({ service: 'ImageEmbeddingRepository' });

/**
 * Database row representation of an image embedding
 */
export interface ImageEmbeddingRecord {
  id: string;
  fileId: string;
  userId: string;
  embedding: number[];
  dimensions: number;
  model: string;
  modelVersion: string;
  createdAt: Date;
  updatedAt: Date | null;
}

/**
 * Parameters for upserting an image embedding
 */
export interface UpsertImageEmbeddingParams {
  fileId: string;
  userId: string;
  embedding: number[];
  dimensions: number;
  model: string;
  modelVersion: string;
}

/**
 * Database row type from SQL query
 */
interface ImageEmbeddingRow {
  id: string;
  file_id: string;
  user_id: string;
  embedding: string;
  dimensions: number;
  model: string;
  model_version: string;
  created_at: Date;
  updated_at: Date | null;
}

/**
 * Image Embedding Repository
 *
 * Singleton repository for managing image embeddings in Azure SQL.
 * Supports CRUD operations with user isolation for multi-tenancy.
 */
export class ImageEmbeddingRepository {
  private static instance: ImageEmbeddingRepository;

  /**
   * Get singleton instance
   */
  static getInstance(): ImageEmbeddingRepository {
    if (!ImageEmbeddingRepository.instance) {
      ImageEmbeddingRepository.instance = new ImageEmbeddingRepository();
    }
    return ImageEmbeddingRepository.instance;
  }

  /**
   * Upsert an image embedding
   *
   * Creates a new embedding record or updates existing one for the file.
   * Uses MERGE pattern for atomic upsert operation.
   *
   * @param params - Embedding data to upsert
   * @returns ID of the upserted record
   */
  async upsert(params: UpsertImageEmbeddingParams): Promise<string> {
    const { fileId, userId, embedding, dimensions, model, modelVersion } = params;

    // Check if exists first (simpler than MERGE for cross-DB compatibility)
    const existing = await this.getByFileId(fileId, userId);

    if (existing) {
      // Update existing record
      await executeQuery(
        `UPDATE image_embeddings
         SET embedding = @embedding,
             dimensions = @dimensions,
             model = @model,
             model_version = @model_version,
             updated_at = GETUTCDATE()
         WHERE file_id = @file_id AND user_id = @user_id`,
        {
          file_id: fileId,
          user_id: userId,
          embedding: JSON.stringify(embedding),
          dimensions,
          model,
          model_version: modelVersion,
        }
      );

      logger.debug({ fileId, userId }, 'Image embedding updated');
      return existing.id;
    }

    // Insert new record
    const id = uuidv4();
    await executeQuery(
      `INSERT INTO image_embeddings
       (id, file_id, user_id, embedding, dimensions, model, model_version, created_at)
       VALUES (@id, @file_id, @user_id, @embedding, @dimensions, @model, @model_version, GETUTCDATE())`,
      {
        id,
        file_id: fileId,
        user_id: userId,
        embedding: JSON.stringify(embedding),
        dimensions,
        model,
        model_version: modelVersion,
      }
    );

    logger.debug({ id, fileId, userId }, 'Image embedding inserted');
    return id;
  }

  /**
   * Get embedding by file ID
   *
   * Retrieves the embedding for a specific file, scoped to user.
   * Returns null if not found.
   *
   * @param fileId - File UUID
   * @param userId - User UUID (for multi-tenant isolation)
   * @returns Embedding record or null
   */
  async getByFileId(fileId: string, userId: string): Promise<ImageEmbeddingRecord | null> {
    const result = await executeQuery<ImageEmbeddingRow>(
      `SELECT id, file_id, user_id, embedding, dimensions, model, model_version, created_at, updated_at
       FROM image_embeddings
       WHERE file_id = @file_id AND user_id = @user_id`,
      { file_id: fileId, user_id: userId }
    );

    const row = result.recordset[0];
    if (!row) return null;

    return this.mapRowToRecord(row);
  }

  /**
   * Get all embeddings for a user
   *
   * Retrieves all image embeddings owned by a user.
   * Useful for batch operations or user data export.
   *
   * @param userId - User UUID
   * @returns Array of embedding records
   */
  async getByUserId(userId: string): Promise<ImageEmbeddingRecord[]> {
    const result = await executeQuery<ImageEmbeddingRow>(
      `SELECT id, file_id, user_id, embedding, dimensions, model, model_version, created_at, updated_at
       FROM image_embeddings
       WHERE user_id = @user_id
       ORDER BY created_at DESC`,
      { user_id: userId }
    );

    return result.recordset.map((row) => this.mapRowToRecord(row));
  }

  /**
   * Delete embedding by file ID
   *
   * Removes the embedding for a specific file.
   * Returns true if a record was deleted.
   *
   * @param fileId - File UUID
   * @param userId - User UUID (for multi-tenant isolation)
   * @returns True if deleted, false if not found
   */
  async deleteByFileId(fileId: string, userId: string): Promise<boolean> {
    const result = await executeQuery(
      `DELETE FROM image_embeddings WHERE file_id = @file_id AND user_id = @user_id`,
      { file_id: fileId, user_id: userId }
    );

    if (result.rowsAffected[0] === undefined) {
      logger.error({ fileId, userId }, 'Database result missing rowsAffected for deleteByFileId');
      return false;
    }

    const deleted = result.rowsAffected[0] > 0;
    if (deleted) {
      logger.debug({ fileId, userId }, 'Image embedding deleted');
    }

    return deleted;
  }

  /**
   * Delete all embeddings for a user
   *
   * Removes all embeddings owned by a user.
   * Used for GDPR data deletion requests.
   *
   * @param userId - User UUID
   * @returns Number of records deleted
   */
  async deleteByUserId(userId: string): Promise<number> {
    const result = await executeQuery(
      `DELETE FROM image_embeddings WHERE user_id = @user_id`,
      { user_id: userId }
    );

    if (result.rowsAffected[0] === undefined) {
      logger.error({ userId }, 'Database result missing rowsAffected for deleteByUserId');
      return 0;
    }

    const count = result.rowsAffected[0];
    if (count > 0) {
      logger.info({ userId, count }, 'Deleted all image embeddings for user');
    }

    return count;
  }

  /**
   * Count embeddings for a user
   *
   * Returns the total number of image embeddings owned by a user.
   *
   * @param userId - User UUID
   * @returns Count of embeddings
   */
  async countByUserId(userId: string): Promise<number> {
    const result = await executeQuery<{ count: number }>(
      `SELECT COUNT(*) as count FROM image_embeddings WHERE user_id = @user_id`,
      { user_id: userId }
    );

    return result.recordset[0]?.count ?? 0;
  }

  /**
   * Map database row to record type
   */
  private mapRowToRecord(row: ImageEmbeddingRow): ImageEmbeddingRecord {
    return {
      id: row.id,
      fileId: row.file_id,
      userId: row.user_id,
      embedding: JSON.parse(row.embedding),
      dimensions: row.dimensions,
      model: row.model,
      modelVersion: row.model_version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

/**
 * Get ImageEmbeddingRepository singleton
 *
 * Factory function for obtaining the repository instance.
 *
 * @returns ImageEmbeddingRepository singleton
 *
 * @example
 * ```typescript
 * const repo = getImageEmbeddingRepository();
 * const embedding = await repo.getByFileId(fileId, userId);
 * ```
 */
export function getImageEmbeddingRepository(): ImageEmbeddingRepository {
  return ImageEmbeddingRepository.getInstance();
}

/**
 * Reset repository singleton for testing
 *
 * @internal Only for tests - DO NOT use in production
 */
export function __resetImageEmbeddingRepository(): void {
  (ImageEmbeddingRepository as unknown as { instance: null }).instance = null;
}
