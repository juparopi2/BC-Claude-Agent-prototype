/**
 * Constants Index
 *
 * Barrel export for all shared constants.
 *
 * @module @bc-agent/shared/constants
 */

export {
  ErrorCode,
  HTTP_STATUS_NAMES,
  ERROR_MESSAGES,
  ERROR_STATUS_CODES,
  getHttpStatusName,
  getErrorMessage,
  getErrorStatusCode,
  validateErrorConstants,
} from './errors';

// WebSocket Events (D25 Sprint 3)
export {
  FILE_WS_CHANNELS,
  FILE_WS_EVENTS,
  type FileWsChannel,
  type FileWsEventType,
} from './websocket-events';

// File Processing Status Constants (D25 Sprint 3)
export {
  PROCESSING_STATUS,
  EMBEDDING_STATUS,
  FILE_READINESS_STATE,
  FILE_DELETION_CONFIG,
  type ProcessingStatusValue,
  type EmbeddingStatusValue,
  type FileReadinessStateValue,
} from './file-processing';
