/**
 * FolderEventEmitter
 *
 * Centralized WebSocket event emitter for folder upload session updates.
 * Uses SocketService singleton to access Socket.IO instance.
 *
 * Design Principles:
 * - Single Responsibility: Only emits events, no business logic
 * - Graceful Degradation: Logs warning if Socket.IO unavailable
 * - No Failures: WebSocket errors never fail the calling operation
 *
 * Channel: folder:status - For all folder session and batch events
 *
 * @module domains/files/emission
 */

import { createChildLogger } from '@/shared/utils/logger';
import {
  getSocketIO,
  isSocketServiceInitialized,
} from '@/services/websocket/SocketService';
import { FOLDER_WS_CHANNELS, FOLDER_WS_EVENTS } from '@bc-agent/shared';
import type { Logger } from 'pino';
import type { Server as SocketServer } from 'socket.io';
import type {
  IFolderEventEmitter,
  FolderEventContext,
  SessionStartedPayload,
  SessionCompletedPayload,
  SessionFailedPayload,
  FolderBatchPayload,
  FolderBatchFailedPayload,
} from './IFolderEventEmitter';

/**
 * Dependencies for FolderEventEmitter (DI support for testing)
 */
export interface FolderEventEmitterDependencies {
  logger?: Logger;
  isSocketReady?: () => boolean;
  getIO?: () => SocketServer;
}

/**
 * FolderEventEmitter implementation
 */
export class FolderEventEmitter implements IFolderEventEmitter {
  private static instance: FolderEventEmitter | null = null;

  private readonly log: Logger;
  private readonly isSocketReady: () => boolean;
  private readonly getIO: () => SocketServer;

  private constructor(deps?: FolderEventEmitterDependencies) {
    this.log = deps?.logger ?? createChildLogger({ service: 'FolderEventEmitter' });
    this.isSocketReady = deps?.isSocketReady ?? isSocketServiceInitialized;
    this.getIO = deps?.getIO ?? getSocketIO;

    this.log.info('FolderEventEmitter initialized');
  }

  public static getInstance(deps?: FolderEventEmitterDependencies): FolderEventEmitter {
    if (!FolderEventEmitter.instance) {
      FolderEventEmitter.instance = new FolderEventEmitter(deps);
    }
    return FolderEventEmitter.instance;
  }

  public static resetInstance(): void {
    FolderEventEmitter.instance = null;
  }

  // =========================================================================
  // SESSION EVENTS
  // =========================================================================

  /**
   * Emit session started event
   * Channel: folder:status
   */
  emitSessionStarted(ctx: FolderEventContext, payload: SessionStartedPayload): void {
    this.emit(ctx, {
      type: FOLDER_WS_EVENTS.SESSION_STARTED,
      sessionId: ctx.sessionId,
      userId: ctx.userId,
      totalFolders: payload.totalFolders,
      timestamp: new Date().toISOString(),
    });

    this.log.debug(
      { sessionId: ctx.sessionId, totalFolders: payload.totalFolders },
      'Emitted session_started event'
    );
  }

  /**
   * Emit session completed event
   * Channel: folder:status
   */
  emitSessionCompleted(ctx: FolderEventContext, payload: SessionCompletedPayload): void {
    this.emit(ctx, {
      type: FOLDER_WS_EVENTS.SESSION_COMPLETED,
      sessionId: ctx.sessionId,
      userId: ctx.userId,
      completedFolders: payload.completedFolders,
      failedFolders: payload.failedFolders,
      timestamp: new Date().toISOString(),
    });

    this.log.info(
      { sessionId: ctx.sessionId, completedFolders: payload.completedFolders },
      'Emitted session_completed event'
    );
  }

  /**
   * Emit session failed event
   * Channel: folder:status
   */
  emitSessionFailed(ctx: FolderEventContext, payload: SessionFailedPayload): void {
    this.emit(ctx, {
      type: FOLDER_WS_EVENTS.SESSION_FAILED,
      sessionId: ctx.sessionId,
      userId: ctx.userId,
      error: payload.error,
      completedFolders: payload.completedFolders,
      failedFolders: payload.failedFolders,
      timestamp: new Date().toISOString(),
    });

    this.log.warn(
      { sessionId: ctx.sessionId, error: payload.error },
      'Emitted session_failed event'
    );
  }

  // =========================================================================
  // BATCH EVENTS
  // =========================================================================

  /**
   * Emit batch started event
   * Channel: folder:status
   */
  emitBatchStarted(ctx: FolderEventContext, payload: FolderBatchPayload): void {
    this.emit(ctx, {
      type: FOLDER_WS_EVENTS.BATCH_STARTED,
      sessionId: ctx.sessionId,
      userId: ctx.userId,
      folderIndex: payload.folderIndex,
      totalFolders: payload.totalFolders,
      folderBatch: payload.folderBatch,
      timestamp: new Date().toISOString(),
    });

    this.log.debug(
      { sessionId: ctx.sessionId, folderIndex: payload.folderIndex, folderName: payload.folderBatch.name },
      'Emitted batch_started event'
    );
  }

  /**
   * Emit batch progress event
   * Channel: folder:status
   */
  emitBatchProgress(ctx: FolderEventContext, payload: FolderBatchPayload): void {
    this.emit(ctx, {
      type: FOLDER_WS_EVENTS.BATCH_PROGRESS,
      sessionId: ctx.sessionId,
      userId: ctx.userId,
      folderIndex: payload.folderIndex,
      totalFolders: payload.totalFolders,
      folderBatch: payload.folderBatch,
      timestamp: new Date().toISOString(),
    });

    this.log.debug(
      {
        sessionId: ctx.sessionId,
        folderIndex: payload.folderIndex,
        uploadedFiles: payload.folderBatch.uploadedFiles,
        totalFiles: payload.folderBatch.totalFiles,
      },
      'Emitted batch_progress event'
    );
  }

  /**
   * Emit batch completed event
   * Channel: folder:status
   */
  emitBatchCompleted(ctx: FolderEventContext, payload: FolderBatchPayload): void {
    this.emit(ctx, {
      type: FOLDER_WS_EVENTS.BATCH_COMPLETED,
      sessionId: ctx.sessionId,
      userId: ctx.userId,
      folderIndex: payload.folderIndex,
      totalFolders: payload.totalFolders,
      folderBatch: payload.folderBatch,
      timestamp: new Date().toISOString(),
    });

    this.log.info(
      { sessionId: ctx.sessionId, folderIndex: payload.folderIndex, folderName: payload.folderBatch.name },
      'Emitted batch_completed event'
    );
  }

  /**
   * Emit batch failed event
   * Channel: folder:status
   */
  emitBatchFailed(ctx: FolderEventContext, payload: FolderBatchFailedPayload): void {
    this.emit(ctx, {
      type: FOLDER_WS_EVENTS.BATCH_FAILED,
      sessionId: ctx.sessionId,
      userId: ctx.userId,
      folderIndex: payload.folderIndex,
      totalFolders: payload.totalFolders,
      folderBatch: payload.folderBatch,
      error: payload.error,
      timestamp: new Date().toISOString(),
    });

    this.log.warn(
      { sessionId: ctx.sessionId, folderIndex: payload.folderIndex, error: payload.error },
      'Emitted batch_failed event'
    );
  }

  // =========================================================================
  // PRIVATE HELPERS
  // =========================================================================

  /**
   * Safe emit to WebSocket - never throws
   *
   * Emits to user room for folder events (not session-specific).
   */
  private emit(ctx: FolderEventContext, payload: Record<string, unknown>): void {
    const { userId } = ctx;

    // Skip if Socket.IO not initialized
    if (!this.isSocketReady()) {
      this.log.debug(
        { sessionId: ctx.sessionId },
        'Skipping event: Socket.IO not initialized'
      );
      return;
    }

    // Warn if no user room target
    if (!userId) {
      this.log.warn(
        { sessionId: ctx.sessionId },
        'Skipping WebSocket event: no userId - frontend will not receive update'
      );
      return;
    }

    try {
      const io = this.getIO();

      // Emit to user room (for file explorer)
      const userRoom = `user:${userId}`;
      this.log.debug(
        { userRoom, sessionId: ctx.sessionId, type: payload.type },
        'Emitting to user room'
      );
      io.to(userRoom).emit(FOLDER_WS_CHANNELS.STATUS, payload);
    } catch (error) {
      // Log but never throw - WebSocket errors should not fail operations
      this.log.error(
        {
          error: error instanceof Error ? error.message : String(error),
          sessionId: ctx.sessionId,
        },
        'Failed to emit WebSocket event'
      );
    }
  }
}

// ===== Convenience Getters =====

/**
 * Get the singleton FolderEventEmitter instance
 */
export function getFolderEventEmitter(
  deps?: FolderEventEmitterDependencies
): FolderEventEmitter {
  return FolderEventEmitter.getInstance(deps);
}

/**
 * Reset the singleton instance (for testing)
 */
export function __resetFolderEventEmitter(): void {
  FolderEventEmitter.resetInstance();
}
