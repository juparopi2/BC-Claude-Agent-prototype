/**
 * Interface for Bulk Upload Processor
 *
 * Defines the contract for processing bulk file upload jobs.
 * Follows the same pattern as IFileDeletionProcessor.
 *
 * @module domains/files/bulk-upload
 */

import type { BulkUploadJobData, ParsedFile } from '@bc-agent/shared';

/**
 * Result of processing a bulk upload job
 */
export interface BulkUploadProcessorResult {
  /** UUID of the created file (empty string if failed) */
  fileId: string;

  /** Client temp ID for correlation */
  tempId: string;

  /** Whether file record creation succeeded */
  success: boolean;

  /** Created file details (only if success=true) */
  file?: ParsedFile;

  /** Error message (only if success=false) */
  error?: string;

  /** Whether FILE_PROCESSING job was enqueued */
  processingJobEnqueued: boolean;

  /** FILE_PROCESSING job ID (if enqueued) */
  processingJobId?: string;
}

/**
 * Interface for BulkUploadProcessor
 *
 * Processes bulk upload jobs from the BullMQ queue.
 * Each job creates a database record for a file that was uploaded
 * directly to Azure Blob Storage via SAS URL.
 */
export interface IBulkUploadProcessor {
  /**
   * Process a single bulk upload job
   *
   * 1. Verifies blob exists at blobPath
   * 2. Creates file record in database
   * 3. Emits WebSocket event (file:uploaded)
   * 4. Enqueues FILE_PROCESSING job for text extraction
   *
   * @param data - Job data from BullMQ queue
   * @returns Processing result with file details
   * @throws Error on failure (for BullMQ retry)
   */
  processJob(data: BulkUploadJobData): Promise<BulkUploadProcessorResult>;
}
