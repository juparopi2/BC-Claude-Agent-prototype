/**
 * Validation Utilities
 *
 * Shared validation functions and constants for file/folder name validation.
 * Supports extended Latin characters (Danish: æ, ø, å, German: ü, ß, etc.)
 *
 * @module lib/utils/validation
 */

/**
 * Regex pattern for valid folder/file names.
 *
 * Allows:
 * - All Unicode letters (\p{L}) - supports æ, ø, å, ü, ñ, etc.
 * - All Unicode numbers (\p{N}) - supports Arabic numerals and other number systems
 * - Spaces (\s)
 * - Hyphens (-)
 * - Underscores (_)
 * - Commas (,) - common in Danish business names
 * - Periods (.) - common in filenames and abbreviations
 * - Ampersands (&) - common in business names (e.g., "Serman & Tipsmark")
 *
 * The 'u' flag enables Unicode mode for \p{} patterns.
 */
export const FOLDER_NAME_REGEX = /^[\p{L}\p{N}\s\-_,.&]+$/u;

/**
 * Error message for invalid folder names
 */
export const FOLDER_NAME_ERROR =
  'Folder name can only contain letters, numbers, spaces, hyphens, underscores, commas, periods, and ampersands';

/**
 * Validation result interface
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate a folder name
 *
 * @param name - The folder name to validate
 * @returns Validation result with valid flag and optional error message
 *
 * @example
 * ```typescript
 * // Valid names
 * validateFolderName('ERA Biler AS'); // { valid: true }
 * validateFolderName('16839-ERA Biler AS, Hillerød'); // { valid: true }
 * validateFolderName('Øresund Æbler Åben'); // { valid: true }
 * validateFolderName('Müller Straße'); // { valid: true }
 *
 * // Invalid names
 * validateFolderName(''); // { valid: false, error: 'Please enter a folder name' }
 * validateFolderName('Invalid/Name'); // { valid: false, error: '...' }
 * validateFolderName('Name*With*Stars'); // { valid: false, error: '...' }
 * ```
 */
export function validateFolderName(name: string): ValidationResult {
  const trimmed = name.trim();

  // Check for empty name
  if (!trimmed) {
    return { valid: false, error: 'Please enter a folder name' };
  }

  // Check length (max 255 characters to match backend)
  if (trimmed.length > 255) {
    return { valid: false, error: 'Folder name must be 255 characters or less' };
  }

  // Check against pattern
  if (!FOLDER_NAME_REGEX.test(trimmed)) {
    return { valid: false, error: FOLDER_NAME_ERROR };
  }

  return { valid: true };
}

/**
 * Validate a file name (same rules as folder name)
 *
 * @param name - The file name to validate
 * @returns Validation result with valid flag and optional error message
 */
export function validateFileName(name: string): ValidationResult {
  const trimmed = name.trim();

  // Check for empty name
  if (!trimmed) {
    return { valid: false, error: 'Please enter a file name' };
  }

  // Check length (max 255 characters to match backend)
  if (trimmed.length > 255) {
    return { valid: false, error: 'File name must be 255 characters or less' };
  }

  // Check against pattern
  if (!FOLDER_NAME_REGEX.test(trimmed)) {
    return {
      valid: false,
      error:
        'File name can only contain letters, numbers, spaces, hyphens, underscores, commas, periods, and ampersands',
    };
  }

  return { valid: true };
}
