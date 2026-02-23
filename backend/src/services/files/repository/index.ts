/**
 * File Repository Module Exports
 *
 * This module contains:
 * - FileRepository: Prisma-based file CRUD and pipeline status operations
 */

export {
  FileRepository,
  getFileRepository,
  __resetFileRepository,
  type IFileRepository,
  type FileMetadata,
  type MarkForDeletionResult,
  type FilePendingProcessing,
} from './FileRepository';
