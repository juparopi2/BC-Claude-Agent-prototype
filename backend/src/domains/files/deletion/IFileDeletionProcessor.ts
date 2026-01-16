/**
 * File Deletion Processor Interface
 *
 * Processes file deletion jobs from the BullMQ queue.
 * Single Responsibility: Delete files and emit WebSocket events.
 *
 * @module domains/files/deletion
 */

import type { FileDeletionJobData } from '@bc-agent/shared';

/**
 * Result of a file deletion operation
 */
export interface FileDeletionResult {
  /** File ID that was deleted */
  fileId: string;

  /** Whether deletion succeeded */
  success: boolean;

  /** Number of blob paths deleted */
  blobPathsDeleted: number;

  /** Error message if deletion failed */
  error?: string;
}

/**
 * File Deletion Processor Interface
 *
 * Processes file deletion jobs sequentially to avoid SQL deadlocks.
 * Emits WebSocket events to notify frontend of deletion status.
 */
export interface IFileDeletionProcessor {
  /**
   * Process a single file deletion job.
   *
   * Called by BullMQ worker for each deletion job.
   * Handles DB deletion, blob cleanup, and WebSocket notification.
   *
   * @param data - Job data with fileId, userId, and optional batchId
   * @returns Deletion result
   * @throws Error if deletion fails (BullMQ will retry)
   */
  processJob(data: FileDeletionJobData): Promise<FileDeletionResult>;
}
