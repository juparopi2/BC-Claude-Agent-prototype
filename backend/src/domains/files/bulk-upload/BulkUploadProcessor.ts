/**
 * BulkUploadProcessor
 *
 * Processes bulk upload jobs from the BullMQ queue.
 *
 * Design Principles:
 * - Single Responsibility: Create file records and emit events
 * - Multi-tenant isolation: All operations require userId
 * - Graceful degradation: WebSocket failures don't fail file creation
 * - Retry-friendly: Throws on failure for BullMQ retry
 *
 * @module domains/files/bulk-upload
 */

import { createChildLogger } from '@/shared/utils/logger';
import {
  getSocketIO,
  isSocketServiceInitialized,
} from '@/services/websocket/SocketService';
import { getFileService } from '@/services/files/FileService';
import { getFileUploadService } from '@/services/files/FileUploadService';
import { getMessageQueue } from '@/infrastructure/queue/MessageQueue';
import { FILE_WS_CHANNELS, FILE_WS_EVENTS } from '@bc-agent/shared';
import type { Logger } from 'pino';
import type { Server as SocketServer } from 'socket.io';
import type { BulkUploadJobData, FileUploadedEvent, ParsedFile } from '@bc-agent/shared';
import type { IBulkUploadProcessor, BulkUploadProcessorResult } from './IBulkUploadProcessor';

/**
 * Interface for FileService (subset used by processor)
 */
interface IFileServiceMinimal {
  createFileRecord(options: {
    userId: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
    blobPath: string;
    parentFolderId?: string | null;
    contentHash?: string | null;
  }): Promise<string>;

  getFile(userId: string, fileId: string): Promise<ParsedFile | null>;
}

/**
 * Interface for FileUploadService (subset used by processor)
 */
interface IFileUploadServiceMinimal {
  blobExists(blobPath: string): Promise<boolean>;
}

/**
 * Interface for MessageQueue (subset used by processor)
 */
interface IMessageQueueMinimal {
  addFileProcessingJob(data: {
    fileId: string;
    userId: string;
    blobPath: string;
    mimeType: string;
  }): Promise<string>;
}

/**
 * Dependencies for BulkUploadProcessor (DI support for testing)
 */
export interface BulkUploadProcessorDependencies {
  logger?: Logger;
  fileService?: IFileServiceMinimal;
  fileUploadService?: IFileUploadServiceMinimal;
  messageQueue?: IMessageQueueMinimal;
  isSocketReady?: () => boolean;
  getIO?: () => SocketServer;
}

/**
 * BulkUploadProcessor implementation
 *
 * Processes bulk uploads with parallel-safe concurrency (unlike deletion).
 */
export class BulkUploadProcessor implements IBulkUploadProcessor {
  private static instance: BulkUploadProcessor | null = null;

  private readonly log: Logger;
  private readonly fileService: IFileServiceMinimal;
  private readonly fileUploadService: IFileUploadServiceMinimal;
  private readonly messageQueue: IMessageQueueMinimal;
  private readonly isSocketReady: () => boolean;
  private readonly getIO: () => SocketServer;

  constructor(deps?: BulkUploadProcessorDependencies) {
    this.log = deps?.logger ?? createChildLogger({ service: 'BulkUploadProcessor' });
    this.fileService = deps?.fileService ?? getFileService();
    this.fileUploadService = deps?.fileUploadService ?? getFileUploadService();
    this.messageQueue = deps?.messageQueue ?? getMessageQueue();
    this.isSocketReady = deps?.isSocketReady ?? isSocketServiceInitialized;
    this.getIO = deps?.getIO ?? getSocketIO;

    this.log.info('BulkUploadProcessor initialized');
  }

  public static getInstance(deps?: BulkUploadProcessorDependencies): BulkUploadProcessor {
    if (!BulkUploadProcessor.instance) {
      BulkUploadProcessor.instance = new BulkUploadProcessor(deps);
    }
    return BulkUploadProcessor.instance;
  }

  public static resetInstance(): void {
    BulkUploadProcessor.instance = null;
  }

  /**
   * Process a single bulk upload job
   */
  async processJob(data: BulkUploadJobData): Promise<BulkUploadProcessorResult> {
    const { tempId, userId, batchId, fileName, mimeType, sizeBytes, blobPath, contentHash, parentFolderId } = data;

    this.log.info({ tempId, userId, batchId, fileName, blobPath }, 'Processing bulk upload job');

    try {
      // 1. Verify blob exists at the specified path
      const exists = await this.fileUploadService.blobExists(blobPath);
      if (!exists) {
        const error = `Blob not found at path: ${blobPath}`;
        this.log.warn({ tempId, userId, blobPath }, error);

        // Emit failure event
        this.emitUploadedEvent(userId, {
          type: FILE_WS_EVENTS.UPLOADED,
          fileId: '',
          tempId,
          batchId,
          success: false,
          error,
          timestamp: new Date().toISOString(),
        });

        // Return failure result (don't throw - blob missing is not retryable)
        return {
          fileId: '',
          tempId,
          success: false,
          error,
          processingJobEnqueued: false,
        };
      }

      // 2. Create file record in database
      const fileId = await this.fileService.createFileRecord({
        userId,
        name: fileName,
        mimeType,
        sizeBytes,
        blobPath,
        parentFolderId: parentFolderId ?? null,
        contentHash: contentHash ?? null,
      });

      // 3. Get full file details for event
      const file = await this.fileService.getFile(userId, fileId);
      if (!file) {
        throw new Error(`File created but not found: ${fileId}`);
      }

      // 4. Enqueue FILE_PROCESSING job for text extraction
      let processingJobId: string | undefined;
      let processingJobEnqueued = false;

      try {
        processingJobId = await this.messageQueue.addFileProcessingJob({
          fileId,
          userId,
          blobPath,
          mimeType,
        });
        processingJobEnqueued = true;
        this.log.debug({ fileId, processingJobId }, 'FILE_PROCESSING job enqueued');
      } catch (processingError) {
        // Log but don't fail - file was created, processing can be retried manually
        this.log.warn(
          {
            fileId,
            error: processingError instanceof Error ? processingError.message : String(processingError),
          },
          'Failed to enqueue FILE_PROCESSING job'
        );
      }

      // 5. Emit success event via WebSocket
      this.emitUploadedEvent(userId, {
        type: FILE_WS_EVENTS.UPLOADED,
        fileId,
        tempId,
        batchId,
        success: true,
        file,
        timestamp: new Date().toISOString(),
      });

      this.log.info(
        { fileId, tempId, userId, batchId, processingJobEnqueued },
        'Bulk upload job completed successfully'
      );

      return {
        fileId,
        tempId,
        success: true,
        file,
        processingJobEnqueued,
        processingJobId,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Emit failure event via WebSocket (best-effort)
      this.emitUploadedEvent(userId, {
        type: FILE_WS_EVENTS.UPLOADED,
        fileId: '',
        tempId,
        batchId,
        success: false,
        error: errorMessage,
        timestamp: new Date().toISOString(),
      });

      this.log.error(
        {
          tempId,
          userId,
          batchId,
          fileName,
          error: errorMessage,
        },
        'Bulk upload job failed'
      );

      // Re-throw to let BullMQ retry
      throw error;
    }
  }

  /**
   * Emit file uploaded event via WebSocket
   *
   * Uses user-specific room for multi-tenant isolation.
   * Fails silently if Socket.IO not available.
   */
  private emitUploadedEvent(userId: string, event: FileUploadedEvent): void {
    if (!this.isSocketReady()) {
      this.log.warn({ userId, tempId: event.tempId }, 'Socket.IO not ready, skipping event emission');
      return;
    }

    try {
      const io = this.getIO();
      // Emit to user's room for multi-tenant isolation
      io.to(`user:${userId}`).emit(FILE_WS_CHANNELS.STATUS, event);

      this.log.debug(
        { userId, tempId: event.tempId, success: event.success },
        'Emitted file:uploaded event'
      );
    } catch (emitError) {
      // Log but don't fail - WebSocket is best-effort
      this.log.warn(
        {
          userId,
          tempId: event.tempId,
          error: emitError instanceof Error ? emitError.message : String(emitError),
        },
        'Failed to emit WebSocket event'
      );
    }
  }
}

/**
 * Get BulkUploadProcessor singleton instance
 */
export function getBulkUploadProcessor(
  deps?: BulkUploadProcessorDependencies
): BulkUploadProcessor {
  return BulkUploadProcessor.getInstance(deps);
}

/**
 * Reset BulkUploadProcessor singleton (for testing)
 */
export function __resetBulkUploadProcessor(): void {
  BulkUploadProcessor.resetInstance();
}
