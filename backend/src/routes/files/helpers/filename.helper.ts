/**
 * Filename Helper
 *
 * Utilities for handling file names, including mojibake detection and correction.
 *
 * @module routes/files/helpers/filename.helper
 */

import { createChildLogger } from '@/shared/utils/logger';

const logger = createChildLogger({ service: 'FilenameHelper' });

/**
 * Detect and fix mojibake in filenames from multer
 *
 * Multer receives filenames from Content-Disposition headers which are
 * encoded as Latin-1 (ISO-8859-1) per HTTP RFC. When the browser sends
 * UTF-8 characters, they get misinterpreted as Latin-1, causing mojibake.
 *
 * This function detects common mojibake patterns and reverses them.
 *
 * @param filename - Potentially corrupted filename from multer
 * @returns Fixed filename with proper UTF-8 characters
 * @example
 * fixFilenameMojibake('Order received â proâ¢duhkâ¢tiv.pdf')
 * // Returns: 'Order received – pro•duhk•tiv.pdf'
 */
export function fixFilenameMojibake(filename: string): string {
  try {
    // Check if filename contains mojibake markers
    const hasMojibake = /[â€¢™'""–—Ã]/.test(filename);

    if (!hasMojibake) {
      // No mojibake detected, return as-is
      return filename;
    }

    // Convert the corrupted string back to UTF-8
    // The mojibake happened because UTF-8 bytes were interpreted as Latin-1
    // We reverse it by converting back: Latin-1 → bytes → UTF-8
    const latin1Buffer = Buffer.from(filename, 'latin1');
    const utf8String = latin1Buffer.toString('utf8');

    logger.debug({
      original: filename,
      fixed: utf8String
    }, 'Fixed mojibake in filename');

    return utf8String;
  } catch (error) {
    // If conversion fails, return original
    logger.warn({ filename, error }, 'Failed to fix mojibake, using original filename');
    return filename;
  }
}
