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
  AgentChangedEvent,
  AgentEvent,
  AgentExecutionResult,
  CitedFile,
  HandoffType,
  TransientEventType,

  // WebSocket types
  ExtendedThinkingConfig,
  ChatMessageData,
  StopAgentData,
  ApprovalResponseData,
  ApprovalRequestData,
  AgentErrorData,
  AgentSelectData,
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
  FileDeletionStartedEvent,
  FileWebSocketEvent,
  // Bulk Delete types (Queue-based deletion)
  DeletionReason,
  DeletionStatus,
  FileDeletionJobData,
  BulkDeleteAcceptedResponse,
  SoftDeleteResult,

  // Bulk Upload types (Queue-based upload with SAS URLs)
  BulkUploadJobData,
  BulkUploadFileMetadata,
  BulkUploadInitRequest,
  BulkUploadFileSasInfo,
  BulkUploadInitResponse,
  BulkUploadResult,
  BulkUploadCompleteRequest,
  BulkUploadAcceptedResponse,
  FileUploadedEvent,
  // Folder Batch types (folder drag and drop)
  CreateFolderBatchRequest,
  CreateFolderBatchResponse,
  // Renew SAS types (pause/resume support)
  RenewSasRequest,
  RenewSasResponse,

  // Source types (Visual Representation feature)
  SourceType,
  FetchStrategy,
  SourceExcerpt,

  // Auth types
  SessionHealthResponse,
  AuthExpiringEventPayload,
  AuthRefreshedEventPayload,
  UserProfileWithExpiry,

  // Settings types
  ThemePreference,
  SettingsTabId,
  UserSettings,
  UserSettingsResponse,
  UpdateUserSettingsRequest,
  UserSettingsRow,

  // Job event types (Phase 3, Task 3.3)
  JobQueueName,
  JobFailureContext,
  JobFailedPayload,

  // Normalized event types (multi-provider normalization)
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

  // Chat Attachments types (ephemeral attachments for chat)
  ChatAttachmentStatus,
  ChatAttachmentMediaType,
  ChatAttachmentDbRecord,
  ChatAttachmentSummary,
  ParsedChatAttachment,
  AnthropicDocumentBlock,
  AnthropicImageBlock,
  AnthropicAttachmentContentBlock,
  LangChainImageBlock,
  LangChainTextBlock,
  LangChainDocumentBlock,
  LangChainContentBlock,
  UploadChatAttachmentRequest,
  UploadChatAttachmentResponse,
  ListChatAttachmentsResponse,
  ResolvedChatAttachment,
  ChatAttachmentCleanupJobData,

  // Upload Session types (Folder-Based Batch Processing)
  FolderBatchStatus,
  UploadSessionStatus,
  FileRegistrationMetadata,
  FolderBatch,
  UploadSession,
  UploadSessionProgress,
  FolderInput,
  InitUploadSessionRequest,
  InitUploadSessionResponse,
  RenamedFolderInfo,
  CreateFolderInSessionResponse,
  RegisteredFileResult,
  RegisterFilesResponse,
  RegisteredFileSasInfo,
  GetSasUrlsResponse,
  MarkFileUploadedRequest,
  MarkFileUploadedResponse,
  CompleteFolderBatchResponse,
  GetUploadSessionResponse,
  // Folder WebSocket event types
  FolderSessionStartedEvent,
  FolderSessionCompletedEvent,
  FolderSessionFailedEvent,
  FolderSessionCancelledEvent,
  FolderBatchStartedEvent,
  FolderBatchProgressEvent,
  FolderBatchCompletedEvent,
  FolderBatchFailedEvent,
  FolderWebSocketEvent,
  // Multi-session upload types
  GetActiveSessionsResponse,
  CancelSessionResult,
  // Folder conflict types
  FolderDuplicateAction,
  FolderConflict,
  FolderConflictResolution,
  ResolveFolderConflictsRequest,
  ResolveFolderConflictsResponse,
  InitUploadSessionResponseWithConflicts,

  // Agent Registry types (PRD-011)
  AgentUISummary,
  AgentListResponse,

  // Chart Config types (PRD-050 Graphing Agent)
  ChartType,
  TremorColor,
  BaseChartConfig,
  BarChartConfig,
  StackedBarChartConfig,
  LineChartConfig,
  AreaChartConfig,
  DonutChartConfig,
  BarListConfig,
  ComboChartConfig,
  KpiConfig,
  KpiGridConfig,
  TableConfig,
  ChartConfig,

  // Agent Identity types (PRD-020/070)
  AgentIdentity,

  // Agent Rendered Result types (PRD-070)
  AgentRenderedResultType,
  AgentRenderedResultBase,
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
  // Normalized event type guards
  requiresSyncPersistence,
  isTransientNormalizedEvent,
  allowsAsyncPersistence,
  isNormalizedThinkingEvent,
  isNormalizedToolRequestEvent,
  isNormalizedToolResponseEvent,
  isNormalizedAssistantMessageEvent,
  isNormalizedCompleteEvent,
  // Agent Rendered Result type guard (PRD-070)
  isAgentRenderedResult,
} from './types';

// File constants
export { FILE_UPLOAD_LIMITS, ALLOWED_MIME_TYPES, FILE_BULK_UPLOAD_CONFIG } from './types';

// Transient event constants
export { TRANSIENT_EVENT_TYPES } from './types';

// Source type utilities (Visual Representation feature)
export {
  getFetchStrategy,
  DEFAULT_SOURCE_TYPE,
  DEFAULT_FETCH_STRATEGY,
} from './types';

// Job event utilities (Phase 3, Task 3.3)
export { JOB_QUEUE_DISPLAY_NAMES, getQueueDisplayName } from './types';

// Chat Attachments constants and utilities
export {
  CHAT_ATTACHMENT_ALLOWED_MIME_TYPES,
  CHAT_ATTACHMENT_CONFIG,
  isAllowedChatAttachmentMimeType,
  parseChatAttachment,
  isImageMimeType,
  getContentBlockType,
  getMaxSizeForMimeType,
} from './types';

// ============================================
// Utils - Name Validation
// ============================================
export {
  NAME_VALIDATION_CONFIG,
  validateFileName,
  validateFolderName,
  sanitizeName,
  isWindowsReservedName,
  validateFilePath,
  type NameValidationResult,
  type NameValidationOptions,
} from './utils/nameValidation';

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
  // Folder Upload Session Configuration
  FOLDER_UPLOAD_CONFIG,
  // Auth Constants
  AUTH_SESSION_STATUS,
  AUTH_WS_EVENTS,
  AUTH_TIME_MS,
  AUTH_ERROR_CODES,
  type AuthSessionStatus,
  type AuthWsEventType,
  type AuthErrorCode,
  // Settings Constants
  SETTINGS_THEME,
  SETTINGS_DEFAULT_THEME,
  SETTINGS_THEME_VALUES,
  SETTINGS_STORAGE_KEY,
  SETTINGS_API,
  SETTINGS_TAB,
  // Job WebSocket Events (Phase 3, Task 3.3)
  JOB_WS_CHANNELS,
  type JobWsChannel,
  // Folder Upload Session WebSocket Events
  FOLDER_WS_CHANNELS,
  FOLDER_WS_EVENTS,
  type FolderWsChannel,
  type FolderWsEventType,

  // Agent Registry Constants (PRD-011)
  AGENT_ID,
  AGENT_DISPLAY_NAME,
  AGENT_ICON,
  AGENT_COLOR,
  AGENT_DESCRIPTION,
  AGENT_CAPABILITY,
  AGENT_API,
  type AgentId,
  type AgentCapability,
} from './constants';

// ============================================
// Schemas - Key validation schemas
// ============================================
// Note: Full schema list is available from '@bc-agent/shared/schemas'
// Re-exporting commonly used schemas for convenience
export {
  validateSafe,
  bulkDeleteRequestSchema,
  bulkUploadInitRequestSchema,
  bulkUploadCompleteRequestSchema,
  renewSasRequestSchema,
  chatMessageSchema,
  // Settings schemas
  themePreferenceSchema,
  updateUserSettingsSchema,
  // Chat attachment schemas and validators
  chatAttachmentIdSchema,
  uploadChatAttachmentSchema,
  listChatAttachmentsSchema,
  validateChatAttachmentMimeType,
  validateChatAttachmentSize,
  // Chart Config schemas (PRD-050 Graphing Agent)
  ChartConfigSchema,
  ChartTypeSchema,
  TremorColorSchema,
  BarChartConfigSchema,
  StackedBarChartConfigSchema,
  LineChartConfigSchema,
  AreaChartConfigSchema,
  DonutChartConfigSchema,
  BarListConfigSchema,
  ComboChartConfigSchema,
  KpiConfigSchema,
  KpiGridConfigSchema,
  TableConfigSchema,
} from './schemas';
