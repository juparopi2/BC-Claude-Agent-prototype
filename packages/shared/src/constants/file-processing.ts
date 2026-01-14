/**
 * File Processing Constants
 *
 * Centralized constants for file processing status values.
 * These match the ProcessingStatus and EmbeddingStatus types.
 *
 * Usage:
 * ```typescript
 * import { PROCESSING_STATUS, EMBEDDING_STATUS } from '@bc-agent/shared';
 *
 * await updateStatus(fileId, PROCESSING_STATUS.COMPLETED);
 * ```
 *
 * @module @bc-agent/shared/constants/file-processing
 */

// ============================================================================
// PROCESSING STATUS VALUES
// ============================================================================

/**
 * Processing status values for file text extraction.
 * Matches the ProcessingStatus type in file.types.ts.
 */
export const PROCESSING_STATUS = {
  /** File uploaded, awaiting processing */
  PENDING: 'pending',
  /** Worker is extracting text/generating previews */
  PROCESSING: 'processing',
  /** Processing finished successfully */
  COMPLETED: 'completed',
  /** Processing failed (check logs for details) */
  FAILED: 'failed',
} as const;

/**
 * Type derived from PROCESSING_STATUS constant.
 * Should match ProcessingStatus type.
 */
export type ProcessingStatusValue = (typeof PROCESSING_STATUS)[keyof typeof PROCESSING_STATUS];

// ============================================================================
// EMBEDDING STATUS VALUES
// ============================================================================

/**
 * Embedding status values for vector search indexing.
 * Matches the EmbeddingStatus type in file.types.ts.
 */
export const EMBEDDING_STATUS = {
  /** Text extraction not complete yet */
  PENDING: 'pending',
  /** Chunking/embedding job queued */
  QUEUED: 'queued',
  /** Embedding generation in progress */
  PROCESSING: 'processing',
  /** Embeddings generated and indexed */
  COMPLETED: 'completed',
  /** Embedding generation failed */
  FAILED: 'failed',
} as const;

/**
 * Type derived from EMBEDDING_STATUS constant.
 * Should match EmbeddingStatus type.
 */
export type EmbeddingStatusValue = (typeof EMBEDDING_STATUS)[keyof typeof EMBEDDING_STATUS];

// ============================================================================
// FILE READINESS STATE VALUES
// ============================================================================

/**
 * File readiness state values for UI display.
 * Matches the FileReadinessState type in file.types.ts.
 */
export const FILE_READINESS_STATE = {
  /** File is being uploaded */
  UPLOADING: 'uploading',
  /** File is being processed (text extraction or embedding) */
  PROCESSING: 'processing',
  /** File is ready for RAG queries */
  READY: 'ready',
  /** File processing failed permanently */
  FAILED: 'failed',
} as const;

/**
 * Type derived from FILE_READINESS_STATE constant.
 * Should match FileReadinessState type.
 */
export type FileReadinessStateValue = (typeof FILE_READINESS_STATE)[keyof typeof FILE_READINESS_STATE];
