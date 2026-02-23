/**
 * File Routes Constants
 *
 * Shared constants for file route validation and pagination.
 *
 * @module routes/files/constants/file.constants
 */

/**
 * Regex for valid folder/file names.
 * Allows: Unicode letters (incl. Danish æøå and other international chars), numbers,
 * spaces, hyphens, underscores, commas, periods, and ampersands.
 * Uses Unicode category \p{L} for letters to support international characters.
 */
export const FOLDER_NAME_REGEX = /^[\p{L}\p{N}\s\-_,\.&()[\]{}!@#$%^+='`~;]+$/u;

/**
 * File validation constants
 */
export const FILE_VALIDATION = {
  /** Maximum length for file/folder names */
  MAX_NAME_LENGTH: 255,

  /** Maximum length for search query strings */
  MAX_SEARCH_QUERY_LENGTH: 500,

  /** Maximum number of search results to return */
  MAX_SEARCH_RESULTS: 100,

  /** Default number of search results to return */
  DEFAULT_SEARCH_RESULTS: 10,

  /** Default minimum similarity score for image search */
  DEFAULT_MIN_SCORE: 0.5,

  /** Length of SHA-256 content hash in hex characters */
  CONTENT_HASH_LENGTH: 64,

  /** Maximum files per duplicate-check request */
  MAX_DUPLICATE_CHECK_FILES: 100,
} as const;

/**
 * File list pagination constants
 */
export const FILE_PAGINATION = {
  /** Maximum number of files per page */
  MAX_LIMIT: 100,

  /** Default number of files per page */
  DEFAULT_LIMIT: 50,

  /** Default pagination offset */
  DEFAULT_OFFSET: 0,
} as const;
