/**
 * IFolderEventEmitter Interface
 *
 * Defines the contract for emitting folder upload session WebSocket events.
 * Follows ISP - only event emission methods.
 *
 * Design Principles:
 * - Single Responsibility: Only emits WebSocket events
 * - Graceful Degradation: Never throws if Socket.IO unavailable
 * - Multi-tenant isolation: Events targeted to user room
 *
 * @module domains/files/emission
 */

import type { FolderBatch } from '@bc-agent/shared';

/**
 * Context for folder event emission
 */
export interface FolderEventContext {
  /** Upload session ID */
  sessionId: string;

  /** User ID for multi-tenant routing */
  userId: string;
}

/**
 * Payload for session started event
 */
export interface SessionStartedPayload {
  totalFolders: number;
}

/**
 * Payload for session completed event
 */
export interface SessionCompletedPayload {
  completedFolders: number;
  failedFolders: number;
}

/**
 * Payload for session failed event
 */
export interface SessionFailedPayload {
  error: string;
  completedFolders: number;
  failedFolders: number;
}

/**
 * Payload for session cancelled event
 */
export interface SessionCancelledPayload {
  completedFolders: number;
  cancelledFolders: number;
  filesRolledBack: number;
}

/**
 * Payload for folder batch events
 */
export interface FolderBatchPayload {
  folderIndex: number;
  totalFolders: number;
  folderBatch: FolderBatch;
}

/**
 * Payload for folder batch failed event
 */
export interface FolderBatchFailedPayload extends FolderBatchPayload {
  error: string;
}

/**
 * Interface for FolderEventEmitter
 */
export interface IFolderEventEmitter {
  /**
   * Emit session started event.
   * Channel: folder:status
   *
   * Called when upload session begins.
   *
   * @param ctx - Event context (sessionId, userId)
   * @param payload - Session details
   */
  emitSessionStarted(ctx: FolderEventContext, payload: SessionStartedPayload): void;

  /**
   * Emit session completed event.
   * Channel: folder:status
   *
   * Called when all folders in session are processed.
   *
   * @param ctx - Event context
   * @param payload - Completion details
   */
  emitSessionCompleted(ctx: FolderEventContext, payload: SessionCompletedPayload): void;

  /**
   * Emit session failed event.
   * Channel: folder:status
   *
   * Called when session fails (too many folder failures).
   *
   * @param ctx - Event context
   * @param payload - Failure details
   */
  emitSessionFailed(ctx: FolderEventContext, payload: SessionFailedPayload): void;

  /**
   * Emit session cancelled event.
   * Channel: folder:status
   *
   * Called when user cancels the upload session.
   *
   * @param ctx - Event context
   * @param payload - Cancellation details including rollback count
   */
  emitSessionCancelled(ctx: FolderEventContext, payload: SessionCancelledPayload): void;

  /**
   * Emit batch started event.
   * Channel: folder:status
   *
   * Called when a folder batch begins processing.
   *
   * @param ctx - Event context
   * @param payload - Batch details
   */
  emitBatchStarted(ctx: FolderEventContext, payload: FolderBatchPayload): void;

  /**
   * Emit batch progress event.
   * Channel: folder:status
   *
   * Called when progress is made on a folder batch.
   *
   * @param ctx - Event context
   * @param payload - Progress details
   */
  emitBatchProgress(ctx: FolderEventContext, payload: FolderBatchPayload): void;

  /**
   * Emit batch completed event.
   * Channel: folder:status
   *
   * Called when a folder batch completes successfully.
   *
   * @param ctx - Event context
   * @param payload - Completion details
   */
  emitBatchCompleted(ctx: FolderEventContext, payload: FolderBatchPayload): void;

  /**
   * Emit batch failed event.
   * Channel: folder:status
   *
   * Called when a folder batch fails.
   *
   * @param ctx - Event context
   * @param payload - Failure details
   */
  emitBatchFailed(ctx: FolderEventContext, payload: FolderBatchFailedPayload): void;
}
