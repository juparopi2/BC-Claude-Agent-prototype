/**
 * File Types Tests
 *
 * Verifies that file type definitions and fixtures work correctly.
 * These tests ensure:
 * - Type transformations (DB → API) work correctly
 * - Fixtures produce valid test data
 * - Type safety is enforced
 */

import { describe, it, expect } from 'vitest';
import { parseFile, parseFileChunk } from '@/types/file.types';
import { FileFixture } from '@/__tests__/fixtures/FileFixture';

describe('File Types', () => {
  describe('parseFile()', () => {
    it('should transform DB record to API format', () => {
      const dbRecord = FileFixture.createFileDbRecord({
        id: 'file-123',
        user_id: 'user-456',
        name: 'test.pdf',
        mime_type: 'application/pdf',
        size_bytes: 1024,
        is_folder: false,
        is_favorite: true,
        extracted_text: 'Some text content',
        created_at: new Date('2025-01-15T10:00:00Z'),
        updated_at: new Date('2025-01-15T11:00:00Z'),
      });

      const parsed = parseFile(dbRecord);

      expect(parsed).toEqual({
        id: 'file-123',
        userId: 'user-456',
        parentFolderId: null,
        name: 'test.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        blobPath: dbRecord.blob_path,
        isFolder: false,
        isFavorite: true,
        processingStatus: 'completed',
        embeddingStatus: 'pending',
        readinessState: 'processing', // completed + pending = processing
        hasExtractedText: true, // Computed from extracted_text !== null
        contentHash: null, // Fixture default is null
        processingRetryCount: 0,
        embeddingRetryCount: 0,
        lastError: null,
        failedAt: null,
        deletionStatus: null, // Default for active files
        deletedAt: null,
        createdAt: '2025-01-15T10:00:00.000Z',
        updatedAt: '2025-01-15T11:00:00.000Z',
      });
    });

    it('should set hasExtractedText to false when extracted_text is null', () => {
      const dbRecord = FileFixture.createFileDbRecord({
        extracted_text: null,
      });

      const parsed = parseFile(dbRecord);

      expect(parsed.hasExtractedText).toBe(false);
    });

    it('should handle folder records correctly', () => {
      const folder = FileFixture.createFolder({
        name: 'My Documents',
      });

      const parsed = parseFile(folder);

      expect(parsed.isFolder).toBe(true);
      expect(parsed.mimeType).toBe('inode/directory');
      expect(parsed.sizeBytes).toBe(0);
      expect(parsed.blobPath).toBe('');
    });
  });

  describe('parseFileChunk()', () => {
    it('should transform chunk DB record to API format', () => {
      const dbRecord = FileFixture.createFileChunk({
        id: 'chunk-123',
        file_id: 'file-456',
        chunk_index: 2,
        chunk_text: 'Sample chunk text',
        chunk_tokens: 42,
        search_document_id: 'search-doc-001',
        created_at: new Date('2025-01-15T10:05:00Z'),
      });

      const parsed = parseFileChunk(dbRecord);

      expect(parsed).toEqual({
        id: 'chunk-123',
        fileId: 'file-456',
        chunkIndex: 2,
        chunkText: 'Sample chunk text',
        chunkTokens: 42,
        searchDocumentId: 'search-doc-001',
        createdAt: '2025-01-15T10:05:00.000Z',
      });
    });
  });
});

describe('FileFixture', () => {
  describe('createFileDbRecord()', () => {
    it('should create a valid file record with defaults', () => {
      const file = FileFixture.createFileDbRecord();

      expect(file.id).toMatch(/^file-/);
      expect(file.user_id).toMatch(/^user-/);
      expect(file.name).toBe('test-document.pdf');
      expect(file.mime_type).toBe('application/pdf');
      expect(file.size_bytes).toBe(1024000);
      expect(file.is_folder).toBe(false);
      expect(file.processing_status).toBe('completed');
      expect(file.created_at).toBeInstanceOf(Date);
    });

    it('should allow overriding any field', () => {
      const file = FileFixture.createFileDbRecord({
        name: 'custom.pdf',
        size_bytes: 500000,
        is_favorite: true,
      });

      expect(file.name).toBe('custom.pdf');
      expect(file.size_bytes).toBe(500000);
      expect(file.is_favorite).toBe(true);
    });

    it('should generate unique IDs for each file', () => {
      const file1 = FileFixture.createFileDbRecord();
      const file2 = FileFixture.createFileDbRecord();

      expect(file1.id).not.toBe(file2.id);
    });
  });

  describe('createFolder()', () => {
    it('should create a valid folder record', () => {
      const folder = FileFixture.createFolder();

      expect(folder.is_folder).toBe(true);
      expect(folder.mime_type).toBe('inode/directory');
      expect(folder.size_bytes).toBe(0);
      expect(folder.blob_path).toBe('');
    });
  });

  describe('createParsedFile()', () => {
    it('should create a valid API-format file', () => {
      const file = FileFixture.createParsedFile();

      expect(file.id).toMatch(/^file-/);
      expect(file.userId).toMatch(/^user-/);
      expect(file.name).toBe('test-document.pdf');
      expect(file.mimeType).toBe('application/pdf');
      expect(file.isFolder).toBe(false);
      expect(file.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO 8601
    });
  });

  describe('createMultipleFiles()', () => {
    it('should create the specified number of files', () => {
      const files = FileFixture.createMultipleFiles(5);

      expect(files).toHaveLength(5);
      expect(files[0].name).toBe('file-1.pdf');
      expect(files[4].name).toBe('file-5.pdf');
    });

    it('should apply overrides to all files', () => {
      const files = FileFixture.createMultipleFiles(3, {
        user_id: 'user-shared',
        is_favorite: true,
      });

      expect(files.every((f) => f.user_id === 'user-shared')).toBe(true);
      expect(files.every((f) => f.is_favorite === true)).toBe(true);
    });
  });

  describe('Presets', () => {
    it('should create an invoice file with realistic data', () => {
      const invoice = FileFixture.Presets.invoice('user-123');

      expect(invoice.name).toBe('invoice-2024-12.pdf');
      expect(invoice.user_id).toBe('user-123');
      expect(invoice.mime_type).toBe('application/pdf');
      expect(invoice.processing_status).toBe('completed');
      expect(invoice.embedding_status).toBe('completed');
      expect(invoice.extracted_text).toContain('Invoice');
      expect(invoice.is_favorite).toBe(true);
    });

    it('should create a folder with files', () => {
      const { folder, files } = FileFixture.Presets.folderWithFiles('user-123');

      expect(folder.is_folder).toBe(true);
      expect(folder.name).toBe('Invoices');
      expect(files).toHaveLength(3);
      expect(files.every((f) => f.parent_folder_id === folder.id)).toBe(true);
    });

    it('should create nested folder structure', () => {
      const { root, subfolder1, subfolder2, file1, file2 } =
        FileFixture.Presets.nestedFolders('user-123');

      expect(root.is_folder).toBe(true);
      expect(subfolder1.parent_folder_id).toBe(root.id);
      expect(subfolder2.parent_folder_id).toBe(root.id);
      expect(file1.parent_folder_id).toBe(subfolder1.id);
      expect(file2.parent_folder_id).toBe(subfolder2.id);
    });

    it('should create file with chunks', () => {
      const { file, chunks } = FileFixture.Presets.fileWithChunks('user-123');

      expect(file.processing_status).toBe('completed');
      expect(file.embedding_status).toBe('completed');
      expect(chunks).toHaveLength(3);
      expect(chunks[0].chunk_index).toBe(0);
      expect(chunks[1].chunk_index).toBe(1);
      expect(chunks[2].chunk_index).toBe(2);
      expect(chunks.every((c) => c.file_id === file.id)).toBe(true);
    });
  });
});
