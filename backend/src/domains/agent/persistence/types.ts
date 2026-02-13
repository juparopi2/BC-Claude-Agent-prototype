/**
 * @module domains/agent/persistence/types
 *
 * Types for persistence error analysis and categorization.
 * Used by PersistenceCoordinator and error handling throughout the agent domain.
 */

/**
 * Categories of persistence errors for debugging and retry logic.
 * Each category maps to a specific root cause.
 */
export type PersistenceErrorCategory =
  | 'DUPLICATE_ID'        // Primary key violation - same message ID inserted twice
  | 'FK_VIOLATION'        // Foreign key constraint - session/user doesn't exist
  | 'SEQUENCE_CONFLICT'   // Sequence number race condition (Technical Debt D1)
  | 'DB_TIMEOUT'          // Database didn't respond in time
  | 'REDIS_ERROR'         // Redis failed when getting sequence number
  | 'CONNECTION_ERROR'    // Could not connect to database
  | 'DB_UNAVAILABLE'      // Database service not available
  | 'UNKNOWN';            // Uncategorized error

/**
 * Detailed analysis of a persistence error.
 * Used for logging, metrics, and retry decisions.
 */
export interface ErrorAnalysis {
  /** Categorized causes detected in the error */
  causes: string[];

  /** Primary category for the error */
  primaryCategory: PersistenceErrorCategory;

  /** Whether this error type should trigger a retry */
  shouldRetry: boolean;

  /** Suggested delay before retry (ms), if shouldRetry is true */
  retryDelayMs?: number;

  /** Log level appropriate for this error type */
  logLevel: 'error' | 'warn' | 'info';
}

/**
 * Interface for PersistenceErrorAnalyzer.
 * Stateless service that categorizes persistence errors.
 */
export interface IPersistenceErrorAnalyzer {
  /**
   * Analyze an error and return categorized causes.
   * @param error - The error to analyze (Error object or string)
   * @returns Array of cause strings with category prefixes
   */
  analyze(error: unknown): string[];

  /**
   * Get detailed analysis including retry recommendations.
   * @param error - The error to analyze
   * @returns Full error analysis with retry logic
   */
  getDetailedAnalysis(error: unknown): ErrorAnalysis;
}

// === PersistenceCoordinator Types ===

/**
 * Result of a successful persistence operation.
 * Contains the sequence number for ordering and the event ID for correlation.
 */
export interface PersistedEvent {
  eventId: string;
  sequenceNumber: number;
  timestamp: string;
  jobId?: string;  // BullMQ job ID for awaiting persistence
}

/**
 * Result of persisting a user message.
 * Extends PersistedEvent with messageId for event emission.
 */
export interface UserMessagePersistedEvent extends PersistedEvent {
  messageId: string;
}

/**
 * Data for persisting an agent message.
 */
export interface AgentMessageData {
  messageId: string;
  content: string;
  stopReason: string;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
  };
  model?: string;
  /** Agent ID for per-message attribution (PRD-070) */
  agentId?: string;
}

/**
 * Data for persisting thinking content.
 */
export interface ThinkingData {
  messageId: string;
  content: string;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
  };
  /** Agent ID for per-message attribution (PRD-070) */
  agentId?: string;
}

/**
 * Data for persisting tool use request.
 */
export interface ToolUseData {
  toolUseId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
}

/**
 * Data for persisting tool result.
 */
export interface ToolResultData {
  toolUseId: string;
  toolOutput: string;
  isError: boolean;
  errorMessage?: string;
}

/**
 * Data for persisting error events.
 */
export interface ErrorData {
  error: string;
  code: string;
  details?: Record<string, unknown>;
}

/**
 * Tool execution data for async batch persistence.
 */
export interface ToolExecution {
  toolUseId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  toolOutput: string;
  success: boolean;
  error?: string;
  timestamp: string;
  /**
   * Pre-allocated sequence number for tool_use_requested event.
   * When provided, uses appendEventWithSequence instead of appendEvent.
   */
  preAllocatedToolUseSeq?: number;
  /**
   * Pre-allocated sequence number for tool_use_completed event.
   * When provided, uses appendEventWithSequence instead of appendEvent.
   */
  preAllocatedToolResultSeq?: number;
  /** Agent ID that executed this tool (for per-message attribution) */
  agentId?: string;
  /** Whether this is an internal infrastructure tool (audit-only, not user-visible) */
  isInternal?: boolean;
}

/**
 * Options for persisting a user message.
 */
export interface PersistUserMessageOptions {
  /**
   * Chat attachment IDs to link to this message.
   * These are ephemeral attachments uploaded via /api/chat/attachments.
   */
  chatAttachmentIds?: string[];
}

/**
 * Interface for PersistenceCoordinator.
 * Coordinates EventStore + MessageQueue for unified persistence.
 */
export interface IPersistenceCoordinator {
  /**
   * Persist a user message to the event store.
   * @param sessionId - Session ID
   * @param content - Message content
   * @param options - Optional settings including chat attachment IDs
   * @returns Persisted event with sequence number and messageId
   */
  persistUserMessage(
    sessionId: string,
    content: string,
    options?: PersistUserMessageOptions
  ): Promise<UserMessagePersistedEvent>;

  /**
   * Persist an agent message with full metadata.
   * @param sessionId - Session ID
   * @param data - Agent message data
   * @param preAllocatedSeq - Pre-allocated sequence number (uses appendEventWithSequence if provided)
   * @returns Persisted event with sequence number
   */
  persistAgentMessage(
    sessionId: string,
    data: AgentMessageData,
    preAllocatedSeq?: number
  ): Promise<PersistedEvent>;

  /**
   * Persist thinking content.
   * @param sessionId - Session ID
   * @param data - Thinking data
   * @param preAllocatedSeq - Pre-allocated sequence number (uses appendEventWithSequence if provided)
   * @returns Persisted event with sequence number
   */
  persistThinking(
    sessionId: string,
    data: ThinkingData,
    preAllocatedSeq?: number
  ): Promise<PersistedEvent>;

  /**
   * Persist tool use request.
   * @param sessionId - Session ID
   * @param data - Tool use data
   * @returns Persisted event with sequence number
   */
  persistToolUse(sessionId: string, data: ToolUseData): Promise<PersistedEvent>;

  /**
   * Persist tool result.
   * @param sessionId - Session ID
   * @param data - Tool result data
   * @returns Persisted event with sequence number
   */
  persistToolResult(sessionId: string, data: ToolResultData): Promise<PersistedEvent>;

  /**
   * Persist error event.
   * @param sessionId - Session ID
   * @param data - Error data
   * @returns Persisted event with sequence number
   */
  persistError(sessionId: string, data: ErrorData): Promise<PersistedEvent>;

  /**
   * Persist tool executions asynchronously (fire-and-forget).
   * Does not block - persists in background.
   * @param sessionId - Session ID
   * @param executions - Array of tool executions
   */
  persistToolEventsAsync(sessionId: string, executions: ToolExecution[]): void;

  /**
   * Persist citations asynchronously (fire-and-forget).
   * Does not block - persists RAG citations in background.
   * @param sessionId - Session ID
   * @param messageId - Message ID to associate citations with
   * @param citations - Array of cited files from RAG tool results
   */
  persistCitationsAsync(
    sessionId: string,
    messageId: string,
    citations: Array<{
      fileName: string;
      fileId: string | null;
      sourceType: string;
      mimeType: string;
      relevanceScore: number;
      isImage: boolean;
    }>
  ): void;

  /**
   * Persist an agent_changed transition event for audit trail.
   * Fire-and-forget: reserves sequence, appends to EventStore, queues DB write.
   * @param sessionId - Session ID
   * @param data - Agent transition data
   */
  persistAgentChangedAsync(sessionId: string, data: {
    eventId: string;
    previousAgentId?: string;
    currentAgentId: string;
    handoffType: string;
    timestamp: string;
  }): void;

  /**
   * Persist message-to-chat-attachment links asynchronously (fire-and-forget).
   * Does not block - creates junction table entries in background.
   * @param messageId - Message ID to link attachments to
   * @param chatAttachmentIds - Array of chat attachment IDs to link
   */
  persistMessageChatAttachmentsAsync(messageId: string, chatAttachmentIds: string[]): void;

  /**
   * Await completion of a persistence job.
   * @param jobId - BullMQ job ID from persist* methods
   * @param timeoutMs - Max wait time (default 30000ms)
   */
  awaitPersistence(jobId: string, timeoutMs?: number): Promise<void>;

  /**
   * Get the number of messages in the LangGraph checkpoint at the end of the last turn.
   * Used by ExecutionPipeline to skip historical messages during normalization.
   * @param sessionId - Session ID
   * @returns Number of messages in the checkpoint (0 for first turn)
   */
  getCheckpointMessageCount(sessionId: string): Promise<number>;

  /**
   * Update the checkpoint message count after successful normalization.
   * Stores the total state.messages.length so the next turn knows what to skip.
   * @param sessionId - Session ID
   * @param count - Total message count in the LangGraph state after this turn
   */
  updateCheckpointMessageCount(sessionId: string, count: number): Promise<void>;
}
