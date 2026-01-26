/**
 * File Event Emission Module
 *
 * Centralized WebSocket event emission for file status updates.
 *
 * @module domains/files/emission
 */

// File Event Emitter Interface
export type {
  IFileEventEmitter,
  FileEventContext,
  ReadinessChangedPayload,
  PermanentlyFailedPayload,
  ProcessingProgressPayload,
  CompletionStats,
} from './IFileEventEmitter';

// File Event Emitter Implementation
export {
  FileEventEmitter,
  getFileEventEmitter,
  __resetFileEventEmitter,
  type FileEventEmitterDependencies,
} from './FileEventEmitter';

// Folder Event Emitter Interface
export type {
  IFolderEventEmitter,
  FolderEventContext,
  SessionStartedPayload,
  SessionCompletedPayload,
  SessionFailedPayload,
  FolderBatchPayload,
  FolderBatchFailedPayload,
} from './IFolderEventEmitter';

// Folder Event Emitter Implementation
export {
  FolderEventEmitter,
  getFolderEventEmitter,
  __resetFolderEventEmitter,
  type FolderEventEmitterDependencies,
} from './FolderEventEmitter';
