/**
 * Upload Session Manager
 *
 * Orchestrates folder-based upload sessions including:
 * - Session lifecycle management
 * - Folder creation
 * - Early file registration (files visible before blob upload)
 * - SAS URL generation
 * - Progress tracking
 *
 * Uses singleton pattern for consistent access across the application.
 *
 * @module domains/files/upload-session
 */

import { createChildLogger } from '@/shared/utils/logger';
import { FOLDER_UPLOAD_CONFIG, validateFileName, sanitizeName } from '@bc-agent/shared';
import type {
  UploadSession,
  FolderBatch,
  UploadSessionProgress,
  FileRegistrationMetadata,
  FolderBatchStatus,
} from '@bc-agent/shared';
import type { Logger } from 'pino';
import {
  getUploadSessionStore,
  type UploadSessionStore,
} from './UploadSessionStore';
import type {
  IUploadSessionManager,
  InitSessionOptions,
  InitSessionResult,
  CreateFolderResult,
  RegisterFilesResult,
  FileSasInfo,
  MarkUploadedResult,
  CompleteBatchResult,
} from './IUploadSessionManager';
import { getFileRepository, type IFileRepository } from '@/services/files/repository';
import { getFileUploadService, type FileUploadService } from '@/services/files/FileUploadService';
import { getMessageQueue, type MessageQueue } from '@/infrastructure/queue/MessageQueue';
import { createFolderNameResolver } from './FolderNameResolver';

/**
 * Dependencies for UploadSessionManager (DI support for testing)
 */
export interface UploadSessionManagerDependencies {
  logger?: Logger;
  store?: UploadSessionStore;
  fileRepository?: IFileRepository;
  fileUploadService?: FileUploadService;
  messageQueue?: MessageQueue;
}

/**
 * UploadSessionManager implementation
 */
export class UploadSessionManager implements IUploadSessionManager {
  private static instance: UploadSessionManager | null = null;

  private readonly log: Logger;
  private readonly store: UploadSessionStore;
  private readonly getFileRepo: () => IFileRepository;
  private readonly getUploadService: () => FileUploadService;
  private readonly getQueue: () => MessageQueue;

  private constructor(deps?: UploadSessionManagerDependencies) {
    this.log = deps?.logger ?? createChildLogger({ service: 'UploadSessionManager' });
    this.store = deps?.store ?? getUploadSessionStore();

    // Use getter functions for lazy initialization
    if (deps?.fileRepository) {
      const repo = deps.fileRepository;
      this.getFileRepo = () => repo;
    } else {
      this.getFileRepo = () => getFileRepository();
    }

    if (deps?.fileUploadService) {
      const svc = deps.fileUploadService;
      this.getUploadService = () => svc;
    } else {
      this.getUploadService = () => getFileUploadService();
    }

    if (deps?.messageQueue) {
      const queue = deps.messageQueue;
      this.getQueue = () => queue;
    } else {
      this.getQueue = () => getMessageQueue();
    }

    this.log.info('UploadSessionManager initialized');
  }

  public static getInstance(deps?: UploadSessionManagerDependencies): UploadSessionManager {
    if (!UploadSessionManager.instance) {
      UploadSessionManager.instance = new UploadSessionManager(deps);
    }
    return UploadSessionManager.instance;
  }

  public static resetInstance(): void {
    UploadSessionManager.instance = null;
  }

  // =========================================================================
  // SESSION LIFECYCLE
  // =========================================================================

  /**
   * Initialize a new upload session
   *
   * Resolves duplicate folder names by applying suffixes (1), (2), etc.
   */
  async initializeSession(options: InitSessionOptions): Promise<InitSessionResult> {
    const { userId, folders, targetFolderId } = options;

    // Validate folder count
    if (folders.length > FOLDER_UPLOAD_CONFIG.MAX_FOLDERS_PER_SESSION) {
      throw new Error(
        `Too many folders: ${folders.length}. Maximum is ${FOLDER_UPLOAD_CONFIG.MAX_FOLDERS_PER_SESSION}`
      );
    }

    // Check for concurrent session limit (multi-session support)
    const activeSessions = await this.store.getActiveSessions(userId);
    if (activeSessions.length >= FOLDER_UPLOAD_CONFIG.MAX_CONCURRENT_SESSIONS) {
      throw new Error(
        `Maximum concurrent sessions (${FOLDER_UPLOAD_CONFIG.MAX_CONCURRENT_SESSIONS}) reached. ` +
        `Please wait for an upload to complete or cancel one.`
      );
    }

    // Resolve folder names to avoid duplicates
    const fileRepo = this.getFileRepo();
    const nameResolver = createFolderNameResolver(fileRepo);
    const nameResolution = await nameResolver.resolveFolderNames(
      userId,
      folders,
      targetFolderId ?? null
    );

    if (nameResolution.renamedCount > 0) {
      this.log.info(
        { userId, renamedCount: nameResolution.renamedCount },
        'Folders renamed to avoid duplicates'
      );
    }

    // Build folder batches from input with resolved names
    const folderBatches: FolderBatch[] = folders.map(folder => {
      const resolvedName = nameResolution.resolvedNameMap.get(folder.tempId) ?? folder.name;
      const wasRenamed = resolvedName !== folder.name;

      return {
        tempId: folder.tempId,
        name: resolvedName,
        originalName: wasRenamed ? folder.name : undefined,
        parentTempId: folder.parentTempId,
        parentFolderId: folder.parentTempId ? undefined : (targetFolderId ?? undefined),
        totalFiles: folder.files.length,
        registeredFiles: 0,
        uploadedFiles: 0,
        processedFiles: 0,
        status: 'pending' as FolderBatchStatus,
      };
    });

    // Create session
    const session = await this.store.create({
      userId,
      folderBatches,
    });

    // Mark session as active
    await this.store.update(session.id, { status: 'active' });

    this.log.info(
      { sessionId: session.id, userId, totalFolders: folders.length },
      'Upload session initialized'
    );

    return {
      session: { ...session, status: 'active' },
      renamedFolderCount: nameResolution.renamedCount,
      renamedFolders: nameResolution.renamedFolders,
    };
  }

  /**
   * Get current session progress
   */
  async getProgress(sessionId: string): Promise<UploadSessionProgress> {
    const session = await this.requireSession(sessionId);

    const currentFolder = session.currentFolderIndex >= 0 && session.currentFolderIndex < session.folderBatches.length
      ? session.folderBatches[session.currentFolderIndex]!
      : null;

    // Calculate file counts across all folders
    const totalFiles = session.folderBatches.reduce((sum, b) => sum + b.totalFiles, 0);
    const uploadedFiles = session.folderBatches.reduce((sum, b) => sum + b.uploadedFiles, 0);

    // Calculate overall progress
    const completedCount = session.completedFolders + session.failedFolders;
    const overallPercent = session.totalFolders > 0
      ? Math.round((completedCount / session.totalFolders) * 100)
      : 0;

    return {
      sessionId: session.id,
      currentFolderIndex: session.currentFolderIndex,
      totalFolders: session.totalFolders,
      currentFolder,
      overallPercent,
      completedFolders: session.completedFolders,
      failedFolders: session.failedFolders,
      status: session.status,
      totalFiles,
      uploadedFiles,
    };
  }

  // =========================================================================
  // FOLDER OPERATIONS
  // =========================================================================

  /**
   * Create a folder for a batch
   */
  async createFolder(sessionId: string, tempId: string): Promise<CreateFolderResult> {
    const session = await this.requireSession(sessionId);
    const batch = this.findBatch(session, tempId);

    // Validate state
    if (batch.status !== 'pending') {
      throw new Error(`Cannot create folder: batch ${tempId} is in ${batch.status} state`);
    }

    // Update batch status
    await this.store.updateBatch(sessionId, tempId, {
      status: 'creating',
      startedAt: Date.now(),
    });

    try {
      // Resolve parent folder ID
      let parentFolderId = batch.parentFolderId ?? null;

      // If parent is another temp folder in session, look up its real ID
      if (batch.parentTempId) {
        const parentBatch = session.folderBatches.find(b => b.tempId === batch.parentTempId);
        if (parentBatch?.folderId) {
          parentFolderId = parentBatch.folderId;
        } else {
          throw new Error(`Parent folder ${batch.parentTempId} not yet created`);
        }
      }

      // Create folder in database
      const fileRepo = this.getFileRepo();
      const folderId = await fileRepo.createFolder(session.userId, batch.name, parentFolderId ?? undefined);

      // Update batch with folder ID
      await this.store.updateBatch(sessionId, tempId, {
        folderId,
        parentFolderId,
        status: 'registering',
      });

      // Update session current folder index if needed
      const batchIndex = session.folderBatches.findIndex(b => b.tempId === tempId);
      if (session.currentFolderIndex < batchIndex) {
        await this.store.update(sessionId, { currentFolderIndex: batchIndex });
      }

      const updatedSession = await this.requireSession(sessionId);
      const updatedBatch = this.findBatch(updatedSession, tempId);

      this.log.info(
        { sessionId, tempId, folderId, folderName: batch.name },
        'Folder created in session'
      );

      return { folderId, folderBatch: updatedBatch };
    } catch (error) {
      // Mark batch as failed
      await this.store.updateBatch(sessionId, tempId, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        completedAt: Date.now(),
      });
      throw error;
    }
  }

  /**
   * Register files for early persistence
   */
  async registerFiles(
    sessionId: string,
    tempId: string,
    files: FileRegistrationMetadata[]
  ): Promise<RegisterFilesResult> {
    const session = await this.requireSession(sessionId);
    const batch = this.findBatch(session, tempId);

    // Validate state
    if (batch.status !== 'registering') {
      throw new Error(`Cannot register files: batch ${tempId} is in ${batch.status} state`);
    }

    if (!batch.folderId) {
      throw new Error(`Folder not yet created for batch ${tempId}`);
    }

    const fileRepo = this.getFileRepo();
    const registered: Array<{ tempId: string; fileId: string }> = [];

    // Register each file with 'uploading' readiness state
    for (const file of files) {
      try {
        // Server-side name validation (second line of defense)
        const nameValidation = validateFileName(file.fileName);
        let validatedFileName = file.fileName;

        if (!nameValidation.isValid) {
          // Try to sanitize the name instead of rejecting outright
          if (nameValidation.sanitized) {
            validatedFileName = nameValidation.sanitized;
            this.log.warn(
              { sessionId, tempId, originalName: file.fileName, sanitizedName: validatedFileName, reason: nameValidation.reason },
              'File name sanitized due to validation failure'
            );
          } else {
            // Can't sanitize, use generic name
            validatedFileName = sanitizeName(file.fileName);
            this.log.warn(
              { sessionId, tempId, originalName: file.fileName, sanitizedName: validatedFileName, reason: nameValidation.reason },
              'File name replaced due to validation failure'
            );
          }
        }

        // Generate a placeholder blob path (will be updated after upload)
        const placeholderBlobPath = `users/${session.userId}/files/pending-${Date.now()}-${validatedFileName}`;

        // Create file record with processing status that results in 'uploading' readiness
        const fileId = await fileRepo.create({
          userId: session.userId,
          name: validatedFileName,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          blobPath: placeholderBlobPath,
          parentFolderId: batch.folderId,
        });

        registered.push({ tempId: file.tempId, fileId });
      } catch (error) {
        this.log.error(
          { sessionId, tempId, fileName: file.fileName, error: error instanceof Error ? error.message : String(error) },
          'Failed to register file'
        );
        // Continue with other files
      }
    }

    // Update batch progress
    await this.store.updateBatch(sessionId, tempId, {
      registeredFiles: registered.length,
      status: 'uploading',
    });

    const updatedSession = await this.requireSession(sessionId);
    const updatedBatch = this.findBatch(updatedSession, tempId);

    this.log.info(
      { sessionId, tempId, registeredCount: registered.length, totalFiles: files.length },
      'Files registered in session'
    );

    return { registered, folderBatch: updatedBatch };
  }

  /**
   * Get SAS URLs for registered files
   */
  async getSasUrls(sessionId: string, tempId: string, fileIds: string[]): Promise<FileSasInfo[]> {
    const session = await this.requireSession(sessionId);
    const batch = this.findBatch(session, tempId);

    // Validate state
    if (batch.status !== 'uploading') {
      throw new Error(`Cannot get SAS URLs: batch ${tempId} is in ${batch.status} state`);
    }

    const uploadService = this.getUploadService();
    const fileRepo = this.getFileRepo();
    const results: FileSasInfo[] = [];

    for (const fileId of fileIds) {
      try {
        // Get file details
        const file = await fileRepo.findById(session.userId, fileId);
        if (!file) {
          this.log.warn({ sessionId, tempId, fileId }, 'File not found for SAS URL generation');
          continue;
        }

        // Generate SAS URL
        const sasInfo = await uploadService.generateSasUrlForBulkUpload(
          session.userId,
          file.name,
          file.mimeType,
          file.sizeBytes,
          180 // 3 hours expiry
        );

        results.push({
          fileId,
          tempId: fileId, // Map back using fileId as we don't have original tempId here
          sasUrl: sasInfo.sasUrl,
          blobPath: sasInfo.blobPath,
          expiresAt: sasInfo.expiresAt,
        });
      } catch (error) {
        this.log.error(
          { sessionId, tempId, fileId, error: error instanceof Error ? error.message : String(error) },
          'Failed to generate SAS URL'
        );
      }
    }

    this.log.info(
      { sessionId, tempId, sasUrlCount: results.length, requestedCount: fileIds.length },
      'SAS URLs generated'
    );

    return results;
  }

  /**
   * Mark a file as uploaded
   *
   * @param sessionId - Session ID
   * @param tempId - Folder batch temp ID
   * @param fileId - Database file ID
   * @param contentHash - SHA-256 content hash of uploaded file
   * @param blobPath - Real blob path where file was uploaded (from SAS URL generation)
   */
  async markFileUploaded(
    sessionId: string,
    tempId: string,
    fileId: string,
    contentHash: string,
    blobPath: string
  ): Promise<MarkUploadedResult> {
    const session = await this.requireSession(sessionId);
    const batch = this.findBatch(session, tempId);

    if (batch.status !== 'uploading') {
      throw new Error(`Cannot mark uploaded: batch ${tempId} is in ${batch.status} state`);
    }

    const fileRepo = this.getFileRepo();
    const queue = this.getQueue();

    try {
      // Update file record with content hash AND the real blob path
      // The blobPath was a placeholder during registration, now we update it
      // to the actual path where the file was uploaded (from SAS URL generation)
      await fileRepo.update(session.userId, fileId, { contentHash, blobPath });

      // Update processing status to trigger file processing
      await fileRepo.updateProcessingStatus(session.userId, fileId, 'pending');

      // Fetch file record to get required fields for processing job
      const file = await fileRepo.findById(session.userId, fileId);

      this.log.info(
        {
          sessionId,
          tempId,
          fileId,
          blobPath,
          fileMimeType: file?.mimeType,
          fileName: file?.name,
          fileExists: !!file,
        },
        'Preparing file processing job'
      );

      if (!file) {
        throw new Error(`File not found after update: ${fileId}`);
      }

      // Enqueue processing job with ALL required fields
      const jobId = await queue.addFileProcessingJob({
        fileId,
        userId: session.userId,
        mimeType: file.mimeType,
        blobPath,
        fileName: file.name,
      });

      this.log.info(
        {
          sessionId,
          tempId,
          fileId,
          jobId,
          mimeType: file.mimeType,
          blobPath,
          fileName: file.name,
        },
        'File processing job enqueued successfully'
      );

      // Update batch uploaded count
      const newUploadedCount = batch.uploadedFiles + 1;
      await this.store.updateBatch(sessionId, tempId, {
        uploadedFiles: newUploadedCount,
      });

      const updatedSession = await this.requireSession(sessionId);
      const updatedBatch = this.findBatch(updatedSession, tempId);

      this.log.debug(
        { sessionId, tempId, fileId, uploadedFiles: newUploadedCount },
        'File marked as uploaded'
      );

      return {
        success: true,
        jobId,
        folderBatch: updatedBatch,
      };
    } catch (error) {
      this.log.error(
        { sessionId, tempId, fileId, error: error instanceof Error ? error.message : String(error) },
        'Failed to mark file as uploaded'
      );

      return {
        success: false,
        folderBatch: batch,
      };
    }
  }

  /**
   * Complete a folder batch
   */
  async completeFolderBatch(sessionId: string, tempId: string): Promise<CompleteBatchResult> {
    const session = await this.requireSession(sessionId);
    const batch = this.findBatch(session, tempId);

    if (batch.status !== 'uploading') {
      throw new Error(`Cannot complete batch: ${tempId} is in ${batch.status} state`);
    }

    // Mark batch as processing (files are being processed by workers)
    await this.store.updateBatch(sessionId, tempId, {
      status: 'processing',
      completedAt: Date.now(),
    });

    // Update session completed count
    await this.store.update(sessionId, {
      completedFolders: session.completedFolders + 1,
    });

    // Check if there's a next folder
    const nextIndex = session.folderBatches.findIndex(
      b => b.status === 'pending'
    );
    const hasNextFolder = nextIndex !== -1;

    const updatedSession = await this.requireSession(sessionId);
    const updatedBatch = this.findBatch(updatedSession, tempId);

    this.log.info(
      { sessionId, tempId, completedFolders: updatedSession.completedFolders, hasNextFolder },
      'Folder batch completed'
    );

    return {
      success: true,
      folderBatch: updatedBatch,
      session: updatedSession,
      hasNextFolder,
    };
  }

  /**
   * Fail a folder batch
   */
  async failFolderBatch(sessionId: string, tempId: string, error: string): Promise<UploadSession> {
    const session = await this.requireSession(sessionId);

    await this.store.updateBatch(sessionId, tempId, {
      status: 'failed',
      error,
      completedAt: Date.now(),
    });

    const newFailedCount = session.failedFolders + 1;
    await this.store.update(sessionId, {
      failedFolders: newFailedCount,
    });

    // Check if should abort session
    if (newFailedCount >= FOLDER_UPLOAD_CONFIG.MAX_CONSECUTIVE_FAILURES) {
      return this.abortSession(sessionId, 'Too many consecutive folder failures');
    }

    const updatedSession = await this.requireSession(sessionId);

    this.log.warn(
      { sessionId, tempId, error, failedFolders: newFailedCount },
      'Folder batch failed'
    );

    return updatedSession;
  }

  /**
   * Complete the entire session
   */
  async completeSession(sessionId: string): Promise<UploadSession> {
    await this.store.update(sessionId, {
      status: 'completed',
    });

    const session = await this.requireSession(sessionId);

    this.log.info(
      { sessionId, completedFolders: session.completedFolders, failedFolders: session.failedFolders },
      'Upload session completed'
    );

    return session;
  }

  /**
   * Abort session
   */
  async abortSession(sessionId: string, reason: string): Promise<UploadSession> {
    await this.store.update(sessionId, {
      status: 'failed',
    });

    const session = await this.requireSession(sessionId);

    this.log.warn(
      { sessionId, reason },
      'Upload session aborted'
    );

    return session;
  }

  /**
   * Cancel and delete an upload session (for stale session recovery)
   *
   * Used when a previous upload failed mid-way and needs to be cleared
   * to allow a new upload to start. Partial files in DB will be cleaned
   * by the scheduled FileCleanupWorker.
   *
   * @param sessionId - Session ID to cancel
   * @param userId - User ID (for ownership verification)
   * @returns True if cancelled, false if not found
   */
  async cancelSession(sessionId: string, userId: string): Promise<boolean> {
    const session = await this.store.get(sessionId);

    if (!session) {
      this.log.debug({ sessionId }, 'Session not found for cancellation');
      return false;
    }

    // Verify ownership
    if (session.userId !== userId) {
      this.log.warn(
        { sessionId, requestUserId: userId, sessionUserId: session.userId },
        'Session cancellation denied: ownership mismatch'
      );
      throw new Error('Access denied: session belongs to another user');
    }

    // Update status before deleting (for any listeners)
    await this.store.update(sessionId, { status: 'failed' });

    // Delete from Redis (clears both session and user:active keys)
    await this.store.delete(sessionId);

    this.log.info(
      { sessionId, userId },
      'Upload session cancelled and deleted'
    );

    return true;
  }

  /**
   * Cancel user's active session if any (for auto-recovery)
   *
   * @param userId - User ID
   * @returns True if a session was cancelled
   */
  async cancelActiveSession(userId: string): Promise<boolean> {
    const session = await this.store.getActiveSession(userId);

    if (!session) {
      return false;
    }

    return this.cancelSession(session.id, userId);
  }

  /**
   * Extend session TTL (heartbeat)
   */
  async heartbeat(sessionId: string): Promise<void> {
    await this.store.extendTTL(sessionId);
  }

  /**
   * Get session by ID
   */
  async getSession(sessionId: string): Promise<UploadSession | null> {
    return this.store.get(sessionId);
  }

  /**
   * Get user's active session (legacy - returns first active)
   *
   * @deprecated Use getActiveSessions() for multi-session support
   */
  async getActiveSession(userId: string): Promise<UploadSession | null> {
    return this.store.getActiveSession(userId);
  }

  /**
   * Get all active sessions for a user (multi-session support)
   */
  async getActiveSessions(userId: string): Promise<UploadSession[]> {
    return this.store.getActiveSessions(userId);
  }

  /**
   * Get count of active sessions for a user
   */
  async getActiveSessionCount(userId: string): Promise<number> {
    return this.store.getActiveSessionCount(userId);
  }

  // =========================================================================
  // PRIVATE HELPERS
  // =========================================================================

  /**
   * Get session or throw
   */
  private async requireSession(sessionId: string): Promise<UploadSession> {
    const session = await this.store.get(sessionId);
    if (!session) {
      throw new Error(`Upload session not found: ${sessionId}`);
    }
    return session;
  }

  /**
   * Find batch in session or throw
   */
  private findBatch(session: UploadSession, tempId: string): FolderBatch {
    const batch = session.folderBatches.find(b => b.tempId === tempId);
    if (!batch) {
      throw new Error(`Folder batch not found: ${tempId} in session ${session.id}`);
    }
    return batch;
  }
}

// ===== Convenience Getters =====

/**
 * Get the singleton UploadSessionManager instance
 */
export function getUploadSessionManager(
  deps?: UploadSessionManagerDependencies
): UploadSessionManager {
  return UploadSessionManager.getInstance(deps);
}

/**
 * Reset the singleton instance (for testing)
 */
export function __resetUploadSessionManager(): void {
  UploadSessionManager.resetInstance();
}
