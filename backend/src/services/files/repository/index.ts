/**
 * File Repository Module Exports
 *
 * This module contains:
 * - FileQueryBuilder: SQL query construction
 * - FileRepository: Database operations
 */

export {
  FileQueryBuilder,
  getFileQueryBuilder,
  __resetFileQueryBuilder,
  type QueryResult,
  type GetFilesQueryOptions,
  type GetFileCountOptions,
  type InClauseResult,
} from './FileQueryBuilder';

export {
  FileRepository,
  getFileRepository,
  __resetFileRepository,
  type IFileRepository,
  type FileMetadata,
} from './FileRepository';
