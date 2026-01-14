/**
 * IFileEventEmitter Interface
 *
 * Defines the contract for emitting file status WebSocket events.
 * Follows ISP - only event emission methods.
 *
 * Design Principles:
 * - Single Responsibility: Only emits WebSocket events
 * - Graceful Degradation: Never throws if Socket.IO unavailable
 * - Multi-tenant isolation: Events targeted to session room
 *
 * @module domains/files/emission
 */

import type {
  FileReadinessState,
  ProcessingStatus,
  EmbeddingStatus,
} from '@bc-agent/shared';

/**
 * Context for event emission (from job data or service call)
 */
export interface FileEventContext {
  fileId: string;
  userId: string;
  sessionId?: string;
}

/**
 * Payload for readiness state change event
 */
export interface ReadinessChangedPayload {
  previousState?: FileReadinessState;
  newState: FileReadinessState;
  processingStatus: ProcessingStatus;
  embeddingStatus: EmbeddingStatus;
}

/**
 * Payload for permanent failure event
 */
export interface PermanentlyFailedPayload {
  error: string;
  processingRetryCount: number;
  embeddingRetryCount: number;
  canRetryManually: boolean;
}

/**
 * Payload for processing progress event
 */
export interface ProcessingProgressPayload {
  progress: number;
  status: ProcessingStatus;
  attemptNumber: number;
  maxAttempts: number;
}

/**
 * Stats for processing completion event
 */
export interface CompletionStats {
  textLength: number;
  pageCount: number;
  ocrUsed: boolean;
}

/**
 * Interface for FileEventEmitter
 */
export interface IFileEventEmitter {
  /**
   * Emit readiness state change event.
   * Channel: file:status
   *
   * Called when file transitions between states:
   * - uploading -> processing
   * - processing -> ready
   * - processing -> failed
   * - failed -> processing (on retry)
   *
   * @param ctx - Event context (fileId, userId, sessionId)
   * @param payload - State change payload
   */
  emitReadinessChanged(ctx: FileEventContext, payload: ReadinessChangedPayload): void;

  /**
   * Emit permanent failure event.
   * Channel: file:status
   *
   * Called when file has exhausted all retries.
   *
   * @param ctx - Event context
   * @param payload - Failure details
   */
  emitPermanentlyFailed(ctx: FileEventContext, payload: PermanentlyFailedPayload): void;

  /**
   * Emit processing progress event.
   * Channel: file:processing
   *
   * Called during text extraction/chunking/embedding.
   *
   * @param ctx - Event context
   * @param payload - Progress details with attempt info
   */
  emitProgress(ctx: FileEventContext, payload: ProcessingProgressPayload): void;

  /**
   * Emit processing completion event.
   * Channel: file:processing
   *
   * Called when processing step completes successfully.
   *
   * @param ctx - Event context
   * @param stats - Completion statistics
   */
  emitCompletion(ctx: FileEventContext, stats: CompletionStats): void;

  /**
   * Emit processing error event.
   * Channel: file:processing
   *
   * Called when processing fails (before retry decision).
   *
   * @param ctx - Event context
   * @param errorMessage - Error details
   */
  emitError(ctx: FileEventContext, errorMessage: string): void;
}
