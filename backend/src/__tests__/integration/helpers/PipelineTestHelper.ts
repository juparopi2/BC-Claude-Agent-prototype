/**
 * PipelineTestHelper - Shared helper for pipeline integration tests
 *
 * Creates test data (files with pipeline_status, upload_batches, file_chunks)
 * and tracks created resources for FK-aware cleanup.
 *
 * @module __tests__/integration/helpers/PipelineTestHelper
 */

import { randomUUID } from 'crypto';
import { executeQuery } from '@/infrastructure/database/database';
import { PIPELINE_STATUS, BATCH_STATUS } from '@bc-agent/shared';

/**
 * Test user result
 */
interface TestUser {
  id: string;
  email: string;
}

/**
 * Created file result
 */
interface CreatedFile {
  id: string;
  name: string;
  blobPath: string;
  userId: string;
}

/**
 * Created batch result
 */
interface CreatedBatch {
  id: string;
}

/**
 * Helper for pipeline integration tests.
 * Manages test data creation and FK-aware cleanup.
 */
export class PipelineTestHelper {
  private createdFileIds: string[] = [];
  private createdBatchIds: string[] = [];
  private createdUserIds: string[] = [];

  /**
   * Create a test user directly in DB (simplified - no Redis session needed).
   */
  async createTestUser(opts?: { userId?: string; email?: string }): Promise<TestUser> {
    const userId = opts?.userId?.toUpperCase() ?? randomUUID().toUpperCase();
    const email = opts?.email ?? `test-${userId.slice(0, 8)}@pipeline-test.local`;

    try {
      await executeQuery(
        `INSERT INTO users (id, email, full_name, role, is_active, created_at, updated_at)
         VALUES (@userId, @email, @fullName, @role, @isActive, GETUTCDATE(), GETUTCDATE())`,
        {
          userId,
          email,
          fullName: `Test User ${userId.slice(0, 8)}`,
          role: 'viewer',
          isActive: true,
        }
      );
    } catch (error: unknown) {
      // Ignore duplicate key violations (leftover from interrupted previous runs)
      if (error instanceof Error && error.message.includes('duplicate key')) {
        // User already exists — that's fine for tests
      } else {
        throw error;
      }
    }

    this.createdUserIds.push(userId);

    return { id: userId, email };
  }

  /**
   * Create a file with a specific pipeline_status in the DB.
   * Returns { id, name, blobPath, userId }
   */
  async createFileWithPipelineStatus(
    userId: string,
    opts?: {
      name?: string;
      pipelineStatus?: string;
      mimeType?: string;
      sizeBytes?: number;
      contentHash?: string;
      batchId?: string;
      parentFolderId?: string;
      deletionStatus?: string;
      pipelineRetryCount?: number;
      createdAt?: Date;
      updatedAt?: Date;
    }
  ): Promise<CreatedFile> {
    const fileId = randomUUID().toUpperCase();
    const name = opts?.name ?? `test-file-${fileId.slice(0, 8)}.txt`;
    const pipelineStatus = opts?.pipelineStatus ?? PIPELINE_STATUS.REGISTERED;
    const mimeType = opts?.mimeType ?? 'text/plain';
    const sizeBytes = opts?.sizeBytes ?? 1024;
    const blobPath = `users/${userId}/files/${fileId}/${name}`;
    const createdAt = opts?.createdAt ?? new Date();
    const updatedAt = opts?.updatedAt ?? new Date();

    await executeQuery(
      `INSERT INTO files (
        id, user_id, name, mime_type, size_bytes, blob_path,
        source_type, is_folder, is_favorite,
        pipeline_status, pipeline_retry_count, last_error,
        content_hash, batch_id, parent_folder_id, deletion_status,
        created_at, updated_at
      )
      VALUES (
        @fileId, @userId, @name, @mimeType, @sizeBytes, @blobPath,
        @sourceType, @isFolder, @isFavorite,
        @pipelineStatus, @pipelineRetryCount, @lastError,
        @contentHash, @batchId, @parentFolderId, @deletionStatus,
        @createdAt, @updatedAt
      )`,
      {
        fileId,
        userId,
        name,
        mimeType,
        sizeBytes,
        blobPath,
        sourceType: 'local',
        isFolder: false,
        isFavorite: false,
        pipelineStatus,
        pipelineRetryCount: opts?.pipelineRetryCount ?? 0,
        lastError: null,
        contentHash: opts?.contentHash !== undefined ? opts.contentHash : null,
        batchId: opts?.batchId !== undefined ? opts.batchId : null,
        parentFolderId: opts?.parentFolderId !== undefined ? opts.parentFolderId : null,
        deletionStatus: opts?.deletionStatus !== undefined ? opts.deletionStatus : null,
        createdAt,
        updatedAt,
      }
    );

    this.createdFileIds.push(fileId);

    return { id: fileId, name, blobPath, userId };
  }

  /**
   * Create an upload_batches row.
   */
  async createBatch(
    userId: string,
    opts?: {
      batchId?: string;
      status?: string;
      totalFiles?: number;
      confirmedCount?: number;
      expiresAt?: Date;
    }
  ): Promise<CreatedBatch> {
    const batchId = opts?.batchId?.toUpperCase() ?? randomUUID().toUpperCase();
    const status = opts?.status ?? BATCH_STATUS.ACTIVE;
    const totalFiles = opts?.totalFiles ?? 1;
    const confirmedCount = opts?.confirmedCount ?? 0;
    const expiresAt = opts?.expiresAt ?? new Date(Date.now() + 3600000); // 1 hour from now

    await executeQuery(
      `INSERT INTO upload_batches (
        id, user_id, status, total_files, confirmed_count, expires_at,
        created_at, updated_at
      )
      VALUES (
        @batchId, @userId, @status, @totalFiles, @confirmedCount, @expiresAt,
        GETUTCDATE(), GETUTCDATE()
      )`,
      {
        batchId,
        userId,
        status,
        totalFiles,
        confirmedCount,
        expiresAt,
      }
    );

    this.createdBatchIds.push(batchId);

    return { id: batchId };
  }

  /**
   * Read current pipeline_status of a file from DB.
   */
  async getFileStatus(fileId: string): Promise<string | null> {
    const result = await executeQuery<{ pipeline_status: string | null }>(
      `SELECT pipeline_status FROM files WHERE id = @fileId`,
      { fileId }
    );

    return result.recordset[0]?.pipeline_status ?? null;
  }

  /**
   * Read a file row from DB.
   */
  async getFile(fileId: string): Promise<Record<string, unknown> | null> {
    const result = await executeQuery<Record<string, unknown>>(
      `SELECT * FROM files WHERE id = @fileId`,
      { fileId }
    );

    return result.recordset[0] ?? null;
  }

  /**
   * Read a batch row from DB.
   */
  async getBatch(batchId: string): Promise<Record<string, unknown> | null> {
    const result = await executeQuery<Record<string, unknown>>(
      `SELECT * FROM upload_batches WHERE id = @batchId`,
      { batchId }
    );

    return result.recordset[0] ?? null;
  }

  /**
   * Count files by pipeline_status for a user.
   */
  async countFilesByStatus(userId: string, status: string): Promise<number> {
    const result = await executeQuery<{ count: number }>(
      `SELECT COUNT(*) as count FROM files WHERE user_id = @userId AND pipeline_status = @status`,
      { userId, status }
    );

    return result.recordset[0]?.count ?? 0;
  }

  /**
   * Set updated_at on a file to a specific date (for testing stuck files).
   */
  async setFileUpdatedAt(fileId: string, date: Date): Promise<void> {
    await executeQuery(
      `UPDATE files SET updated_at = @date WHERE id = @fileId`,
      { fileId, date }
    );
  }

  /**
   * Set created_at on a file to a specific date (for testing orphan cleanup).
   */
  async setFileCreatedAt(fileId: string, date: Date): Promise<void> {
    await executeQuery(
      `UPDATE files SET created_at = @date WHERE id = @fileId`,
      { fileId, date }
    );
  }

  /**
   * Delete all tracked test data in FK-safe order:
   * file_chunks → files → upload_batches → users
   */
  async cleanup(): Promise<void> {
    // 1. Delete file_chunks (FK to files)
    if (this.createdFileIds.length > 0) {
      for (const fileId of this.createdFileIds) {
        await executeQuery(
          `DELETE FROM file_chunks WHERE file_id = @fileId`,
          { fileId }
        );
      }
    }

    // 2. Detach parent references (avoids FK self-reference conflicts during deletion)
    if (this.createdFileIds.length > 0) {
      for (const fileId of this.createdFileIds) {
        await executeQuery(
          `UPDATE files SET parent_folder_id = NULL WHERE parent_folder_id = @fileId`,
          { fileId }
        );
      }
    }

    // 3. Delete files (FK to users and upload_batches)
    if (this.createdFileIds.length > 0) {
      for (const fileId of this.createdFileIds) {
        await executeQuery(
          `DELETE FROM files WHERE id = @fileId`,
          { fileId }
        );
      }
    }

    // 4. Delete upload_batches (FK to users)
    if (this.createdBatchIds.length > 0) {
      for (const batchId of this.createdBatchIds) {
        await executeQuery(
          `DELETE FROM upload_batches WHERE id = @batchId`,
          { batchId }
        );
      }
    }

    // 5. Delete usage_events, token_usage, and sessions (FK to users, no cascade)
    if (this.createdUserIds.length > 0) {
      for (const userId of this.createdUserIds) {
        await executeQuery(
          `DELETE FROM usage_events WHERE user_id = @userId`,
          { userId }
        );
        await executeQuery(
          `DELETE FROM token_usage WHERE user_id = @userId`,
          { userId }
        );
        await executeQuery(
          `DELETE FROM sessions WHERE user_id = @userId`,
          { userId }
        );
      }
    }

    // 6. Delete users (no FK dependencies at this point)
    if (this.createdUserIds.length > 0) {
      for (const userId of this.createdUserIds) {
        await executeQuery(
          `DELETE FROM users WHERE id = @userId`,
          { userId }
        );
      }
    }

    // Clear tracking arrays
    this.createdFileIds = [];
    this.createdBatchIds = [];
    this.createdUserIds = [];
  }
}

/**
 * Factory function to create a new PipelineTestHelper instance.
 */
export function createPipelineTestHelper(): PipelineTestHelper {
  return new PipelineTestHelper();
}
