/**
 * Upload Session Types
 *
 * Types for folder-based batch processing and transactional upload sessions.
 * These types enable the frontend to track upload progress by folder instead
 * of arbitrary batch sizes.
 *
 * Key Concepts:
 * - UploadSession: A complete multi-folder upload operation
 * - FolderBatch: A single folder being uploaded with its files
 * - Early Persistence: Files are registered in DB before blob upload
 *
 * Flow:
 * 1. User selects folders
 * 2. UploadSession created with FolderBatch for each folder
 * 3. Each folder processed sequentially (create folder -> register files -> upload blobs)
 * 4. Progress tracked per folder for clear UX feedback
 *
 * @module @bc-agent/shared/types/upload-session
 */

import { FOLDER_WS_EVENTS } from '../constants/websocket-events';

// ============================================================================
// FOLDER BATCH STATUS
// ============================================================================

/**
 * Status values for a folder batch during upload
 *
 * Lifecycle:
 * - `pending`: In queue, waiting for previous folders to complete
 * - `creating`: Creating folder record in database
 * - `registering`: Registering file metadata in DB (early persistence)
 * - `uploading`: Uploading files to Azure Blob Storage
 * - `processing`: Files uploaded, processing jobs enqueued
 * - `completed`: All files in folder processed successfully
 * - `failed`: Fatal error occurred, folder batch abandoned
 */
export type FolderBatchStatus =
  | 'pending'
  | 'creating'
  | 'registering'
  | 'uploading'
  | 'processing'
  | 'completed'
  | 'failed';

// ============================================================================
// UPLOAD SESSION STATUS
// ============================================================================

/**
 * Status values for an upload session
 *
 * Lifecycle:
 * - `initializing`: Session created, folders being analyzed
 * - `active`: Session in progress, folders being processed
 * - `paused`: Session paused by user (future feature)
 * - `completed`: All folders completed successfully
 * - `failed`: Session failed (too many folder failures)
 * - `expired`: Session TTL exceeded (Redis cleanup)
 */
export type UploadSessionStatus =
  | 'initializing'
  | 'active'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'expired';

// ============================================================================
// FILE REGISTRATION METADATA
// ============================================================================

/**
 * File metadata for early registration (before blob upload)
 *
 * Used when registering files in the database before the actual
 * blob upload begins. This enables "early persistence" where files
 * appear in the UI immediately with 'uploading' state.
 *
 * @example
 * ```typescript
 * const file: FileRegistrationMetadata = {
 *   tempId: 'temp-abc123',
 *   fileName: 'document.pdf',
 *   mimeType: 'application/pdf',
 *   sizeBytes: 1024000,
 * };
 * ```
 */
export interface FileRegistrationMetadata {
  /** Client-generated temporary ID for correlation */
  tempId: string;

  /** Original filename */
  fileName: string;

  /** MIME type of the file */
  mimeType: string;

  /** File size in bytes */
  sizeBytes: number;
}

// ============================================================================
// FOLDER BATCH
// ============================================================================

/**
 * Represents a single folder being uploaded with all its files
 *
 * A FolderBatch is the unit of transactional upload - either all files
 * in the folder are uploaded successfully, or the batch fails.
 *
 * Progress tracking:
 * - `totalFiles`: Total files to upload in this folder
 * - `registeredFiles`: Files registered in DB (early persistence)
 * - `uploadedFiles`: Files successfully uploaded to blob
 * - `processedFiles`: Files with processing jobs completed
 *
 * @example
 * ```typescript
 * const batch: FolderBatch = {
 *   tempId: 'temp-folder-123',
 *   name: 'Marketing Materials',
 *   parentTempId: null,
 *   totalFiles: 45,
 *   registeredFiles: 45,
 *   uploadedFiles: 30,
 *   processedFiles: 15,
 *   status: 'uploading',
 *   startedAt: 1705312200000,
 * };
 * ```
 */
export interface FolderBatch {
  /** Client-generated temporary ID for correlation */
  tempId: string;

  /** Database folder ID (assigned after creation) */
  folderId?: string;

  /** Folder name */
  name: string;

  /** Parent folder temp ID for nested structure */
  parentTempId?: string | null;

  /** Parent folder database ID (assigned after parent creation) */
  parentFolderId?: string | null;

  /** Total number of files in this folder */
  totalFiles: number;

  /** Files registered in database (early persistence) */
  registeredFiles: number;

  /** Files successfully uploaded to blob storage */
  uploadedFiles: number;

  /** Files with processing completed */
  processedFiles: number;

  /** Current batch status */
  status: FolderBatchStatus;

  /** Error message if status is 'failed' */
  error?: string;

  /** Timestamp when batch processing started (ms since epoch) */
  startedAt?: number;

  /** Timestamp when batch completed (ms since epoch) */
  completedAt?: number;
}

// ============================================================================
// UPLOAD SESSION
// ============================================================================

/**
 * Represents a complete multi-folder upload session
 *
 * An UploadSession tracks the progress of uploading multiple folders.
 * Stored in Redis with TTL for automatic cleanup.
 *
 * Session structure:
 * - Created when user initiates folder upload
 * - Contains array of FolderBatch (one per folder)
 * - Folders processed sequentially for clear progress feedback
 * - Expires after TTL if abandoned
 *
 * @example
 * ```typescript
 * const session: UploadSession = {
 *   id: 'SESSION-ABC123',
 *   userId: 'USER-456',
 *   totalFolders: 6,
 *   currentFolderIndex: 1,
 *   completedFolders: 1,
 *   failedFolders: 0,
 *   status: 'active',
 *   folderBatches: [...],
 *   createdAt: 1705312200000,
 *   updatedAt: 1705312260000,
 *   expiresAt: 1705326600000,
 * };
 * ```
 */
export interface UploadSession {
  /** Unique session ID (UUID) */
  id: string;

  /** Owner user ID */
  userId: string;

  /** Total number of folders in session */
  totalFolders: number;

  /** Index of currently processing folder (0-based, -1 if not started) */
  currentFolderIndex: number;

  /** Number of folders completed successfully */
  completedFolders: number;

  /** Number of folders that failed */
  failedFolders: number;

  /** Current session status */
  status: UploadSessionStatus;

  /** Array of folder batches (one per folder) */
  folderBatches: FolderBatch[];

  /** Timestamp when session was created (ms since epoch) */
  createdAt: number;

  /** Timestamp when session was last updated (ms since epoch) */
  updatedAt: number;

  /** Timestamp when session expires (ms since epoch) */
  expiresAt: number;
}

// ============================================================================
// UPLOAD SESSION PROGRESS
// ============================================================================

/**
 * Computed progress information for an upload session
 *
 * Derived from UploadSession for easy progress bar display.
 * Progress is calculated based on files (not folders) for smoother UX.
 *
 * @example
 * ```typescript
 * const progress: UploadSessionProgress = {
 *   sessionId: 'SESSION-ABC123',
 *   currentFolderIndex: 2,
 *   totalFolders: 6,
 *   currentFolder: { tempId: '...', name: 'Documents', ... },
 *   overallPercent: 33,
 *   completedFolders: 2,
 *   failedFolders: 0,
 *   status: 'active',
 *   totalFiles: 150,
 *   uploadedFiles: 50,
 * };
 * ```
 */
export interface UploadSessionProgress {
  /** Session ID */
  sessionId: string;

  /** Current folder index (0-based) */
  currentFolderIndex: number;

  /** Total folders in session */
  totalFolders: number;

  /** Current folder being processed (null if completed/failed) */
  currentFolder: FolderBatch | null;

  /** Overall progress percentage (0-100), based on file counts */
  overallPercent: number;

  /** Completed folder count */
  completedFolders: number;

  /** Failed folder count */
  failedFolders: number;

  /** Session status */
  status: UploadSessionStatus;

  /** Total files across all folders in the session */
  totalFiles: number;

  /** Files successfully uploaded across all folders */
  uploadedFiles: number;
}

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================

/**
 * Single folder input for upload session initialization
 *
 * Used in the request to create a new upload session.
 */
export interface FolderInput {
  /** Client-generated temporary ID */
  tempId: string;

  /** Folder name */
  name: string;

  /** Parent folder temp ID (null for root-level in target folder) */
  parentTempId?: string | null;

  /** Files in this folder */
  files: FileRegistrationMetadata[];
}

/**
 * Request body for initializing an upload session
 * POST /api/files/upload-session/init
 *
 * @example
 * ```typescript
 * const request: InitUploadSessionRequest = {
 *   folders: [
 *     {
 *       tempId: 'temp-1',
 *       name: 'Documents',
 *       parentTempId: null,
 *       files: [
 *         { tempId: 'file-1', fileName: 'doc.pdf', mimeType: 'application/pdf', sizeBytes: 1024 }
 *       ]
 *     }
 *   ],
 *   targetFolderId: 'FOLDER-123',
 * };
 * ```
 */
export interface InitUploadSessionRequest {
  /** Array of folders with their files */
  folders: FolderInput[];

  /** Target folder ID where root folders will be created (null = root level) */
  targetFolderId?: string | null;
}

/**
 * Response for upload session initialization
 * POST /api/files/upload-session/init
 *
 * @example
 * ```typescript
 * const response: InitUploadSessionResponse = {
 *   sessionId: 'SESSION-ABC123',
 *   folderBatches: [...],
 *   expiresAt: '2026-01-16T14:30:00.000Z',
 * };
 * ```
 */
export interface InitUploadSessionResponse {
  /** Created session ID */
  sessionId: string;

  /** Folder batches with initial status */
  folderBatches: FolderBatch[];

  /** ISO 8601 timestamp when session expires */
  expiresAt: string;
}

/**
 * Response for folder creation in upload session
 * POST /api/files/upload-session/:sessionId/folder/:tempId/create
 *
 * @example
 * ```typescript
 * const response: CreateFolderInSessionResponse = {
 *   folderId: 'FOLDER-ABC123',
 *   folderBatch: { ... },
 * };
 * ```
 */
export interface CreateFolderInSessionResponse {
  /** Created folder database ID */
  folderId: string;

  /** Updated folder batch status */
  folderBatch: FolderBatch;
}

/**
 * Registered file result after early persistence
 */
export interface RegisteredFileResult {
  /** Client temp ID for correlation */
  tempId: string;

  /** Database file ID */
  fileId: string;
}

/**
 * Response for file registration in upload session
 * POST /api/files/upload-session/:sessionId/folder/:tempId/register-files
 *
 * @example
 * ```typescript
 * const response: RegisterFilesResponse = {
 *   registered: [
 *     { tempId: 'file-1', fileId: 'FILE-ABC123' },
 *     { tempId: 'file-2', fileId: 'FILE-DEF456' },
 *   ],
 *   folderBatch: { ... },
 * };
 * ```
 */
export interface RegisterFilesResponse {
  /** Array of registered files with tempId -> fileId mapping */
  registered: RegisteredFileResult[];

  /** Updated folder batch status */
  folderBatch: FolderBatch;
}

/**
 * SAS URL info for a registered file
 */
export interface RegisteredFileSasInfo {
  /** Database file ID */
  fileId: string;

  /** Client temp ID for correlation */
  tempId: string;

  /** Presigned SAS URL for direct blob upload */
  sasUrl: string;

  /** Blob path for the file */
  blobPath: string;

  /** ISO 8601 timestamp when SAS URL expires */
  expiresAt: string;
}

/**
 * Response for getting SAS URLs in upload session
 * POST /api/files/upload-session/:sessionId/folder/:tempId/get-sas-urls
 *
 * @example
 * ```typescript
 * const response: GetSasUrlsResponse = {
 *   files: [
 *     { fileId: 'FILE-123', tempId: 'temp-1', sasUrl: '...', blobPath: '...', expiresAt: '...' }
 *   ],
 * };
 * ```
 */
export interface GetSasUrlsResponse {
  /** Array of SAS URLs for requested files */
  files: RegisteredFileSasInfo[];
}

/**
 * Request body for marking a file as uploaded
 * POST /api/files/upload-session/:sessionId/folder/:tempId/mark-uploaded
 */
export interface MarkFileUploadedRequest {
  /** Database file ID */
  fileId: string;

  /** SHA-256 content hash of uploaded file */
  contentHash: string;

  /** Real blob path where file was uploaded (from SAS URL generation) */
  blobPath: string;
}

/**
 * Response for marking file as uploaded
 * POST /api/files/upload-session/:sessionId/folder/:tempId/mark-uploaded
 */
export interface MarkFileUploadedResponse {
  /** Whether operation succeeded */
  success: boolean;

  /** Processing job ID (if enqueued) */
  jobId?: string;

  /** Updated folder batch status */
  folderBatch: FolderBatch;
}

/**
 * Response for completing a folder batch
 * POST /api/files/upload-session/:sessionId/folder/:tempId/complete
 */
export interface CompleteFolderBatchResponse {
  /** Whether completion succeeded */
  success: boolean;

  /** Updated folder batch */
  folderBatch: FolderBatch;

  /** Updated session */
  session: UploadSession;
}

/**
 * Response for getting upload session status
 * GET /api/files/upload-session/:sessionId
 */
export interface GetUploadSessionResponse {
  /** Current session state */
  session: UploadSession;

  /** Computed progress information */
  progress: UploadSessionProgress;
}

// ============================================================================
// WEBSOCKET EVENT TYPES
// ============================================================================

/**
 * Base interface for folder WebSocket events
 */
interface BaseFolderWebSocketEvent {
  /** Upload session ID */
  sessionId: string;

  /** User ID for multi-tenant filtering */
  userId: string;

  /** ISO 8601 timestamp when event was emitted */
  timestamp: string;
}

/**
 * Session started event
 * Channel: folder:status
 *
 * Emitted when an upload session begins.
 *
 * @example
 * ```typescript
 * const event: FolderSessionStartedEvent = {
 *   type: 'folder:session_started',
 *   sessionId: 'SESSION-ABC123',
 *   userId: 'USER-456',
 *   totalFolders: 6,
 *   timestamp: '2026-01-16T10:30:00.000Z',
 * };
 * ```
 */
export interface FolderSessionStartedEvent extends BaseFolderWebSocketEvent {
  type: typeof FOLDER_WS_EVENTS.SESSION_STARTED;

  /** Total number of folders in session */
  totalFolders: number;
}

/**
 * Session completed event
 * Channel: folder:status
 *
 * Emitted when all folders in a session are completed.
 *
 * @example
 * ```typescript
 * const event: FolderSessionCompletedEvent = {
 *   type: 'folder:session_completed',
 *   sessionId: 'SESSION-ABC123',
 *   userId: 'USER-456',
 *   completedFolders: 6,
 *   failedFolders: 0,
 *   timestamp: '2026-01-16T10:35:00.000Z',
 * };
 * ```
 */
export interface FolderSessionCompletedEvent extends BaseFolderWebSocketEvent {
  type: typeof FOLDER_WS_EVENTS.SESSION_COMPLETED;

  /** Number of successfully completed folders */
  completedFolders: number;

  /** Number of failed folders */
  failedFolders: number;
}

/**
 * Session failed event
 * Channel: folder:status
 *
 * Emitted when a session fails (too many folder failures).
 *
 * @example
 * ```typescript
 * const event: FolderSessionFailedEvent = {
 *   type: 'folder:session_failed',
 *   sessionId: 'SESSION-ABC123',
 *   userId: 'USER-456',
 *   error: 'Too many folder failures',
 *   completedFolders: 2,
 *   failedFolders: 3,
 *   timestamp: '2026-01-16T10:35:00.000Z',
 * };
 * ```
 */
export interface FolderSessionFailedEvent extends BaseFolderWebSocketEvent {
  type: typeof FOLDER_WS_EVENTS.SESSION_FAILED;

  /** Error message describing the failure */
  error: string;

  /** Number of successfully completed folders before failure */
  completedFolders: number;

  /** Number of failed folders */
  failedFolders: number;
}

/**
 * Folder batch started event
 * Channel: folder:status
 *
 * Emitted when a folder batch begins processing.
 *
 * @example
 * ```typescript
 * const event: FolderBatchStartedEvent = {
 *   type: 'folder:batch_started',
 *   sessionId: 'SESSION-ABC123',
 *   userId: 'USER-456',
 *   folderIndex: 0,
 *   totalFolders: 6,
 *   folderBatch: { tempId: '...', name: 'Documents', ... },
 *   timestamp: '2026-01-16T10:30:00.000Z',
 * };
 * ```
 */
export interface FolderBatchStartedEvent extends BaseFolderWebSocketEvent {
  type: typeof FOLDER_WS_EVENTS.BATCH_STARTED;

  /** Folder index (0-based) */
  folderIndex: number;

  /** Total folders in session */
  totalFolders: number;

  /** Folder batch details */
  folderBatch: FolderBatch;
}

/**
 * Folder batch progress event
 * Channel: folder:status
 *
 * Emitted when progress is made on a folder batch.
 *
 * @example
 * ```typescript
 * const event: FolderBatchProgressEvent = {
 *   type: 'folder:batch_progress',
 *   sessionId: 'SESSION-ABC123',
 *   userId: 'USER-456',
 *   folderIndex: 0,
 *   totalFolders: 6,
 *   folderBatch: { tempId: '...', uploadedFiles: 30, ... },
 *   timestamp: '2026-01-16T10:31:00.000Z',
 * };
 * ```
 */
export interface FolderBatchProgressEvent extends BaseFolderWebSocketEvent {
  type: typeof FOLDER_WS_EVENTS.BATCH_PROGRESS;

  /** Folder index (0-based) */
  folderIndex: number;

  /** Total folders in session */
  totalFolders: number;

  /** Updated folder batch with progress */
  folderBatch: FolderBatch;
}

/**
 * Folder batch completed event
 * Channel: folder:status
 *
 * Emitted when a folder batch completes successfully.
 *
 * @example
 * ```typescript
 * const event: FolderBatchCompletedEvent = {
 *   type: 'folder:batch_completed',
 *   sessionId: 'SESSION-ABC123',
 *   userId: 'USER-456',
 *   folderIndex: 0,
 *   totalFolders: 6,
 *   folderBatch: { tempId: '...', status: 'completed', ... },
 *   timestamp: '2026-01-16T10:32:00.000Z',
 * };
 * ```
 */
export interface FolderBatchCompletedEvent extends BaseFolderWebSocketEvent {
  type: typeof FOLDER_WS_EVENTS.BATCH_COMPLETED;

  /** Folder index (0-based) */
  folderIndex: number;

  /** Total folders in session */
  totalFolders: number;

  /** Completed folder batch */
  folderBatch: FolderBatch;
}

/**
 * Folder batch failed event
 * Channel: folder:status
 *
 * Emitted when a folder batch fails.
 *
 * @example
 * ```typescript
 * const event: FolderBatchFailedEvent = {
 *   type: 'folder:batch_failed',
 *   sessionId: 'SESSION-ABC123',
 *   userId: 'USER-456',
 *   folderIndex: 0,
 *   totalFolders: 6,
 *   folderBatch: { tempId: '...', status: 'failed', error: '...', ... },
 *   error: 'Failed to create folder',
 *   timestamp: '2026-01-16T10:32:00.000Z',
 * };
 * ```
 */
export interface FolderBatchFailedEvent extends BaseFolderWebSocketEvent {
  type: typeof FOLDER_WS_EVENTS.BATCH_FAILED;

  /** Folder index (0-based) */
  folderIndex: number;

  /** Total folders in session */
  totalFolders: number;

  /** Failed folder batch */
  folderBatch: FolderBatch;

  /** Error message */
  error: string;
}

/**
 * Union type for all folder WebSocket events
 *
 * Use discriminated union pattern with `type` field for type narrowing.
 *
 * @example
 * ```typescript
 * function handleFolderEvent(event: FolderWebSocketEvent) {
 *   switch (event.type) {
 *     case 'folder:batch_progress':
 *       console.log(`Folder ${event.folderIndex + 1}: ${event.folderBatch.uploadedFiles}/${event.folderBatch.totalFiles}`);
 *       break;
 *     case 'folder:batch_completed':
 *       console.log(`Folder ${event.folderBatch.name} completed!`);
 *       break;
 *     // ...
 *   }
 * }
 * ```
 */
export type FolderWebSocketEvent =
  | FolderSessionStartedEvent
  | FolderSessionCompletedEvent
  | FolderSessionFailedEvent
  | FolderBatchStartedEvent
  | FolderBatchProgressEvent
  | FolderBatchCompletedEvent
  | FolderBatchFailedEvent;
