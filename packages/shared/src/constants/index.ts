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
  // Job failure events (Phase 3, Task 3.3)
  JOB_WS_CHANNELS,
  type JobWsChannel,
  // Folder upload session events (Folder-Based Batch Processing)
  FOLDER_WS_CHANNELS,
  FOLDER_WS_EVENTS,
  type FolderWsChannel,
  type FolderWsEventType,
} from './websocket-events';

// File Processing Status Constants (D25 Sprint 3)
export {
  PROCESSING_STATUS,
  EMBEDDING_STATUS,
  FILE_READINESS_STATE,
  FILE_DELETION_CONFIG,
  // Folder upload session configuration
  FOLDER_UPLOAD_CONFIG,
  type ProcessingStatusValue,
  type EmbeddingStatusValue,
  type FileReadinessStateValue,
} from './file-processing';

// Auth Constants
export {
  AUTH_SESSION_STATUS,
  AUTH_WS_EVENTS,
  AUTH_TIME_MS,
  AUTH_ERROR_CODES,
  type AuthSessionStatus,
  type AuthWsEventType,
  type AuthErrorCode,
} from './auth.constants';

// Settings Constants
export {
  SETTINGS_THEME,
  SETTINGS_DEFAULT_THEME,
  SETTINGS_THEME_VALUES,
  SETTINGS_STORAGE_KEY,
  SETTINGS_API,
  SETTINGS_TAB,
} from './settings.constants';

// Agent Registry Constants (PRD-011)
export {
  AGENT_ID,
  AGENT_DISPLAY_NAME,
  AGENT_ICON,
  AGENT_COLOR,
  AGENT_DESCRIPTION,
  AGENT_CAPABILITY,
  AGENT_API,
  type AgentId,
  type AgentCapability,
} from './agent-registry.constants';
