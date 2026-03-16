/**
 * File Repository Module Exports
 *
 * This module contains:
 * - FileRepository: Prisma-based file CRUD and pipeline status operations
 * - FileChunkRepository: Prisma-based file_chunks CRUD
 */

export {
  FileRepository,
  getFileRepository,
  __resetFileRepository,
  type IFileRepository,
  type FileMetadata,
  type FileWithScopeMetadata,
  type MarkForDeletionResult,
  type FilePendingProcessing,
} from './FileRepository';

export {
  FileChunkRepository,
  getFileChunkRepository,
  __resetFileChunkRepository,
  type IFileChunkRepository,
  type ChunkRecord,
  type ChunkInsertInput,
  type SearchDocumentIdUpdate,
} from './FileChunkRepository';
