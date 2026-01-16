/**
 * File Deletion Domain Module
 *
 * Exports for the file deletion processor that handles
 * queue-based bulk file deletion.
 *
 * @module domains/files/deletion
 */

export type { IFileDeletionProcessor, FileDeletionResult } from './IFileDeletionProcessor';
export {
  FileDeletionProcessor,
  getFileDeletionProcessor,
  __resetFileDeletionProcessor,
  type FileDeletionProcessorDependencies,
} from './FileDeletionProcessor';
