/**
 * Agent System Type Definitions
 *
 * Types for Claude Agent SDK integration, agent events, and session management.
 *
 * Shared types are imported from @bc-agent/shared.
 * Backend-specific types are defined here.
 */


// ============================================
// Re-export ALL shared types for consumers
// ============================================
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
} from '@bc-agent/shared';

// ============================================
// Backend-Specific Types (not shared with frontend)
// ============================================

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
  /**
   * Extended Thinking Configuration (Phase 1F)
   *
   * Enables Claude's extended thinking mode for complex reasoning tasks.
   * When enabled, Claude will show its internal reasoning process.
   *
   * @example
   * ```typescript
   * { enableThinking: true, thinkingBudget: 10000 }
   * ```
   */
  enableThinking?: boolean;
  /**
   * Budget tokens for extended thinking (minimum 1024, max varies by model)
   * Only used when enableThinking is true.
   * @default 10000
   */
  thinkingBudget?: number;
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

// ============================================
// File Context Types (Phase 5 Chat Integration)
// ============================================

/**
 * Image content for Claude Vision API
 * Used when files include images that should be processed visually
 */
export interface ImageContent {
  /** MIME type of the image (e.g., 'image/png', 'image/jpeg') */
  mimeType: string;
  /** Base64-encoded image data */
  data: string;
}

/**
 * Result of preparing file context for injection into LLM prompts
 *
 * Contains all the information needed to:
 * 1. Inject document content into the user message (documentContext)
 * 2. Extend the system prompt with citation instructions (systemInstructions)
 * 3. Add images for Claude Vision API (images)
 * 4. Track which files were cited in responses (fileMap)
 */
export interface FileContextResult {
  /** XML-formatted document content to inject into user message */
  documentContext: string;
  /** System prompt instructions for citing documents */
  systemInstructions: string;
  /** Image contents for Claude Vision API (base64 encoded) */
  images: ImageContent[];
  /** Map of fileName → fileId for citation parsing */
  fileMap: Map<string, string>;
}
