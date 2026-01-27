/**
 * File Management Type Definitions
 *
 * This module defines the type system for the file management feature.
 * It includes database record types (snake_case), API response types (camelCase),
 * and transformer functions to convert between them.
 *
 * Key Design Principles:
 * - Database records use snake_case to match SQL schema
 * - API responses use camelCase for JavaScript conventions
 * - Transformer functions handle conversion between formats
 * - All types are fully typed (no `any` allowed)
 * - API types are imported from @bc-agent/shared (Single Source of Truth)
 *
 * Architecture:
 * - Phase 1: Basic file CRUD (this module)
 * - Phase 2: Folder hierarchy
 * - Phase 3: Async processing (OCR, preview generation)
 * - Phase 4: Vector search and semantic matching
 */

// ============================================
// Shared Types (Single Source of Truth)
// ============================================

// Re-export types from @bc-agent/shared for internal use
// These types are defined once in shared package and used across all packages
export type {
  ProcessingStatus,
  EmbeddingStatus,
  FileReadinessState,
  FileUsageType,
  FileSortBy,
  ParsedFile,
  ParsedFileChunk,
  DeletionStatus,
} from '@bc-agent/shared';

// Import for local use in this module
import type {
  ProcessingStatus,
  EmbeddingStatus,
  FileUsageType,
  ParsedFile,
  ParsedFileChunk,
  FileSortBy,
  DeletionStatus,
} from '@bc-agent/shared';

// Import domain service for computing readiness state
import { getReadinessStateComputer } from '@/domains/files/status';

/**
 * Database record for files table
 *
 * This matches the SQL schema exactly with snake_case naming.
 * All dates are stored as UTC timestamps.
 *
 * Important fields:
 * - `is_folder`: If true, this is a folder (no blob_path)
 * - `blob_path`: Azure Blob Storage path (format: users/{userId}/files/{timestamp}-{filename})
 * - `parent_folder_id`: NULL for root-level files, otherwise points to parent folder
 * - `extracted_text`: NULL until processing completes (Phase 3)
 */
export interface FileDbRecord {
  /** UUID primary key */
  id: string;

  /** Owner of the file */
  user_id: string;

  /** Parent folder ID (NULL for root-level) */
  parent_folder_id: string | null;

  /** File or folder name (e.g., "document.pdf", "My Documents") */
  name: string;

  /** MIME type (e.g., "application/pdf", "inode/directory" for folders) */
  mime_type: string;

  /** Size in bytes (0 for folders) */
  size_bytes: number;

  /** Azure Blob Storage path (empty string for folders) */
  blob_path: string;

  /** True if this is a folder, false if it's a file */
  is_folder: boolean;

  /** User-set favorite flag */
  is_favorite: boolean;

  /** Processing status (Phase 3: OCR, preview generation) */
  processing_status: ProcessingStatus;

  /** Embedding status (Phase 4: vector search) */
  embedding_status: EmbeddingStatus;

  /** Extracted text content (NULL until processing completes) */
  extracted_text: string | null;

  /** SHA-256 hash of file content for duplicate detection (NULL for folders) */
  content_hash: string | null;

  /** Number of processing retry attempts (Phase 5) */
  processing_retry_count: number;

  /** Number of embedding retry attempts (Phase 5) */
  embedding_retry_count: number;

  /** Last error message from processing failure (Phase 5) */
  last_processing_error: string | null;

  /** Last error message from embedding failure (Phase 5) */
  last_embedding_error: string | null;

  /** UTC timestamp when file permanently failed (Phase 5) */
  failed_at: Date | null;

  /** Deletion status for soft delete workflow (NULL = active) */
  deletion_status: DeletionStatus;

  /** UTC timestamp when file was marked for deletion (NULL if active) */
  deleted_at: Date | null;

  /** UTC timestamp when file was uploaded */
  created_at: Date;

  /** UTC timestamp when file was last modified */
  updated_at: Date;
}

/**
 * Database record for file_chunks table
 *
 * Phase 3: Text chunks for search and context injection.
 * Large documents are split into chunks (~1000 tokens each) for:
 * - Full-text search
 * - Context injection into agent prompts
 * - Vector embedding (Phase 4)
 *
 * Chunks are created during async processing after text extraction.
 */
export interface FileChunkDbRecord {
  /** UUID primary key */
  id: string;

  /** Parent file ID (foreign key to files.id) */
  file_id: string;

  /** Chunk position in document (0-indexed) */
  chunk_index: number;

  /** Chunk text content (~1000 tokens) */
  chunk_text: string;

  /** Token count for this chunk */
  chunk_tokens: number;

  /** Azure AI Search document ID (Phase 4, NULL until embedded) */
  search_document_id: string | null;

  /** UTC timestamp when chunk was created */
  created_at: Date;
}

/**
 * Database record for message_file_attachments table
 *
 * Links files to messages in chat sessions.
 * Tracks how the file was attached (direct, semantic match, folder).
 *
 * Important:
 * - One message can have many file attachments
 * - One file can be attached to many messages
 * - `relevance_score` is NULL for direct attachments, 0-1 for semantic matches
 */
export interface MessageFileAttachmentDbRecord {
  /** UUID primary key */
  id: string;

  /** Message ID (foreign key to messages.id) */
  message_id: string;

  /** File ID (foreign key to files.id) */
  file_id: string;

  /** How this file was attached to the message */
  usage_type: FileUsageType;

  /** Relevance score for semantic matches (0-1, NULL for direct attachments) */
  relevance_score: number | null;

  /** UTC timestamp when attachment was created */
  created_at: Date;
}

// NOTE: ParsedFile and ParsedFileChunk interfaces are imported from @bc-agent/shared
// See type exports at the top of this file

/**
 * Options for getFiles() query
 *
 * Used by FileRepository to filter and paginate file listings.
 *
 * Examples:
 * - List all user's files: `{ userId: 'user-123' }`
 * - List root-level files: `{ userId: 'user-123', folderId: null }`
 * - List folder contents: `{ userId: 'user-123', folderId: 'folder-456' }`
 * - List with favorites first: `{ userId: 'user-123', favoritesFirst: true }`
 */
export interface GetFilesOptions {
  /** Owner user ID (required) */
  userId: string;

  /** Folder ID to list contents (undefined = all files, null = root only) */
  folderId?: string | null;

  /** Sort order */
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
 * Options for createFileRecord()
 *
 * Used when creating a new file record after successful blob upload.
 *
 * Note: Folders have empty `blobPath` and 0 `sizeBytes`
 */
export interface CreateFileOptions {
  /** Owner user ID */
  userId: string;

  /** File or folder name */
  name: string;

  /** MIME type (e.g., "application/pdf", "inode/directory") */
  mimeType: string;

  /** Size in bytes (0 for folders) */
  sizeBytes: number;

  /** Azure Blob Storage path (empty string for folders) */
  blobPath: string;

  /** Parent folder ID (undefined = root level) */
  parentFolderId?: string;

  /** SHA-256 content hash for duplicate detection (optional) */
  contentHash?: string;
}

/**
 * Options for updateFile()
 *
 * All fields are optional (partial update).
 * Common use cases:
 * - Rename: `{ name: 'new-name.pdf' }`
 * - Move: `{ parentFolderId: 'folder-456' }`
 * - Move to root: `{ parentFolderId: null }`
 * - Toggle favorite: `{ isFavorite: true }`
 * - Update blob path after upload: `{ blobPath: 'users/...' }`
 * - Set content hash: `{ contentHash: 'sha256-...' }`
 */
export interface UpdateFileOptions {
  /** New file/folder name */
  name?: string;

  /** New parent folder ID (null = move to root) */
  parentFolderId?: string | null;

  /** Toggle favorite flag */
  isFavorite?: boolean;

  /** Update blob path (used after upload to replace placeholder) */
  blobPath?: string;

  /** SHA-256 content hash for duplicate detection */
  contentHash?: string;
}

/**
 * Transform database record to API format
 *
 * Converts:
 * - snake_case DB fields → camelCase API fields
 * - Date objects → ISO 8601 strings
 * - Adds computed `hasExtractedText` field
 * - Computes `readinessState` from processing + embedding status (Phase 5)
 *
 * @param record - Database record from SQL query
 * @returns Parsed file ready for API response
 *
 * @example
 * ```typescript
 * const dbRecord = await db.query('SELECT * FROM files WHERE id = ?', [fileId]);
 * const apiResponse = parseFile(dbRecord);
 * res.json(apiResponse);
 * ```
 */
export function parseFile(record: FileDbRecord): ParsedFile {
  // Compute last error from either processing or embedding error
  const lastError = record.last_processing_error || record.last_embedding_error || null;

  return {
    id: record.id,
    userId: record.user_id,
    parentFolderId: record.parent_folder_id,
    name: record.name,
    mimeType: record.mime_type,
    sizeBytes: record.size_bytes,
    blobPath: record.blob_path,
    isFolder: record.is_folder,
    isFavorite: record.is_favorite,
    processingStatus: record.processing_status,
    embeddingStatus: record.embedding_status,
    readinessState: getReadinessStateComputer().compute(record.processing_status, record.embedding_status),
    processingRetryCount: record.processing_retry_count ?? 0,
    embeddingRetryCount: record.embedding_retry_count ?? 0,
    lastError,
    failedAt: record.failed_at ? record.failed_at.toISOString() : null,
    hasExtractedText: record.extracted_text !== null,
    contentHash: record.content_hash,
    deletionStatus: record.deletion_status ?? null,
    deletedAt: record.deleted_at ? record.deleted_at.toISOString() : null,
    createdAt: record.created_at.toISOString(),
    updatedAt: record.updated_at.toISOString(),
  };
}

/**
 * Transform file chunk database record to API format
 *
 * @param record - Database record from SQL query
 * @returns Parsed chunk ready for API response
 */
export function parseFileChunk(record: FileChunkDbRecord): ParsedFileChunk {
  return {
    id: record.id,
    fileId: record.file_id,
    chunkIndex: record.chunk_index,
    chunkText: record.chunk_text,
    chunkTokens: record.chunk_tokens,
    searchDocumentId: record.search_document_id,
    createdAt: record.created_at.toISOString(),
  };
}
