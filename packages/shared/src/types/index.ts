/**
 * Types Index
 *
 * Barrel export for all shared type definitions.
 *
 * @module @bc-agent/shared/types
 */

// Agent event types
export type {
  StopReason,
  AgentEventType,
  PersistenceState,
  BaseAgentEvent,
  SessionStartEvent,
  ThinkingEvent,
  ThinkingChunkEvent,
  MessagePartialEvent,
  MessageEvent,
  MessageChunkEvent,
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
} from './agent.types';

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
