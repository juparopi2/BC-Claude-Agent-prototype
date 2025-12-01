/**
 * Token Usage Service
 *
 * Tracks and persists token usage for billing analytics.
 * Captures per-request token counts, cache usage, and Extended Thinking patterns.
 *
 * @module services/token-usage/TokenUsageService
 */

import { executeQuery } from '@/config/database';
import { createChildLogger } from '@/utils/logger';

const logger = createChildLogger({ service: 'TokenUsageService' });

/**
 * Token usage record to persist
 */
export interface TokenUsageRecord {
  userId: string;
  sessionId: string;
  messageId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  thinkingEnabled: boolean;
  thinkingBudget?: number;
  serviceTier?: 'standard' | 'priority' | 'batch';
}

/**
 * User token totals from view
 */
export interface UserTokenTotals {
  userId: string;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  thinkingRequests: number;
  firstRequest: Date;
  lastRequest: Date;
}

/**
 * Session token totals from view
 */
export interface SessionTokenTotals {
  sessionId: string;
  userId: string;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  sessionStart: Date;
  sessionLastActivity: Date;
}

/**
 * Monthly usage by model
 */
export interface MonthlyUsageByModel {
  model: string;
  year: number;
  month: number;
  totalTokens: number;
  requests: number;
}

/**
 * Token Usage Service - Singleton
 */
class TokenUsageService {
  private static instance: TokenUsageService | null = null;

  private constructor() {
    logger.info('TokenUsageService initialized');
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): TokenUsageService {
    if (!TokenUsageService.instance) {
      TokenUsageService.instance = new TokenUsageService();
    }
    return TokenUsageService.instance;
  }

  /**
   * Record token usage for a request
   *
   * @param record - Token usage data to persist
   */
  public async recordUsage(record: TokenUsageRecord): Promise<void> {
    try {
      await executeQuery(
        `
        INSERT INTO token_usage (
          user_id,
          session_id,
          message_id,
          model,
          input_tokens,
          output_tokens,
          cache_creation_input_tokens,
          cache_read_input_tokens,
          thinking_enabled,
          thinking_budget,
          service_tier,
          request_timestamp
        ) VALUES (
          @user_id,
          @session_id,
          @message_id,
          @model,
          @input_tokens,
          @output_tokens,
          @cache_creation_input_tokens,
          @cache_read_input_tokens,
          @thinking_enabled,
          @thinking_budget,
          @service_tier,
          GETUTCDATE()
        )
        `,
        {
          user_id: record.userId,
          session_id: record.sessionId,
          message_id: record.messageId,
          model: record.model,
          input_tokens: record.inputTokens,
          output_tokens: record.outputTokens,
          cache_creation_input_tokens: record.cacheCreationInputTokens ?? null,
          cache_read_input_tokens: record.cacheReadInputTokens ?? null,
          thinking_enabled: record.thinkingEnabled ? 1 : 0,
          thinking_budget: record.thinkingBudget ?? null,
          service_tier: record.serviceTier ?? null,
        }
      );

      logger.debug('Token usage recorded', {
        userId: record.userId,
        sessionId: record.sessionId,
        messageId: record.messageId,
        inputTokens: record.inputTokens,
        outputTokens: record.outputTokens,
        model: record.model,
      });
    } catch (error) {
      logger.error('Failed to record token usage', {
        error,
        record,
      });
      // Don't throw - token tracking should not break the main flow
    }
  }

  /**
   * Get token totals for a user
   *
   * @param userId - User ID
   * @returns User token totals or null if not found
   */
  public async getUserTotals(userId: string): Promise<UserTokenTotals | null> {
    const result = await executeQuery<{
      user_id: string;
      total_requests: number;
      total_input_tokens: number;
      total_output_tokens: number;
      total_tokens: number;
      total_cache_creation_tokens: number;
      total_cache_read_tokens: number;
      thinking_requests: number;
      first_request: Date;
      last_request: Date;
    }>(
      `SELECT * FROM vw_user_token_totals WHERE user_id = @user_id`,
      { user_id: userId }
    );

    const row = result.recordset[0];
    if (!row) {
      return null;
    }

    return {
      userId: row.user_id,
      totalRequests: row.total_requests,
      totalInputTokens: row.total_input_tokens,
      totalOutputTokens: row.total_output_tokens,
      totalTokens: row.total_tokens,
      totalCacheCreationTokens: row.total_cache_creation_tokens,
      totalCacheReadTokens: row.total_cache_read_tokens,
      thinkingRequests: row.thinking_requests,
      firstRequest: row.first_request,
      lastRequest: row.last_request,
    };
  }

  /**
   * Get token totals for a session
   *
   * @param sessionId - Session ID
   * @returns Session token totals or null if not found
   */
  public async getSessionTotals(sessionId: string): Promise<SessionTokenTotals | null> {
    const result = await executeQuery<{
      session_id: string;
      user_id: string;
      total_requests: number;
      total_input_tokens: number;
      total_output_tokens: number;
      total_tokens: number;
      total_cache_creation_tokens: number;
      total_cache_read_tokens: number;
      session_start: Date;
      session_last_activity: Date;
    }>(
      `SELECT * FROM vw_session_token_totals WHERE session_id = @session_id`,
      { session_id: sessionId }
    );

    const row = result.recordset[0];
    if (!row) {
      return null;
    }

    return {
      sessionId: row.session_id,
      userId: row.user_id,
      totalRequests: row.total_requests,
      totalInputTokens: row.total_input_tokens,
      totalOutputTokens: row.total_output_tokens,
      totalTokens: row.total_tokens,
      totalCacheCreationTokens: row.total_cache_creation_tokens,
      totalCacheReadTokens: row.total_cache_read_tokens,
      sessionStart: row.session_start,
      sessionLastActivity: row.session_last_activity,
    };
  }

  /**
   * Get monthly usage breakdown by model for a user
   *
   * @param userId - User ID
   * @param months - Number of months to look back (default: 12)
   * @returns Array of monthly usage by model
   */
  public async getMonthlyUsageByModel(
    userId: string,
    months: number = 12
  ): Promise<MonthlyUsageByModel[]> {
    const result = await executeQuery<{
      model: string;
      year: number;
      month: number;
      total_tokens: number;
      requests: number;
    }>(
      `
      SELECT
        model,
        DATEPART(YEAR, request_timestamp) as year,
        DATEPART(MONTH, request_timestamp) as month,
        SUM(input_tokens + output_tokens) as total_tokens,
        COUNT(*) as requests
      FROM token_usage
      WHERE user_id = @user_id
        AND request_timestamp >= DATEADD(MONTH, -@months, GETUTCDATE())
      GROUP BY model, DATEPART(YEAR, request_timestamp), DATEPART(MONTH, request_timestamp)
      ORDER BY year DESC, month DESC, model
      `,
      { user_id: userId, months }
    );

    return (result.recordset || []).map((row) => ({
      model: row.model,
      year: row.year,
      month: row.month,
      totalTokens: row.total_tokens,
      requests: row.requests,
    }));
  }

  /**
   * Get top sessions by token usage for a user
   *
   * @param userId - User ID
   * @param limit - Number of sessions to return (default: 10)
   * @returns Array of session totals ordered by total tokens descending
   */
  public async getTopSessionsByUsage(
    userId: string,
    limit: number = 10
  ): Promise<SessionTokenTotals[]> {
    const result = await executeQuery<{
      session_id: string;
      user_id: string;
      total_requests: number;
      total_input_tokens: number;
      total_output_tokens: number;
      total_tokens: number;
      total_cache_creation_tokens: number;
      total_cache_read_tokens: number;
      session_start: Date;
      session_last_activity: Date;
    }>(
      `
      SELECT TOP (@limit) *
      FROM vw_session_token_totals
      WHERE user_id = @user_id
      ORDER BY total_tokens DESC
      `,
      { user_id: userId, limit }
    );

    return (result.recordset || []).map((row) => ({
      sessionId: row.session_id,
      userId: row.user_id,
      totalRequests: row.total_requests,
      totalInputTokens: row.total_input_tokens,
      totalOutputTokens: row.total_output_tokens,
      totalTokens: row.total_tokens,
      totalCacheCreationTokens: row.total_cache_creation_tokens,
      totalCacheReadTokens: row.total_cache_read_tokens,
      sessionStart: row.session_start,
      sessionLastActivity: row.session_last_activity,
    }));
  }

  /**
   * Get cache efficiency stats for a user
   * Shows how much the user is benefiting from prompt caching
   *
   * @param userId - User ID
   * @returns Cache efficiency metrics
   */
  public async getCacheEfficiency(userId: string): Promise<{
    totalInputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    cacheHitRate: number;
    estimatedSavings: number;
  }> {
    const result = await executeQuery<{
      total_input_tokens: number;
      cache_read_tokens: number;
      cache_creation_tokens: number;
    }>(
      `
      SELECT
        SUM(input_tokens) as total_input_tokens,
        SUM(ISNULL(cache_read_input_tokens, 0)) as cache_read_tokens,
        SUM(ISNULL(cache_creation_input_tokens, 0)) as cache_creation_tokens
      FROM token_usage
      WHERE user_id = @user_id
      `,
      { user_id: userId }
    );

    const row = result.recordset[0];
    const totalInputTokens = row?.total_input_tokens ?? 0;
    const cacheReadTokens = row?.cache_read_tokens ?? 0;
    const cacheCreationTokens = row?.cache_creation_tokens ?? 0;

    // Cache hit rate = cache_read_tokens / (total_input_tokens + cache_creation_tokens)
    const totalProcessed = totalInputTokens + cacheCreationTokens;
    const cacheHitRate = totalProcessed > 0 ? cacheReadTokens / totalProcessed : 0;

    // Estimated savings: cache reads are ~90% cheaper
    // So savings = cache_read_tokens * 0.9 (in terms of tokens saved)
    const estimatedSavings = cacheReadTokens * 0.9;

    return {
      totalInputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      cacheHitRate,
      estimatedSavings,
    };
  }
}

/**
 * Get singleton instance
 */
export function getTokenUsageService(): TokenUsageService {
  return TokenUsageService.getInstance();
}

export { TokenUsageService };
