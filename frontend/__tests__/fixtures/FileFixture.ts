/**
 * File Test Fixtures
 *
 * Centralized mock file factory for test consistency.
 * Ensures all ParsedFile mocks have required fields.
 *
 * @module __tests__/fixtures/FileFixture
 */

import type { ParsedFile, ProcessingStatus, EmbeddingStatus, FileReadinessState } from '@bc-agent/shared';

/**
 * Creates a mock ParsedFile with all required fields.
 * All fields have sensible defaults that can be overridden.
 */
export const createMockParsedFile = (overrides: Partial<ParsedFile> = {}): ParsedFile => ({
  id: `file-${Math.random().toString(36).substr(2, 9)}`,
  userId: 'user-1',
  parentFolderId: null,
  name: 'test-file.txt',
  mimeType: 'text/plain',
  sizeBytes: 1024,
  blobPath: 'users/user-1/files/test-file.txt',
  isFolder: false,
  isFavorite: false,
  processingStatus: 'completed' as ProcessingStatus,
  embeddingStatus: 'completed' as EmbeddingStatus,
  readinessState: 'ready' as FileReadinessState,
  processingRetryCount: 0,
  embeddingRetryCount: 0,
  lastError: null,
  failedAt: null,
  hasExtractedText: true,
  contentHash: null,
  deletionStatus: null,
  deletedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

/**
 * Creates a mock folder (a ParsedFile with isFolder: true).
 */
export const createMockFolder = (overrides: Partial<ParsedFile> = {}): ParsedFile =>
  createMockParsedFile({
    name: 'test-folder',
    mimeType: 'inode/directory',
    sizeBytes: 0,
    blobPath: '', // Folders don't have blob paths
    isFolder: true,
    hasExtractedText: false,
    processingStatus: 'pending' as ProcessingStatus,
    embeddingStatus: 'pending' as EmbeddingStatus,
    readinessState: 'processing' as FileReadinessState, // Folders are typically in processing until completed
    ...overrides,
  });

/**
 * Legacy alias for backward compatibility.
 * Use createMockParsedFile in new code.
 */
export const createMockFile = createMockParsedFile;
