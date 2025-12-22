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
