/**
 * API Infrastructure
 *
 * Barrel exports for HTTP API clients.
 *
 * @module infrastructure/api
 */

// HTTP Client (General API)
export {
  ApiClient,
  getApiClient,
  resetApiClient,
  ApiError,
  type ApiResponse,
  type Session,
  type UserProfile,
  type TokenUsage,
  type CreateSessionRequest,
  type UpdateSessionRequest,
  type GetSessionsOptions,
  type PaginationInfo,
  type PaginatedSessionsResponse,
  // Message types from shared
  type Message,
  type StandardMessage,
  type ThinkingMessage,
  type ToolUseMessage,
  isStandardMessage,
  isThinkingMessage,
  isToolUseMessage,
} from './httpClient';

// File API Client
export {
  FileApiClient,
  getFileApiClient,
  resetFileApiClient,
} from './fileApiClient';

// Chat Attachment API Client
export {
  ChatAttachmentApiClient,
  getChatAttachmentApiClient,
  resetChatAttachmentApiClient,
  type UploadChatAttachmentResponse,
  type ListChatAttachmentsResponse,
} from './chatAttachmentApiClient';

// Auth Retry Utility
export {
  withAuthRetry,
  createRetryableApiCall,
} from './withAuthRetry';
