/**
 * Central Type Definitions Export
 *
 * Barrel file for all type definitions in the backend.
 * Import types from here rather than individual files.
 */

// MCP Types
export type {
  MCPServerConfig,
  MCPTool,
  MCPToolCall,
  MCPToolResult,
  MCPResource,
  MCPPrompt,
  MCPHealthStatus,
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
