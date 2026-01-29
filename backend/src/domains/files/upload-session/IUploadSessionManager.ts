/**
 * Upload Session Manager Interface
 *
 * Defines the contract for upload session lifecycle management.
 *
 * @module domains/files/upload-session
 */

import type {
  UploadSession,
  FolderBatch,
  FolderInput,
  UploadSessionProgress,
  FileRegistrationMetadata,
  RenamedFolderInfo,
  FolderConflict,
  FolderConflictResolution,
} from '@bc-agent/shared';

/**
 * Options for initializing an upload session
 */
export interface InitSessionOptions {
  /** User ID (owner of the session) */
  userId: string;

  /** Folders with their files */
  folders: FolderInput[];

  /** Target folder ID where root folders will be created */
  targetFolderId?: string | null;
}

/**
 * Result of folder creation
 */
export interface CreateFolderResult {
  /** Database folder ID */
  folderId: string;

  /** Updated folder batch */
  folderBatch: FolderBatch;
}

/**
 * Result of file registration
 */
export interface RegisterFilesResult {
  /** Registered files with tempId -> fileId mapping */
  registered: Array<{ tempId: string; fileId: string }>;

  /** Updated folder batch */
  folderBatch: FolderBatch;
}

/**
 * SAS URL info for registered file
 */
export interface FileSasInfo {
  fileId: string;
  tempId: string;
  sasUrl: string;
  blobPath: string;
  expiresAt: string;
}

/**
 * Result of marking file as uploaded
 */
export interface MarkUploadedResult {
  /** Whether operation succeeded */
  success: boolean;

  /** Processing job ID */
  jobId?: string;

  /** Updated folder batch */
  folderBatch: FolderBatch;
}

/**
 * Result of completing a folder batch
 */
export interface CompleteBatchResult {
  /** Whether completion succeeded */
  success: boolean;

  /** Updated folder batch */
  folderBatch: FolderBatch;

  /** Updated session */
  session: UploadSession;

  /** Whether there's a next folder to process */
  hasNextFolder: boolean;
}

/**
 * Result of session initialization
 */
export interface InitSessionResult {
  /** Created session */
  session: UploadSession;

  /** Number of folders that were renamed to avoid duplicates */
  renamedFolderCount: number;

  /** Details of renamed folders (only present if renamedFolderCount > 0) */
  renamedFolders: RenamedFolderInfo[];

  /** Conflicts requiring user resolution (when autoResolve: false) */
  conflicts?: FolderConflict[];

  /** Whether resolution is required before proceeding */
  requiresResolution?: boolean;
}

/**
 * Result of applying conflict resolutions
 */
export interface ApplyResolutionsResult {
  /** Folders that were skipped */
  skippedFolders: string[];

  /** Folders that were renamed */
  renamedFolders: RenamedFolderInfo[];

  /** Updated session */
  session: UploadSession;
}

/**
 * Interface for upload session lifecycle management
 */
export interface IUploadSessionManager {
  /**
   * Initialize a new upload session
   *
   * Creates session in Redis with all folder batches in 'pending' status.
   * Validates folder count and structure.
   * Resolves duplicate folder names by applying suffixes (1), (2), etc.
   *
   * @param options - Session initialization options
   * @returns Session with renamed folder information
   */
  initializeSession(options: InitSessionOptions): Promise<InitSessionResult>;

  /**
   * Get current session progress
   *
   * @param sessionId - Session ID
   * @returns Session progress information
   */
  getProgress(sessionId: string): Promise<UploadSessionProgress>;

  /**
   * Create a folder for a batch
   *
   * Creates the folder in the database and updates batch status.
   *
   * @param sessionId - Session ID
   * @param tempId - Folder batch temp ID
   * @returns Created folder result
   */
  createFolder(sessionId: string, tempId: string): Promise<CreateFolderResult>;

  /**
   * Register files for early persistence
   *
   * Creates file records in database with 'uploading' readiness state.
   * Files appear in UI immediately before blob upload starts.
   *
   * @param sessionId - Session ID
   * @param tempId - Folder batch temp ID
   * @param files - File metadata to register
   * @returns Registered file results
   */
  registerFiles(
    sessionId: string,
    tempId: string,
    files: FileRegistrationMetadata[]
  ): Promise<RegisterFilesResult>;

  /**
   * Get SAS URLs for registered files
   *
   * @param sessionId - Session ID
   * @param tempId - Folder batch temp ID
   * @param fileIds - Database file IDs
   * @returns SAS URL information
   */
  getSasUrls(sessionId: string, tempId: string, fileIds: string[]): Promise<FileSasInfo[]>;

  /**
   * Mark a file as uploaded
   *
   * Updates file record with blobPath and sets status to 'pending_processing'.
   * The FileProcessingScheduler will pick up the file and enqueue it for processing
   * based on queue capacity (flow control / backpressure).
   *
   * Note: jobId is no longer returned immediately since enqueuing is decoupled.
   *
   * @param sessionId - Session ID
   * @param tempId - Folder batch temp ID
   * @param fileId - Database file ID
   * @param contentHash - SHA-256 content hash
   * @param blobPath - Real blob path where file was uploaded
   * @returns Upload result
   */
  markFileUploaded(
    sessionId: string,
    tempId: string,
    fileId: string,
    contentHash: string,
    blobPath: string
  ): Promise<MarkUploadedResult>;

  /**
   * Complete a folder batch
   *
   * Marks batch as 'processing' and prepares for next folder.
   *
   * @param sessionId - Session ID
   * @param tempId - Folder batch temp ID
   * @returns Completion result
   */
  completeFolderBatch(sessionId: string, tempId: string): Promise<CompleteBatchResult>;

  /**
   * Fail a folder batch
   *
   * Marks batch as 'failed' and checks if session should abort.
   *
   * @param sessionId - Session ID
   * @param tempId - Folder batch temp ID
   * @param error - Error message
   * @returns Updated session
   */
  failFolderBatch(sessionId: string, tempId: string, error: string): Promise<UploadSession>;

  /**
   * Complete the entire session
   *
   * Called when all folders are processed.
   *
   * @param sessionId - Session ID
   * @returns Final session state
   */
  completeSession(sessionId: string): Promise<UploadSession>;

  /**
   * Abort session due to too many failures
   *
   * @param sessionId - Session ID
   * @param reason - Abort reason
   * @returns Final session state
   */
  abortSession(sessionId: string, reason: string): Promise<UploadSession>;

  /**
   * Extend session TTL (heartbeat)
   *
   * @param sessionId - Session ID
   */
  heartbeat(sessionId: string): Promise<void>;

  /**
   * Get session by ID
   *
   * @param sessionId - Session ID
   * @returns Session or null
   */
  getSession(sessionId: string): Promise<UploadSession | null>;

  /**
   * Get user's active session (legacy - returns first active)
   *
   * @param userId - User ID
   * @returns Active session or null
   * @deprecated Use getActiveSessions() for multi-session support
   */
  getActiveSession(userId: string): Promise<UploadSession | null>;

  /**
   * Get all active sessions for a user (multi-session support)
   *
   * @param userId - User ID
   * @returns Array of active sessions
   */
  getActiveSessions(userId: string): Promise<UploadSession[]>;

  /**
   * Get count of active sessions for a user
   *
   * @param userId - User ID
   * @returns Number of active sessions
   */
  getActiveSessionCount(userId: string): Promise<number>;

  /**
   * Apply folder conflict resolutions
   *
   * Updates session with user's choices for skip/rename.
   * Skipped folders are removed from session.
   * Renamed folders get their name updated in the batch.
   *
   * @param sessionId - Session ID
   * @param userId - User ID (for ownership verification)
   * @param resolutions - Array of conflict resolutions
   * @returns Result with skipped/renamed folders and updated session
   */
  applyFolderResolutions?(
    sessionId: string,
    userId: string,
    resolutions: FolderConflictResolution[]
  ): Promise<ApplyResolutionsResult>;
}
