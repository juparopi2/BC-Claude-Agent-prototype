/**
 * Upload Session Module
 *
 * Provides folder-based batch processing for file uploads.
 * Uses Redis for session state with automatic TTL expiration.
 *
 * @module domains/files/upload-session
 */

// Store Interfaces
export type {
  IUploadSessionStore,
  CreateSessionOptions,
  FolderBatchUpdate,
  SessionUpdate,
} from './IUploadSessionStore';

// Manager Interfaces
export type {
  IUploadSessionManager,
  InitSessionOptions,
  CreateFolderResult,
  RegisterFilesResult,
  FileSasInfo,
  MarkUploadedResult,
  CompleteBatchResult,
} from './IUploadSessionManager';

// Store implementation
export {
  UploadSessionStore,
  getUploadSessionStore,
  __resetUploadSessionStore,
  type UploadSessionStoreDependencies,
} from './UploadSessionStore';

// Manager implementation
export {
  UploadSessionManager,
  getUploadSessionManager,
  __resetUploadSessionManager,
  type UploadSessionManagerDependencies,
} from './UploadSessionManager';
