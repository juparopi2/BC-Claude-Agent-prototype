/**
 * File Formatters
 *
 * Utility functions for formatting file metadata for display.
 *
 * @module domains/files/utils/fileFormatters
 */

/**
 * Format file size in bytes to a human-readable string.
 *
 * @param bytes - File size in bytes (number or string)
 * @returns Formatted string (e.g., "1.5 MB") or "—" for invalid/zero values
 */
export function formatFileSize(bytes: number | string): string {
  // Parse bytes to number
  const parsedBytes = typeof bytes === 'string' ? Number(bytes) : bytes;

  // Handle invalid input types
  if (typeof parsedBytes !== 'number' || isNaN(parsedBytes) || parsedBytes < 0) {
    return '—';
  }
  if (parsedBytes === 0) return '—';

  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(parsedBytes) / Math.log(1024));

  // Extra safety check for array bounds
  if (i < 0 || i >= units.length) return '—';

  return `${(parsedBytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

/**
 * Format an ISO date string to a localized short date.
 *
 * @param isoDate - ISO 8601 date string
 * @returns Formatted date (e.g., "Jan 15, 2026") or "—" for invalid values
 */
export function formatDate(isoDate: string): string {
  // Handle invalid input
  if (!isoDate || typeof isoDate !== 'string') {
    return '—';
  }

  const date = new Date(isoDate);

  // Check if date is valid
  if (isNaN(date.getTime())) {
    return '—';
  }

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
