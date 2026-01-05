/**
 * Types Index
 *
 * Barrel export for all shared type definitions.
 *
 * @module @bc-agent/shared/types
 */

// Agent event types (sync architecture - no chunk types)
export type {
  StopReason,
  AgentEventType,
  PersistenceState,
  BaseAgentEvent,
  SessionStartEvent,
  ThinkingEvent,
  ThinkingCompleteEvent,
  MessageEvent,
  Citation,  // RAG source attribution
  ToolUseEvent,
  ToolResultEvent,
  ErrorEvent,
  SessionEndEvent,
  CompleteEvent,
  ApprovalRequestedEvent,
  ApprovalResolvedEvent,
  UserMessageConfirmedEvent,
  TurnPausedEvent,
  ContentRefusedEvent,
  AgentEvent,
  AgentExecutionResult,
  CitedFile,
  TransientEventType,
} from './agent.types';

// Transient event utilities
export { TRANSIENT_EVENT_TYPES, isTransientEventType } from './agent.types';

// WebSocket types
export type {
  ExtendedThinkingConfig,
  ChatMessageData,
  StopAgentData,
  ApprovalResponseData,
  ApprovalRequestData,
  AgentErrorData,
  SessionReadyEvent,
  SessionJoinedEvent,
  WebSocketEvents,
} from './websocket.types';

// Approval types
export type {
  ApprovalStatus,
  ApprovalPriority,
  ApprovalRequest,
  ApprovalResponse,
  ChangeSummary,
  CreateApprovalOptions,
  ApprovalResult,
  ApprovalOwnershipError,
} from './approval.types';

// Error types
export type {
  ApiErrorResponse,
  ErrorResponseWithStatus,
  ValidationErrorDetail,
  RangeErrorDetail,
} from './error.types';

// Type guards
export { isApiErrorResponse, isValidErrorCode } from './error.types';

// Message types (API contract between Backend and Frontend)
export type {
  BaseMessage,
  TokenUsage,
  StandardMessage,
  ThinkingMessage,
  ToolUseMessage,
  ToolResultMessage,
  Message,
} from './message.types';

// Message type guards
export {
  isStandardMessage,
  isThinkingMessage,
  isToolUseMessage,
  isToolResultMessage,
} from './message.types';

// File types (Phase 2: File Management)
export type {
  ProcessingStatus,
  EmbeddingStatus,
  FileUsageType,
  FileSortBy,
  SortOrder,
  ParsedFile,
  ParsedFileChunk,
  GetFilesOptions,
  CreateFolderRequest,
  UpdateFileRequest,
  FilesListResponse,
  FileResponse,
  FolderResponse,
  UploadFilesResponse,
  AllowedMimeType,
} from './file.types';

// File constants
export { FILE_UPLOAD_LIMITS, ALLOWED_MIME_TYPES } from './file.types';

// File type guards
export { isAllowedMimeType } from './file.types';

// Normalized event types (multi-provider normalization)
export type {
  NormalizedProvider,
  NormalizedAgentEventType,
  NormalizedPersistenceStrategy,
  NormalizedStopReason,
  NormalizedTokenUsage,
  BaseNormalizedEvent,
  NormalizedSessionStartEvent,
  NormalizedUserMessageEvent,
  NormalizedThinkingEvent,
  NormalizedToolRequestEvent,
  NormalizedToolResponseEvent,
  NormalizedAssistantMessageEvent,
  NormalizedErrorEvent,
  NormalizedCompleteEvent,
  NormalizedAgentEvent,
} from './normalized-events.types';

// Normalized event type guards
export {
  requiresSyncPersistence,
  isTransientNormalizedEvent,
  allowsAsyncPersistence,
  isNormalizedThinkingEvent,
  isNormalizedToolRequestEvent,
  isNormalizedToolResponseEvent,
  isNormalizedAssistantMessageEvent,
  isNormalizedCompleteEvent,
} from './normalized-events.types';
