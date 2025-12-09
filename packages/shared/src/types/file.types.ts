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

  /** True if text has been extracted (computed from extracted_text !== null) */
  hasExtractedText: boolean;

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
 * // List favorites sorted by date
 * const options: GetFilesOptions = {
 *   favorites: true,
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

  /** Filter to favorites only */
  favorites?: boolean;

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

  /** Maximum files per upload request */
  MAX_FILES_PER_UPLOAD: 20,
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
