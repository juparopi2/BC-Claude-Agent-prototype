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
  FILE_READINESS_STATE,
  FILE_DELETION_CONFIG,
  // Folder upload session configuration
  FOLDER_UPLOAD_CONFIG,
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
  AGENT_UI_ORDER,
  AGENT_API,
  INTERNAL_TOOL_PREFIXES,
  isInternalTool,
  SERVER_TOOL_NAMES,
  isServerToolName,
  type AgentId,
  type AgentCapability,
  type ServerToolName,
} from './agent-registry.constants';

// Provider Constants (PRD-100)
export {
  PROVIDER_ID,
  PROVIDER_DISPLAY_NAME,
  PROVIDER_ACCENT_COLOR,
  PROVIDER_ICON,
  PROVIDER_UI_ORDER,
  CONNECTIONS_API,
  type ProviderId,
} from './providers';

// Connection Status Constants (PRD-100)
export {
  CONNECTION_STATUS,
  SYNC_STATUS,
  FILE_SOURCE_TYPE,
  SCOPE_MODE,
  type ConnectionStatus,
  type SyncStatus,
  type FileSourceType,
  type ScopeMode,
} from './connection-status';

// Sync Events (PRD-101)
export {
  SYNC_WS_EVENTS,
  type SyncWsEventType,
} from './sync-events';

// Graph API Scopes (PRD-101)
export {
  GRAPH_API_SCOPES,
  type GraphApiScope,
} from './graph-scopes';

// Pipeline Status (PRD-01)
export {
  PIPELINE_STATUS,
  PIPELINE_TRANSITIONS,
  canTransition,
  getValidTransitions,
  getTransitionErrorMessage,
  computeReadinessState,
  PipelineTransitionError,
  type PipelineStatus,
  type PipelineStatusValue,
  type TransitionResult,
} from './pipeline-status';

// File Type Categories (RAG Filtered Search)
export {
  FILE_TYPE_CATEGORIES,
  FILE_TYPE_DISPLAY,
  SUPPORTED_EXTENSIONS_DISPLAY,
  getMimeTypesForCategory,
  getValidCategories,
  type FileTypeCategory,
} from './file-type-categories';

// File Health State Definitions (PRD-304)
export {
  HEALTHY_FILE_STATES,
  getFileHealthKey,
  getExpectedHealthState,
  validateFileHealth,
  isResourceExpectationMet,
  type HealthyFileExpectation,
  type FileHealthViolation,
  type FileHealthStateKey,
  type ResourceExpectation,
} from './file-health-state';

// Mention Constants (scope context for chat)
export {
  MENTION_TYPE,
  MENTION_MIME_TYPE,
  type MentionType,
} from './mention.constants';

// Onboarding Constants
export {
  TOUR_ID,
  TIP_ID,
  TIP_MAX_SHOW_COUNTS,
  NEW_CHAT_TIP_MESSAGE_THRESHOLD,
  type TourId,
  type TipId,
} from './onboarding.constants';
