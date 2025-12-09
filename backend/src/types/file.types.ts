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
 *
 * Architecture:
 * - Phase 1: Basic file CRUD (this module)
 * - Phase 2: Folder hierarchy
 * - Phase 3: Async processing (OCR, preview generation)
 * - Phase 4: Vector search and semantic matching
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
 */
export type FileSortBy = 'name' | 'date' | 'size';

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

/**
 * Parsed file for API responses
 *
 * This is the camelCase version sent to clients.
 * Differences from DB record:
 * - camelCase naming
 * - Dates as ISO 8601 strings
 * - `hasExtractedText` computed field (extracted_text !== null)
 * - No `extracted_text` field (too large for API responses)
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

  /** MIME type */
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
 * Parsed file chunk for API responses
 *
 * Used when returning search results or file content.
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
 * Options for getFiles() query
 *
 * Used by FileRepository to filter and paginate file listings.
 *
 * Examples:
 * - List all user's files: `{ userId: 'user-123' }`
 * - List root-level files: `{ userId: 'user-123', folderId: null }`
 * - List folder contents: `{ userId: 'user-123', folderId: 'folder-456' }`
 * - List favorites: `{ userId: 'user-123', favorites: true }`
 */
export interface GetFilesOptions {
  /** Owner user ID (required) */
  userId: string;

  /** Folder ID to list contents (undefined = all files, null = root only) */
  folderId?: string | null;

  /** Sort order */
  sortBy?: FileSortBy;

  /** Filter to favorites only */
  favorites?: boolean;

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
 */
export interface UpdateFileOptions {
  /** New file/folder name */
  name?: string;

  /** New parent folder ID (null = move to root) */
  parentFolderId?: string | null;

  /** Toggle favorite flag */
  isFavorite?: boolean;
}

/**
 * Transform database record to API format
 *
 * Converts:
 * - snake_case DB fields → camelCase API fields
 * - Date objects → ISO 8601 strings
 * - Adds computed `hasExtractedText` field
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
    hasExtractedText: record.extracted_text !== null,
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
