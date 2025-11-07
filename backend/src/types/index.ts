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
} from './bc.types';

// Agent Types
export type {
  AgentOptions,
  AgentEventType,
  BaseAgentEvent,
  SessionStartEvent,
  ThinkingEvent,
  MessagePartialEvent,
  MessageEvent,
  ToolUseEvent,
  ToolResultEvent,
  ErrorEvent,
  SessionEndEvent,
  ApprovalRequestedEvent,
  ApprovalResolvedEvent,
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

// Orchestration Types
export type {
  IntentType,
  EntityType,
  ConfidenceLevel,
  IntentClassification,
  OrchestratorConfig,
  AgentExecutionStep,
  AgentExecutionPlan,
  StepExecutionResult,
  MultiStepResult,
  OrchestrationMetrics,
  IntentAnalysisOptions,
  OrchestratorStatus,
} from './orchestration.types';
