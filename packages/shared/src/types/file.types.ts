/**
 * File Types for API Contract
 *
 * Shared types between frontend and backend for file management.
 * These are API-facing types (camelCase), not database types (snake_case).
 *
 * Key Design Principles:
 * - All types use camelCase for JavaScript conventions
 * - Dates are ISO 8601 strings for serialization
 * - Constants are shared to ensure consistent validation
 * - Type guards provide runtime type checking
 *
 * Architecture Phases:
 * - Phase 1: Basic file CRUD with blob storage
 * - Phase 2: Folder hierarchy and navigation
 * - Phase 3: Async processing (OCR, preview generation)
 * - Phase 4: Vector search and semantic matching
 *
 * @module @bc-agent/shared/types/file
 */

import { FILE_WS_EVENTS } from '../constants/websocket-events';

/**
 * Processing status for async workers (Phase 3)
 *
 * Lifecycle:
 * - `pending`: File uploaded, awaiting processing
 * - `processing`: Worker is extracting text/generating previews
 * - `completed`: Processing finished successfully
 * - `failed`: Processing failed (check logs for details)
 */
export type ProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * Embedding status for vector search (Phase 4)
 *
 * Lifecycle:
 * - `pending`: Text extracted, awaiting embedding generation
 * - `processing`: Embedding model is generating vectors
 * - `completed`: Embeddings stored in Azure AI Search
 * - `failed`: Embedding generation failed
 */
export type EmbeddingStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * Unified readiness state for frontend display
 *
 * Computed from processing_status + embedding_status to simplify frontend logic.
 * The frontend should NOT compute this; it's computed by the backend.
 *
 * States:
 * - `uploading`: File is being uploaded (frontend-only during upload progress)
 * - `processing`: File uploaded, processing or embedding in progress
 * - `ready`: Both processing and embedding completed successfully
 * - `failed`: Either processing or embedding failed permanently
 *
 * Priority: failed > processing > ready
 */
export type FileReadinessState = 'uploading' | 'processing' | 'ready' | 'failed';

/**
 * File usage type in messages
 *
 * Types:
 * - `direct`: User explicitly attached this file to the message
 * - `semantic_match`: Agent found this file via semantic search
 * - `folder`: File included because parent folder was attached
 */
export type FileUsageType = 'direct' | 'semantic_match' | 'folder';

/**
 * File sort options for queries
 *
 * Options:
 * - `name`: Alphabetical by filename
 * - `date`: Chronological by creation date
 * - `size`: By file size in bytes
 */
export type FileSortBy = 'name' | 'date' | 'size';

/**
 * Sort order for queries
 *
 * Options:
 * - `asc`: Ascending (A-Z, oldest first, smallest first)
 * - `desc`: Descending (Z-A, newest first, largest first)
 */
export type SortOrder = 'asc' | 'desc';

/**
 * Parsed file for API responses
 *
 * This is the API contract format sent between frontend and backend.
 * All fields use camelCase naming convention.
 *
 * Key fields:
 * - `id`: UUID primary key
 * - `isFolder`: If true, this is a folder (no blobPath)
 * - `blobPath`: Azure Blob Storage path (empty string for folders)
 * - `parentFolderId`: null for root-level files/folders
 * - `hasExtractedText`: Computed from whether text extraction completed
 *
 * @example
 * ```typescript
 * const file: ParsedFile = {
 *   id: '123e4567-e89b-12d3-a456-426614174000',
 *   userId: 'user-123',
 *   parentFolderId: null,
 *   name: 'document.pdf',
 *   mimeType: 'application/pdf',
 *   sizeBytes: 1024000,
 *   blobPath: 'users/user-123/files/2024-01-15-document.pdf',
 *   isFolder: false,
 *   isFavorite: false,
 *   processingStatus: 'completed',
 *   embeddingStatus: 'completed',
 *   hasExtractedText: true,
 *   createdAt: '2024-01-15T10:30:00.000Z',
 *   updatedAt: '2024-01-15T10:30:00.000Z',
 * };
 * ```
 */
export interface ParsedFile {
  /** UUID primary key */
  id: string;

  /** Owner of the file */
  userId: string;

  /** Parent folder ID (null for root-level) */
  parentFolderId: string | null;

  /** File or folder name */
  name: string;

  /** MIME type (e.g., "application/pdf", "inode/directory" for folders) */
  mimeType: string;

  /** Size in bytes (0 for folders) */
  sizeBytes: number;

  /** Azure Blob Storage path (empty string for folders) */
  blobPath: string;

  /** True if this is a folder */
  isFolder: boolean;

  /** User-set favorite flag */
  isFavorite: boolean;

  /** Processing status (Phase 3) */
  processingStatus: ProcessingStatus;

  /** Embedding status (Phase 4) */
  embeddingStatus: EmbeddingStatus;

  /** Unified readiness state computed from processing + embedding status */
  readinessState: FileReadinessState;

  /** Number of processing retry attempts */
  processingRetryCount: number;

  /** Number of embedding retry attempts */
  embeddingRetryCount: number;

  /** Last error message from processing or embedding failure */
  lastError: string | null;

  /** ISO 8601 timestamp when file permanently failed */
  failedAt: string | null;

  /** True if text has been extracted (computed from extracted_text !== null) */
  hasExtractedText: boolean;

  /** SHA-256 hash of file content for duplicate detection (null for folders) */
  contentHash: string | null;

  /** ISO 8601 timestamp when file was uploaded */
  createdAt: string;

  /** ISO 8601 timestamp when file was last modified */
  updatedAt: string;
}

/**
 * Parsed file chunk for API responses (Phase 3+)
 *
 * Large documents are split into chunks (~1000 tokens each) for:
 * - Full-text search
 * - Context injection into agent prompts
 * - Vector embedding (Phase 4)
 *
 * @example
 * ```typescript
 * const chunk: ParsedFileChunk = {
 *   id: 'chunk-123',
 *   fileId: 'file-456',
 *   chunkIndex: 0,
 *   chunkText: 'This is the first chunk of text...',
 *   chunkTokens: 982,
 *   searchDocumentId: 'doc-789',
 *   createdAt: '2024-01-15T10:30:00.000Z',
 * };
 * ```
 */
export interface ParsedFileChunk {
  /** UUID primary key */
  id: string;

  /** Parent file ID */
  fileId: string;

  /** Chunk position in document (0-indexed) */
  chunkIndex: number;

  /** Chunk text content */
  chunkText: string;

  /** Token count for this chunk */
  chunkTokens: number;

  /** Azure AI Search document ID (null if not embedded yet) */
  searchDocumentId: string | null;

  /** ISO 8601 timestamp when chunk was created */
  createdAt: string;
}

/**
 * Options for getFiles() API query
 *
 * Used for filtering and paginating file listings.
 *
 * @example
 * ```typescript
 * // List all root-level files
 * const options: GetFilesOptions = { folderId: null };
 *
 * // List folder contents
 * const options: GetFilesOptions = { folderId: 'folder-123' };
 *
 * // List with favorites first (at root: favorites from any folder + root items)
 * const options: GetFilesOptions = {
 *   favoritesFirst: true,
 *   sortBy: 'date',
 *   limit: 20,
 * };
 * ```
 */
export interface GetFilesOptions {
  /** Folder ID to list contents (undefined = all files, null = root only) */
  folderId?: string | null;

  /** Sort field */
  sortBy?: FileSortBy;

  /**
   * Sort favorites first (not a filter).
   * - At root (folderId=null): Returns favorites from ALL folders + all root items, favorites sorted first
   * - In folder: Returns all items in folder, with favorites sorted first
   */
  favoritesFirst?: boolean;

  /** Maximum number of results */
  limit?: number;

  /** Pagination offset */
  offset?: number;
}

/**
 * Request body for creating a folder
 *
 * @example
 * ```typescript
 * // Create root-level folder
 * const request: CreateFolderRequest = { name: 'My Documents' };
 *
 * // Create nested folder
 * const request: CreateFolderRequest = {
 *   name: 'Invoices',
 *   parentFolderId: 'folder-123',
 * };
 * ```
 */
export interface CreateFolderRequest {
  /** Folder name */
  name: string;

  /** Parent folder ID (undefined = create at root level) */
  parentFolderId?: string;
}

/**
 * Request body for updating a file
 *
 * All fields are optional (partial update).
 * Common use cases:
 * - Rename: `{ name: 'new-name.pdf' }`
 * - Move: `{ parentFolderId: 'folder-456' }`
 * - Move to root: `{ parentFolderId: null }`
 * - Toggle favorite: `{ isFavorite: true }`
 *
 * @example
 * ```typescript
 * // Rename file
 * const request: UpdateFileRequest = { name: 'new-name.pdf' };
 *
 * // Move to folder
 * const request: UpdateFileRequest = { parentFolderId: 'folder-123' };
 *
 * // Move to root and mark as favorite
 * const request: UpdateFileRequest = {
 *   parentFolderId: null,
 *   isFavorite: true,
 * };
 * ```
 */
export interface UpdateFileRequest {
  /** New file/folder name */
  name?: string;

  /** New parent folder ID (null = move to root) */
  parentFolderId?: string | null;

  /** Toggle favorite flag */
  isFavorite?: boolean;
}

/**
 * Response for file list API endpoint
 *
 * Includes pagination metadata for infinite scroll or pagination UI.
 *
 * @example
 * ```typescript
 * const response: FilesListResponse = {
 *   files: [...],
 *   pagination: {
 *     total: 150,
 *     limit: 50,
 *     offset: 0,
 *   },
 * };
 * ```
 */
export interface FilesListResponse {
  /** Array of files/folders */
  files: ParsedFile[];

  /** Pagination metadata */
  pagination: {
    /** Total number of files matching query */
    total: number;

    /** Maximum results per page */
    limit: number;

    /** Current page offset */
    offset: number;
  };
}

/**
 * Response for single file API endpoint
 *
 * @example
 * ```typescript
 * const response: FileResponse = {
 *   file: {
 *     id: 'file-123',
 *     name: 'document.pdf',
 *     // ... other fields
 *   },
 * };
 * ```
 */
export interface FileResponse {
  /** The requested file */
  file: ParsedFile;
}

/**
 * Response for folder creation API endpoint
 *
 * @example
 * ```typescript
 * const response: FolderResponse = {
 *   folder: {
 *     id: 'folder-123',
 *     name: 'My Documents',
 *     isFolder: true,
 *     // ... other fields
 *   },
 * };
 * ```
 */
export interface FolderResponse {
  /** The created folder */
  folder: ParsedFile;
}

/**
 * Response for file upload API endpoint
 *
 * Returns array of uploaded files (supports multiple file upload).
 *
 * @example
 * ```typescript
 * const response: UploadFilesResponse = {
 *   files: [
 *     { id: 'file-1', name: 'doc1.pdf', ... },
 *     { id: 'file-2', name: 'doc2.pdf', ... },
 *   ],
 * };
 * ```
 */
export interface UploadFilesResponse {
  /** Array of uploaded files */
  files: ParsedFile[];
}

/**
 * Upload validation constants
 *
 * Shared between frontend (client-side validation) and backend (server-side validation).
 *
 * Note: MAX_IMAGE_SIZE is 30MB due to Anthropic API constraint for vision models.
 */
export const FILE_UPLOAD_LIMITS = {
  /** Maximum file size: 100MB */
  MAX_FILE_SIZE: 100 * 1024 * 1024,

  /** Maximum image size: 30MB (Anthropic API constraint) */
  MAX_IMAGE_SIZE: 30 * 1024 * 1024,

  /** Maximum files per synchronous upload request (legacy) */
  MAX_FILES_PER_UPLOAD: 20,

  /** Maximum files per bulk upload batch */
  MAX_FILES_PER_BULK_UPLOAD: 500,
} as const;

/**
 * Allowed MIME types for file uploads
 *
 * Supports documents, images, and code files.
 * Used for both client-side and server-side validation.
 */
export const ALLOWED_MIME_TYPES = [
  // Documents
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'text/plain',
  'text/csv',
  'text/markdown',

  // Images
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',

  // Code
  'application/json',
  'text/javascript',
  'text/html',
  'text/css',
] as const;

/**
 * Type for allowed MIME types
 *
 * Extracted from ALLOWED_MIME_TYPES array.
 */
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

/**
 * Type guard for checking if a MIME type is allowed
 *
 * Provides runtime type checking for file uploads.
 *
 * @param mimeType - MIME type to check
 * @returns True if MIME type is in ALLOWED_MIME_TYPES list
 *
 * @example
 * ```typescript
 * const mimeType = 'application/pdf';
 * if (isAllowedMimeType(mimeType)) {
 *   // TypeScript now knows mimeType is AllowedMimeType
 *   console.log('Valid file type:', mimeType);
 * } else {
 *   console.error('Invalid file type:', mimeType);
 * }
 * ```
 */
export function isAllowedMimeType(mimeType: string): mimeType is AllowedMimeType {
  return ALLOWED_MIME_TYPES.includes(mimeType as AllowedMimeType);
}

// ============================================
// Duplicate Detection Types
// ============================================

/**
 * Single file to check for duplicates (content-based)
 *
 * Used in batch duplicate checking before upload.
 * The tempId allows correlating results back to client-side file references.
 *
 * @example
 * ```typescript
 * const item: DuplicateCheckItem = {
 *   tempId: 'temp-abc123',
 *   contentHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
 *   fileName: 'document.pdf',
 * };
 * ```
 */
export interface DuplicateCheckItem {
  /** Client-generated temporary ID for correlation */
  tempId: string;

  /** SHA-256 content hash (64-character hex string) */
  contentHash: string;

  /** Original filename (for display purposes) */
  fileName: string;
}

/**
 * Request body for checking duplicates by content hash
 *
 * @example
 * ```typescript
 * const request: CheckDuplicatesRequest = {
 *   files: [
 *     { tempId: 'temp-1', contentHash: 'abc...', fileName: 'doc1.pdf' },
 *     { tempId: 'temp-2', contentHash: 'def...', fileName: 'doc2.pdf' },
 *   ],
 * };
 * ```
 */
export interface CheckDuplicatesRequest {
  /** Array of files to check (1-50 files) */
  files: DuplicateCheckItem[];
}

/**
 * Single duplicate check result
 *
 * Indicates whether a file with matching content hash exists.
 * If duplicate, includes the existing file details.
 */
export interface DuplicateResult {
  /** Client temp ID for correlation */
  tempId: string;

  /** Whether a duplicate exists */
  isDuplicate: boolean;

  /** Existing file if duplicate found */
  existingFile?: ParsedFile;
}

/**
 * Response for duplicate check API endpoint
 *
 * @example
 * ```typescript
 * const response: CheckDuplicatesResponse = {
 *   results: [
 *     { tempId: 'temp-1', isDuplicate: true, existingFile: { ... } },
 *     { tempId: 'temp-2', isDuplicate: false },
 *   ],
 * };
 * ```
 */
export interface CheckDuplicatesResponse {
  /** Results for each file checked */
  results: DuplicateResult[];
}

/**
 * User action for handling duplicate files during upload
 *
 * Actions:
 * - `replace`: Delete existing file and upload new one
 * - `skip`: Skip uploading this file
 * - `cancel`: Cancel entire upload operation
 */
export type DuplicateAction = 'replace' | 'skip' | 'cancel';

// ============================================
// Retry & Cleanup Types (D25 Sprint 2)
// ============================================

/**
 * Phase of file processing that can be retried
 *
 * Phases:
 * - `processing`: Text extraction, OCR, preview generation
 * - `embedding`: Vector embedding generation for AI Search
 */
export type RetryPhase = 'processing' | 'embedding';

/**
 * Scope for retry operations
 *
 * Scopes:
 * - `full`: Re-process entire file from start (text extraction + embedding)
 * - `embedding_only`: Only re-generate embeddings (text extraction was successful)
 */
export type RetryScope = 'full' | 'embedding_only';

/**
 * Reason for retry decision
 *
 * Reasons:
 * - `within_limit`: Retry count is below max, will retry
 * - `max_retries_exceeded`: Max retries reached, mark as permanently failed
 * - `not_failed`: File is not in failed state
 */
export type RetryDecisionReason = 'within_limit' | 'max_retries_exceeded' | 'not_failed';

/**
 * Result of retry decision check
 *
 * Used by ProcessingRetryManager to decide whether to retry or fail permanently.
 *
 * @example
 * ```typescript
 * const decision: RetryDecisionResult = {
 *   shouldRetry: true,
 *   newRetryCount: 2,
 *   maxRetries: 3,
 *   backoffDelayMs: 10000,
 *   reason: 'within_limit',
 * };
 * ```
 */
export interface RetryDecisionResult {
  /** Whether to retry processing */
  shouldRetry: boolean;

  /** Updated retry count after this attempt */
  newRetryCount: number;

  /** Maximum allowed retries for this phase */
  maxRetries: number;

  /** Delay in milliseconds before next retry (exponential backoff) */
  backoffDelayMs: number;

  /** Reason for the decision */
  reason: RetryDecisionReason;
}

/**
 * Result of manual retry request
 *
 * Returned by POST /api/files/:id/retry-processing endpoint.
 *
 * @example
 * ```typescript
 * // Success case
 * const result: ManualRetryResult = {
 *   success: true,
 *   file: { id: '...', readinessState: 'processing', ... },
 *   jobId: 'job-12345',
 * };
 *
 * // Failure case
 * const result: ManualRetryResult = {
 *   success: false,
 *   file: { id: '...', readinessState: 'ready', ... },
 *   error: 'File is not in failed state',
 * };
 * ```
 */
export interface ManualRetryResult {
  /** Whether retry was initiated successfully */
  success: boolean;

  /** Current file state */
  file: ParsedFile;

  /** Job ID for tracking (only if success=true) */
  jobId?: string;

  /** Error message (only if success=false) */
  error?: string;
}

/**
 * Result of cleanup operation for a single file
 *
 * Returned by PartialDataCleaner.cleanupForFile().
 *
 * @example
 * ```typescript
 * const result: CleanupResult = {
 *   fileId: 'file-123',
 *   chunksDeleted: 15,
 *   searchDocumentsDeleted: 15,
 *   success: true,
 * };
 * ```
 */
export interface CleanupResult {
  /** ID of the file that was cleaned */
  fileId: string;

  /** Number of chunks deleted from database */
  chunksDeleted: number;

  /** Number of documents deleted from Azure AI Search */
  searchDocumentsDeleted: number;

  /** Whether cleanup completed successfully */
  success: boolean;

  /** Error message if cleanup failed */
  error?: string;
}

/**
 * Result of batch cleanup operation
 *
 * Returned by PartialDataCleaner.cleanupOldFailedFiles().
 *
 * @example
 * ```typescript
 * const result: BatchCleanupResult = {
 *   filesProcessed: 10,
 *   totalChunksDeleted: 150,
 *   totalSearchDocsDeleted: 150,
 *   failures: [
 *     { fileId: 'file-456', error: 'AI Search unavailable' },
 *   ],
 * };
 * ```
 */
export interface BatchCleanupResult {
  /** Number of files processed in batch */
  filesProcessed: number;

  /** Total chunks deleted across all files */
  totalChunksDeleted: number;

  /** Total search documents deleted across all files */
  totalSearchDocsDeleted: number;

  /** List of files that failed to clean up */
  failures: Array<{ fileId: string; error: string }>;
}

/**
 * Request body for POST /api/files/:id/retry-processing
 *
 * @example
 * ```typescript
 * // Retry everything
 * const request: RetryProcessingRequest = { scope: 'full' };
 *
 * // Only retry embedding
 * const request: RetryProcessingRequest = { scope: 'embedding_only' };
 * ```
 */
export interface RetryProcessingRequest {
  /** Scope of retry (default: 'full') */
  scope?: RetryScope;
}

/**
 * Response from POST /api/files/:id/retry-processing
 *
 * @example
 * ```typescript
 * const response: RetryProcessingResponse = {
 *   file: { id: '...', readinessState: 'processing', ... },
 *   jobId: 'job-12345',
 *   message: 'Processing retry initiated',
 * };
 * ```
 */
export interface RetryProcessingResponse {
  /** Updated file with new processing state */
  file: ParsedFile;

  /** Job ID for tracking retry progress */
  jobId: string;

  /** Human-readable status message */
  message: string;
}

// ============================================
// WebSocket Event Types
// ============================================

/**
 * Base interface for file WebSocket events
 */
interface BaseFileWebSocketEvent {
  /** ID of the file this event relates to */
  fileId: string;

  /** ISO 8601 timestamp when event was emitted */
  timestamp: string;
}

/**
 * Readiness state change event
 * Channel: file:status
 *
 * Emitted when file transitions between readiness states:
 * - uploading -> processing (file uploaded, processing started)
 * - processing -> ready (all processing completed successfully)
 * - processing -> failed (processing or embedding failed permanently)
 * - failed -> processing (manual retry initiated)
 *
 * @example
 * ```typescript
 * const event: FileReadinessChangedEvent = {
 *   type: 'file:readiness_changed',
 *   fileId: 'file-123',
 *   userId: 'user-456',
 *   previousState: 'processing',
 *   readinessState: 'ready',
 *   processingStatus: 'completed',
 *   embeddingStatus: 'completed',
 *   timestamp: '2026-01-14T10:30:00.000Z',
 * };
 * ```
 */
export interface FileReadinessChangedEvent extends BaseFileWebSocketEvent {
  type: typeof FILE_WS_EVENTS.READINESS_CHANGED;

  /** User ID for multi-tenant filtering */
  userId: string;

  /** Previous readiness state (undefined for initial state) */
  previousState?: FileReadinessState;

  /** New readiness state */
  readinessState: FileReadinessState;

  /** Current processing status */
  processingStatus: ProcessingStatus;

  /** Current embedding status */
  embeddingStatus: EmbeddingStatus;
}

/**
 * Permanent failure event
 * Channel: file:status
 *
 * Emitted when file has exhausted all automatic retries.
 * User can still manually retry via POST /api/files/:id/retry-processing.
 *
 * @example
 * ```typescript
 * const event: FilePermanentlyFailedEvent = {
 *   type: 'file:permanently_failed',
 *   fileId: 'file-123',
 *   userId: 'user-456',
 *   error: 'OCR timeout after 30s',
 *   processingRetryCount: 2,
 *   embeddingRetryCount: 0,
 *   canRetryManually: true,
 *   timestamp: '2026-01-14T10:30:00.000Z',
 * };
 * ```
 */
export interface FilePermanentlyFailedEvent extends BaseFileWebSocketEvent {
  type: typeof FILE_WS_EVENTS.PERMANENTLY_FAILED;

  /** User ID for multi-tenant filtering */
  userId: string;

  /** Error message describing the failure */
  error: string;

  /** Number of processing retries attempted */
  processingRetryCount: number;

  /** Number of embedding retries attempted */
  embeddingRetryCount: number;

  /** Whether user can manually retry via API */
  canRetryManually: boolean;
}

/**
 * Processing progress event
 * Channel: file:processing
 *
 * Emitted during text extraction, OCR, and embedding generation.
 * Includes retry attempt information for user feedback.
 *
 * @example
 * ```typescript
 * const event: FileProcessingProgressEvent = {
 *   type: 'file:processing_progress',
 *   fileId: 'file-123',
 *   progress: 50,
 *   status: 'processing',
 *   attemptNumber: 2,
 *   maxAttempts: 3,
 *   timestamp: '2026-01-14T10:30:00.000Z',
 * };
 * ```
 */
export interface FileProcessingProgressEvent extends BaseFileWebSocketEvent {
  type: typeof FILE_WS_EVENTS.PROCESSING_PROGRESS;

  /** Progress percentage (0-100) */
  progress: number;

  /** Current processing status */
  status: ProcessingStatus;

  /** Current retry attempt number (1-based) */
  attemptNumber: number;

  /** Maximum retry attempts configured */
  maxAttempts: number;
}

/**
 * Processing completed event
 * Channel: file:processing
 *
 * Emitted when text extraction completes successfully.
 * Note: This does not mean the file is ready for RAG - embedding may still be pending.
 *
 * @example
 * ```typescript
 * const event: FileProcessingCompletedEvent = {
 *   type: 'file:processing_completed',
 *   fileId: 'file-123',
 *   status: 'completed',
 *   progress: 100,
 *   stats: { textLength: 5000, pageCount: 10, ocrUsed: true },
 *   timestamp: '2026-01-14T10:30:00.000Z',
 * };
 * ```
 */
export interface FileProcessingCompletedEvent extends BaseFileWebSocketEvent {
  type: typeof FILE_WS_EVENTS.PROCESSING_COMPLETED;

  /** Always 'completed' for this event */
  status: 'completed';

  /** Always 100 for completion event */
  progress: 100;

  /** Processing statistics */
  stats: {
    /** Length of extracted text in characters */
    textLength: number;

    /** Number of pages (for documents) */
    pageCount: number;

    /** Whether OCR was used for text extraction */
    ocrUsed: boolean;
  };
}

/**
 * Processing failed event
 * Channel: file:processing
 *
 * Emitted when processing fails (before retry decision).
 * This may be followed by automatic retry or permanent failure.
 *
 * @example
 * ```typescript
 * const event: FileProcessingFailedEvent = {
 *   type: 'file:processing_failed',
 *   fileId: 'file-123',
 *   status: 'failed',
 *   error: 'Failed to extract text from PDF',
 *   timestamp: '2026-01-14T10:30:00.000Z',
 * };
 * ```
 */
export interface FileProcessingFailedEvent extends BaseFileWebSocketEvent {
  type: typeof FILE_WS_EVENTS.PROCESSING_FAILED;

  /** Always 'failed' for this event */
  status: 'failed';

  /** Error message describing the failure */
  error: string;
}

/**
 * Union type for all file WebSocket events
 *
 * Use discriminated union pattern with `type` field for type narrowing:
 *
 * @example
 * ```typescript
 * function handleFileEvent(event: FileWebSocketEvent) {
 *   switch (event.type) {
 *     case 'file:readiness_changed':
 *       console.log('New state:', event.readinessState);
 *       break;
 *     case 'file:permanently_failed':
 *       console.log('Error:', event.error);
 *       break;
 *     case 'file:processing_progress':
 *       console.log('Progress:', event.progress, '%');
 *       break;
 *     // ...
 *   }
 * }
 * ```
 */
export type FileWebSocketEvent =
  | FileReadinessChangedEvent
  | FilePermanentlyFailedEvent
  | FileProcessingProgressEvent
  | FileProcessingCompletedEvent
  | FileProcessingFailedEvent
  | FileDeletedEvent
  | FileUploadedEvent;

// ============================================
// Bulk Delete Types (Queue-based deletion)
// ============================================

/**
 * Deletion reason for GDPR compliance audit trail
 */
export type DeletionReason = 'user_request' | 'gdpr_erasure' | 'retention_policy' | 'admin_action';

/**
 * Job data for file deletion queue (BullMQ)
 *
 * Used by the FILE_DELETION queue to process deletions sequentially
 * to avoid SQL deadlocks from parallel DELETE operations.
 *
 * @example
 * ```typescript
 * const jobData: FileDeletionJobData = {
 *   fileId: 'FILE-123',
 *   userId: 'USER-456',
 *   deletionReason: 'user_request',
 *   batchId: 'BATCH-789',
 * };
 * ```
 */
export interface FileDeletionJobData {
  /** UUID of the file to delete */
  fileId: string;

  /** UUID of the file owner (for multi-tenant isolation) */
  userId: string;

  /** Reason for deletion (GDPR audit trail) */
  deletionReason?: DeletionReason;

  /** Batch ID to group related deletions for tracking */
  batchId?: string;

  /** Correlation ID for distributed tracing */
  correlationId?: string;
}

/**
 * Response for bulk delete API endpoint (DELETE /api/files)
 *
 * Returns 202 Accepted with tracking information for async processing.
 *
 * @example
 * ```typescript
 * const response: BulkDeleteAcceptedResponse = {
 *   batchId: 'BATCH-123',
 *   jobsEnqueued: 5,
 *   jobIds: ['job-1', 'job-2', 'job-3', 'job-4', 'job-5'],
 * };
 * ```
 */
export interface BulkDeleteAcceptedResponse {
  /** Unique batch ID for tracking this bulk operation */
  batchId: string;

  /** Number of deletion jobs enqueued */
  jobsEnqueued: number;

  /** Individual job IDs for tracking each file deletion */
  jobIds: string[];
}

/**
 * WebSocket event emitted when file deletion completes
 * Channel: file:status
 *
 * @example
 * ```typescript
 * // Success
 * const event: FileDeletedEvent = {
 *   type: 'file:deleted',
 *   fileId: 'FILE-123',
 *   batchId: 'BATCH-789',
 *   success: true,
 *   timestamp: '2026-01-16T10:30:00.000Z',
 * };
 *
 * // Failure
 * const event: FileDeletedEvent = {
 *   type: 'file:deleted',
 *   fileId: 'FILE-123',
 *   batchId: 'BATCH-789',
 *   success: false,
 *   error: 'Database connection failed',
 *   timestamp: '2026-01-16T10:30:00.000Z',
 * };
 * ```
 */
export interface FileDeletedEvent extends BaseFileWebSocketEvent {
  type: typeof FILE_WS_EVENTS.DELETED;

  /** Batch ID for correlating with bulk delete request */
  batchId?: string;

  /** Whether deletion succeeded */
  success: boolean;

  /** Error message if deletion failed */
  error?: string;
}

// ============================================
// Bulk Upload Types (Queue-based upload with SAS URLs)
// ============================================

/**
 * Configuration for bulk file upload queue processing
 *
 * Mirrors FILE_DELETION_CONFIG pattern for consistency.
 */
export const FILE_BULK_UPLOAD_CONFIG = {
  /** Maximum files per bulk upload batch */
  MAX_BATCH_SIZE: 500,

  /** Queue worker concurrency (parallel processing OK for uploads) */
  QUEUE_CONCURRENCY: 10,

  /** Maximum retry attempts for failed upload jobs */
  MAX_RETRY_ATTEMPTS: 3,

  /** Initial retry delay in milliseconds */
  RETRY_DELAY_MS: 1000,

  /** SAS URL expiration in minutes */
  SAS_EXPIRY_MINUTES: 60,
} as const;

/**
 * Job data for bulk file upload queue (BullMQ)
 *
 * Used by the FILE_BULK_UPLOAD queue to create database records
 * after files have been uploaded directly to Azure Blob Storage.
 *
 * @example
 * ```typescript
 * const jobData: BulkUploadJobData = {
 *   tempId: 'temp-123',
 *   userId: 'USER-456',
 *   batchId: 'BATCH-789',
 *   fileName: 'document.pdf',
 *   mimeType: 'application/pdf',
 *   sizeBytes: 1024000,
 *   blobPath: 'users/USER-456/files/1705312200000-document.pdf',
 * };
 * ```
 */
export interface BulkUploadJobData {
  /** Client-generated temporary ID for correlation */
  tempId: string;

  /** UUID of the file owner (for multi-tenant isolation) */
  userId: string;

  /** Batch ID to group related uploads for tracking */
  batchId: string;

  /** Original filename */
  fileName: string;

  /** MIME type of the file */
  mimeType: string;

  /** File size in bytes */
  sizeBytes: number;

  /** Azure Blob Storage path where file was uploaded */
  blobPath: string;

  /** SHA-256 content hash for duplicate detection (optional) */
  contentHash?: string;

  /** Parent folder ID (null for root level) */
  parentFolderId?: string | null;

  /** Session ID for WebSocket events (optional) */
  sessionId?: string;

  /** Correlation ID for distributed tracing */
  correlationId?: string;
}

/**
 * Single file metadata for bulk upload init request
 */
export interface BulkUploadFileMetadata {
  /** Client-generated temporary ID for correlation */
  tempId: string;

  /** Original filename */
  fileName: string;

  /** MIME type of the file */
  mimeType: string;

  /** File size in bytes */
  sizeBytes: number;
}

/**
 * Request body for bulk upload initialization (POST /api/files/bulk-upload/init)
 *
 * @example
 * ```typescript
 * const request: BulkUploadInitRequest = {
 *   files: [
 *     { tempId: 'temp-1', fileName: 'doc1.pdf', mimeType: 'application/pdf', sizeBytes: 1024000 },
 *     { tempId: 'temp-2', fileName: 'doc2.pdf', mimeType: 'application/pdf', sizeBytes: 2048000 },
 *   ],
 *   parentFolderId: 'FOLDER-123',
 *   sessionId: 'SESSION-456',
 * };
 * ```
 */
export interface BulkUploadInitRequest {
  /** Array of files to upload (1-500 files) */
  files: BulkUploadFileMetadata[];

  /** Parent folder ID for all files (undefined = root level) */
  parentFolderId?: string;

  /** Session ID for WebSocket events (optional) */
  sessionId?: string;
}

/**
 * Single file SAS URL info in bulk upload init response
 */
export interface BulkUploadFileSasInfo {
  /** Client temp ID for correlation */
  tempId: string;

  /** Presigned SAS URL for direct blob upload */
  sasUrl: string;

  /** Blob path for confirmation */
  blobPath: string;

  /** ISO 8601 timestamp when SAS URL expires */
  expiresAt: string;
}

/**
 * Response for bulk upload initialization (POST /api/files/bulk-upload/init)
 *
 * Returns 202 Accepted with SAS URLs for direct-to-blob uploads.
 *
 * @example
 * ```typescript
 * const response: BulkUploadInitResponse = {
 *   batchId: 'BATCH-123',
 *   files: [
 *     {
 *       tempId: 'temp-1',
 *       sasUrl: 'https://storage.blob.core.windows.net/...?sv=...',
 *       blobPath: 'users/USER-456/files/1705312200000-doc1.pdf',
 *       expiresAt: '2026-01-16T11:30:00.000Z',
 *     },
 *   ],
 * };
 * ```
 */
export interface BulkUploadInitResponse {
  /** Unique batch ID for tracking this bulk upload */
  batchId: string;

  /** SAS URLs and blob paths for each file */
  files: BulkUploadFileSasInfo[];
}

/**
 * Single upload result in bulk upload complete request
 */
export interface BulkUploadResult {
  /** Client temp ID for correlation */
  tempId: string;

  /** Whether upload to blob succeeded */
  success: boolean;

  /** SHA-256 content hash (if upload succeeded) */
  contentHash?: string;

  /** Error message (if upload failed) */
  error?: string;
}

/**
 * Request body for bulk upload completion (POST /api/files/bulk-upload/complete)
 *
 * @example
 * ```typescript
 * const request: BulkUploadCompleteRequest = {
 *   batchId: 'BATCH-123',
 *   uploads: [
 *     { tempId: 'temp-1', success: true, contentHash: 'abc123...' },
 *     { tempId: 'temp-2', success: false, error: 'Network error' },
 *   ],
 *   parentFolderId: 'FOLDER-456',
 * };
 * ```
 */
export interface BulkUploadCompleteRequest {
  /** Batch ID from init response */
  batchId: string;

  /** Upload results for each file */
  uploads: BulkUploadResult[];

  /** Parent folder ID (null for root level) */
  parentFolderId?: string | null;
}

/**
 * Response for bulk upload completion (POST /api/files/bulk-upload/complete)
 *
 * Returns 202 Accepted with job tracking information.
 *
 * @example
 * ```typescript
 * const response: BulkUploadAcceptedResponse = {
 *   batchId: 'BATCH-123',
 *   jobsEnqueued: 5,
 *   jobIds: ['job-1', 'job-2', 'job-3', 'job-4', 'job-5'],
 * };
 * ```
 */
export interface BulkUploadAcceptedResponse {
  /** Batch ID for tracking this bulk operation */
  batchId: string;

  /** Number of upload jobs enqueued */
  jobsEnqueued: number;

  /** Individual job IDs for tracking each file */
  jobIds: string[];
}

/**
 * WebSocket event emitted when bulk upload file record is created
 * Channel: file:status
 *
 * @example
 * ```typescript
 * // Success
 * const event: FileUploadedEvent = {
 *   type: 'file:uploaded',
 *   fileId: 'FILE-123',
 *   tempId: 'temp-1',
 *   batchId: 'BATCH-789',
 *   success: true,
 *   file: { id: 'FILE-123', name: 'doc.pdf', ... },
 *   timestamp: '2026-01-16T10:30:00.000Z',
 * };
 *
 * // Failure
 * const event: FileUploadedEvent = {
 *   type: 'file:uploaded',
 *   fileId: '',
 *   tempId: 'temp-1',
 *   batchId: 'BATCH-789',
 *   success: false,
 *   error: 'Blob not found at specified path',
 *   timestamp: '2026-01-16T10:30:00.000Z',
 * };
 * ```
 */
export interface FileUploadedEvent extends BaseFileWebSocketEvent {
  type: typeof FILE_WS_EVENTS.UPLOADED;

  /** Client temp ID for correlation */
  tempId?: string;

  /** Batch ID for correlating with bulk upload request */
  batchId?: string;

  /** Whether file record creation succeeded */
  success: boolean;

  /** Created file (only if success=true) */
  file?: ParsedFile;

  /** Error message (only if success=false) */
  error?: string;
}
