/**
 * FileEventEmitter
 *
 * Centralized WebSocket event emitter for file status updates.
 * Uses SocketService singleton to access Socket.IO instance.
 *
 * Design Principles:
 * - Single Responsibility: Only emits events, no business logic
 * - Graceful Degradation: Logs warning if Socket.IO unavailable
 * - No Failures: WebSocket errors never fail the calling operation
 *
 * Channels:
 * - file:status - For readiness state changes and permanent failures
 * - file:processing - For progress, completion, and error events
 *
 * @module domains/files/emission
 */

import { createChildLogger } from '@/shared/utils/logger';
import {
  getSocketIO,
  isSocketServiceInitialized,
} from '@/services/websocket/SocketService';
import { FILE_WS_CHANNELS, FILE_WS_EVENTS, PROCESSING_STATUS } from '@bc-agent/shared';
import type { Logger } from 'pino';
import type { Server as SocketServer } from 'socket.io';
import type {
  IFileEventEmitter,
  FileEventContext,
  ReadinessChangedPayload,
  PermanentlyFailedPayload,
  ProcessingProgressPayload,
  CompletionStats,
} from './IFileEventEmitter';

/**
 * Dependencies for FileEventEmitter (DI support for testing)
 */
export interface FileEventEmitterDependencies {
  logger?: Logger;
  isSocketReady?: () => boolean;
  getIO?: () => SocketServer;
}

/**
 * FileEventEmitter implementation
 */
export class FileEventEmitter implements IFileEventEmitter {
  private static instance: FileEventEmitter | null = null;

  private readonly log: Logger;
  private readonly isSocketReady: () => boolean;
  private readonly getIO: () => SocketServer;

  private constructor(deps?: FileEventEmitterDependencies) {
    this.log = deps?.logger ?? createChildLogger({ service: 'FileEventEmitter' });
    this.isSocketReady = deps?.isSocketReady ?? isSocketServiceInitialized;
    this.getIO = deps?.getIO ?? getSocketIO;

    this.log.info('FileEventEmitter initialized');
  }

  public static getInstance(deps?: FileEventEmitterDependencies): FileEventEmitter {
    if (!FileEventEmitter.instance) {
      FileEventEmitter.instance = new FileEventEmitter(deps);
    }
    return FileEventEmitter.instance;
  }

  public static resetInstance(): void {
    FileEventEmitter.instance = null;
  }

  /**
   * Emit readiness state change event
   * Channel: file:status
   */
  emitReadinessChanged(ctx: FileEventContext, payload: ReadinessChangedPayload): void {
    this.emit(ctx, FILE_WS_CHANNELS.STATUS, {
      type: FILE_WS_EVENTS.READINESS_CHANGED,
      fileId: ctx.fileId,
      userId: ctx.userId,
      previousState: payload.previousState,
      readinessState: payload.newState,
      processingStatus: payload.processingStatus,
      embeddingStatus: payload.embeddingStatus,
      timestamp: new Date().toISOString(),
    });

    this.log.debug(
      { fileId: ctx.fileId, newState: payload.newState },
      'Emitted readiness_changed event'
    );
  }

  /**
   * Emit permanent failure event
   * Channel: file:status
   */
  emitPermanentlyFailed(ctx: FileEventContext, payload: PermanentlyFailedPayload): void {
    this.emit(ctx, FILE_WS_CHANNELS.STATUS, {
      type: FILE_WS_EVENTS.PERMANENTLY_FAILED,
      fileId: ctx.fileId,
      userId: ctx.userId,
      error: payload.error,
      processingRetryCount: payload.processingRetryCount,
      embeddingRetryCount: payload.embeddingRetryCount,
      canRetryManually: payload.canRetryManually,
      timestamp: new Date().toISOString(),
    });

    this.log.info(
      {
        fileId: ctx.fileId,
        processingRetryCount: payload.processingRetryCount,
        embeddingRetryCount: payload.embeddingRetryCount,
      },
      'Emitted permanently_failed event'
    );
  }

  /**
   * Emit processing progress event
   * Channel: file:processing
   */
  emitProgress(ctx: FileEventContext, payload: ProcessingProgressPayload): void {
    this.emit(ctx, FILE_WS_CHANNELS.PROCESSING, {
      type: FILE_WS_EVENTS.PROCESSING_PROGRESS,
      fileId: ctx.fileId,
      status: payload.status,
      progress: payload.progress,
      attemptNumber: payload.attemptNumber,
      maxAttempts: payload.maxAttempts,
      timestamp: new Date().toISOString(),
    });

    this.log.debug(
      {
        fileId: ctx.fileId,
        progress: payload.progress,
        attemptNumber: payload.attemptNumber,
      },
      'Emitted processing_progress event'
    );
  }

  /**
   * Emit processing completion event
   * Channel: file:processing
   */
  emitCompletion(ctx: FileEventContext, stats: CompletionStats): void {
    this.emit(ctx, FILE_WS_CHANNELS.PROCESSING, {
      type: FILE_WS_EVENTS.PROCESSING_COMPLETED,
      fileId: ctx.fileId,
      status: PROCESSING_STATUS.COMPLETED,
      stats,
      progress: 100,
      timestamp: new Date().toISOString(),
    });

    this.log.debug({ fileId: ctx.fileId, stats }, 'Emitted processing_completed event');
  }

  /**
   * Emit processing error event
   * Channel: file:processing
   */
  emitError(ctx: FileEventContext, errorMessage: string): void {
    this.emit(ctx, FILE_WS_CHANNELS.PROCESSING, {
      type: FILE_WS_EVENTS.PROCESSING_FAILED,
      fileId: ctx.fileId,
      status: PROCESSING_STATUS.FAILED,
      error: errorMessage,
      timestamp: new Date().toISOString(),
    });

    this.log.debug({ fileId: ctx.fileId }, 'Emitted processing_failed event');
  }

  // ===== Private Helpers =====

  /**
   * Safe emit to WebSocket - never throws
   */
  private emit(
    ctx: FileEventContext,
    channel: string,
    payload: Record<string, unknown>
  ): void {
    const { sessionId } = ctx;

    // Skip if no session to target
    if (!sessionId) {
      this.log.debug(
        { fileId: ctx.fileId, channel },
        'Skipping event: no sessionId'
      );
      return;
    }

    // Skip if Socket.IO not initialized
    if (!this.isSocketReady()) {
      this.log.debug(
        { fileId: ctx.fileId, channel },
        'Skipping event: Socket.IO not initialized'
      );
      return;
    }

    try {
      const io = this.getIO();
      io.to(sessionId).emit(channel, payload);
    } catch (error) {
      // Log but never throw - WebSocket errors should not fail jobs
      this.log.error(
        {
          error: error instanceof Error ? error.message : String(error),
          fileId: ctx.fileId,
          channel,
        },
        'Failed to emit WebSocket event'
      );
    }
  }
}

// ===== Convenience Getters =====

/**
 * Get the singleton FileEventEmitter instance
 */
export function getFileEventEmitter(
  deps?: FileEventEmitterDependencies
): FileEventEmitter {
  return FileEventEmitter.getInstance(deps);
}

/**
 * Reset the singleton instance (for testing)
 */
export function __resetFileEventEmitter(): void {
  FileEventEmitter.resetInstance();
}
