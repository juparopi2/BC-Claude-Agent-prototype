/**
 * Usage Tracking Service
 *
 * Responsible for tracking individual usage events in a fire-and-forget manner.
 * This service implements Phase 1.5: Usage Tracking & Billing System.
 *
 * Key Features:
 * - Fire-and-forget async tracking (never blocks user operations)
 * - Atomic Redis counter increments
 * - Append-only SQL event log (usage_events table)
 * - Cost calculation using pricing configuration
 * - Comprehensive error handling (logs but never throws)
 *
 * Architecture Pattern:
 * - Singleton + Dependency Injection (like DirectAgentService)
 * - Constructor accepts optional DB pool and Redis client for testing
 * - Singleton getter function: getUsageTrackingService()
 *
 * Error Handling:
 * - All methods wrapped in try-catch
 * - Errors logged but NEVER thrown (prevents blocking user operations)
 * - Failed tracking events are logged for manual reconciliation
 *
 * @module services/tracking/UsageTrackingService
 */

import type { ConnectionPool } from 'mssql';
import type { Redis } from 'ioredis';
import { getPool } from '@config/database';
import { getRedis } from '@config/redis';
import { UNIT_COSTS, calculateTokenCost } from '@config/pricing.config';
import type { OperationCategory } from '@/types/usage.types';
import { createChildLogger } from '@/utils/logger';
import type { Logger } from 'pino';

/**
 * Usage Tracking Service
 *
 * Implements fire-and-forget usage tracking with atomic counters and
 * append-only event logging.
 */
export class UsageTrackingService {
  private pool: ConnectionPool | null;
  private redis: Redis | null;
  private logger: Logger;

  /**
   * Create UsageTrackingService instance
   *
   * @param pool - Optional database pool (for dependency injection in tests)
   * @param redis - Optional Redis client (for dependency injection in tests)
   */
  constructor(pool?: ConnectionPool, redis?: Redis) {
    // Use dependency injection for testability
    // If no pool/redis provided, use singletons (may be null if not initialized)
    this.pool = pool || null;
    this.redis = redis || null;

    // Try to get singletons if not provided
    if (!this.pool) {
      try {
        this.pool = getPool();
      } catch {
        // Pool not initialized - will be set to null
        // Methods will check and handle gracefully
      }
    }

    if (!this.redis) {
      this.redis = getRedis();
    }

    // Initialize child logger with service context
    this.logger = createChildLogger({ service: 'UsageTrackingService' });
  }

  /**
   * Track file upload event
   *
   * Records file upload to storage with size in bytes.
   * Cost calculated based on storage pricing.
   *
   * @param userId - User ID
   * @param fileId - File ID
   * @param sizeBytes - File size in bytes
   * @param metadata - Optional metadata (file_name, mime_type, etc.)
   *
   * @example
   * ```typescript
   * await trackFileUpload(
   *   '123e4567-e89b-12d3-a456-426614174000',
   *   '987fcdeb-51a2-43d7-8765-ba9876543210',
   *   1048576, // 1MB
   *   { file_name: 'document.pdf', mime_type: 'application/pdf' }
   * );
   * ```
   */
  async trackFileUpload(
    userId: string,
    fileId: string,
    sizeBytes: number,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    try {
      // Calculate storage cost
      const cost = sizeBytes * UNIT_COSTS.storage_per_byte;

      // Log event
      this.logger.info({
        userId,
        fileId,
        sizeBytes,
        cost,
        metadata,
      }, 'Tracking file upload');

      // Insert into database
      await this.insertUsageEvent(
        userId,
        fileId, // Use fileId as session_id for file operations
        'storage',
        'file_upload',
        sizeBytes,
        'bytes',
        cost,
        metadata
      );

      // Increment Redis counters
      await this.incrementRedisCounter(userId, 'storage_bytes', sizeBytes);

    } catch (error) {
      // Log error but NEVER throw (fire-and-forget)
      this.logger.error({
        error: error instanceof Error ? error.message : String(error),
        userId,
        fileId,
        sizeBytes,
      }, 'Failed to track file upload (non-blocking)');
    }
  }

  /**
   * Track Claude API usage (input and output tokens)
   *
   * Records token consumption with cost calculation.
   * Supports cache tokens for prompt caching billing.
   *
   * @param userId - User ID
   * @param sessionId - Session ID
   * @param inputTokens - Input tokens consumed
   * @param outputTokens - Output tokens consumed
   * @param model - Claude model used (e.g., "claude-sonnet-4-5-20250929")
   * @param metadata - Optional metadata (message_id, tool_calls, thinking_enabled, etc.)
   *
   * @example
   * ```typescript
   * await trackClaudeUsage(
   *   '123e4567-e89b-12d3-a456-426614174000',
   *   '987fcdeb-51a2-43d7-8765-ba9876543210',
   *   506000, // 506K input tokens
   *   81000,  // 81K output tokens
   *   'claude-sonnet-4-5-20250929',
   *   { message_id: 'msg_01ABC...', cache_read_tokens: 100000 }
   * );
   * ```
   */
  async trackClaudeUsage(
    userId: string,
    sessionId: string,
    inputTokens: number,
    outputTokens: number,
    model: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    try {
      // Extract cache tokens from metadata if present
      const cacheWriteTokens = (metadata?.cache_write_tokens as number) || 0;
      const cacheReadTokens = (metadata?.cache_read_tokens as number) || 0;

      // Calculate token cost using pricing config
      const cost = calculateTokenCost(
        inputTokens,
        outputTokens,
        cacheWriteTokens,
        cacheReadTokens
      );

      const totalTokens = inputTokens + outputTokens;

      // Log event
      this.logger.info({
        userId,
        sessionId,
        inputTokens,
        outputTokens,
        totalTokens,
        cost,
        model,
        metadata,
      }, 'Tracking Claude usage');

      // Insert input tokens event
      await this.insertUsageEvent(
        userId,
        sessionId,
        'ai',
        'claude_input_tokens',
        inputTokens,
        'tokens',
        inputTokens * UNIT_COSTS.claude_input_token,
        { ...metadata, model, token_type: 'input' }
      );

      // Insert output tokens event
      await this.insertUsageEvent(
        userId,
        sessionId,
        'ai',
        'claude_output_tokens',
        outputTokens,
        'tokens',
        outputTokens * UNIT_COSTS.claude_output_token,
        { ...metadata, model, token_type: 'output' }
      );

      // Insert cache write tokens if present
      if (cacheWriteTokens > 0) {
        await this.insertUsageEvent(
          userId,
          sessionId,
          'ai',
          'cache_write_tokens',
          cacheWriteTokens,
          'tokens',
          cacheWriteTokens * UNIT_COSTS.cache_write_token,
          { ...metadata, model, token_type: 'cache_write' }
        );
      }

      // Insert cache read tokens if present
      if (cacheReadTokens > 0) {
        await this.insertUsageEvent(
          userId,
          sessionId,
          'ai',
          'cache_read_tokens',
          cacheReadTokens,
          'tokens',
          cacheReadTokens * UNIT_COSTS.cache_read_token,
          { ...metadata, model, token_type: 'cache_read' }
        );
      }

      // Increment Redis counters
      await this.incrementRedisCounter(userId, 'ai_tokens', totalTokens);
      await this.incrementRedisCounter(userId, 'ai_calls', 1);

    } catch (error) {
      // Log error but NEVER throw (fire-and-forget)
      this.logger.error({
        error: error instanceof Error ? error.message : String(error),
        userId,
        sessionId,
        inputTokens,
        outputTokens,
        model,
      }, 'Failed to track Claude usage (non-blocking)');
    }
  }

  /**
   * Track tool execution event
   *
   * Records tool execution with duration in milliseconds.
   * Useful for performance monitoring and usage analytics.
   *
   * @param userId - User ID
   * @param sessionId - Session ID
   * @param toolName - Tool name (e.g., "list_all_entities")
   * @param durationMs - Execution duration in milliseconds
   * @param metadata - Optional metadata (tool_args, result_size, success, etc.)
   *
   * @example
   * ```typescript
   * await trackToolExecution(
   *   '123e4567-e89b-12d3-a456-426614174000',
   *   '987fcdeb-51a2-43d7-8765-ba9876543210',
   *   'list_all_entities',
   *   1234,
   *   { success: true, result_size: 500 }
   * );
   * ```
   */
  async trackToolExecution(
    userId: string,
    sessionId: string,
    toolName: string,
    durationMs: number,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    try {
      // Tool execution has no direct cost (included in API call cost)
      const cost = 0;

      // Log event
      this.logger.info({
        userId,
        sessionId,
        toolName,
        durationMs,
        metadata,
      }, 'Tracking tool execution');

      // Insert into database
      await this.insertUsageEvent(
        userId,
        sessionId,
        'ai',
        'tool_executed',
        durationMs,
        'milliseconds',
        cost,
        { ...metadata, tool_name: toolName }
      );

      // Increment Redis counter for tool executions
      await this.incrementRedisCounter(userId, 'tool_calls', 1);

    } catch (error) {
      // Log error but NEVER throw (fire-and-forget)
      this.logger.error({
        error: error instanceof Error ? error.message : String(error),
        userId,
        sessionId,
        toolName,
        durationMs,
      }, 'Failed to track tool execution (non-blocking)');
    }
  }

  /**
   * Track text extraction event (Future implementation)
   *
   * Records OCR or text parsing from document.
   * Placeholder for Phase 2: Document Processing.
   *
   * @param userId - User ID
   * @param fileId - File ID
   * @param pagesCount - Number of pages processed
   * @param metadata - Optional metadata (ocr_engine, confidence, etc.)
   */
  async trackTextExtraction(
    userId: string,
    fileId: string,
    pagesCount: number,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    try {
      // Future implementation - cost TBD
      const cost = 0;

      this.logger.info({
        userId,
        fileId,
        pagesCount,
        metadata,
      }, 'Tracking text extraction (stub)');

      await this.insertUsageEvent(
        userId,
        fileId,
        'processing',
        'text_extraction',
        pagesCount,
        'pages',
        cost,
        metadata
      );

    } catch (error) {
      this.logger.error({
        error: error instanceof Error ? error.message : String(error),
        userId,
        fileId,
        pagesCount,
      }, 'Failed to track text extraction (non-blocking)');
    }
  }

  /**
   * Track embedding generation event (Future implementation)
   *
   * Records vector embedding generation for search.
   * Placeholder for Phase 2: Semantic Search.
   *
   * @param userId - User ID
   * @param fileId - File ID
   * @param tokens - Number of tokens embedded
   * @param type - Embedding type ('text' or 'image')
   * @param metadata - Optional metadata (model, dimensions, etc.)
   */
  async trackEmbedding(
    userId: string,
    fileId: string,
    tokens: number,
    type: 'text' | 'image',
    metadata?: Record<string, unknown>
  ): Promise<void> {
    try {
      // Future implementation - cost TBD
      const cost = 0;

      this.logger.info({
        userId,
        fileId,
        tokens,
        type,
        metadata,
      }, 'Tracking embedding generation (stub)');

      await this.insertUsageEvent(
        userId,
        fileId,
        'embeddings',
        'embedding_generation',
        tokens,
        'tokens',
        cost,
        { ...metadata, embedding_type: type }
      );

    } catch (error) {
      this.logger.error({
        error: error instanceof Error ? error.message : String(error),
        userId,
        fileId,
        tokens,
        type,
      }, 'Failed to track embedding generation (non-blocking)');
    }
  }

  /**
   * Track vector search event (Future implementation)
   *
   * Records semantic search query execution.
   * Placeholder for Phase 2: Semantic Search.
   *
   * @param userId - User ID
   * @param queryTokens - Number of tokens in query
   * @param metadata - Optional metadata (results_count, search_type, etc.)
   */
  async trackVectorSearch(
    userId: string,
    queryTokens: number,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    try {
      // Future implementation - cost TBD
      const cost = 0;

      this.logger.info({
        userId,
        queryTokens,
        metadata,
      }, 'Tracking vector search (stub)');

      // Generate a session ID for search query
      const searchSessionId = `search_${Date.now()}`;

      await this.insertUsageEvent(
        userId,
        searchSessionId,
        'search',
        'semantic_search',
        queryTokens,
        'tokens',
        cost,
        metadata
      );

    } catch (error) {
      this.logger.error({
        error: error instanceof Error ? error.message : String(error),
        userId,
        queryTokens,
      }, 'Failed to track vector search (non-blocking)');
    }
  }

  /**
   * Insert usage event into database
   *
   * Private method that handles SQL insertion with parameterized queries.
   * Uses append-only pattern - never updates existing events.
   *
   * @param userId - User ID
   * @param sessionId - Session ID
   * @param category - Operation category
   * @param eventType - Specific event type
   * @param quantity - Resource quantity consumed
   * @param unit - Unit of measurement
   * @param cost - Calculated cost
   * @param metadata - Optional JSON metadata
   */
  private async insertUsageEvent(
    userId: string,
    sessionId: string,
    category: OperationCategory,
    eventType: string,
    quantity: number,
    unit: string,
    cost: number,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    try {
      if (!this.pool) {
        throw new Error('Database pool not initialized');
      }

      const query = `
        INSERT INTO usage_events (
          user_id,
          session_id,
          category,
          event_type,
          quantity,
          unit,
          cost,
          metadata,
          created_at
        )
        VALUES (
          @user_id,
          @session_id,
          @category,
          @event_type,
          @quantity,
          @unit,
          @cost,
          @metadata,
          GETUTCDATE()
        )
      `;

      const result = await this.pool
        .request()
        .input('user_id', userId)
        .input('session_id', sessionId)
        .input('category', category)
        .input('event_type', eventType)
        .input('quantity', quantity)
        .input('unit', unit)
        .input('cost', cost)
        .input('metadata', metadata ? JSON.stringify(metadata) : null)
        .query(query);

      this.logger.debug({
        userId,
        sessionId,
        category,
        eventType,
        quantity,
        unit,
        cost,
        rowsAffected: result.rowsAffected[0],
      }, 'Usage event inserted into database');

    } catch (error) {
      // Log error with full context for debugging
      this.logger.error({
        error: error instanceof Error ? error.message : String(error),
        userId,
        sessionId,
        category,
        eventType,
        quantity,
        unit,
        cost,
      }, 'Failed to insert usage event into database');

      // Re-throw to be caught by caller's try-catch
      throw error;
    }
  }

  /**
   * Increment Redis counter atomically
   *
   * Private method that uses INCR for atomic counter updates.
   * Key format: usage:counter:{userId}:{metric}:{period}
   *
   * @param userId - User ID
   * @param metric - Metric name (e.g., 'storage_bytes', 'ai_tokens')
   * @param amount - Amount to increment by (default: 1)
   */
  private async incrementRedisCounter(
    userId: string,
    metric: string,
    amount: number = 1
  ): Promise<void> {
    try {
      if (!this.redis) {
        throw new Error('Redis client not initialized');
      }

      // Key format: usage:counter:{userId}:{metric}:{period}
      const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
      const key = `usage:counter:${userId}:${metric}:${currentMonth}`;

      // Atomic increment
      const newValue = await this.redis.incrby(key, amount);

      this.logger.debug({
        userId,
        metric,
        amount,
        newValue,
        key,
      }, 'Redis counter incremented');

      // Set expiry if this is a new counter (TTL 90 days)
      if (newValue === amount) {
        await this.redis.expire(key, 90 * 24 * 60 * 60); // 90 days in seconds
      }

    } catch (error) {
      // Log error with full context for debugging
      this.logger.error({
        error: error instanceof Error ? error.message : String(error),
        userId,
        metric,
        amount,
      }, 'Failed to increment Redis counter');

      // Re-throw to be caught by caller's try-catch
      throw error;
    }
  }
}

// =====================================================================
// SINGLETON PATTERN
// =====================================================================

/**
 * Singleton instance (lazily initialized)
 */
let usageTrackingServiceInstance: UsageTrackingService | null = null;

/**
 * Get UsageTrackingService singleton instance
 *
 * Factory function that creates or returns the singleton instance.
 * Supports dependency injection for testing.
 *
 * @param pool - Optional database pool (for testing)
 * @param redis - Optional Redis client (for testing)
 * @returns UsageTrackingService instance
 *
 * @example
 * // Production usage
 * const service = getUsageTrackingService();
 * await service.trackClaudeUsage(...);
 *
 * @example
 * // Test usage with mocks
 * const mockPool = createMockPool();
 * const mockRedis = createMockRedis();
 * const service = getUsageTrackingService(mockPool, mockRedis);
 */
export function getUsageTrackingService(
  pool?: ConnectionPool,
  redis?: Redis
): UsageTrackingService {
  // If dependencies provided, always create new instance (for testing)
  if (pool || redis) {
    return new UsageTrackingService(pool, redis);
  }

  // Otherwise, use singleton
  if (!usageTrackingServiceInstance) {
    usageTrackingServiceInstance = new UsageTrackingService();
  }

  return usageTrackingServiceInstance;
}

/**
 * Reset UsageTrackingService singleton for testing
 *
 * @internal Only for tests - DO NOT use in production
 */
export function __resetUsageTrackingService(): void {
  usageTrackingServiceInstance = null;
}
