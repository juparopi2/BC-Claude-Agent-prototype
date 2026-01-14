/**
 * File Processing Configuration Module
 *
 * Exports centralized configuration for file processing.
 *
 * Usage:
 * ```typescript
 * import { getFileProcessingConfig } from '@/domains/files/config';
 *
 * const config = getFileProcessingConfig();
 * const maxRetries = config.retry.maxProcessingRetries;
 * ```
 *
 * @module domains/files/config
 */

// Schema and types
export {
  FileProcessingConfigSchema,
  type FileProcessingConfig,
  DEFAULT_FILE_PROCESSING_CONFIG,
} from './file-processing.config';

// Getter
export {
  getFileProcessingConfig,
  __resetFileProcessingConfig,
} from './file-processing.config';
