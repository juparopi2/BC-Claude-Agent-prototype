/**
 * Central Type Definitions Export
 *
 * Barrel file for all type definitions in the backend.
 * Import types from here rather than individual files.
 */

// MCP Types
export type {
  MCPTool,
  MCPToolCall,
  MCPToolResult,
  MCPResource,
  MCPPrompt,
} from './mcp.types';

// Business Central Types
export type {
  BCBaseEntity,
  BCCustomer,
  BCVendor,
  BCItem,
  BCSalesOrder,
  BCSalesOrderLine,
  BCQueryOptions,
  BCApiResponse,
  BCSingleEntityResponse,
  BCApiError,
  BCOAuthTokenResponse,
  BCValidationResult,
  BCEntity,
  BCEntityType,
  BCResult,
  BCSingleResult,
} from './bc.types';

// Agent Types
export type {
  AgentOptions,
  AgentEventType,
  PersistenceState,
  BaseAgentEvent,
  SessionStartEvent,
  ThinkingEvent,
  MessagePartialEvent,
  MessageEvent,
  MessageChunkEvent,  // ⭐ Added missing export
  Citation,  // ⭐ RAG source attribution
  ToolUseEvent,
  ToolResultEvent,
  ErrorEvent,
  SessionEndEvent,
  CompleteEvent,  // ⭐ Added missing export
  ApprovalRequestedEvent,
  ApprovalResolvedEvent,
  UserMessageConfirmedEvent,  // ⭐ NEW: User message confirmation event
  AgentEvent,
  AgentExecutionResult,
  AgentType,
  AgentConfig,
  AgentSessionContext,
  // Phase 5: File Context Types
  ImageContent,
  FileContextResult,
  // LangGraph Orchestrator Types
  UsageEvent,
} from './agent.types';

// Auth Types
export type {
  UserRole,
  RegisterRequest,
  LoginRequest,
  RefreshTokenRequest,
  LogoutRequest,
  AuthResponse,
  UserDTO,
  JWTPayload,
  RefreshTokenPayload,
  UserRecord,
  RefreshTokenRecord,
  PasswordValidationResult,
  TokenVerificationResult,
} from './auth.types';

export { AuthenticationError, AuthorizationError } from './auth.types';

// Error Types
export type {
  ApiErrorResponse,
  ErrorResponseWithStatus,
  ValidationErrorDetail,
  RangeErrorDetail,
} from './error.types';

export { isApiErrorResponse, isValidErrorCode } from './error.types';

// File Types
export type {
  ProcessingStatus,
  EmbeddingStatus,
  FileUsageType,
  FileSortBy,
  FileDbRecord,
  FileChunkDbRecord,
  MessageFileAttachmentDbRecord,
  ParsedFile,
  ParsedFileChunk,
  GetFilesOptions,
  CreateFileOptions,
  UpdateFileOptions,
} from './file.types';

export { parseFile, parseFileChunk } from './file.types';
