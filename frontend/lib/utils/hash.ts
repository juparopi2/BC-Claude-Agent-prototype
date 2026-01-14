/**
 * Hash Utilities for File Duplicate Detection
 *
 * Uses Web Crypto API to compute SHA-256 hashes for file content.
 * This enables client-side duplicate detection before upload.
 *
 * @module lib/utils/hash
 */

/**
 * Compute SHA-256 hash of a File using Web Crypto API
 *
 * @param file - File object to hash
 * @returns 64-character lowercase hexadecimal hash string
 *
 * @example
 * ```typescript
 * const hash = await computeFileSha256(file);
 * console.log(hash); // "e3b0c44298fc1c149afbf4c8996fb924..."
 * ```
 */
export async function computeFileSha256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);

  // Convert ArrayBuffer to hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

  return hashHex;
}

/**
 * Compute SHA-256 hashes for multiple files in parallel
 *
 * @param files - Array of File objects to hash
 * @returns Map of File to hash string
 *
 * @example
 * ```typescript
 * const files = [file1, file2, file3];
 * const hashes = await computeFileHashes(files);
 * const hash1 = hashes.get(file1); // "abc123..."
 * ```
 */
export async function computeFileHashes(files: File[]): Promise<Map<File, string>> {
  const results = new Map<File, string>();

  await Promise.all(
    files.map(async (file) => {
      const hash = await computeFileSha256(file);
      results.set(file, hash);
    })
  );

  return results;
}

/**
 * Result of hashing multiple files with metadata
 */
export interface FileHashResult {
  /** Original file */
  file: File;
  /** SHA-256 hash (64-char hex) */
  hash: string;
  /** Unique temp ID for API correlation */
  tempId: string;
}

/**
 * Compute hashes for files with unique temp IDs
 *
 * Useful for correlating API responses back to original files.
 *
 * @param files - Array of File objects
 * @returns Array of FileHashResult with tempId for correlation
 *
 * @example
 * ```typescript
 * const results = await computeFileHashesWithIds(files);
 * // Send to API: results.map(r => ({ tempId: r.tempId, hash: r.hash }))
 * // On response: find file by tempId
 * ```
 */
export async function computeFileHashesWithIds(files: File[]): Promise<FileHashResult[]> {
  const results: FileHashResult[] = [];

  await Promise.all(
    files.map(async (file, index) => {
      const hash = await computeFileSha256(file);
      results.push({
        file,
        hash,
        tempId: `temp-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 9)}`,
      });
    })
  );

  return results;
}
