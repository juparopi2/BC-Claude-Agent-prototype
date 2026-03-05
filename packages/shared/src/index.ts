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
  // Duplicate Detection types (PRD-02)
  DuplicateMatchType,
  DuplicateScope,
  DuplicateMatchInfo,
  DuplicateCheckInput,
  CheckDuplicatesRequest,
  DuplicateCheckResult,
  DuplicateCheckSummary,
  CheckDuplicatesResponse,
  DuplicateResolutionAction,
  // Folder Duplicate Detection types
  FolderDuplicateCheckInput,
  CheckFolderDuplicatesRequest,
  FolderDuplicateCheckResult,
  CheckFolderDuplicatesResponse,
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
  AnthropicFileDocumentBlock,
  AnthropicFileImageBlock,
  AnthropicContainerUploadBlock,
  AnthropicAttachmentContentBlock,
  SessionFileReference,
  LangChainImageBlock,
  LangChainTextBlock,
  LangChainDocumentBlock,
  LangChainContainerUploadBlock,
  LangChainContentBlock,
  UploadChatAttachmentRequest,
  UploadChatAttachmentResponse,
  ListChatAttachmentsResponse,
  ResolvedChatAttachment,
  AttachmentRoutingCategory,
  AttachmentRoutingMetadata,
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
  InitUploadSessionResponseWithSasUrls,

  // Upload Batch types (PRD-03)
  BatchStatus,
  ManifestFileItem,
  ManifestFolderItem,
  ReplaceFolderMapping,
  CreateBatchRequest,
  BatchFileResult,
  BatchFolderResult,
  CreateBatchResponse,
  BatchProgress,
  ConfirmFileResponse,
  BatchFileStatus,
  BatchStatusResponse,
  CancelBatchResponse,

  // Connection types (PRD-100)
  ConnectionSummary,
  ConnectionScopeDetail,
  ConnectionListResponse,

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

  // File Mention types (@ mentions in chat input)
  FileMention,

  // Agent Identity types (PRD-020/070)
  AgentIdentity,

  // Agent Rendered Result types (PRD-070)
  AgentRenderedResultType,
  AgentRenderedResultBase,

  // Citation Result types (PRD-071)
  CitationPassage,
  CitedDocument,
  CitationResult,

  // Upload Dashboard types (PRD-05)
  QueueDepth,
  UploadDashboard,
  StuckFileDetails,
  StuckFilesResponse,
  OrphanReport,
  RetryResponse,
  BulkRetryResponse,
  StuckFileRecoveryMetrics,
  OrphanCleanupMetrics,
  BatchTimeoutMetrics,
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
  // Server tool result type detection
  detectServerToolResultType,
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
  CHAT_ATTACHMENT_MIME_TO_EXTENSIONS,
  CHAT_ATTACHMENT_DISPLAY_TYPES,
  buildChatAttachmentAcceptString,
  MIME_ROUTING_MAP,
  isAllowedChatAttachmentMimeType,
  parseChatAttachment,
  isImageMimeType,
  getContentBlockType,
  getMaxSizeForMimeType,
  getAttachmentRoutingCategory,
  isAnthropicNativeMimeType,
} from './types';

// Duplicate Detection schemas (PRD-02)
export {
  duplicateCheckInputSchema,
  checkDuplicatesRequestSchema,
  // Folder Duplicate Detection schemas
  folderDuplicateCheckInputSchema,
  checkFolderDuplicatesRequestSchema,
} from './types';

// Upload Batch schemas & constants (PRD-03)
export {
  BATCH_STATUS,
  manifestFileItemSchema,
  manifestFolderItemSchema,
  replaceFolderMappingSchema,
  createBatchRequestSchema,
} from './types';

// DLQ types (PRD-04)
export type {
  FailedPipelineStage,
  DLQEntry,
  DLQListResponse,
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
// Utils - File Name Resolver (duplicate rename)
// ============================================
export {
  splitFileName,
  extractSuffix,
  generateUniqueFileName,
} from './utils/fileNameResolver';

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
  FILE_READINESS_STATE,
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

  // Provider Constants (PRD-100)
  PROVIDER_ID,
  PROVIDER_DISPLAY_NAME,
  PROVIDER_ACCENT_COLOR,
  PROVIDER_ICON,
  PROVIDER_UI_ORDER,
  CONNECTIONS_API,
  type ProviderId,

  // Connection Status Constants (PRD-100)
  CONNECTION_STATUS,
  SYNC_STATUS,
  FILE_SOURCE_TYPE,
  type ConnectionStatus,
  type SyncStatus,
  type FileSourceType,

  // Agent Registry Constants (PRD-011)
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

  // File Type Categories (RAG Filtered Search)
  FILE_TYPE_CATEGORIES,
  FILE_TYPE_DISPLAY,
  SUPPORTED_EXTENSIONS_DISPLAY,
  getMimeTypesForCategory,
  getValidCategories,
  type FileTypeCategory,

  // Pipeline Status (PRD-01)
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
  // Connection schemas (PRD-100)
  createConnectionSchema,
  updateConnectionSchema,
  connectionIdParamSchema,

  // Citation Result schemas (PRD-071)
  CitationPassageSchema,
  CitedDocumentSchema,
  CitationResultSchema,
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
