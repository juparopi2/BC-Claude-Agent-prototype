/**
 * File Cleanup Domain Module
 *
 * Exports cleanup services for orphaned data and maintenance.
 *
 * @module domains/files/cleanup
 */

// Types
export type { IPartialDataCleaner, CleanupOptions } from './IPartialDataCleaner';

// Legacy Service (PRD-05 deprecation pending PRD-07)
export {
  PartialDataCleaner,
  getPartialDataCleaner,
  __resetPartialDataCleaner,
  type PartialDataCleanerDependencies,
} from './PartialDataCleaner';

// V2 Cleanup Services (PRD-05)
export {
  OrphanCleanupService,
  getOrphanCleanupService,
  __resetOrphanCleanupService,
} from './OrphanCleanupService';

export {
  BatchTimeoutService,
  getBatchTimeoutService,
  __resetBatchTimeoutService,
} from './BatchTimeoutService';
