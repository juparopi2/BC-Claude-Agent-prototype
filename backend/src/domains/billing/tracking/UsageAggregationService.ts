/**
 * Usage Aggregation Service
 *
 * Responsible for aggregating usage data from usage_events into usage_aggregates
 * and managing quota alerts based on threshold percentages.
 *
 * Key Features:
 * - Hourly, daily, and monthly aggregation from usage_events
 * - MERGE-based upserts for idempotent aggregation
 * - Alert threshold checking (50%, 80%, 90%, 100%)
 * - WebSocket alert emission for real-time notifications
 * - Automatic quota reset for expired periods
 *
 * Architecture Pattern:
 * - Singleton + Dependency Injection (like UsageTrackingService)
 * - Constructor accepts optional DB pool and Redis client for testing
 * - Singleton getter function: getUsageAggregationService()
 *
 * Error Handling:
 * - All methods wrapped in try-catch
 * - Errors logged with full context
 * - Methods return affected row counts for verification
 *
 * @module services/tracking/UsageAggregationService
 */

import type { ConnectionPool } from 'mssql';
import sql from 'mssql';
import type { Redis } from 'ioredis';
import { getPool } from '@/infrastructure/database/database';
import { getRedis } from '@/infrastructure/redis/redis';
import type {
  QuotaType,
  UpsertAggregateParams,
  CreateAlertParams,
  OperationCategory,
  AlertThreshold,
  UserQuotasDbRow,
} from '@/types/usage.types';
import { ALERT_THRESHOLDS } from '@/types/usage.types';
import { createChildLogger } from '@/shared/utils/logger';
import type { Logger } from 'pino';

/**
 * Usage Aggregation Service
 *
 * Aggregates usage events into rollup tables and manages quota alerts.
 */
export class UsageAggregationService {
  private pool: ConnectionPool | null;
  private redis: Redis | null;
  private logger: Logger;

  /**
   * Create UsageAggregationService instance
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
    this.logger = createChildLogger({ service: 'UsageAggregationService' });
  }

  /**
   * Aggregate hourly usage data
   *
   * Aggregates usage_events for the specified hour into usage_aggregates.
   * If userId provided, only aggregates for that user. Otherwise, aggregates all users.
   *
   * @param hourStart - Start of the hour to aggregate (e.g., 2025-01-15 14:00:00)
   * @param userId - Optional user ID to aggregate (omit for all users)
   * @returns Number of aggregate records created/updated
   *
   * @example
   * ```typescript
   * // Aggregate last hour for all users
   * const lastHour = new Date();
   * lastHour.setMinutes(0, 0, 0);
   * lastHour.setHours(lastHour.getHours() - 1);
   * const count = await aggregateHourly(lastHour);
   * ```
   */
  async aggregateHourly(hourStart: Date, userId?: string): Promise<number> {
    try {
      if (!this.pool) {
        throw new Error('Database pool not initialized');
      }

      // Calculate hour end (hourStart + 1 hour)
      const hourEnd = new Date(hourStart);
      hourEnd.setHours(hourEnd.getHours() + 1);

      this.logger.info({
        hourStart: hourStart.toISOString(),
        hourEnd: hourEnd.toISOString(),
        userId,
      }, 'Aggregating hourly usage data');

      // Query aggregated data from usage_events
      const query = `
        SELECT
          user_id,
          COUNT(*) as total_events,
          SUM(CASE WHEN unit = 'tokens' THEN quantity ELSE 0 END) as total_tokens,
          COUNT(DISTINCT CASE WHEN category = 'ai' THEN id END) as total_api_calls,
          SUM(cost) as total_cost,
          category
        FROM usage_events
        WHERE created_at >= @periodStart
          AND created_at < @periodEnd
          AND (@userId IS NULL OR user_id = @userId)
        GROUP BY user_id, category
      `;

      const result = await this.pool
        .request()
        .input('periodStart', sql.DateTime2, hourStart)
        .input('periodEnd', sql.DateTime2, hourEnd)
        .input('userId', userId ? sql.UniqueIdentifier : sql.VarChar, userId || null)
        .query(query);

      // Group results by user_id to build category breakdown
      const userAggregates = new Map<string, {
        totalEvents: number;
        totalTokens: number;
        totalApiCalls: number;
        totalCost: number;
        categoryBreakdown: Record<OperationCategory, number>;
      }>();

      for (const row of result.recordset) {
        const uid = row.user_id as string;
        if (!userAggregates.has(uid)) {
          userAggregates.set(uid, {
            totalEvents: 0,
            totalTokens: 0,
            totalApiCalls: 0,
            totalCost: 0,
            categoryBreakdown: {
              storage: 0,
              processing: 0,
              embeddings: 0,
              search: 0,
              ai: 0,
            },
          });
        }

        const aggregate = userAggregates.get(uid)!;
        aggregate.totalEvents += Number(row.total_events);
        aggregate.totalTokens += Number(row.total_tokens);
        aggregate.totalApiCalls += Number(row.total_api_calls);
        aggregate.totalCost += Number(row.total_cost);
        aggregate.categoryBreakdown[row.category as OperationCategory] = Number(row.total_cost);
      }

      // Upsert aggregates for each user
      let upsertCount = 0;
      for (const [uid, aggregate] of userAggregates.entries()) {
        await this.upsertAggregate({
          userId: uid,
          periodType: 'hourly',
          periodStart: hourStart,
          totalEvents: aggregate.totalEvents,
          totalTokens: aggregate.totalTokens,
          totalApiCalls: aggregate.totalApiCalls,
          totalCost: aggregate.totalCost,
          categoryBreakdown: aggregate.categoryBreakdown,
        });
        upsertCount++;
      }

      this.logger.info({
        hourStart: hourStart.toISOString(),
        userId,
        upsertCount,
      }, 'Hourly aggregation completed');

      return upsertCount;

    } catch (error) {
      this.logger.error({
        error: error instanceof Error ? error.message : String(error),
        hourStart: hourStart.toISOString(),
        userId,
      }, 'Failed to aggregate hourly usage data');
      throw error;
    }
  }

  /**
   * Aggregate daily usage data
   *
   * Aggregates usage_events for the specified day into usage_aggregates.
   * If userId provided, only aggregates for that user. Otherwise, aggregates all users.
   *
   * @param dayStart - Start of the day to aggregate (e.g., 2025-01-15 00:00:00)
   * @param userId - Optional user ID to aggregate (omit for all users)
   * @returns Number of aggregate records created/updated
   *
   * @example
   * ```typescript
   * // Aggregate yesterday for all users
   * const yesterday = new Date();
   * yesterday.setDate(yesterday.getDate() - 1);
   * yesterday.setHours(0, 0, 0, 0);
   * const count = await aggregateDaily(yesterday);
   * ```
   */
  async aggregateDaily(dayStart: Date, userId?: string): Promise<number> {
    try {
      if (!this.pool) {
        throw new Error('Database pool not initialized');
      }

      // Calculate day end (dayStart + 1 day)
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);

      this.logger.info({
        dayStart: dayStart.toISOString(),
        dayEnd: dayEnd.toISOString(),
        userId,
      }, 'Aggregating daily usage data');

      // Query aggregated data from usage_events
      const query = `
        SELECT
          user_id,
          COUNT(*) as total_events,
          SUM(CASE WHEN unit = 'tokens' THEN quantity ELSE 0 END) as total_tokens,
          COUNT(DISTINCT CASE WHEN category = 'ai' THEN id END) as total_api_calls,
          SUM(cost) as total_cost,
          category
        FROM usage_events
        WHERE created_at >= @periodStart
          AND created_at < @periodEnd
          AND (@userId IS NULL OR user_id = @userId)
        GROUP BY user_id, category
      `;

      const result = await this.pool
        .request()
        .input('periodStart', sql.DateTime2, dayStart)
        .input('periodEnd', sql.DateTime2, dayEnd)
        .input('userId', userId ? sql.UniqueIdentifier : sql.VarChar, userId || null)
        .query(query);

      // Group results by user_id to build category breakdown
      const userAggregates = new Map<string, {
        totalEvents: number;
        totalTokens: number;
        totalApiCalls: number;
        totalCost: number;
        categoryBreakdown: Record<OperationCategory, number>;
      }>();

      for (const row of result.recordset) {
        const uid = row.user_id as string;
        if (!userAggregates.has(uid)) {
          userAggregates.set(uid, {
            totalEvents: 0,
            totalTokens: 0,
            totalApiCalls: 0,
            totalCost: 0,
            categoryBreakdown: {
              storage: 0,
              processing: 0,
              embeddings: 0,
              search: 0,
              ai: 0,
            },
          });
        }

        const aggregate = userAggregates.get(uid)!;
        aggregate.totalEvents += Number(row.total_events);
        aggregate.totalTokens += Number(row.total_tokens);
        aggregate.totalApiCalls += Number(row.total_api_calls);
        aggregate.totalCost += Number(row.total_cost);
        aggregate.categoryBreakdown[row.category as OperationCategory] = Number(row.total_cost);
      }

      // Upsert aggregates for each user
      let upsertCount = 0;
      for (const [uid, aggregate] of userAggregates.entries()) {
        await this.upsertAggregate({
          userId: uid,
          periodType: 'daily',
          periodStart: dayStart,
          totalEvents: aggregate.totalEvents,
          totalTokens: aggregate.totalTokens,
          totalApiCalls: aggregate.totalApiCalls,
          totalCost: aggregate.totalCost,
          categoryBreakdown: aggregate.categoryBreakdown,
        });
        upsertCount++;
      }

      this.logger.info({
        dayStart: dayStart.toISOString(),
        userId,
        upsertCount,
      }, 'Daily aggregation completed');

      return upsertCount;

    } catch (error) {
      this.logger.error({
        error: error instanceof Error ? error.message : String(error),
        dayStart: dayStart.toISOString(),
        userId,
      }, 'Failed to aggregate daily usage data');
      throw error;
    }
  }

  /**
   * Aggregate monthly usage data
   *
   * Aggregates usage_events for the specified month into usage_aggregates.
   * If userId provided, only aggregates for that user. Otherwise, aggregates all users.
   *
   * @param monthStart - Start of the month to aggregate (e.g., 2025-01-01 00:00:00)
   * @param userId - Optional user ID to aggregate (omit for all users)
   * @returns Number of aggregate records created/updated
   *
   * @example
   * ```typescript
   * // Aggregate last month for all users
   * const lastMonth = new Date();
   * lastMonth.setMonth(lastMonth.getMonth() - 1);
   * lastMonth.setDate(1);
   * lastMonth.setHours(0, 0, 0, 0);
   * const count = await aggregateMonthly(lastMonth);
   * ```
   */
  async aggregateMonthly(monthStart: Date, userId?: string): Promise<number> {
    try {
      if (!this.pool) {
        throw new Error('Database pool not initialized');
      }

      // Calculate month end (first day of next month)
      const monthEnd = new Date(monthStart);
      monthEnd.setMonth(monthEnd.getMonth() + 1);

      this.logger.info({
        monthStart: monthStart.toISOString(),
        monthEnd: monthEnd.toISOString(),
        userId,
      }, 'Aggregating monthly usage data');

      // Query aggregated data from usage_events
      const query = `
        SELECT
          user_id,
          COUNT(*) as total_events,
          SUM(CASE WHEN unit = 'tokens' THEN quantity ELSE 0 END) as total_tokens,
          COUNT(DISTINCT CASE WHEN category = 'ai' THEN id END) as total_api_calls,
          SUM(cost) as total_cost,
          category
        FROM usage_events
        WHERE created_at >= @periodStart
          AND created_at < @periodEnd
          AND (@userId IS NULL OR user_id = @userId)
        GROUP BY user_id, category
      `;

      const result = await this.pool
        .request()
        .input('periodStart', sql.DateTime2, monthStart)
        .input('periodEnd', sql.DateTime2, monthEnd)
        .input('userId', userId ? sql.UniqueIdentifier : sql.VarChar, userId || null)
        .query(query);

      // Group results by user_id to build category breakdown
      const userAggregates = new Map<string, {
        totalEvents: number;
        totalTokens: number;
        totalApiCalls: number;
        totalCost: number;
        categoryBreakdown: Record<OperationCategory, number>;
      }>();

      for (const row of result.recordset) {
        const uid = row.user_id as string;
        if (!userAggregates.has(uid)) {
          userAggregates.set(uid, {
            totalEvents: 0,
            totalTokens: 0,
            totalApiCalls: 0,
            totalCost: 0,
            categoryBreakdown: {
              storage: 0,
              processing: 0,
              embeddings: 0,
              search: 0,
              ai: 0,
            },
          });
        }

        const aggregate = userAggregates.get(uid)!;
        aggregate.totalEvents += Number(row.total_events);
        aggregate.totalTokens += Number(row.total_tokens);
        aggregate.totalApiCalls += Number(row.total_api_calls);
        aggregate.totalCost += Number(row.total_cost);
        aggregate.categoryBreakdown[row.category as OperationCategory] = Number(row.total_cost);
      }

      // Upsert aggregates for each user
      let upsertCount = 0;
      for (const [uid, aggregate] of userAggregates.entries()) {
        await this.upsertAggregate({
          userId: uid,
          periodType: 'monthly',
          periodStart: monthStart,
          totalEvents: aggregate.totalEvents,
          totalTokens: aggregate.totalTokens,
          totalApiCalls: aggregate.totalApiCalls,
          totalCost: aggregate.totalCost,
          categoryBreakdown: aggregate.categoryBreakdown,
        });
        upsertCount++;
      }

      this.logger.info({
        monthStart: monthStart.toISOString(),
        userId,
        upsertCount,
      }, 'Monthly aggregation completed');

      return upsertCount;

    } catch (error) {
      this.logger.error({
        error: error instanceof Error ? error.message : String(error),
        monthStart: monthStart.toISOString(),
        userId,
      }, 'Failed to aggregate monthly usage data');
      throw error;
    }
  }

  /**
   * Check alert thresholds for a user
   *
   * Checks if user has crossed any alert thresholds (50%, 80%, 90%, 100%)
   * for any quota type (tokens, api_calls, storage). Creates alerts and emits
   * WebSocket events for thresholds crossed.
   *
   * @param userId - User ID to check
   *
   * @example
   * ```typescript
   * // Check alerts after incrementing usage
   * await usageTrackingService.trackClaudeUsage(...);
   * await usageAggregationService.checkAlertThresholds(userId);
   * ```
   */
  async checkAlertThresholds(userId: string): Promise<void> {
    try {
      if (!this.pool) {
        throw new Error('Database pool not initialized');
      }

      this.logger.debug({ userId }, 'Checking alert thresholds');

      // Get user's quota limits and current usage
      const quotaQuery = `
        SELECT
          user_id,
          plan_tier,
          monthly_token_limit,
          current_token_usage,
          monthly_api_call_limit,
          current_api_call_usage,
          storage_limit_bytes,
          current_storage_usage,
          quota_reset_at
        FROM user_quotas
        WHERE user_id = @userId
      `;

      const quotaResult = await this.pool
        .request()
        .input('userId', sql.UniqueIdentifier, userId)
        .query(quotaQuery);

      if (quotaResult.recordset.length === 0) {
        this.logger.warn({ userId }, 'No quota record found for user');
        return;
      }

      const quota = quotaResult.recordset[0] as UserQuotasDbRow;

      // Check each quota type
      await this.checkQuotaType(userId, 'tokens', quota.current_token_usage, quota.monthly_token_limit, quota.quota_reset_at);
      await this.checkQuotaType(userId, 'api_calls', quota.current_api_call_usage, quota.monthly_api_call_limit, quota.quota_reset_at);
      await this.checkQuotaType(userId, 'storage', quota.current_storage_usage, quota.storage_limit_bytes, quota.quota_reset_at);

    } catch (error) {
      this.logger.error({
        error: error instanceof Error ? error.message : String(error),
        userId,
      }, 'Failed to check alert thresholds');
      // Don't throw - this is a non-critical operation
    }
  }

  /**
   * Reset expired quotas
   *
   * Resets quota usage counters for users whose quota_reset_at has passed.
   * Updates last_reset_at and quota_reset_at to next period.
   *
   * @returns Number of quota records reset
   *
   * @example
   * ```typescript
   * // Reset expired quotas (run daily via cron)
   * const count = await resetExpiredQuotas();
   * console.log(`Reset ${count} user quotas`);
   * ```
   */
  async resetExpiredQuotas(): Promise<number> {
    try {
      if (!this.pool) {
        throw new Error('Database pool not initialized');
      }

      this.logger.info({}, 'Resetting expired quotas');

      const query = `
        UPDATE user_quotas
        SET
          current_token_usage = 0,
          current_api_call_usage = 0,
          last_reset_at = GETUTCDATE(),
          quota_reset_at = DATEADD(MONTH, 1, quota_reset_at),
          updated_at = GETUTCDATE()
        OUTPUT inserted.user_id
        WHERE quota_reset_at <= GETUTCDATE()
      `;

      const result = await this.pool
        .request()
        .query(query);

      const resetCount = result.recordset.length;

      this.logger.info({
        resetCount,
        resetUserIds: result.recordset.map((r: { user_id: string }) => r.user_id),
      }, 'Expired quotas reset completed');

      return resetCount;

    } catch (error) {
      this.logger.error({
        error: error instanceof Error ? error.message : String(error),
      }, 'Failed to reset expired quotas');
      throw error;
    }
  }

  /**
   * Upsert usage aggregate
   *
   * Private method to insert or update usage_aggregates record using MERGE.
   * This ensures idempotent aggregation - running twice produces same result.
   *
   * @param params - Aggregate parameters
   */
  private async upsertAggregate(params: UpsertAggregateParams): Promise<void> {
    try {
      if (!this.pool) {
        throw new Error('Database pool not initialized');
      }

      const query = `
        MERGE INTO usage_aggregates AS target
        USING (SELECT @user_id as user_id, @period_type as period_type, @period_start as period_start) AS source
        ON target.user_id = source.user_id
           AND target.period_type = source.period_type
           AND target.period_start = source.period_start
        WHEN MATCHED THEN
          UPDATE SET
            total_events = @total_events,
            total_tokens = @total_tokens,
            total_api_calls = @total_api_calls,
            total_cost = @total_cost,
            category_breakdown = @category_breakdown,
            updated_at = GETUTCDATE()
        WHEN NOT MATCHED THEN
          INSERT (user_id, period_type, period_start, total_events, total_tokens, total_api_calls, total_cost, category_breakdown)
          VALUES (@user_id, @period_type, @period_start, @total_events, @total_tokens, @total_api_calls, @total_cost, @category_breakdown);
      `;

      await this.pool
        .request()
        .input('user_id', sql.UniqueIdentifier, params.userId)
        .input('period_type', sql.NVarChar(20), params.periodType)
        .input('period_start', sql.DateTime2, params.periodStart)
        .input('total_events', sql.BigInt, params.totalEvents)
        .input('total_tokens', sql.BigInt, params.totalTokens)
        .input('total_api_calls', sql.Int, params.totalApiCalls)
        .input('total_cost', sql.Decimal(18, 8), params.totalCost)
        .input('category_breakdown', sql.NVarChar(sql.MAX), JSON.stringify(params.categoryBreakdown))
        .query(query);

      this.logger.debug({
        userId: params.userId,
        periodType: params.periodType,
        periodStart: params.periodStart.toISOString(),
        totalEvents: params.totalEvents,
      }, 'Aggregate upserted');

    } catch (error) {
      this.logger.error({
        error: error instanceof Error ? error.message : String(error),
        params,
      }, 'Failed to upsert aggregate');
      throw error;
    }
  }

  /**
   * Check quota type for alert thresholds
   *
   * Private method to check if a specific quota type has crossed any thresholds.
   *
   * @param userId - User ID
   * @param quotaType - Quota type (tokens, api_calls, storage)
   * @param currentUsage - Current usage value
   * @param limit - Quota limit
   * @param periodStart - Period start (for checking if alert already sent this period)
   */
  private async checkQuotaType(
    userId: string,
    quotaType: QuotaType,
    currentUsage: number,
    limit: number,
    periodStart: Date
  ): Promise<void> {
    try {
      if (limit === 0) {
        return; // No limit set
      }

      const usagePercent = Math.round((currentUsage / limit) * 100);

      // Check thresholds in order
      for (const threshold of ALERT_THRESHOLDS) {
        if (usagePercent >= threshold) {
          // Check if alert already sent this period
          const alreadySent = await this.checkAlertAlreadySent(userId, quotaType, threshold, periodStart);
          if (!alreadySent) {
            // Create alert
            await this.createAlert({
              userId,
              quotaType,
              thresholdPercent: threshold,
              thresholdValue: currentUsage,
            });

            this.logger.info({
              userId,
              quotaType,
              threshold,
              currentUsage,
              limit,
              usagePercent,
            }, 'Alert threshold crossed');
          }
        }
      }

    } catch (error) {
      this.logger.error({
        error: error instanceof Error ? error.message : String(error),
        userId,
        quotaType,
        currentUsage,
        limit,
      }, 'Failed to check quota type threshold');
      // Don't throw - non-critical
    }
  }

  /**
   * Check if alert already sent this period
   *
   * Private method to prevent duplicate alerts in the same period.
   *
   * @param userId - User ID
   * @param quotaType - Quota type
   * @param threshold - Threshold percent
   * @param periodStart - Period start
   * @returns True if alert already sent
   */
  private async checkAlertAlreadySent(
    userId: string,
    quotaType: QuotaType,
    threshold: AlertThreshold,
    periodStart: Date
  ): Promise<boolean> {
    try {
      if (!this.pool) {
        throw new Error('Database pool not initialized');
      }

      const query = `
        SELECT TOP 1 1 FROM quota_alerts
        WHERE user_id = @userId
          AND quota_type = @quotaType
          AND threshold_percent = @threshold
          AND alerted_at >= @periodStart
      `;

      const result = await this.pool
        .request()
        .input('userId', sql.UniqueIdentifier, userId)
        .input('quotaType', sql.NVarChar(20), quotaType)
        .input('threshold', sql.Int, threshold)
        .input('periodStart', sql.DateTime2, periodStart)
        .query(query);

      return result.recordset.length > 0;

    } catch (error) {
      this.logger.error({
        error: error instanceof Error ? error.message : String(error),
        userId,
        quotaType,
        threshold,
      }, 'Failed to check if alert already sent');
      return false; // Assume not sent to avoid blocking alerts
    }
  }

  /**
   * Create quota alert
   *
   * Private method to insert alert record and emit WebSocket event.
   *
   * @param params - Alert parameters
   */
  private async createAlert(params: CreateAlertParams): Promise<void> {
    try {
      if (!this.pool) {
        throw new Error('Database pool not initialized');
      }

      // Insert alert record
      const query = `
        INSERT INTO quota_alerts (
          user_id,
          quota_type,
          threshold_percent,
          threshold_value,
          alerted_at
        )
        VALUES (
          @user_id,
          @quota_type,
          @threshold_percent,
          @threshold_value,
          GETUTCDATE()
        )
      `;

      await this.pool
        .request()
        .input('user_id', sql.UniqueIdentifier, params.userId)
        .input('quota_type', sql.NVarChar(20), params.quotaType)
        .input('threshold_percent', sql.Int, params.thresholdPercent)
        .input('threshold_value', sql.BigInt, params.thresholdValue)
        .query(query);

      this.logger.info({
        userId: params.userId,
        quotaType: params.quotaType,
        thresholdPercent: params.thresholdPercent,
        thresholdValue: params.thresholdValue,
      }, 'Alert created');

      // Emit WebSocket event
      await this.emitAlertEvent(params);

    } catch (error) {
      this.logger.error({
        error: error instanceof Error ? error.message : String(error),
        params,
      }, 'Failed to create alert');
      throw error;
    }
  }

  /**
   * Emit alert event via WebSocket
   *
   * Private method to notify user of alert via WebSocket.
   *
   * NOTE: WebSocket emission is currently not implemented because:
   * - There is no centralized SocketService in the codebase
   * - The io (Socket.IO) object is only accessible in server.ts
   * - Aggregation service runs as background jobs without socket context
   *
   * Future implementation options:
   * 1. Create a SocketService singleton that holds a reference to io
   * 2. Emit alerts via a separate notification queue (BullMQ)
   * 3. Poll for alerts from frontend via REST API
   *
   * For now, alerts are only stored in database (quota_alerts table).
   * Frontend can poll GET /api/usage/alerts to check for new alerts.
   *
   * @param params - Alert parameters
   */
  private async emitAlertEvent(params: CreateAlertParams): Promise<void> {
    // TODO: Implement WebSocket emission when SocketService is available
    // For now, alerts are only persisted to database
    this.logger.debug({
      userId: params.userId,
      quotaType: params.quotaType,
      thresholdPercent: params.thresholdPercent,
    }, 'Alert created (WebSocket emission not yet implemented)');
  }
}

// =====================================================================
// SINGLETON PATTERN
// =====================================================================

/**
 * Singleton instance (lazily initialized)
 */
let usageAggregationServiceInstance: UsageAggregationService | null = null;

/**
 * Get UsageAggregationService singleton instance
 *
 * Factory function that creates or returns the singleton instance.
 * Supports dependency injection for testing.
 *
 * @param pool - Optional database pool (for testing)
 * @param redis - Optional Redis client (for testing)
 * @returns UsageAggregationService instance
 *
 * @example
 * // Production usage
 * const service = getUsageAggregationService();
 * await service.aggregateHourly(new Date());
 *
 * @example
 * // Test usage with mocks
 * const mockPool = createMockPool();
 * const mockRedis = createMockRedis();
 * const service = getUsageAggregationService(mockPool, mockRedis);
 */
export function getUsageAggregationService(
  pool?: ConnectionPool,
  redis?: Redis
): UsageAggregationService {
  // If dependencies provided, always create new instance (for testing)
  if (pool || redis) {
    return new UsageAggregationService(pool, redis);
  }

  // Otherwise, use singleton
  if (!usageAggregationServiceInstance) {
    usageAggregationServiceInstance = new UsageAggregationService();
  }

  return usageAggregationServiceInstance;
}

/**
 * Reset UsageAggregationService singleton for testing
 *
 * @internal Only for tests - DO NOT use in production
 */
export function __resetUsageAggregationService(): void {
  usageAggregationServiceInstance = null;
}
