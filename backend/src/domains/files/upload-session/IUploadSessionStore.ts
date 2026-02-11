/**
 * Upload Session Store Interface
 *
 * Defines the contract for upload session storage operations.
 * Implementations use Redis for fast, TTL-based session storage.
 *
 * @module domains/files/upload-session
 */

import type {
  UploadSession,
  FolderBatch,
  UploadSessionStatus,
  FolderBatchStatus,
} from '@bc-agent/shared';

/**
 * Options for creating an upload session
 */
export interface CreateSessionOptions {
  /** User ID (owner of the session) */
  userId: string;

  /** Initial folder batches */
  folderBatches: FolderBatch[];

  /** TTL in milliseconds (defaults to FOLDER_UPLOAD_CONFIG.SESSION_TTL_MS) */
  ttlMs?: number;
}

/**
 * Partial update for folder batch
 */
export interface FolderBatchUpdate {
  folderId?: string;
  parentFolderId?: string | null;
  status?: FolderBatchStatus;
  registeredFiles?: number;
  uploadedFiles?: number;
  processedFiles?: number;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

/**
 * Partial update for session
 */
export interface SessionUpdate {
  currentFolderIndex?: number;
  completedFolders?: number;
  failedFolders?: number;
  status?: UploadSessionStatus;
  updatedAt?: number;
  /** Updated folder batches (used when removing skipped folders) */
  folderBatches?: FolderBatch[];
  /** Updated total folder count (used when removing skipped folders) */
  totalFolders?: number;
}

/**
 * Interface for upload session storage operations
 */
export interface IUploadSessionStore {
  /**
   * Create a new upload session
   *
   * @param options - Session creation options
   * @returns Created session with generated ID
   */
  create(options: CreateSessionOptions): Promise<UploadSession>;

  /**
   * Get session by ID
   *
   * @param sessionId - Session ID
   * @returns Session or null if not found
   */
  get(sessionId: string): Promise<UploadSession | null>;

  /**
   * Update session fields
   *
   * @param sessionId - Session ID
   * @param updates - Partial session update
   */
  update(sessionId: string, updates: SessionUpdate): Promise<void>;

  /**
   * Update a specific folder batch within a session
   *
   * @param sessionId - Session ID
   * @param tempId - Folder batch temp ID
   * @param updates - Partial folder batch update
   */
  updateBatch(sessionId: string, tempId: string, updates: FolderBatchUpdate): Promise<void>;

  /**
   * Get all active sessions for a user (multi-session support)
   *
   * @param userId - User ID
   * @returns Array of active sessions
   */
  getActiveSessions(userId: string): Promise<UploadSession[]>;

  /**
   * Get active session for a user (if any)
   *
   * @param userId - User ID
   * @returns Active session or null
   * @deprecated Use getActiveSessions() for multi-session support
   */
  getActiveSession(userId: string): Promise<UploadSession | null>;

  /**
   * Get count of active sessions for a user
   *
   * @param userId - User ID
   * @returns Number of active sessions
   */
  getActiveSessionCount(userId: string): Promise<number>;

  /**
   * Delete a session
   *
   * @param sessionId - Session ID
   */
  delete(sessionId: string): Promise<void>;

  /**
   * Extend session TTL (heartbeat)
   *
   * @param sessionId - Session ID
   * @param ttlMs - New TTL in milliseconds
   */
  extendTTL(sessionId: string, ttlMs?: number): Promise<void>;

  /**
   * Check if session exists
   *
   * @param sessionId - Session ID
   * @returns True if session exists
   */
  exists(sessionId: string): Promise<boolean>;
}
