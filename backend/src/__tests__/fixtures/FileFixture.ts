/**
 * FileFixture - Factory for file management test data
 *
 * This fixture creates realistic test data for the file management system.
 * Follows the Builder pattern for fluent, readable test setup.
 *
 * Benefits:
 * - Reduces test boilerplate
 * - Provides realistic default values
 * - Easy to create complex file hierarchies
 * - Self-documenting test data
 *
 * Usage:
 * ```typescript
 * // Create a simple file
 * const file = FileFixture.createFileDbRecord();
 *
 * // Create a file with overrides
 * const pdf = FileFixture.createFileDbRecord({
 *   name: 'invoice.pdf',
 *   mime_type: 'application/pdf',
 *   size_bytes: 512000,
 * });
 *
 * // Create a folder
 * const folder = FileFixture.createFolder({ name: 'Documents' });
 *
 * // Create multiple files
 * const files = FileFixture.createMultipleFiles(5, { user_id: 'user-123' });
 *
 * // Create a parsed file (API format)
 * const apiFile = FileFixture.createParsedFile({ name: 'report.pdf' });
 * ```
 */

import {
  FileDbRecord,
  ParsedFile,
  FileChunkDbRecord,
  ParsedFileChunk,
  MessageFileAttachmentDbRecord,
  ProcessingStatus,
  EmbeddingStatus,
  FileUsageType,
} from '@/types/file.types';

/**
 * File Fixture Factory
 *
 * Creates realistic test data with complete typing.
 * Follows the pattern: provide realistic defaults, allow overrides.
 */
export class FileFixture {
  /**
   * Generate a random UUID for testing
   */
  private static generateId(prefix = 'file'): string {
    return `${prefix}-${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Generate a realistic blob path
   */
  private static generateBlobPath(userId: string, filename: string): string {
    const timestamp = Date.now();
    return `users/${userId}/files/${timestamp}-${filename}`;
  }

  /**
   * Create a complete FileDbRecord with realistic defaults
   *
   * Default values represent a typical uploaded PDF file:
   * - 1 MB size
   * - Uploaded today
   * - Processing completed
   * - Embeddings pending
   * - No extracted text yet
   *
   * @param overrides - Partial record to override defaults
   * @returns Complete file database record ready for tests
   *
   * @example
   * ```typescript
   * const invoice = FileFixture.createFileDbRecord({
   *   name: 'invoice-2024-01.pdf',
   *   user_id: 'user-123',
   * });
   * ```
   */
  static createFileDbRecord(overrides?: Partial<FileDbRecord>): FileDbRecord {
    const userId = overrides?.user_id || FileFixture.generateId('user');
    const name = overrides?.name || 'test-document.pdf';
    const createdAt = overrides?.created_at || new Date('2025-01-15T10:00:00Z');

    return {
      id: FileFixture.generateId('file'),
      user_id: userId,
      parent_folder_id: null,
      name,
      mime_type: 'application/pdf',
      size_bytes: 1024000, // 1 MB
      blob_path: FileFixture.generateBlobPath(userId, name),
      is_folder: false,
      is_favorite: false,
      processing_status: 'completed' as ProcessingStatus,
      embedding_status: 'pending' as EmbeddingStatus,
      extracted_text: null,
      created_at: createdAt,
      updated_at: createdAt,
      ...overrides,
    };
  }

  /**
   * Create a folder record
   *
   * Folders have special characteristics:
   * - `is_folder: true`
   * - `mime_type: 'inode/directory'`
   * - `size_bytes: 0`
   * - `blob_path: ''` (empty string, no blob storage)
   *
   * @param overrides - Partial record to override defaults
   * @returns Complete folder database record
   *
   * @example
   * ```typescript
   * const docsFolder = FileFixture.createFolder({
   *   name: 'Documents',
   *   user_id: 'user-123',
   * });
   * ```
   */
  static createFolder(overrides?: Partial<FileDbRecord>): FileDbRecord {
    return FileFixture.createFileDbRecord({
      name: 'Documents',
      mime_type: 'inode/directory',
      size_bytes: 0,
      blob_path: '',
      is_folder: true,
      ...overrides,
    });
  }

  /**
   * Create a ParsedFile (API response format)
   *
   * This is the camelCase version sent to clients.
   * Dates are ISO 8601 strings, not Date objects.
   *
   * @param overrides - Partial record to override defaults
   * @returns Complete parsed file ready for API tests
   *
   * @example
   * ```typescript
   * const apiFile = FileFixture.createParsedFile({
   *   name: 'report.pdf',
   *   userId: 'user-123',
   * });
   *
   * // Test API response
   * expect(response.body).toEqual(apiFile);
   * ```
   */
  static createParsedFile(overrides?: Partial<ParsedFile>): ParsedFile {
    const userId = overrides?.userId || FileFixture.generateId('user');
    const name = overrides?.name || 'test-document.pdf';
    const createdAt = overrides?.createdAt || '2025-01-15T10:00:00.000Z';

    return {
      id: FileFixture.generateId('file'),
      userId,
      parentFolderId: null,
      name,
      mimeType: 'application/pdf',
      sizeBytes: 1024000,
      blobPath: FileFixture.generateBlobPath(userId, name),
      isFolder: false,
      isFavorite: false,
      processingStatus: 'completed',
      embeddingStatus: 'pending',
      hasExtractedText: false,
      createdAt,
      updatedAt: createdAt,
      ...overrides,
    };
  }

  /**
   * Create multiple file records
   *
   * Useful for testing pagination, sorting, and bulk operations.
   *
   * @param count - Number of files to create
   * @param overrides - Partial record applied to ALL files
   * @returns Array of file database records
   *
   * @example
   * ```typescript
   * // Create 10 files for a user
   * const files = FileFixture.createMultipleFiles(10, {
   *   user_id: 'user-123',
   * });
   *
   * // Files are named: file-1.pdf, file-2.pdf, etc.
   * expect(files).toHaveLength(10);
   * expect(files[0].name).toBe('file-1.pdf');
   * ```
   */
  static createMultipleFiles(count: number, overrides?: Partial<FileDbRecord>): FileDbRecord[] {
    return Array.from({ length: count }, (_, i) =>
      FileFixture.createFileDbRecord({
        name: `file-${i + 1}.pdf`,
        ...overrides,
      })
    );
  }

  /**
   * Create a file chunk record
   *
   * Chunks are created during Phase 3 async processing.
   * Each chunk is ~1000 tokens of extracted text.
   *
   * @param overrides - Partial record to override defaults
   * @returns Complete file chunk database record
   *
   * @example
   * ```typescript
   * const chunk = FileFixture.createFileChunk({
   *   file_id: 'file-123',
   *   chunk_index: 0,
   *   chunk_text: 'This is the first chunk of text...',
   * });
   * ```
   */
  static createFileChunk(overrides?: Partial<FileChunkDbRecord>): FileChunkDbRecord {
    return {
      id: FileFixture.generateId('chunk'),
      file_id: overrides?.file_id || FileFixture.generateId('file'),
      chunk_index: 0,
      chunk_text: 'This is a sample chunk of extracted text from a document. It contains approximately 1000 tokens of content that will be used for search and context injection.',
      chunk_tokens: 42,
      search_document_id: null,
      created_at: new Date('2025-01-15T10:05:00Z'),
      ...overrides,
    };
  }

  /**
   * Create a parsed file chunk (API format)
   *
   * @param overrides - Partial record to override defaults
   * @returns Complete parsed chunk ready for API tests
   */
  static createParsedFileChunk(overrides?: Partial<ParsedFileChunk>): ParsedFileChunk {
    return {
      id: FileFixture.generateId('chunk'),
      fileId: overrides?.fileId || FileFixture.generateId('file'),
      chunkIndex: 0,
      chunkText: 'This is a sample chunk of extracted text from a document. It contains approximately 1000 tokens of content that will be used for search and context injection.',
      chunkTokens: 42,
      searchDocumentId: null,
      createdAt: '2025-01-15T10:05:00.000Z',
      ...overrides,
    };
  }

  /**
   * Create a message file attachment record
   *
   * Links a file to a message in a chat session.
   *
   * @param overrides - Partial record to override defaults
   * @returns Complete message file attachment record
   *
   * @example
   * ```typescript
   * const attachment = FileFixture.createMessageFileAttachment({
   *   message_id: 'msg-123',
   *   file_id: 'file-456',
   *   usage_type: 'direct',
   * });
   * ```
   */
  static createMessageFileAttachment(
    overrides?: Partial<MessageFileAttachmentDbRecord>
  ): MessageFileAttachmentDbRecord {
    return {
      id: FileFixture.generateId('attach'),
      message_id: overrides?.message_id || FileFixture.generateId('msg'),
      file_id: overrides?.file_id || FileFixture.generateId('file'),
      usage_type: 'direct' as FileUsageType,
      relevance_score: null,
      created_at: new Date('2025-01-15T10:00:00Z'),
      ...overrides,
    };
  }

  /**
   * Common presets for typical file scenarios
   */
  static readonly Presets = {
    /**
     * A typical PDF invoice file
     */
    invoice: (userId = 'user-test-123') =>
      FileFixture.createFileDbRecord({
        user_id: userId,
        name: 'invoice-2024-12.pdf',
        mime_type: 'application/pdf',
        size_bytes: 245760, // ~240 KB
        processing_status: 'completed',
        embedding_status: 'completed',
        extracted_text: 'Invoice #INV-2024-12-001\nDate: December 31, 2024\nAmount Due: $1,250.00',
        is_favorite: true,
      }),

    /**
     * A Word document
     */
    wordDoc: (userId = 'user-test-123') =>
      FileFixture.createFileDbRecord({
        user_id: userId,
        name: 'project-proposal.docx',
        mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size_bytes: 512000, // ~500 KB
        processing_status: 'completed',
        embedding_status: 'pending',
      }),

    /**
     * An Excel spreadsheet
     */
    spreadsheet: (userId = 'user-test-123') =>
      FileFixture.createFileDbRecord({
        user_id: userId,
        name: 'budget-2024.xlsx',
        mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size_bytes: 102400, // ~100 KB
        processing_status: 'completed',
        embedding_status: 'completed',
      }),

    /**
     * An image file (processing pending)
     */
    image: (userId = 'user-test-123') =>
      FileFixture.createFileDbRecord({
        user_id: userId,
        name: 'screenshot.png',
        mime_type: 'image/png',
        size_bytes: 2048000, // ~2 MB
        processing_status: 'pending',
        embedding_status: 'pending',
      }),

    /**
     * A large PDF (processing failed)
     */
    largePdfFailed: (userId = 'user-test-123') =>
      FileFixture.createFileDbRecord({
        user_id: userId,
        name: 'annual-report-2024.pdf',
        mime_type: 'application/pdf',
        size_bytes: 52428800, // 50 MB
        processing_status: 'failed',
        embedding_status: 'pending',
      }),

    /**
     * A folder with files inside
     */
    folderWithFiles: (userId = 'user-test-123') => {
      const folder = FileFixture.createFolder({
        user_id: userId,
        name: 'Invoices',
      });

      const files = [
        FileFixture.createFileDbRecord({
          user_id: userId,
          parent_folder_id: folder.id,
          name: 'invoice-01.pdf',
        }),
        FileFixture.createFileDbRecord({
          user_id: userId,
          parent_folder_id: folder.id,
          name: 'invoice-02.pdf',
        }),
        FileFixture.createFileDbRecord({
          user_id: userId,
          parent_folder_id: folder.id,
          name: 'invoice-03.pdf',
        }),
      ];

      return { folder, files };
    },

    /**
     * Nested folder structure
     */
    nestedFolders: (userId = 'user-test-123') => {
      const root = FileFixture.createFolder({
        user_id: userId,
        name: 'Documents',
      });

      const subfolder1 = FileFixture.createFolder({
        user_id: userId,
        parent_folder_id: root.id,
        name: 'Work',
      });

      const subfolder2 = FileFixture.createFolder({
        user_id: userId,
        parent_folder_id: root.id,
        name: 'Personal',
      });

      const file1 = FileFixture.createFileDbRecord({
        user_id: userId,
        parent_folder_id: subfolder1.id,
        name: 'work-document.pdf',
      });

      const file2 = FileFixture.createFileDbRecord({
        user_id: userId,
        parent_folder_id: subfolder2.id,
        name: 'personal-note.pdf',
      });

      return { root, subfolder1, subfolder2, file1, file2 };
    },

    /**
     * File with chunks (for search tests)
     */
    fileWithChunks: (userId = 'user-test-123') => {
      const file = FileFixture.createFileDbRecord({
        user_id: userId,
        name: 'long-document.pdf',
        size_bytes: 5120000, // 5 MB
        processing_status: 'completed',
        embedding_status: 'completed',
        extracted_text: 'This is a long document with multiple pages...',
      });

      const chunks = [
        FileFixture.createFileChunk({
          file_id: file.id,
          chunk_index: 0,
          chunk_text: 'This is the first chunk of the document. It contains the introduction and overview...',
          chunk_tokens: 128,
          search_document_id: 'search-doc-001',
        }),
        FileFixture.createFileChunk({
          file_id: file.id,
          chunk_index: 1,
          chunk_text: 'This is the second chunk. It contains the main content and analysis...',
          chunk_tokens: 135,
          search_document_id: 'search-doc-002',
        }),
        FileFixture.createFileChunk({
          file_id: file.id,
          chunk_index: 2,
          chunk_text: 'This is the final chunk. It contains the conclusion and recommendations...',
          chunk_tokens: 98,
          search_document_id: 'search-doc-003',
        }),
      ];

      return { file, chunks };
    },

    /**
     * Semantic match attachment (for message attachment tests)
     */
    semanticAttachment: (messageId = 'msg-123', fileId = 'file-456') =>
      FileFixture.createMessageFileAttachment({
        message_id: messageId,
        file_id: fileId,
        usage_type: 'semantic_match',
        relevance_score: 0.87,
      }),

    /**
     * Direct attachment (user explicitly attached)
     */
    directAttachment: (messageId = 'msg-123', fileId = 'file-456') =>
      FileFixture.createMessageFileAttachment({
        message_id: messageId,
        file_id: fileId,
        usage_type: 'direct',
        relevance_score: null,
      }),

    /**
     * Folder attachment (file included via parent folder)
     */
    folderAttachment: (messageId = 'msg-123', fileId = 'file-456') =>
      FileFixture.createMessageFileAttachment({
        message_id: messageId,
        file_id: fileId,
        usage_type: 'folder',
        relevance_score: null,
      }),
  };
}
