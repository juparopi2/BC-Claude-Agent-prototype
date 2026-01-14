/**
 * File Event Emission Module
 *
 * Centralized WebSocket event emission for file status updates.
 *
 * @module domains/files/emission
 */

// Interface
export type {
  IFileEventEmitter,
  FileEventContext,
  ReadinessChangedPayload,
  PermanentlyFailedPayload,
  ProcessingProgressPayload,
  CompletionStats,
} from './IFileEventEmitter';

// Implementation
export {
  FileEventEmitter,
  getFileEventEmitter,
  __resetFileEventEmitter,
  type FileEventEmitterDependencies,
} from './FileEventEmitter';
