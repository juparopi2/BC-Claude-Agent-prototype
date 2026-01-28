/**
 * Name Validation Utilities
 *
 * Provides validation and sanitization for file and folder names.
 * Prevents errors with non-technical users by rejecting invalid names early.
 *
 * Validation Rules:
 * - Maximum length: 255 characters
 * - No path traversal patterns (.., /, \)
 * - No control characters (0x00-0x1F)
 * - No Windows reserved characters (<>:"|?*)
 * - No Windows reserved names (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
 *
 * @module @bc-agent/shared/utils/nameValidation
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Configuration for name validation
 */
export const NAME_VALIDATION_CONFIG = {
  /** Maximum length for file/folder names */
  MAX_NAME_LENGTH: 255,

  /** Maximum length for full path */
  MAX_PATH_LENGTH: 4096,

  /** Forbidden patterns with reasons */
  FORBIDDEN_PATTERNS: [
    { pattern: /\.\./, reason: 'Path traversal (..) not allowed' },
    { pattern: /[\\/]/, reason: 'Path separators (/ or \\) not allowed in names' },
    { pattern: /[\x00-\x1f]/, reason: 'Control characters not allowed' },
    { pattern: /[<>:"|?*]/, reason: 'Special characters (<>:"|?*) not allowed' },
  ] as const,

  /** Windows reserved device names (case-insensitive) */
  WINDOWS_RESERVED: [
    'CON', 'PRN', 'AUX', 'NUL',
    'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
    'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
  ] as const,
} as const;

// ============================================================================
// TYPES
// ============================================================================

/**
 * Result of name validation
 */
export interface NameValidationResult {
  /** Whether the name is valid */
  isValid: boolean;

  /** Reason for invalidity (only present if isValid = false) */
  reason?: string;

  /** Sanitized name (only present if name can be fixed) */
  sanitized?: string;
}

/**
 * Options for name validation
 */
export interface NameValidationOptions {
  /** Whether to allow empty names (default: false) */
  allowEmpty?: boolean;

  /** Custom max length (default: 255) */
  maxLength?: number;
}

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Validate a file name
 *
 * Checks for:
 * - Empty or whitespace-only names
 * - Names exceeding max length
 * - Path traversal patterns
 * - Control characters
 * - Windows reserved characters and names
 *
 * @param name - File name to validate
 * @param options - Validation options
 * @returns Validation result
 *
 * @example
 * ```typescript
 * const result = validateFileName('document.pdf');
 * if (!result.isValid) {
 *   console.error(result.reason);
 * }
 * ```
 */
export function validateFileName(
  name: string,
  options: NameValidationOptions = {}
): NameValidationResult {
  const { allowEmpty = false, maxLength = NAME_VALIDATION_CONFIG.MAX_NAME_LENGTH } = options;

  // Check for empty name
  if (!name || name.trim().length === 0) {
    if (allowEmpty) {
      return { isValid: true };
    }
    return { isValid: false, reason: 'File name cannot be empty' };
  }

  // Check length
  if (name.length > maxLength) {
    return {
      isValid: false,
      reason: `File name exceeds maximum length of ${maxLength} characters`,
      sanitized: name.substring(0, maxLength),
    };
  }

  // Check forbidden patterns
  for (const { pattern, reason } of NAME_VALIDATION_CONFIG.FORBIDDEN_PATTERNS) {
    if (pattern.test(name)) {
      const sanitized = sanitizeName(name);
      return { isValid: false, reason, sanitized };
    }
  }

  // Check Windows reserved names
  const baseName = name.split('.')[0]?.toUpperCase() ?? '';
  if (NAME_VALIDATION_CONFIG.WINDOWS_RESERVED.includes(baseName as typeof NAME_VALIDATION_CONFIG.WINDOWS_RESERVED[number])) {
    return {
      isValid: false,
      reason: `"${baseName}" is a reserved system name`,
      sanitized: `_${name}`,
    };
  }

  // Check for leading/trailing whitespace or dots
  if (name !== name.trim() || name.endsWith('.') || name.endsWith(' ')) {
    const sanitized = name.trim().replace(/[. ]+$/, '');
    return {
      isValid: false,
      reason: 'File name cannot have leading/trailing whitespace or end with a dot',
      sanitized,
    };
  }

  return { isValid: true };
}

/**
 * Validate a folder name
 *
 * Same rules as file names, plus:
 * - No file extension expected
 *
 * @param name - Folder name to validate
 * @param options - Validation options
 * @returns Validation result
 *
 * @example
 * ```typescript
 * const result = validateFolderName('My Documents');
 * if (!result.isValid) {
 *   console.error(result.reason);
 * }
 * ```
 */
export function validateFolderName(
  name: string,
  options: NameValidationOptions = {}
): NameValidationResult {
  // Folder validation is identical to file validation
  return validateFileName(name, options);
}

/**
 * Sanitize a name by removing or replacing invalid characters
 *
 * Transformations:
 * - Truncate to max length
 * - Remove control characters
 * - Replace forbidden characters with underscore
 * - Trim whitespace
 * - Remove trailing dots
 *
 * @param name - Name to sanitize
 * @param maxLength - Maximum length (default: 255)
 * @returns Sanitized name
 *
 * @example
 * ```typescript
 * const safe = sanitizeName('file<name>.txt');
 * // Returns: 'file_name_.txt'
 * ```
 */
export function sanitizeName(
  name: string,
  maxLength: number = NAME_VALIDATION_CONFIG.MAX_NAME_LENGTH
): string {
  if (!name) {
    return 'unnamed';
  }

  let sanitized = name;

  // Remove control characters
  sanitized = sanitized.replace(/[\x00-\x1f]/g, '');

  // Replace forbidden characters with underscore
  sanitized = sanitized.replace(/[<>:"|?*\\/]/g, '_');

  // Remove path traversal
  sanitized = sanitized.replace(/\.\./g, '_');

  // Trim whitespace and trailing dots
  sanitized = sanitized.trim().replace(/[. ]+$/, '');

  // Truncate to max length
  if (sanitized.length > maxLength) {
    // Try to preserve extension
    const lastDot = sanitized.lastIndexOf('.');
    if (lastDot > 0 && lastDot > maxLength - 10) {
      // Extension is near the end, keep it
      const extension = sanitized.substring(lastDot);
      const baseName = sanitized.substring(0, maxLength - extension.length);
      sanitized = baseName + extension;
    } else {
      sanitized = sanitized.substring(0, maxLength);
    }
  }

  // Handle empty result
  if (!sanitized || sanitized.trim().length === 0) {
    return 'unnamed';
  }

  return sanitized;
}

/**
 * Check if a name is a Windows reserved name
 *
 * @param name - Name to check
 * @returns True if reserved
 */
export function isWindowsReservedName(name: string): boolean {
  const baseName = name.split('.')[0]?.toUpperCase() ?? '';
  return NAME_VALIDATION_CONFIG.WINDOWS_RESERVED.includes(
    baseName as typeof NAME_VALIDATION_CONFIG.WINDOWS_RESERVED[number]
  );
}

/**
 * Validate a full file path
 *
 * @param path - Full path to validate
 * @returns Validation result
 */
export function validateFilePath(path: string): NameValidationResult {
  if (!path || path.trim().length === 0) {
    return { isValid: false, reason: 'Path cannot be empty' };
  }

  if (path.length > NAME_VALIDATION_CONFIG.MAX_PATH_LENGTH) {
    return {
      isValid: false,
      reason: `Path exceeds maximum length of ${NAME_VALIDATION_CONFIG.MAX_PATH_LENGTH} characters`,
    };
  }

  // Check for path traversal
  if (/\.\./.test(path)) {
    return { isValid: false, reason: 'Path traversal (..) not allowed' };
  }

  // Validate each segment
  const segments = path.split(/[\\/]/).filter(s => s.length > 0);
  for (const segment of segments) {
    const result = validateFileName(segment);
    if (!result.isValid) {
      return {
        isValid: false,
        reason: `Invalid path segment "${segment}": ${result.reason}`,
      };
    }
  }

  return { isValid: true };
}
