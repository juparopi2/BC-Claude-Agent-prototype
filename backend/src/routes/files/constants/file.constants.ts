/**
 * File Routes Constants
 *
 * Magic numbers, regex patterns, and configuration values for file routes.
 *
 * @module routes/files/constants/file.constants
 */

/**
 * Multer configuration limits
 */
export const MULTER_LIMITS = {
  /** Maximum file size in bytes (100 MB) */
  FILE_SIZE: 100 * 1024 * 1024,
  /** Maximum number of files per request */
  MAX_FILES: 20,
  /** Maximum field size in bytes (10 KB) */
  FIELD_SIZE: 10 * 1024,
} as const;

/**
 * Regex pattern for valid folder/file names.
 *
 * Allows: Unicode letters (\p{L}), numbers (\p{N}), spaces, hyphens, underscores, commas, periods, ampersands.
 * Supports Danish characters (æ, ø, å), German (ü, ß), and other European diacritics.
 * Also supports business names with "&" (e.g., "Serman & Tipsmark").
 */
export const FOLDER_NAME_REGEX = /^[\p{L}\p{N}\s\-_,.&]+$/u;

/**
 * Bulk upload batch configuration
 */
export const BULK_BATCH_CONFIG = {
  /** Time-to-live for batches in milliseconds (1 hour) */
  TTL_MS: 60 * 60 * 1000,
  /** Cleanup interval in milliseconds (1 hour) */
  CLEANUP_INTERVAL_MS: 60 * 60 * 1000,
} as const;

/**
 * File validation limits
 */
export const FILE_VALIDATION = {
  /** Maximum file name length */
  MAX_NAME_LENGTH: 255,
  /** Maximum content hash length for SHA-256 hex */
  CONTENT_HASH_LENGTH: 64,
  /** Maximum files per duplicate check request */
  MAX_DUPLICATE_CHECK_FILES: 50,
  /** Maximum query length for image search */
  MAX_SEARCH_QUERY_LENGTH: 1000,
  /** Maximum results for image search */
  MAX_SEARCH_RESULTS: 50,
  /** Default results for image search */
  DEFAULT_SEARCH_RESULTS: 10,
  /** Default minimum score for image search */
  DEFAULT_MIN_SCORE: 0.5,
} as const;

/**
 * Pagination defaults for file listing
 */
export const FILE_PAGINATION = {
  /** Default limit for file listing */
  DEFAULT_LIMIT: 50,
  /** Maximum limit for file listing */
  MAX_LIMIT: 100,
  /** Default offset */
  DEFAULT_OFFSET: 0,
} as const;
