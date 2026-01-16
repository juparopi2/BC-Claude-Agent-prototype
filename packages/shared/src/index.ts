/**
 * @bc-agent/shared
 *
 * Shared TypeScript definitions for BC Claude Agent.
 * This package is the single source of truth for types used by both
 * frontend and backend applications.
 *
 * @module @bc-agent/shared
 *
 * @example
 * ```typescript
 * // Import types
 * import type { AgentEvent, ChatMessageData, ApiErrorResponse } from '@bc-agent/shared';
 *
 * // Import constants
 * import { ErrorCode, getErrorMessage } from '@bc-agent/shared';
 *
 * // Import schemas
 * import { chatMessageSchema, validateSafe } from '@bc-agent/shared/schemas';
 * ```
 */

// ============================================
// Types - All type definitions
// ============================================
export type {
  // Agent event types (sync architecture - no chunk types)
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

  // WebSocket types
  ExtendedThinkingConfig,
  ChatMessageData,
  StopAgentData,
  ApprovalResponseData,
  ApprovalRequestData,
  AgentErrorData,
  SessionReadyEvent,
  SessionJoinedEvent,
  WebSocketEvents,

  // Approval types
  ApprovalStatus,
  ApprovalPriority,
  ApprovalRequest,
  ApprovalResponse,
  ChangeSummary,
  CreateApprovalOptions,
  ApprovalResult,
  ApprovalOwnershipError,

  // Error types
  ApiErrorResponse,
  ErrorResponseWithStatus,
  ValidationErrorDetail,
  RangeErrorDetail,

  // Message types (API contract between Backend and Frontend)
  // PHASE 4.6: Single source of truth for message structure
  BaseMessage,
  TokenUsage,
  StandardMessage,
  ThinkingMessage,
  ToolUseMessage,
  ToolResultMessage,
  Message,

  // File types
  ProcessingStatus,
  EmbeddingStatus,
  FileReadinessState,
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
  // Duplicate detection types
  DuplicateCheckItem,
  CheckDuplicatesRequest,
  DuplicateResult,
  CheckDuplicatesResponse,
  DuplicateAction,
  // Retry & Cleanup types
  RetryPhase,
  RetryScope,
  RetryDecisionReason,
  RetryDecisionResult,
  ManualRetryResult,
  CleanupResult,
  BatchCleanupResult,
  RetryProcessingRequest,
  RetryProcessingResponse,
  // File WebSocket event types
  FileReadinessChangedEvent,
  FilePermanentlyFailedEvent,
  FileProcessingProgressEvent,
  FileProcessingCompletedEvent,
  FileProcessingFailedEvent,
  FileDeletedEvent,
  FileWebSocketEvent,
  // Bulk Delete types (Queue-based deletion)
  DeletionReason,
  FileDeletionJobData,
  BulkDeleteAcceptedResponse,

  // Source types (Visual Representation feature)
  SourceType,
  FetchStrategy,
  SourceExcerpt,
} from './types';

// Type guards (runtime functions, not types)
export {
  isApiErrorResponse,
  isValidErrorCode,
  // Message type guards
  isStandardMessage,
  isThinkingMessage,
  isToolUseMessage,
  isToolResultMessage,
  // File type guards
  isAllowedMimeType,
  // Transient event utilities
  isTransientEventType,
} from './types';

// File constants
export { FILE_UPLOAD_LIMITS, ALLOWED_MIME_TYPES } from './types';

// Transient event constants
export { TRANSIENT_EVENT_TYPES } from './types';

// Source type utilities (Visual Representation feature)
export {
  getFetchStrategy,
  DEFAULT_SOURCE_TYPE,
  DEFAULT_FETCH_STRATEGY,
} from './types';

// ============================================
// Constants - Error codes, messages, mappings
// ============================================
export {
  ErrorCode,
  HTTP_STATUS_NAMES,
  ERROR_MESSAGES,
  ERROR_STATUS_CODES,
  getHttpStatusName,
  getErrorMessage,
  getErrorStatusCode,
  validateErrorConstants,
  // WebSocket Events (D25 Sprint 3)
  FILE_WS_CHANNELS,
  FILE_WS_EVENTS,
  type FileWsChannel,
  type FileWsEventType,
  // File Processing Status Constants (D25 Sprint 3)
  PROCESSING_STATUS,
  EMBEDDING_STATUS,
  FILE_READINESS_STATE,
  type ProcessingStatusValue,
  type EmbeddingStatusValue,
  type FileReadinessStateValue,
  // File Deletion Configuration (Bulk Delete)
  FILE_DELETION_CONFIG,
} from './constants';

// ============================================
// Schemas - Exported from separate entry point
// ============================================
// Note: Schemas are exported from '@bc-agent/shared/schemas'
// to allow tree-shaking of Zod dependency when only types are needed
