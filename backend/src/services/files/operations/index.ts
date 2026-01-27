/**
 * File Operations Module Exports
 *
 * This module contains specialized services for file operations:
 * - FileDeletionService: GDPR-compliant cascading deletion (hard delete)
 * - SoftDeleteService: Two-phase soft delete workflow (Phase 1 sync, Phase 2 async)
 * - FileDuplicateService: Duplicate detection by name and hash
 * - FileMetadataService: Metadata updates (rename, move, favorite)
 */

export {
  FileDeletionService,
  getFileDeletionService,
  __resetFileDeletionService,
  type IFileDeletionService,
  type DeletionOptions,
} from './FileDeletionService';

export {
  SoftDeleteService,
  getSoftDeleteService,
  __resetSoftDeleteService,
  type ISoftDeleteService,
  type SoftDeleteOptions,
} from './SoftDeleteService';

export {
  FileDuplicateService,
  getFileDuplicateService,
  __resetFileDuplicateService,
  type IFileDuplicateService,
  type DuplicateCheckResult,
  type BatchNameDuplicateResult,
  type BatchHashDuplicateResult,
} from './FileDuplicateService';

export {
  FileMetadataService,
  getFileMetadataService,
  __resetFileMetadataService,
  type IFileMetadataService,
} from './FileMetadataService';
