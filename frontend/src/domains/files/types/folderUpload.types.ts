/**
 * Folder Upload Types
 *
 * Types for recursive folder reading and batch upload operations.
 * Supports drag and drop of entire folder hierarchies.
 *
 * @module domains/files/types/folderUpload
 */

/**
 * Represents a folder entry in a folder structure
 */
export interface FolderEntry {
  /** Type discriminator for folder entries */
  type: 'folder';

  /** Folder name */
  name: string;

  /**
   * Relative path from drop root.
   * Example: "MyFolder/SubFolder"
   */
  path: string;

  /** Children entries (files and folders) */
  children: (FolderEntry | FileEntry)[];
}

/**
 * Represents a file entry in a folder structure
 */
export interface FileEntry {
  /** Type discriminator for file entries */
  type: 'file';

  /** File name */
  name: string;

  /**
   * Relative path from drop root including filename.
   * Example: "MyFolder/SubFolder/file.pdf"
   */
  path: string;

  /** The actual File object from the browser */
  file: File;

  /** Whether the file type is valid/supported */
  isValid: boolean;

  /** Reason for invalidity if isValid is false */
  invalidReason?: string;
}

/**
 * Complete folder structure from reading a dropped folder
 */
export interface FolderStructure {
  /** Root level folder entries */
  rootFolders: FolderEntry[];

  /** Flat list of all files (for easy iteration) */
  allFiles: FileEntry[];

  /** Files that passed validation */
  validFiles: FileEntry[];

  /** Files that failed validation */
  invalidFiles: FileEntry[];

  /** Total file count */
  totalFiles: number;

  /** Total folder count */
  totalFolders: number;

  /** Number of empty folders that were filtered out */
  emptyFoldersFiltered?: number;
}

/**
 * Type of drop operation detected
 */
export type DropType = 'folder' | 'files' | 'mixed' | 'empty';

/**
 * Result of validating a file
 */
export interface FileValidationResult {
  /** Whether the file is valid */
  isValid: boolean;

  /** Reason for invalidity */
  reason?: string;
}

/**
 * Invalid files grouped by extension for the modal
 */
export interface InvalidFilesByExtension {
  /** File extension (e.g., ".exe") */
  extension: string;

  /** Count of files with this extension */
  count: number;

  /** File entries with this extension */
  files: FileEntry[];
}

/**
 * User action for handling unsupported files
 */
export type UnsupportedFileAction = 'skip' | 'skip_all' | 'skip_extension' | 'cancel';

/**
 * Resolution result from the unsupported files modal
 */
export interface UnsupportedFilesResolution {
  /** The action taken */
  action: UnsupportedFileAction;

  /** If skip_extension, which extension to skip */
  extensionToSkip?: string;
}

/**
 * State for folder upload progress tracking
 */
export type FolderUploadPhase =
  | 'idle'
  | 'reading'
  | 'validating'
  | 'session-init'
  | 'creating-folders'
  | 'registering'
  | 'getting-sas'
  | 'uploading'
  | 'completing'
  | 'paused'
  | 'done'
  | 'error';

/**
 * Progress information for folder upload
 *
 * Simplified: removed speed/ETA for cleaner UX.
 * Shows file count and percentage only.
 */
export interface FolderUploadProgress {
  /** Current phase of the upload */
  phase: FolderUploadPhase;

  /** Total number of files to upload */
  totalFiles: number;

  /** Number of files uploaded so far */
  uploadedFiles: number;

  /** Number of files that failed */
  failedFiles: number;

  /** Current batch number (1-based) */
  currentBatch: number;

  /** Total number of batches */
  totalBatches: number;

  /** Overall progress percentage (0-100) */
  percent: number;

  /** Current file being uploaded */
  currentFile?: string;
}

/**
 * Persisted state for pause/resume functionality
 */
export interface PersistedFolderUploadState {
  /** Unique identifier for this upload session */
  megaBatchId: string;

  /** Original folder structure */
  structure: FolderStructure;

  /** Map of folder path to created folder ID */
  folderIdMap: Record<string, string>;

  /** Indices of completed batches */
  completedBatches: number[];

  /** Temp IDs of failed files */
  failedFiles: string[];

  /** Target folder ID where upload started */
  targetFolderId: string | null;

  /** ISO timestamp when upload was paused */
  pausedAt: string;

  /** Total batches for this upload */
  totalBatches: number;
}

/**
 * Limits for folder upload operations
 */
export const FOLDER_UPLOAD_LIMITS = {
  /** Maximum files per folder upload session */
  MAX_FILES_PER_FOLDER_UPLOAD: 10_000,

  /** Maximum folder depth supported */
  MAX_FOLDER_DEPTH: 10,

  /** Batch size for folder creation */
  FOLDER_BATCH_SIZE: 100,
} as const;

/**
 * Type of limit that was exceeded
 */
export type LimitExceededType =
  | 'file_count'
  | 'folder_depth'
  | 'total_size'
  | 'single_file_size'
  | 'image_size';

/**
 * Information about a limit that was exceeded
 */
export interface LimitExceededError {
  /** Type of limit exceeded */
  type: LimitExceededType;

  /** Human-readable error message */
  message: string;

  /** The actual value that exceeded the limit */
  actual: number;

  /** The maximum allowed value */
  limit: number;

  /** Unit for display (e.g., "files", "MB", "levels") */
  unit: string;
}

/**
 * Result of validating folder structure against limits
 */
export interface FolderValidationResult {
  /** Whether the folder structure is valid */
  isValid: boolean;

  /** Array of limit errors if any were exceeded */
  errors: LimitExceededError[];
}

/**
 * Validate a folder structure against all upload limits
 *
 * @param structure - The folder structure to validate
 * @returns Validation result with any exceeded limits
 */
export function validateFolderLimits(structure: FolderStructure): FolderValidationResult {
  const errors: LimitExceededError[] = [];

  // Check file count limit
  if (structure.totalFiles > FOLDER_UPLOAD_LIMITS.MAX_FILES_PER_FOLDER_UPLOAD) {
    errors.push({
      type: 'file_count',
      message: `Too many files detected. Maximum allowed is ${FOLDER_UPLOAD_LIMITS.MAX_FILES_PER_FOLDER_UPLOAD.toLocaleString()} files.`,
      actual: structure.totalFiles,
      limit: FOLDER_UPLOAD_LIMITS.MAX_FILES_PER_FOLDER_UPLOAD,
      unit: 'files',
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}
