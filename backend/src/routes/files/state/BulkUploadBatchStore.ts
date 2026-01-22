/**
 * Bulk Upload Batch Store
 *
 * Singleton store for managing bulk upload batch metadata.
 * In production, this would be Redis for horizontal scaling.
 *
 * @module routes/files/state/BulkUploadBatchStore
 */

import { BULK_BATCH_CONFIG } from '../constants/file.constants';
import { createChildLogger } from '@/shared/utils/logger';

const logger = createChildLogger({ service: 'BulkUploadBatchStore' });

/**
 * Metadata stored for each file in a batch
 */
export interface BatchFileMetadata {
  tempId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  blobPath: string;
}

/**
 * Metadata stored for each batch
 */
export interface BatchMetadata {
  userId: string;
  files: BatchFileMetadata[];
  sessionId?: string;
  createdAt: Date;
}

/**
 * Singleton store for bulk upload batches
 */
class BulkUploadBatchStore {
  private static instance: BulkUploadBatchStore | null = null;
  private batches = new Map<string, BatchMetadata>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  private constructor() {
    // Start cleanup interval
    this.startCleanup();
  }

  /**
   * Get the singleton instance
   */
  static getInstance(): BulkUploadBatchStore {
    if (!BulkUploadBatchStore.instance) {
      BulkUploadBatchStore.instance = new BulkUploadBatchStore();
    }
    return BulkUploadBatchStore.instance;
  }

  /**
   * Store a batch
   */
  set(batchId: string, metadata: BatchMetadata): void {
    this.batches.set(batchId, metadata);
    logger.debug({ batchId, fileCount: metadata.files.length }, 'Batch stored');
  }

  /**
   * Get a batch by ID
   */
  get(batchId: string): BatchMetadata | undefined {
    return this.batches.get(batchId);
  }

  /**
   * Delete a batch
   */
  delete(batchId: string): boolean {
    const result = this.batches.delete(batchId);
    if (result) {
      logger.debug({ batchId }, 'Batch deleted');
    }
    return result;
  }

  /**
   * Check if batch exists
   */
  has(batchId: string): boolean {
    return this.batches.has(batchId);
  }

  /**
   * Get batch count (for monitoring)
   */
  get size(): number {
    return this.batches.size;
  }

  /**
   * Start the cleanup interval
   */
  private startCleanup(): void {
    if (this.cleanupInterval) {
      return;
    }

    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredBatches();
    }, BULK_BATCH_CONFIG.CLEANUP_INTERVAL_MS);

    // Don't keep the process alive just for cleanup
    this.cleanupInterval.unref();
  }

  /**
   * Clean up expired batches
   */
  private cleanupExpiredBatches(): void {
    const now = Date.now();
    const expirationTime = now - BULK_BATCH_CONFIG.TTL_MS;
    let cleanedCount = 0;

    for (const [batchId, batch] of this.batches.entries()) {
      if (batch.createdAt.getTime() < expirationTime) {
        this.batches.delete(batchId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.info({ cleanedCount, remaining: this.batches.size }, 'Cleaned expired batches');
    }
  }

  /**
   * Stop the cleanup interval (for testing)
   */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Reset the store (for testing)
   */
  static __reset(): void {
    if (BulkUploadBatchStore.instance) {
      BulkUploadBatchStore.instance.stopCleanup();
      BulkUploadBatchStore.instance.batches.clear();
      BulkUploadBatchStore.instance = null;
    }
  }
}

/**
 * Get the BulkUploadBatchStore singleton
 */
export function getBulkUploadBatchStore(): BulkUploadBatchStore {
  return BulkUploadBatchStore.getInstance();
}

// Export the class for type usage
export { BulkUploadBatchStore };
