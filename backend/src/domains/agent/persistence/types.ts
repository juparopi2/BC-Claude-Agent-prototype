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
   * @returns Persisted event with sequence number and messageId
   */
  persistUserMessage(sessionId: string, content: string): Promise<UserMessagePersistedEvent>;

  /**
   * Persist an agent message with full metadata.
   * @param sessionId - Session ID
   * @param data - Agent message data
   * @returns Persisted event with sequence number
   */
  persistAgentMessage(sessionId: string, data: AgentMessageData): Promise<PersistedEvent>;

  /**
   * Persist thinking content.
   * @param sessionId - Session ID
   * @param data - Thinking data
   * @returns Persisted event with sequence number
   */
  persistThinking(sessionId: string, data: ThinkingData): Promise<PersistedEvent>;

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
   * Await completion of a persistence job.
   * @param jobId - BullMQ job ID from persist* methods
   * @param timeoutMs - Max wait time (default 30000ms)
   */
  awaitPersistence(jobId: string, timeoutMs?: number): Promise<void>;
}
