/**
 * Folder Reader Utilities
 *
 * Utilities for reading folder structures from drag and drop operations.
 * Uses the File System Access API (webkitGetAsEntry) for recursive folder reading.
 *
 * @module domains/files/utils/folderReader
 */

import { FILE_UPLOAD_LIMITS, ALLOWED_MIME_TYPES, isAllowedMimeType } from '@bc-agent/shared';
import type {
  DropType,
  FolderEntry,
  FileEntry,
  FolderStructure,
  FileValidationResult,
  InvalidFilesByExtension,
  FOLDER_UPLOAD_LIMITS,
} from '../types/folderUpload.types';

/**
 * Detect the type of drop operation from DataTransfer
 *
 * @param dataTransfer - The DataTransfer object from the drop event
 * @returns The type of drop: 'folder', 'files', 'mixed', or 'empty'
 */
export function detectDropType(dataTransfer: DataTransfer): DropType {
  const items = dataTransfer.items;

  if (!items || items.length === 0) {
    return 'empty';
  }

  let hasFolder = false;
  let hasFile = false;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind !== 'file') continue;

    const entry = item.webkitGetAsEntry?.();
    if (!entry) continue;

    if (entry.isDirectory) {
      hasFolder = true;
    } else if (entry.isFile) {
      hasFile = true;
    }

    // Early exit if we've detected both
    if (hasFolder && hasFile) {
      return 'mixed';
    }
  }

  if (hasFolder && !hasFile) {
    return 'folder';
  }

  if (hasFile && !hasFolder) {
    return 'files';
  }

  if (hasFolder && hasFile) {
    return 'mixed';
  }

  return 'empty';
}

/**
 * Validate a file against allowed types and size limits
 *
 * @param file - The File object to validate
 * @returns Validation result with isValid and optional reason
 */
export function validateFile(file: File): FileValidationResult {
  // Check MIME type
  if (!isAllowedMimeType(file.type)) {
    return {
      isValid: false,
      reason: `Unsupported file type: ${file.type || 'unknown'}`,
    };
  }

  // Check file size
  const maxSize = file.type.startsWith('image/')
    ? FILE_UPLOAD_LIMITS.MAX_IMAGE_SIZE
    : FILE_UPLOAD_LIMITS.MAX_FILE_SIZE;

  if (file.size > maxSize) {
    const maxMB = maxSize / (1024 * 1024);
    return {
      isValid: false,
      reason: `File size exceeds limit (${maxMB}MB)`,
    };
  }

  return { isValid: true };
}

/**
 * Read a file from a FileSystemFileEntry
 *
 * @param entry - The FileSystemFileEntry to read
 * @returns Promise resolving to the File object
 */
function readFileEntry(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

/**
 * Read entries from a FileSystemDirectoryReader
 *
 * @param reader - The directory reader
 * @returns Promise resolving to array of entries
 */
function readDirectoryEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    reader.readEntries(resolve, reject);
  });
}

/**
 * Read all entries from a directory (handles pagination)
 *
 * The readEntries API may not return all entries at once for large directories.
 * We need to call it repeatedly until it returns an empty array.
 *
 * @param reader - The directory reader
 * @returns Promise resolving to all entries
 */
async function readAllDirectoryEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  const allEntries: FileSystemEntry[] = [];
  let entries: FileSystemEntry[];

  do {
    entries = await readDirectoryEntries(reader);
    allEntries.push(...entries);
  } while (entries.length > 0);

  return allEntries;
}

/**
 * Recursively read a folder structure from a FileSystemEntry
 *
 * @param entry - The FileSystemEntry to read (file or directory)
 * @param basePath - The base path to prepend (empty string for root)
 * @returns Promise resolving to FolderEntry or FileEntry
 */
export async function readFolderRecursive(
  entry: FileSystemEntry,
  basePath: string
): Promise<FolderEntry | FileEntry | null> {
  const currentPath = basePath ? `${basePath}/${entry.name}` : entry.name;

  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    try {
      const file = await readFileEntry(fileEntry);
      const validation = validateFile(file);

      return {
        type: 'file',
        name: entry.name,
        path: currentPath,
        file,
        isValid: validation.isValid,
        invalidReason: validation.reason,
      };
    } catch (error) {
      // If we can't read the file, mark it as invalid
      return {
        type: 'file',
        name: entry.name,
        path: currentPath,
        file: new File([], entry.name), // Placeholder file
        isValid: false,
        invalidReason: `Failed to read file: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry;
    const reader = dirEntry.createReader();
    const entries = await readAllDirectoryEntries(reader);

    const children: (FolderEntry | FileEntry)[] = [];

    for (const childEntry of entries) {
      const child = await readFolderRecursive(childEntry, currentPath);
      if (child) {
        children.push(child);
      }
    }

    return {
      type: 'folder',
      name: entry.name,
      path: currentPath,
      children,
    };
  }

  return null;
}

/**
 * Count files and folders in a folder structure
 */
function countEntries(entry: FolderEntry | FileEntry): { files: number; folders: number } {
  if (entry.type === 'file') {
    return { files: 1, folders: 0 };
  }

  let files = 0;
  let folders = 1; // Count the folder itself

  for (const child of entry.children) {
    const childCounts = countEntries(child);
    files += childCounts.files;
    folders += childCounts.folders;
  }

  return { files, folders };
}

/**
 * Collect all files from a folder structure
 */
function collectAllFiles(entry: FolderEntry | FileEntry): FileEntry[] {
  if (entry.type === 'file') {
    return [entry];
  }

  const files: FileEntry[] = [];
  for (const child of entry.children) {
    files.push(...collectAllFiles(child));
  }
  return files;
}

/**
 * Build a complete folder structure from a DataTransfer object
 *
 * @param dataTransfer - The DataTransfer object from the drop event
 * @returns Promise resolving to FolderStructure
 */
export async function buildFolderStructure(dataTransfer: DataTransfer): Promise<FolderStructure> {
  const items = dataTransfer.items;
  const rootFolders: FolderEntry[] = [];
  const standaloneFiles: FileEntry[] = [];

  // CRITICAL: Capture ALL entries synchronously FIRST before any async operations.
  // The DataTransfer items can be garbage collected after the event loop advances,
  // so webkitGetAsEntry() must be called for ALL items before the first await.
  const entries: FileSystemEntry[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind !== 'file') continue;

    const entry = item.webkitGetAsEntry?.();
    if (entry) {
      entries.push(entry);
    }
  }

  // Now process all captured entries asynchronously
  for (const entry of entries) {
    const result = await readFolderRecursive(entry, '');
    if (!result) continue;

    if (result.type === 'folder') {
      rootFolders.push(result);
    } else {
      standaloneFiles.push(result);
    }
  }

  // Collect all files from root folders
  const allFiles: FileEntry[] = [...standaloneFiles];
  let totalFolders = 0;

  for (const folder of rootFolders) {
    allFiles.push(...collectAllFiles(folder));
    const counts = countEntries(folder);
    totalFolders += counts.folders;
  }

  // Separate valid and invalid files
  const validFiles = allFiles.filter((f) => f.isValid);
  const invalidFiles = allFiles.filter((f) => !f.isValid);

  return {
    rootFolders,
    allFiles,
    validFiles,
    invalidFiles,
    totalFiles: allFiles.length,
    totalFolders,
  };
}

/**
 * Get file extension from filename
 *
 * @param filename - The filename to extract extension from
 * @returns The extension (e.g., ".exe") or "(no extension)"
 */
function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1 || lastDot === filename.length - 1) {
    return '(no extension)';
  }
  return filename.substring(lastDot).toLowerCase();
}

/**
 * Group invalid files by their file extension
 *
 * @param invalidFiles - Array of invalid file entries
 * @returns Array of InvalidFilesByExtension, sorted by count descending
 */
export function groupInvalidFilesByExtension(invalidFiles: FileEntry[]): InvalidFilesByExtension[] {
  if (invalidFiles.length === 0) {
    return [];
  }

  const groups = new Map<string, FileEntry[]>();

  for (const file of invalidFiles) {
    const extension = getFileExtension(file.name);
    const existing = groups.get(extension) || [];
    existing.push(file);
    groups.set(extension, existing);
  }

  const result: InvalidFilesByExtension[] = [];
  for (const [extension, files] of groups) {
    result.push({
      extension,
      count: files.length,
      files,
    });
  }

  // Sort by count descending
  result.sort((a, b) => b.count - a.count);

  return result;
}
