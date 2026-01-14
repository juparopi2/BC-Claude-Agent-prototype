/**
 * Hash Utilities
 *
 * Provides cryptographic hash functions for content identification.
 * Used primarily for duplicate file detection.
 *
 * @module shared/utils/hash
 */

import { createHash } from 'crypto';

/**
 * Compute SHA-256 hash of a buffer
 *
 * SHA-256 produces a 256-bit (32-byte) hash, represented as a 64-character
 * hexadecimal string. This is used for content-based duplicate detection.
 *
 * @param buffer - File content as Buffer
 * @returns 64-character lowercase hexadecimal string
 *
 * @example
 * ```typescript
 * const hash = computeSha256(fileBuffer);
 * // Returns: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
 * ```
 */
export function computeSha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Compute SHA-256 hash of a string
 *
 * Convenience wrapper for hashing string content.
 *
 * @param content - String content to hash
 * @param encoding - Character encoding (default: utf8)
 * @returns 64-character lowercase hexadecimal string
 */
export function computeSha256String(
  content: string,
  encoding: BufferEncoding = 'utf8'
): string {
  return createHash('sha256').update(content, encoding).digest('hex');
}
