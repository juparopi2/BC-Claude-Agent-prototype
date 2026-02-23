/**
 * File Processing Constants
 *
 * Centralized constants for file processing status values.
 *
 * @module @bc-agent/shared/constants/file-processing
 */

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

// ============================================================================
// FILE DELETION CONFIGURATION (Bulk Delete)
// ============================================================================

/**
 * Configuration for file deletion queue processing.
 * Used to avoid SQL deadlocks by processing deletions sequentially.
 *
 * @example
 * ```typescript
 * import { FILE_DELETION_CONFIG } from '@bc-agent/shared';
 *
 * const worker = new Worker(queueName, processor, {
 *   concurrency: FILE_DELETION_CONFIG.QUEUE_CONCURRENCY,
 * });
 * ```
 */
export const FILE_DELETION_CONFIG = {
  /** Maximum files per bulk delete request */
  MAX_BATCH_SIZE: 100,

  /** Queue worker concurrency (1 = sequential to avoid deadlocks) */
  QUEUE_CONCURRENCY: 1,

  /** Maximum retry attempts for failed deletion jobs */
  MAX_RETRY_ATTEMPTS: 3,

  /** Initial retry delay in milliseconds (exponential backoff) */
  RETRY_DELAY_MS: 1000,
} as const;

// ============================================================================
// FOLDER UPLOAD SESSION CONFIGURATION
// ============================================================================

/**
 * Configuration for folder-based upload sessions.
 * Controls limits, concurrency, and TTL for upload sessions.
 *
 * Key Design Decisions:
 * - Folders processed sequentially for clear progress feedback
 * - Files within a folder uploaded in parallel (20 concurrent)
 * - Session stored in Redis with 4-hour TTL
 *
 * @example
 * ```typescript
 * import { FOLDER_UPLOAD_CONFIG } from '@bc-agent/shared';
 *
 * // Validate folder count
 * if (folders.length > FOLDER_UPLOAD_CONFIG.MAX_FOLDERS_PER_SESSION) {
 *   throw new Error('Too many folders');
 * }
 *
 * // Configure parallel uploads
 * const concurrency = FOLDER_UPLOAD_CONFIG.FILE_UPLOAD_CONCURRENCY;
 * ```
 */
export const FOLDER_UPLOAD_CONFIG = {
  /** Maximum number of folders per upload session */
  MAX_FOLDERS_PER_SESSION: 50,

  /** Maximum files per folder batch (split folder if exceeded) */
  MAX_FILES_PER_FOLDER_BATCH: 1000,

  /** Concurrency for file uploads within a folder */
  FILE_UPLOAD_CONCURRENCY: 20,

  /** Session TTL in milliseconds (4 hours) */
  SESSION_TTL_MS: 4 * 60 * 60 * 1000,

  /** Heartbeat interval for keeping session alive (1 minute) */
  HEARTBEAT_INTERVAL_MS: 60 * 1000,

  /** Maximum session inactivity before auto-pause (5 minutes) */
  MAX_INACTIVITY_MS: 5 * 60 * 1000,

  /** Maximum consecutive folder failures before session abort */
  MAX_CONSECUTIVE_FAILURES: 3,

  /** Maximum concurrent upload sessions per user */
  MAX_CONCURRENT_SESSIONS: 50,
} as const;
