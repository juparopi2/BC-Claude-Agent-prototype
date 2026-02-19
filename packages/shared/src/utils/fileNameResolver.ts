/**
 * File Name Resolver Utilities
 *
 * Shared utility for generating unique file names using the "name (N)" pattern.
 * Same pattern as Windows/macOS/Google Drive and FolderNameResolver.findNextAvailableName().
 *
 * @module @bc-agent/shared/utils/fileNameResolver
 */

/**
 * Split a file name into base name and extension.
 *
 * @example splitFileName("report.pdf") → { baseName: "report", extension: ".pdf" }
 * @example splitFileName("archive.tar.gz") → { baseName: "archive.tar", extension: ".gz" }
 * @example splitFileName("README") → { baseName: "README", extension: "" }
 */
export function splitFileName(name: string): { baseName: string; extension: string } {
  const lastDot = name.lastIndexOf('.');
  if (lastDot <= 0) {
    return { baseName: name, extension: '' };
  }
  return {
    baseName: name.slice(0, lastDot),
    extension: name.slice(lastDot),
  };
}

/**
 * Extract the numeric suffix from a base name that follows the "name (N)" pattern.
 *
 * @example extractSuffix("report (1)") → { cleanBase: "report", suffix: 1 }
 * @example extractSuffix("report") → { cleanBase: "report", suffix: null }
 * @example extractSuffix("report (3)") → { cleanBase: "report", suffix: 3 }
 */
export function extractSuffix(baseName: string): { cleanBase: string; suffix: number | null } {
  const match = baseName.match(/^(.+?) \((\d+)\)$/);
  if (match && match[1] !== undefined && match[2] !== undefined) {
    return { cleanBase: match[1], suffix: parseInt(match[2], 10) };
  }
  return { cleanBase: baseName, suffix: null };
}

/**
 * Generate a unique file name given a set of existing names in the same folder.
 * Uses the "name (N).ext" pattern (same as Windows/macOS/Google Drive).
 *
 * @param name - The original file name (e.g., "report.pdf")
 * @param existingNames - Set or array of names already in the target folder
 * @returns A unique name (e.g., "report (1).pdf") or the original if no conflict
 *
 * @example
 * generateUniqueFileName("report.pdf", ["report.pdf"])
 * // → "report (1).pdf"
 *
 * @example
 * generateUniqueFileName("report.pdf", ["report.pdf", "report (1).pdf"])
 * // → "report (2).pdf"
 *
 * @example
 * generateUniqueFileName("photo.jpg", ["other.jpg"])
 * // → "photo.jpg" (no conflict)
 */
export function generateUniqueFileName(
  name: string,
  existingNames: ReadonlyArray<string> | ReadonlySet<string>,
): string {
  const nameSet = existingNames instanceof Set ? existingNames : new Set(existingNames);

  if (!nameSet.has(name)) {
    return name;
  }

  const { baseName, extension } = splitFileName(name);

  // Find the highest existing suffix for this base name (treated literally)
  let maxSuffix = 0;
  const escapedBase = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedExt = extension.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escapedBase} \\((\\d+)\\)${escapedExt}$`);

  for (const existing of nameSet) {
    if (existing === `${baseName}${extension}`) {
      maxSuffix = Math.max(maxSuffix, 0);
    } else {
      const match = existing.match(pattern);
      if (match) {
        maxSuffix = Math.max(maxSuffix, parseInt(match[1], 10));
      }
    }
  }

  return `${baseName} (${maxSuffix + 1})${extension}`;
}
