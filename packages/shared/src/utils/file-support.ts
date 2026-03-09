/**
 * File Sync Support Utility (PRD-106)
 *
 * Null-safe wrapper around isAllowedMimeType() for use in sync pipelines
 * and browse API responses. Reuses the existing ALLOWED_MIME_TYPES constant.
 *
 * @module utils/file-support
 */

import { isAllowedMimeType } from '../types/file.types';

/**
 * Check whether a file's MIME type is supported for sync/RAG ingestion.
 *
 * @param mimeType - MIME type string (may be null/undefined for unknown files)
 * @returns true if the MIME type is in the ALLOWED_MIME_TYPES list
 */
export function isFileSyncSupported(mimeType: string | null | undefined): boolean {
  if (!mimeType) return false;
  return isAllowedMimeType(mimeType);
}
