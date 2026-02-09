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
  AgentChangedEvent,
  HandoffType,
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
  AgentSelectData,
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

export type {
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
  // Retry & Cleanup types (D25 Sprint 2)
  RetryPhase,
  RetryScope,
  RetryDecisionReason,
  RetryDecisionResult,
  ManualRetryResult,
  CleanupResult,
  BatchCleanupResult,
  RetryProcessingRequest,
  RetryProcessingResponse,
  FileReadinessChangedEvent,
  FilePermanentlyFailedEvent,
  FileProcessingProgressEvent,
  FileProcessingCompletedEvent,
  FileProcessingFailedEvent,
  FileWebSocketEvent,
  // Bulk Delete types (Queue-based deletion)
  DeletionReason,
  DeletionStatus,
  FileDeletionJobData,
  BulkDeleteAcceptedResponse,
  SoftDeleteResult,
  FileDeletedEvent,
  FileDeletionStartedEvent,
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
} from './file.types';

// File constants
export { FILE_UPLOAD_LIMITS, ALLOWED_MIME_TYPES, FILE_BULK_UPLOAD_CONFIG } from './file.types';

// File type guards
export { isAllowedMimeType } from './file.types';

// Source types (Visual Representation - Multi-Provider Support)
export type { SourceType, FetchStrategy, SourceExcerpt } from './source.types';
export {
  getFetchStrategy,
  DEFAULT_SOURCE_TYPE,
  DEFAULT_FETCH_STRATEGY,
} from './source.types';

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

// Auth types
export type {
  SessionHealthResponse,
  AuthExpiringEventPayload,
  AuthRefreshedEventPayload,
  UserProfileWithExpiry,
} from './auth.types';

// Settings types
export type {
  ThemePreference,
  SettingsTabId,
  UserSettings,
  UserSettingsResponse,
  UpdateUserSettingsRequest,
  UserSettingsRow,
} from './settings.types';

// Job event types (Phase 3, Task 3.3)
export type {
  JobQueueName,
  JobFailureContext,
  JobFailedPayload,
} from './job-events.types';

export {
  JOB_QUEUE_DISPLAY_NAMES,
  getQueueDisplayName,
} from './job-events.types';

// Chat Attachments types (ephemeral attachments for chat)
export type {
  ChatAttachmentStatus,
  ChatAttachmentMediaType,
  ChatAttachmentDbRecord,
  ChatAttachmentSummary,
  ParsedChatAttachment,
  AnthropicDocumentBlock,
  AnthropicImageBlock,
  AnthropicAttachmentContentBlock,
  UploadChatAttachmentRequest,
  UploadChatAttachmentResponse,
  ListChatAttachmentsResponse,
  ResolvedChatAttachment,
  ChatAttachmentCleanupJobData,
  // LangChain-compatible content block types
  LangChainImageBlock,
  LangChainTextBlock,
  LangChainDocumentBlock,
  LangChainContentBlock,
} from './chat-attachments.types';

// Chat Attachments constants and utilities
export {
  CHAT_ATTACHMENT_ALLOWED_MIME_TYPES,
  CHAT_ATTACHMENT_CONFIG,
  isAllowedChatAttachmentMimeType,
  parseChatAttachment,
  isImageMimeType,
  getContentBlockType,
  getMaxSizeForMimeType,
} from './chat-attachments.types';

// Upload Session types (Folder-Based Batch Processing)
export type {
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
  GetActiveSessionsResponse,
  CancelSessionResult,
  // Folder conflict types
  FolderDuplicateAction,
  FolderConflict,
  FolderConflictResolution,
  ResolveFolderConflictsRequest,
  ResolveFolderConflictsResponse,
  InitUploadSessionResponseWithConflicts,
  // WebSocket event types
  FolderSessionStartedEvent,
  FolderSessionCompletedEvent,
  FolderSessionFailedEvent,
  FolderSessionCancelledEvent,
  FolderBatchStartedEvent,
  FolderBatchProgressEvent,
  FolderBatchCompletedEvent,
  FolderBatchFailedEvent,
  FolderWebSocketEvent,
} from './upload-session.types';

// Agent Identity types (PRD-020)
export type { AgentIdentity } from './agent-identity.types';

// Agent Registry types (PRD-011)
export type {
  AgentUISummary,
  AgentListResponse,
} from './agent-registry.types';

// Chart Config types (PRD-050 Graphing Agent)
export type {
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
} from './chart-config.types';
