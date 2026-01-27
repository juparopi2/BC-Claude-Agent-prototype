/**
 * SoftDeleteService
 *
 * Orchestrates the two-phase soft delete workflow for files:
 *
 * Phase 1 (Synchronous, ~50ms):
 * - Mark files in DB with deletion_status='pending'
 * - Return 200 OK immediately (files now hidden from queries)
 *
 * Phase 2 (Async, fire-and-forget):
 * - Update AI Search to mark documents as 'deleting' (excluded from RAG)
 * - Enqueue physical deletion jobs to queue worker
 * - Emit WebSocket event for deletion_started
 *
 * Phase 3 (Queue Worker - FileDeletionWorker):
 * - Update deletion_status to 'deleting'
 * - Delete from AI Search
 * - Delete from Blob Storage
 * - Hard delete from DB
 * - Emit WebSocket event for deletion complete
 *
 * Design Goals:
 * - Eliminate race condition where files reappear after refresh
 * - Ensure files don't appear in RAG searches immediately
 * - Provide better feedback to user about deletion progress
 */

import { createChildLogger } from '@/shared/utils/logger';
import type { Logger } from 'pino';
import { randomUUID } from 'crypto';
import { getFileRepository, type IFileRepository } from '../repository/FileRepository';
import { VectorSearchService } from '@services/search/VectorSearchService';
import { getMessageQueue } from '@/infrastructure/queue';
import type { FileDeletionJobData, DeletionReason, SoftDeleteResult } from '@bc-agent/shared';

/**
 * Options for soft delete operation
 */
export interface SoftDeleteOptions {
  /** Reason for deletion (GDPR audit trail) */
  deletionReason?: DeletionReason;
  /** Skip async operations (for testing) */
  skipAsync?: boolean;
}

/**
 * Interface for dependency injection
 */
export interface ISoftDeleteService {
  markForDeletion(
    userId: string,
    fileIds: string[],
    options?: SoftDeleteOptions
  ): Promise<SoftDeleteResult>;
}

/**
 * SoftDeleteService - Two-phase deletion orchestrator
 */
export class SoftDeleteService implements ISoftDeleteService {
  private static instance: SoftDeleteService | null = null;
  private logger: Logger;
  private repository: IFileRepository;

  private constructor(deps?: { repository?: IFileRepository }) {
    this.logger = createChildLogger({ service: 'SoftDeleteService' });
    this.repository = deps?.repository ?? getFileRepository();
  }

  public static getInstance(): SoftDeleteService {
    if (!SoftDeleteService.instance) {
      SoftDeleteService.instance = new SoftDeleteService();
    }
    return SoftDeleteService.instance;
  }

  /**
   * Mark files for deletion (Phase 1 - Synchronous)
   *
   * This is the main entry point for file deletion. It:
   * 1. Validates ownership of files
   * 2. Marks them as 'pending' deletion in DB
   * 3. Fires off async operations (AI Search update, queue jobs)
   * 4. Returns immediately with count of marked files
   *
   * After this method returns:
   * - Files are hidden from all queries (FileQueryBuilder filters them)
   * - Files are excluded from RAG searches (once AI Search updates)
   * - Physical deletion happens asynchronously via queue workers
   *
   * @param userId - User ID (for ownership check)
   * @param fileIds - Array of file IDs to mark for deletion
   * @param options - Deletion options
   * @returns Result with count of marked files and IDs not found
   */
  public async markForDeletion(
    userId: string,
    fileIds: string[],
    options?: SoftDeleteOptions
  ): Promise<SoftDeleteResult> {
    // Generate batch ID for tracking
    const batchId = randomUUID().toUpperCase();

    this.logger.info(
      { userId, fileCount: fileIds.length, batchId },
      'Starting soft delete (Phase 1)'
    );

    if (fileIds.length === 0) {
      return {
        markedForDeletion: 0,
        notFoundIds: [],
        batchId,
      };
    }

    // Normalize all IDs to uppercase per project convention
    const normalizedFileIds = fileIds.map(id => id.toUpperCase());

    try {
      // Phase 1: Mark files for deletion in database
      const result = await this.repository.markForDeletion(userId, normalizedFileIds);
      const { markedIds, markedCount } = result;

      // Determine which IDs were not found/already deleted
      const notFoundIds = normalizedFileIds.filter(id => !markedIds.includes(id));

      this.logger.info(
        { userId, batchId, markedCount, notFoundCount: notFoundIds.length },
        'Phase 1 complete - files marked for deletion'
      );

      // Phase 2: Fire-and-forget async operations
      if (!options?.skipAsync && markedCount > 0) {
        this.executePhase2Async(userId, markedIds, batchId, options?.deletionReason);
      }

      return {
        markedForDeletion: markedCount,
        notFoundIds,
        batchId,
      };
    } catch (error) {
      this.logger.error(
        { error, userId, fileCount: fileIds.length, batchId },
        'Failed to mark files for deletion'
      );
      throw error;
    }
  }

  /**
   * Phase 2: Execute async operations (fire-and-forget)
   *
   * This method is called after Phase 1 completes and runs asynchronously.
   * Errors are logged but don't fail the deletion.
   */
  private executePhase2Async(
    userId: string,
    markedIds: string[],
    batchId: string,
    deletionReason?: DeletionReason
  ): void {
    // Fire and forget - don't await
    this.phase2Operations(userId, markedIds, batchId, deletionReason).catch(error => {
      this.logger.error(
        { error, userId, batchId, fileCount: markedIds.length },
        'Phase 2 async operations failed (non-fatal)'
      );
    });
  }

  /**
   * Perform Phase 2 operations
   */
  private async phase2Operations(
    userId: string,
    markedIds: string[],
    batchId: string,
    deletionReason?: DeletionReason
  ): Promise<void> {
    this.logger.info(
      { userId, batchId, fileCount: markedIds.length },
      'Starting Phase 2 async operations'
    );

    // 2a. Update AI Search to mark documents as 'deleting'
    // This runs in parallel for all files
    const searchUpdatePromises = markedIds.map(fileId =>
      this.updateAISearchStatus(fileId, userId, batchId)
    );
    await Promise.allSettled(searchUpdatePromises);

    // 2b. Enqueue physical deletion jobs
    await this.enqueuePhysicalDeletionJobs(userId, markedIds, batchId, deletionReason);

    this.logger.info(
      { userId, batchId, fileCount: markedIds.length },
      'Phase 2 async operations completed'
    );
  }

  /**
   * Update AI Search to mark file documents as 'deleting'
   *
   * This ensures RAG searches won't return these files.
   * Uses eventual consistency - errors don't fail the deletion.
   */
  private async updateAISearchStatus(
    fileId: string,
    userId: string,
    batchId: string
  ): Promise<void> {
    try {
      const vectorSearchService = VectorSearchService.getInstance();
      const updatedCount = await vectorSearchService.markFileAsDeleting(fileId, userId);

      this.logger.debug(
        { fileId, userId, batchId, updatedCount },
        'AI Search documents marked as deleting'
      );
    } catch (error) {
      // Log but don't fail - eventual consistency model
      // The physical deletion worker will also try to delete from AI Search
      this.logger.warn(
        { error, fileId, userId, batchId },
        'Failed to update AI Search status (will be cleaned during physical deletion)'
      );
    }
  }

  /**
   * Enqueue physical deletion jobs to queue worker
   *
   * These jobs will:
   * - Update deletion_status to 'deleting'
   * - Delete from AI Search
   * - Delete from Blob Storage
   * - Hard delete from DB
   */
  private async enqueuePhysicalDeletionJobs(
    userId: string,
    fileIds: string[],
    batchId: string,
    deletionReason?: DeletionReason
  ): Promise<void> {
    try {
      const queue = getMessageQueue();
      const jobPromises: Promise<string>[] = [];

      for (const fileId of fileIds) {
        const jobData: FileDeletionJobData = {
          fileId,
          userId,
          batchId,
          deletionReason: deletionReason || 'user_request',
        };

        jobPromises.push(queue.addFileDeletionJob(jobData));
      }

      const jobIds = await Promise.all(jobPromises);

      this.logger.info(
        { userId, batchId, fileCount: fileIds.length, jobCount: jobIds.length },
        'Physical deletion jobs enqueued'
      );
    } catch (error) {
      this.logger.error(
        { error, userId, batchId, fileCount: fileIds.length },
        'Failed to enqueue physical deletion jobs'
      );
      // Don't throw - files are already marked for deletion in DB
      // They will be picked up by the cleanup job
    }
  }
}

/**
 * Get singleton instance of SoftDeleteService
 */
export function getSoftDeleteService(): SoftDeleteService {
  return SoftDeleteService.getInstance();
}

/**
 * Reset singleton for testing
 */
export function __resetSoftDeleteService(): void {
  (SoftDeleteService as unknown as { instance: SoftDeleteService | null }).instance = null;
}
