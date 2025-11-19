/**
 * Agent System Type Definitions
 *
 * Types for Claude Agent SDK integration, agent events, and session management.
 */

import type { MCPServerConfig } from './mcp.types';
// ✅ Import native SDK types (source of truth)
import type { StopReason } from '@anthropic-ai/sdk/resources/messages';

/**
 * Agent Options
 * Configuration options for agent execution
 */
export interface AgentOptions {
  /** Session ID for conversation context */
  sessionId?: string;
  /** User ID making the request */
  userId: string;
  /** MCP server URL */
  mcpServerUrl: string;
  /** Include partial messages in streaming */
  includePartialMessages?: boolean;
  /** Model to use (defaults to claude-sonnet-4) */
  model?: string;
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Temperature for response generation */
  temperature?: number;
  /** System prompt override */
  systemPrompt?: string;
}

/**
 * Agent Event Types
 * Events emitted during agent execution
 */
export type AgentEventType =
  | 'session_start'
  | 'thinking'
  | 'message_partial'
  | 'message'
  | 'message_chunk'
  | 'tool_use'
  | 'tool_result'
  | 'error'
  | 'session_end'
  | 'complete'
  | 'approval_requested'
  | 'approval_resolved';

/**
 * Persistence State
 *
 * Indicates database persistence status for real-time frontend updates.
 * Transitions: queued → persisted | failed
 */
export type PersistenceState = 'queued' | 'persisted' | 'failed';

/**
 * Base Agent Event (Enhanced Contract - Multi-Tenant)
 *
 * Base structure for all agent events with Event Sourcing support.
 * Provides maximum information for flexible frontend rendering.
 *
 * Architecture:
 * - eventId: Unique identifier for tracing and debugging
 * - sequenceNumber: Guaranteed ordering (replaces timestamp-based sorting)
 * - persistenceState: Real-time persistence status for optimistic UI
 * - correlationId: Links related events (e.g., tool_use → tool_result)
 * - parentEventId: Hierarchical event relationships
 */
export interface BaseAgentEvent {
  /** Event type discriminator */
  type: AgentEventType;
  /** Session ID */
  sessionId?: string;
  /** Event timestamp */
  timestamp: Date;

  // Enhanced Event Sourcing Fields (Multi-Tenant Architecture)
  /** Unique event ID (UUID) for tracing and correlation */
  eventId: string;
  /** Sequence number for guaranteed ordering (atomic via Redis INCR) */
  sequenceNumber: number;
  /** Database persistence state for optimistic UI updates */
  persistenceState: PersistenceState;
  /** Correlation ID for linking related events (e.g., tool_use → tool_result) */
  correlationId?: string;
  /** Parent event ID for hierarchical relationships */
  parentEventId?: string;
}

/**
 * Session Start Event
 * Emitted when an agent session begins
 */
export interface SessionStartEvent extends BaseAgentEvent {
  type: 'session_start';
  sessionId: string;
  userId: string;
}

/**
 * Thinking Event
 * Emitted when the agent is thinking (reasoning internally)
 */
export interface ThinkingEvent extends BaseAgentEvent {
  type: 'thinking';
  /** Thinking content (may be redacted) */
  content?: string;
  /** Token count for thinking */
  tokenCount?: number;
}

/**
 * Message Partial Event
 * Emitted during streaming for partial message content
 */
export interface MessagePartialEvent extends BaseAgentEvent {
  type: 'message_partial';
  /** Partial message content */
  content: string;
  /** Message ID */
  messageId?: string;
}

/**
 * Message Event
 * Emitted when a complete message is available
 */
export interface MessageEvent extends BaseAgentEvent {
  type: 'message';
  /** Complete message content */
  content: string;
  /** Message ID */
  messageId: string;
  /** Role (user or assistant) */
  role: 'user' | 'assistant';
  /**
   * Native SDK stop_reason indicating message completion state
   * - 'end_turn': Natural completion - final message
   * - 'tool_use': Model wants to use a tool - intermediate message
   * - 'max_tokens': Truncated due to token limit
   * - 'stop_sequence': Hit custom stop sequence
   * - 'pause_turn': Long turn paused
   * - 'refusal': Policy violation
   */
  stopReason?: StopReason | null;  // ⭐ SDK returns null, not undefined
  /** Token usage for this message */
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    thinkingTokens?: number;
  };
}

/**
 * Tool Use Event
 * Emitted when the agent uses a tool
 */
export interface ToolUseEvent extends BaseAgentEvent {
  type: 'tool_use';
  /** Tool name */
  toolName: string;
  /** Tool arguments */
  args: Record<string, unknown>;
  /** Tool use ID */
  toolUseId?: string;
}

/**
 * Tool Result Event
 * Emitted when a tool execution completes
 */
export interface ToolResultEvent extends BaseAgentEvent {
  type: 'tool_result';
  /** Tool name */
  toolName: string;
  /** Tool arguments (preserved from original tool_use) */
  args?: Record<string, unknown>;
  /** Tool result */
  result: unknown;
  /** Whether tool succeeded */
  success: boolean;
  /** Error if tool failed */
  error?: string;
  /** Tool use ID */
  toolUseId?: string;
  /** Duration in milliseconds */
  durationMs?: number;
}

/**
 * Error Event
 * Emitted when an error occurs during agent execution
 */
export interface ErrorEvent extends BaseAgentEvent {
  type: 'error';
  /** Error message */
  error: string;
  /** Error code */
  code?: string;
  /** Stack trace (in development) */
  stack?: string;
}

/**
 * Session End Event
 * Emitted when an agent session ends
 */
export interface SessionEndEvent extends BaseAgentEvent {
  type: 'session_end';
  sessionId: string;
  /** Reason for ending */
  reason?: 'completed' | 'error' | 'timeout' | 'user_cancelled';
}

/**
 * Message Chunk Event
 * Emitted during streaming for incremental message content
 */
export interface MessageChunkEvent extends BaseAgentEvent {
  type: 'message_chunk';
  /** Chunk of message content */
  content: string;
}

/**
 * Complete Event
 * Emitted when agent execution completes
 */
export interface CompleteEvent extends BaseAgentEvent {
  type: 'complete';
  /** Completion reason */
  reason: 'success' | 'error' | 'max_turns' | 'user_cancelled';
}

/**
 * Approval Requested Event
 * Emitted when agent needs user approval for an action
 */
export interface ApprovalRequestedEvent extends BaseAgentEvent {
  type: 'approval_requested';
  /** Approval request ID */
  approvalId: string;
  /** Tool that requires approval */
  toolName: string;
  /** Tool arguments */
  args: Record<string, unknown>;
  /** Human-readable summary of the change */
  changeSummary: string;
  /** Priority level */
  priority: 'low' | 'medium' | 'high';
  /** Expiration time */
  expiresAt?: Date;
}

/**
 * Approval Resolved Event
 * Emitted when user responds to approval request
 */
export interface ApprovalResolvedEvent extends BaseAgentEvent {
  type: 'approval_resolved';
  /** Approval request ID */
  approvalId: string;
  /** User's decision */
  decision: 'approved' | 'rejected';
  /** Optional reason for decision */
  reason?: string;
}

/**
 * Agent Event
 * Union of all possible agent event types
 */
export type AgentEvent =
  | SessionStartEvent
  | ThinkingEvent
  | MessagePartialEvent
  | MessageEvent
  | MessageChunkEvent
  | ToolUseEvent
  | ToolResultEvent
  | ErrorEvent
  | SessionEndEvent
  | CompleteEvent
  | ApprovalRequestedEvent
  | ApprovalResolvedEvent;

/**
 * Agent Execution Result
 * Final result of agent execution
 */
export interface AgentExecutionResult {
  /** Session ID (optional for backward compatibility) */
  sessionId?: string;
  /** Final response text */
  response: string;
  /** Message ID (optional for backward compatibility) */
  messageId?: string;
  /** Token usage */
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    thinkingTokens?: number;
    totalTokens: number;
  };
  /** Input tokens (flat structure for DirectAgentService) */
  inputTokens?: number;
  /** Output tokens (flat structure for DirectAgentService) */
  outputTokens?: number;
  /** Tools used during execution */
  toolsUsed: string[];
  /** Duration in milliseconds */
  durationMs?: number;
  /** Duration (flat structure for DirectAgentService) */
  duration?: number;
  /** Whether execution was successful */
  success: boolean;
  /** Error if execution failed */
  error?: string;
}

/**
 * Agent Type
 * Different types of specialized agents
 */
export type AgentType =
  | 'general'
  | 'bc_query'
  | 'bc_write'
  | 'bc_validation'
  | 'bc_analysis';

/**
 * Agent Configuration
 * Configuration for creating a specialized agent
 */
export interface AgentConfig {
  /** Agent type */
  type: AgentType;
  /** System prompt for this agent */
  systemPrompt: string;
  /** MCP servers to connect to */
  mcpServers: MCPServerConfig[];
  /** Model to use */
  model?: string;
  /** Max tokens */
  maxTokens?: number;
  /** Temperature */
  temperature?: number;
  /** Tool permissions */
  toolPermissions?: {
    /** Allowed tool patterns (regex) */
    allowed?: string[];
    /** Denied tool patterns (regex) */
    denied?: string[];
  };
  /** Whether to require approval for writes */
  requireApproval?: boolean;
}

/**
 * Agent Session Context
 * Context maintained across agent interactions in a session
 */
export interface AgentSessionContext {
  /** Session ID */
  sessionId: string;
  /** User ID */
  userId: string;
  /** Conversation history */
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
  }>;
  /** Files in context */
  files?: string[];
  /** Session metadata */
  metadata?: Record<string, unknown>;
  /** Total tokens used in session */
  totalTokens?: number;
  /** Created timestamp */
  createdAt: Date;
  /** Last activity timestamp */
  lastActivityAt: Date;
}

/**
 * Agent Hook Context
 * Context provided to SDK hooks (onPreToolUse, onPostToolUse)
 */
export interface AgentHookContext {
  /** Session ID */
  sessionId: string;
  /** Tool name being called */
  toolName: string;
  /** Tool arguments */
  toolArgs: Record<string, unknown>;
  /** Timestamp of hook execution */
  timestamp: Date;
  /** User ID */
  userId?: string;
  /** Current todo ID (if tracked) */
  currentTodoId?: string;
}

/**
 * Tool Restriction
 * Configuration for restricting tool access
 */
export interface ToolRestriction {
  /** Allowed tool name prefixes */
  allowedPrefixes: string[];
  /** Denied tool name prefixes */
  deniedPrefixes: string[];
}

/**
 * Agent Hook Callbacks
 * Callback functions for agent lifecycle hooks
 */
export interface AgentHooks {
  /** Called before tool execution */
  onPreToolUse?: (toolName: string, args: Record<string, unknown>) => Promise<boolean>;
  /** Called after tool execution */
  onPostToolUse?: (toolName: string, result: unknown) => Promise<void>;
  /** Called when session starts */
  onSessionStart?: (sessionId: string) => Promise<void>;
  /** Called when session ends */
  onSessionEnd?: (sessionId: string, reason?: string) => Promise<void>;
}
