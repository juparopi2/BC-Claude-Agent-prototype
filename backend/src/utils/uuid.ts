/**
 * UUID Normalization Utility
 *
 * Centralizes UUID case normalization to handle the mismatch between:
 * - SQL Server: Returns UUIDs in UPPERCASE (e.g., '322A1BAC-77DB-4A15-B1F0-48A51604642B')
 * - JavaScript: Generates UUIDs in lowercase (e.g., '322a1bac-77db-4a15-b1f0-48a51604642b')
 *
 * This utility ensures consistent case-insensitive UUID comparison across the application.
 *
 * @module utils/uuid
 */

/**
 * Normalize UUID to lowercase for case-insensitive comparison.
 *
 * @param uuid - The UUID string to normalize (can be null/undefined)
 * @returns The lowercase UUID string, or empty string if input is falsy
 *
 * @example
 * ```typescript
 * normalizeUUID('322A1BAC-77DB-4A15-B1F0-48A51604642B')
 * // Returns: '322a1bac-77db-4a15-b1f0-48a51604642b'
 *
 * normalizeUUID(null)
 * // Returns: ''
 * ```
 */
export function normalizeUUID(uuid: string | null | undefined): string {
  if (!uuid) return '';
  return uuid.toLowerCase();
}

/**
 * Compare two UUIDs for equality, case-insensitively.
 *
 * @param uuid1 - First UUID to compare
 * @param uuid2 - Second UUID to compare
 * @returns true if both UUIDs are equal (case-insensitive), false otherwise
 *
 * @example
 * ```typescript
 * compareUUIDs('ABC-123', 'abc-123')
 * // Returns: true
 *
 * compareUUIDs('ABC-123', 'DEF-456')
 * // Returns: false
 *
 * compareUUIDs(null, 'abc-123')
 * // Returns: false
 * ```
 */
export function compareUUIDs(
  uuid1: string | null | undefined,
  uuid2: string | null | undefined
): boolean {
  const normalized1 = normalizeUUID(uuid1);
  const normalized2 = normalizeUUID(uuid2);

  // Both empty means both were null/undefined - consider not equal
  if (normalized1 === '' && normalized2 === '') return false;

  return normalized1 === normalized2;
}
