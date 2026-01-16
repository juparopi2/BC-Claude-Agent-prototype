/**
 * FileDeletionProcessor
 *
 * Processes file deletion jobs from the BullMQ queue.
 *
 * Design Principles:
 * - Single Responsibility: Delete files and emit events
 * - Multi-tenant isolation: All operations require userId
 * - Graceful degradation: WebSocket failures don't fail deletion
 * - Retry-friendly: Throws on failure for BullMQ retry
 *
 * @module domains/files/deletion
 */

import { createChildLogger } from '@/shared/utils/logger';
import {
  getSocketIO,
  isSocketServiceInitialized,
} from '@/services/websocket/SocketService';
import { getFileService } from '@/services/files/FileService';
import { getFileUploadService } from '@/services/files/FileUploadService';
import { FILE_WS_CHANNELS, FILE_WS_EVENTS } from '@bc-agent/shared';
import type { Logger } from 'pino';
import type { Server as SocketServer } from 'socket.io';
import type { FileDeletionJobData, FileDeletedEvent, DeletionReason } from '@bc-agent/shared';
import type { IFileDeletionProcessor, FileDeletionResult } from './IFileDeletionProcessor';

/**
 * Interface for FileService (subset used by processor)
 */
interface IFileServiceMinimal {
  deleteFile(
    userId: string,
    fileId: string,
    options?: { deletionReason?: DeletionReason }
  ): Promise<string[]>;
}

/**
 * Interface for FileUploadService (subset used by processor)
 */
interface IFileUploadServiceMinimal {
  deleteFromBlob(blobPath: string): Promise<void>;
}

/**
 * Dependencies for FileDeletionProcessor (DI support for testing)
 */
export interface FileDeletionProcessorDependencies {
  logger?: Logger;
  fileService?: IFileServiceMinimal;
  fileUploadService?: IFileUploadServiceMinimal;
  isSocketReady?: () => boolean;
  getIO?: () => SocketServer;
}

/**
 * FileDeletionProcessor implementation
 *
 * Processes file deletions sequentially to avoid SQL deadlocks.
 */
export class FileDeletionProcessor implements IFileDeletionProcessor {
  private static instance: FileDeletionProcessor | null = null;

  private readonly log: Logger;
  private readonly fileService: IFileServiceMinimal;
  private readonly fileUploadService: IFileUploadServiceMinimal;
  private readonly isSocketReady: () => boolean;
  private readonly getIO: () => SocketServer;

  constructor(deps?: FileDeletionProcessorDependencies) {
    this.log = deps?.logger ?? createChildLogger({ service: 'FileDeletionProcessor' });
    this.fileService = deps?.fileService ?? getFileService();
    this.fileUploadService = deps?.fileUploadService ?? getFileUploadService();
    this.isSocketReady = deps?.isSocketReady ?? isSocketServiceInitialized;
    this.getIO = deps?.getIO ?? getSocketIO;

    this.log.info('FileDeletionProcessor initialized');
  }

  public static getInstance(deps?: FileDeletionProcessorDependencies): FileDeletionProcessor {
    if (!FileDeletionProcessor.instance) {
      FileDeletionProcessor.instance = new FileDeletionProcessor(deps);
    }
    return FileDeletionProcessor.instance;
  }

  public static resetInstance(): void {
    FileDeletionProcessor.instance = null;
  }

  /**
   * Process a single file deletion job
   */
  async processJob(data: FileDeletionJobData): Promise<FileDeletionResult> {
    const { fileId, userId, deletionReason, batchId } = data;

    this.log.info({ fileId, userId, batchId, deletionReason }, 'Processing file deletion job');

    try {
      // 1. Delete file from database (cascades to chunks, AI Search, audit)
      const blobPaths = await this.fileService.deleteFile(userId, fileId, {
        deletionReason,
      });

      // 2. Delete blobs from Azure Blob Storage
      if (blobPaths.length > 0) {
        await Promise.all(
          blobPaths.map(async (blobPath) => {
            try {
              await this.fileUploadService.deleteFromBlob(blobPath);
              this.log.debug({ fileId, blobPath }, 'Blob deleted');
            } catch (blobError) {
              // Log but don't fail - blob can be cleaned up later
              this.log.warn(
                {
                  fileId,
                  blobPath,
                  error: blobError instanceof Error ? blobError.message : String(blobError),
                },
                'Failed to delete blob (eventual consistency)'
              );
            }
          })
        );
      }

      // 3. Emit success event via WebSocket
      this.emitDeletedEvent(userId, {
        type: FILE_WS_EVENTS.DELETED,
        fileId,
        batchId,
        success: true,
        timestamp: new Date().toISOString(),
      });

      this.log.info(
        { fileId, userId, batchId, blobPathsDeleted: blobPaths.length },
        'File deletion completed successfully'
      );

      return {
        fileId,
        success: true,
        blobPathsDeleted: blobPaths.length,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Emit failure event via WebSocket (best-effort)
      this.emitDeletedEvent(userId, {
        type: FILE_WS_EVENTS.DELETED,
        fileId,
        batchId,
        success: false,
        error: errorMessage,
        timestamp: new Date().toISOString(),
      });

      this.log.error(
        {
          fileId,
          userId,
          batchId,
          error: errorMessage,
        },
        'File deletion failed'
      );

      // Re-throw to let BullMQ retry
      throw error;
    }
  }

  /**
   * Emit file deleted event via WebSocket
   *
   * Uses user-specific room for multi-tenant isolation.
   * Fails silently if Socket.IO not available.
   */
  private emitDeletedEvent(userId: string, event: FileDeletedEvent): void {
    if (!this.isSocketReady()) {
      this.log.warn({ userId, fileId: event.fileId }, 'Socket.IO not ready, skipping event emission');
      return;
    }

    try {
      const io = this.getIO();
      // Emit to user's room for multi-tenant isolation
      io.to(`user:${userId}`).emit(FILE_WS_CHANNELS.STATUS, event);

      this.log.debug(
        { userId, fileId: event.fileId, success: event.success },
        'Emitted file:deleted event'
      );
    } catch (emitError) {
      // Log but don't fail - WebSocket is best-effort
      this.log.warn(
        {
          userId,
          fileId: event.fileId,
          error: emitError instanceof Error ? emitError.message : String(emitError),
        },
        'Failed to emit WebSocket event'
      );
    }
  }
}

/**
 * Get FileDeletionProcessor singleton instance
 */
export function getFileDeletionProcessor(
  deps?: FileDeletionProcessorDependencies
): FileDeletionProcessor {
  return FileDeletionProcessor.getInstance(deps);
}

/**
 * Reset FileDeletionProcessor singleton (for testing)
 */
export function __resetFileDeletionProcessor(): void {
  FileDeletionProcessor.resetInstance();
}
