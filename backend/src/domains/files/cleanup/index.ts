/**
 * File Cleanup Domain Module
 *
 * Exports cleanup service for orphaned data.
 *
 * Usage:
 * ```typescript
 * import { getPartialDataCleaner } from '@/domains/files/cleanup';
 *
 * const cleaner = getPartialDataCleaner();
 * await cleaner.cleanupForFile(userId, fileId);
 * ```
 *
 * @module domains/files/cleanup
 */

// Types
export type { IPartialDataCleaner, CleanupOptions } from './IPartialDataCleaner';

// Service
export {
  PartialDataCleaner,
  getPartialDataCleaner,
  __resetPartialDataCleaner,
  type PartialDataCleanerDependencies,
} from './PartialDataCleaner';
