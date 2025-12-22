/**
 * Quota Validator Service
 *
 * Validates requested usage against user quotas BEFORE executing expensive operations.
 * This service implements Phase 1.5: Usage Tracking & Billing System - Quota Validation.
 *
 * Key Features:
 * - Pre-validation of usage requests (non-blocking pattern)
 * - Redis counter fast path with database fallback
 * - PAYG (Pay As You Go) logic for enterprise users
 * - Structured result objects (never throws)
 * - Actionable error messages with upgrade URLs
 *
 * Architecture Pattern:
 * - Singleton + Dependency Injection (like UsageTrackingService)
 * - Constructor accepts optional DB pool and Redis client for testing
 * - Singleton getter function: getQuotaValidatorService()
 *
 * Validation Flow:
 * 1. Query Redis for current usage counter (fast path)
 * 2. If Redis fails, query database aggregates (fallback)
 * 3. Query user_quotas table for limits
 * 4. Check: currentUsage + requestedAmount <= limit
 * 5. If over limit and allow_overage = 1, allow with PAYG
 * 6. If over limit and no PAYG, return allowed: false with upgrade URL
 *
 * Error Handling:
 * - All methods return structured result objects
 * - NEVER throws exceptions (caller decides how to handle)
 * - Comprehensive logging for debugging
 *
 * @module services/tracking/QuotaValidatorService
 */

import type { ConnectionPool } from 'mssql';
import type { Redis } from 'ioredis';
import { getPool } from '@/infrastructure/database/database';
import { getRedis } from '@/infrastructure/redis/redis';
import type {
  QuotaValidationResult,
  UserQuotasDbRow,
  QuotaType,
} from '@/types/usage.types';
import { createChildLogger } from '@/shared/utils/logger';
import type { Logger } from 'pino';

/**
 * Quota status for a specific quota type
 *
 * Used by checkAllQuotas() to return status for each quota type.
 */
export interface QuotaStatus {
  /** Quota type (tokens, api_calls, storage) */
  quotaType: QuotaType;
  /** Current usage amount */
  currentUsage: number;
  /** Quota limit */
  limit: number;
  /** Percentage of quota used */
  percentageUsed: number;
  /** Remaining quota */
  remaining: number;
  /** Will requested amount exceed quota */
  willExceed: boolean;
}

/**
 * Result of canProceed check
 *
 * Simplified check for quick validation before operations.
 */
export interface CanProceedResult {
  /** Is operation allowed */
  allowed: boolean;
  /** Reason if not allowed */
  reason?: string;
  /** Is PAYG allowed (enterprise feature) */
  paygAllowed?: boolean;
}

/**
 * Quota Validator Service
 *
 * Validates usage requests against user quotas with Redis fast path
 * and database fallback.
 */
export class QuotaValidatorService {
  private pool: ConnectionPool | null;
  private redis: Redis | null;
  private logger: Logger;

  /**
   * Create QuotaValidatorService instance
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
    this.logger = createChildLogger({ service: 'QuotaValidatorService' });
  }

  /**
   * Validate quota for a requested operation
   *
   * Comprehensive validation that returns detailed result with usage stats,
   * PAYG availability, and upgrade URLs.
   *
   * @param userId - User ID
   * @param quotaType - Quota type (tokens, api_calls, storage)
   * @param requestedAmount - Amount to be consumed
   * @returns Validation result with detailed status
   *
   * @example
   * ```typescript
   * const result = await validator.validateQuota(
   *   '123e4567-e89b-12d3-a456-426614174000',
   *   'tokens',
   *   100000
   * );
   *
   * if (!result.allowed) {
   *   console.log(result.reason);
   *   console.log(`Upgrade at: ${result.upgradeUrl}`);
   * }
   * ```
   */
  async validateQuota(
    userId: string,
    quotaType: QuotaType,
    requestedAmount: number
  ): Promise<QuotaValidationResult> {
    try {
      this.logger.debug({
        userId,
        quotaType,
        requestedAmount,
      }, 'Validating quota');

      // Get current usage (Redis first, DB fallback)
      const currentUsage = await this.getCurrentUsage(userId, quotaType);

      // Get quota limits from database
      const quotaLimits = await this.getQuotaLimits(userId);

      if (!quotaLimits) {
        // User has no quota record - return error
        return {
          allowed: false,
          reason: 'User quota record not found. Please contact support.',
          currentUsage: 0,
          limit: 0,
          remaining: 0,
          usagePercent: 0,
          alertThreshold: null,
          overageAllowed: false,
        };
      }

      // Check trial expiration for free_trial users
      if (quotaLimits.plan_tier === 'free_trial') {
        const trialStatus = await this.checkTrialExpiration(quotaLimits);
        if (trialStatus.expired) {
          return {
            allowed: false,
            reason: trialStatus.reason,
            currentUsage: 0,
            limit: 0,
            remaining: 0,
            usagePercent: 0,
            alertThreshold: null,
            overageAllowed: false,
          };
        }
      }

      // Determine limit based on quota type
      const limit = this.getLimitForQuotaType(quotaLimits, quotaType);

      // Calculate remaining quota
      const remaining = Math.max(0, limit - currentUsage);

      // Calculate percentage used
      const usagePercent = limit > 0 ? Math.round((currentUsage / limit) * 100) : 0;

      // Check if requested amount would exceed limit
      const wouldExceed = currentUsage + requestedAmount > limit;

      if (!wouldExceed) {
        // Within quota - allow operation
        return {
          allowed: true,
          currentUsage,
          limit,
          remaining,
          usagePercent,
          alertThreshold: null,
          overageAllowed: quotaLimits.allow_overage,
        };
      }

      // Would exceed quota - check PAYG eligibility
      const overageAllowed = quotaLimits.allow_overage;

      if (overageAllowed) {
        // PAYG enabled - allow with overage charges
        this.logger.info({
          userId,
          quotaType,
          currentUsage,
          limit,
          requestedAmount,
          overage: currentUsage + requestedAmount - limit,
        }, 'Quota exceeded but PAYG enabled - allowing operation');

        return {
          allowed: true,
          reason: 'Quota exceeded but PAYG enabled. Overage charges will apply.',
          currentUsage,
          limit,
          remaining,
          usagePercent,
          alertThreshold: 100,
          overageAllowed: true,
        };
      }

      // Quota exceeded and no PAYG - deny operation
      this.logger.warn({
        userId,
        quotaType,
        currentUsage,
        limit,
        requestedAmount,
      }, 'Quota exceeded and PAYG not available - denying operation');

      return {
        allowed: false,
        reason: `${quotaType} quota exceeded. Current: ${currentUsage}, Limit: ${limit}, Requested: ${requestedAmount}. Please upgrade your plan.`,
        currentUsage,
        limit,
        remaining: 0,
        usagePercent: 100,
        alertThreshold: 100,
        overageAllowed: false,
      };

    } catch (error) {
      // Log error and return safe default (deny operation)
      this.logger.error({
        error: error instanceof Error ? error.message : String(error),
        userId,
        quotaType,
        requestedAmount,
      }, 'Failed to validate quota - denying operation as safe default');

      return {
        allowed: false,
        reason: 'Quota validation failed due to system error. Please try again.',
        currentUsage: 0,
        limit: 0,
        remaining: 0,
        usagePercent: 0,
        alertThreshold: null,
        overageAllowed: false,
      };
    }
  }

  /**
   * Quick check if operation can proceed
   *
   * Simplified validation for fast pre-checks before expensive operations.
   * Returns only allowed/reason without detailed stats.
   *
   * @param userId - User ID
   * @param quotaType - Quota type (tokens, api_calls, storage)
   * @param amount - Amount to be consumed
   * @returns Simple allowed/reason result
   *
   * @example
   * ```typescript
   * const { allowed, reason } = await validator.canProceed(
   *   '123e4567-e89b-12d3-a456-426614174000',
   *   'tokens',
   *   50000
   * );
   *
   * if (!allowed) {
   *   throw new Error(reason);
   * }
   * ```
   */
  async canProceed(
    userId: string,
    quotaType: QuotaType,
    amount: number
  ): Promise<CanProceedResult> {
    try {
      const result = await this.validateQuota(userId, quotaType, amount);

      return {
        allowed: result.allowed,
        reason: result.reason,
        paygAllowed: result.overageAllowed,
      };
    } catch (error) {
      this.logger.error({
        error: error instanceof Error ? error.message : String(error),
        userId,
        quotaType,
        amount,
      }, 'Failed to check if operation can proceed - denying as safe default');

      return {
        allowed: false,
        reason: 'System error during quota check. Please try again.',
        paygAllowed: false,
      };
    }
  }

  /**
   * Get current usage for a quota type
   *
   * Tries Redis counter first (fast path), falls back to database aggregates
   * if Redis unavailable.
   *
   * @param userId - User ID
   * @param quotaType - Quota type (tokens, api_calls, storage)
   * @returns Current usage amount
   */
  async getCurrentUsage(userId: string, quotaType: QuotaType): Promise<number> {
    try {
      // Try Redis counter first (fast path)
      if (this.redis) {
        const usage = await this.getUsageFromRedis(userId, quotaType);
        if (usage !== null) {
          return usage;
        }
      }

      // Fallback to database
      return await this.getUsageFromDatabase(userId, quotaType);

    } catch (error) {
      this.logger.error({
        error: error instanceof Error ? error.message : String(error),
        userId,
        quotaType,
      }, 'Failed to get current usage - returning 0 as safe default');

      return 0;
    }
  }

  /**
   * Get quota limits for a user
   *
   * Queries user_quotas table for limits and PAYG settings.
   *
   * @param userId - User ID
   * @returns User quota record or null if not found
   */
  async getQuotaLimits(userId: string): Promise<UserQuotasDbRow | null> {
    try {
      if (!this.pool) {
        throw new Error('Database pool not initialized');
      }

      const query = `
        SELECT
          user_id,
          plan_tier,
          monthly_token_limit,
          current_token_usage,
          monthly_api_call_limit,
          current_api_call_usage,
          storage_limit_bytes,
          current_storage_usage,
          quota_reset_at,
          last_reset_at,
          allow_overage,
          overage_rate,
          created_at,
          updated_at
        FROM user_quotas
        WHERE user_id = @user_id
      `;

      const result = await this.pool
        .request()
        .input('user_id', userId)
        .query<UserQuotasDbRow>(query);

      if (result.recordset.length === 0) {
        this.logger.warn({ userId }, 'User quota record not found');
        return null;
      }

      return result.recordset[0] ?? null;

    } catch (error) {
      this.logger.error({
        error: error instanceof Error ? error.message : String(error),
        userId,
      }, 'Failed to get quota limits from database');

      throw error;
    }
  }

  /**
   * Check all quota types for a user
   *
   * Returns status for all quota types (tokens, api_calls, storage).
   * Useful for dashboard displays and comprehensive quota checks.
   *
   * @param userId - User ID
   * @returns Array of quota statuses
   *
   * @example
   * ```typescript
   * const statuses = await validator.checkAllQuotas(
   *   '123e4567-e89b-12d3-a456-426614174000'
   * );
   *
   * statuses.forEach(status => {
   *   console.log(`${status.quotaType}: ${status.percentageUsed}% used`);
   * });
   * ```
   */
  async checkAllQuotas(userId: string): Promise<QuotaStatus[]> {
    try {
      const quotaTypes: QuotaType[] = ['tokens', 'api_calls', 'storage'];
      const statuses: QuotaStatus[] = [];

      // Get quota limits once
      const quotaLimits = await this.getQuotaLimits(userId);

      if (!quotaLimits) {
        this.logger.warn({ userId }, 'No quota limits found - returning empty status array');
        return [];
      }

      // Check each quota type
      for (const quotaType of quotaTypes) {
        const currentUsage = await this.getCurrentUsage(userId, quotaType);
        const limit = this.getLimitForQuotaType(quotaLimits, quotaType);
        const percentageUsed = limit > 0 ? Math.round((currentUsage / limit) * 100) : 0;
        const remaining = Math.max(0, limit - currentUsage);

        statuses.push({
          quotaType,
          currentUsage,
          limit,
          percentageUsed,
          remaining,
          willExceed: currentUsage >= limit,
        });
      }

      return statuses;

    } catch (error) {
      this.logger.error({
        error: error instanceof Error ? error.message : String(error),
        userId,
      }, 'Failed to check all quotas - returning empty array');

      return [];
    }
  }

  /**
   * Get usage from Redis counter (fast path)
   *
   * @param userId - User ID
   * @param quotaType - Quota type
   * @returns Usage amount or null if Redis unavailable
   */
  private async getUsageFromRedis(
    userId: string,
    quotaType: QuotaType
  ): Promise<number | null> {
    try {
      if (!this.redis) {
        return null;
      }

      // Key format: usage:counter:{userId}:{metric}:{period}
      const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
      const metric = this.quotaTypeToMetric(quotaType);
      const key = `usage:counter:${userId}:${metric}:${currentMonth}`;

      const value = await this.redis.get(key);

      if (value === null) {
        this.logger.debug({ userId, quotaType, key }, 'Redis counter not found - returning 0');
        return 0;
      }

      const usage = parseInt(value, 10);

      this.logger.debug({
        userId,
        quotaType,
        usage,
        key,
      }, 'Retrieved usage from Redis');

      return usage;

    } catch (error) {
      this.logger.warn({
        error: error instanceof Error ? error.message : String(error),
        userId,
        quotaType,
      }, 'Failed to get usage from Redis - will fallback to database');

      return null;
    }
  }

  /**
   * Get usage from database aggregates (fallback)
   *
   * @param userId - User ID
   * @param quotaType - Quota type
   * @returns Usage amount from database
   */
  private async getUsageFromDatabase(
    userId: string,
    quotaType: QuotaType
  ): Promise<number> {
    try {
      if (!this.pool) {
        throw new Error('Database pool not initialized');
      }

      // Query usage_aggregates table for current month
      const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
      const periodStart = `${currentMonth}-01`;

      const query = `
        SELECT
          total_tokens,
          total_api_calls
        FROM usage_aggregates
        WHERE user_id = @user_id
          AND period_type = 'monthly'
          AND period_start >= @period_start
        ORDER BY period_start DESC
      `;

      const result = await this.pool
        .request()
        .input('user_id', userId)
        .input('period_start', periodStart)
        .query<{
          total_tokens: number;
          total_api_calls: number;
        }>(query);

      if (result.recordset.length === 0) {
        this.logger.debug({ userId, quotaType }, 'No usage aggregates found - returning 0');
        return 0;
      }

      const aggregate = result.recordset[0];

      if (!aggregate) {
        this.logger.debug({ userId, quotaType }, 'No usage aggregate found - returning 0');
        return 0;
      }

      // Map quota type to aggregate field
      let usage = 0;
      if (quotaType === 'tokens') {
        usage = aggregate.total_tokens;
      } else if (quotaType === 'api_calls') {
        usage = aggregate.total_api_calls;
      }
      // Note: storage usage is tracked in user_quotas.current_storage_usage

      this.logger.debug({
        userId,
        quotaType,
        usage,
      }, 'Retrieved usage from database aggregates');

      return usage;

    } catch (error) {
      this.logger.error({
        error: error instanceof Error ? error.message : String(error),
        userId,
        quotaType,
      }, 'Failed to get usage from database - returning 0 as safe default');

      return 0;
    }
  }

  /**
   * Map quota type to Redis metric name
   *
   * @param quotaType - Quota type
   * @returns Redis metric name
   */
  private quotaTypeToMetric(quotaType: QuotaType): string {
    switch (quotaType) {
      case 'tokens':
        return 'ai_tokens';
      case 'api_calls':
        return 'ai_calls';
      case 'storage':
        return 'storage_bytes';
      default:
        return quotaType;
    }
  }

  /**
   * Get limit for specific quota type from quota record
   *
   * @param quotaLimits - User quota record
   * @param quotaType - Quota type
   * @returns Limit amount
   */
  private getLimitForQuotaType(
    quotaLimits: UserQuotasDbRow,
    quotaType: QuotaType
  ): number {
    switch (quotaType) {
      case 'tokens':
        return quotaLimits.monthly_token_limit;
      case 'api_calls':
        return quotaLimits.monthly_api_call_limit;
      case 'storage':
        return quotaLimits.storage_limit_bytes;
      default:
        return 0;
    }
  }

  /**
   * Check if free trial has expired
   *
   * Validates trial expiration for free_trial users. Returns detailed status
   * including expiration state and user-friendly messages.
   *
   * @param quotaLimits - User quota record with trial data
   * @returns Trial status with expiration check
   *
   * @example
   * ```typescript
   * const status = await validator.checkTrialExpiration(quotaLimits);
   * if (status.expired) {
   *   console.log(status.reason);  // "Your free trial has expired..."
   * }
   * ```
   */
  async checkTrialExpiration(
    quotaLimits: UserQuotasDbRow
  ): Promise<{
    expired: boolean;
    reason?: string;
    daysRemaining?: number;
    canExtend?: boolean;
  }> {
    try {
      // Check if trial expiry date is set
      if (!quotaLimits.trial_expires_at) {
        this.logger.warn({
          userId: quotaLimits.user_id,
          planTier: quotaLimits.plan_tier
        }, 'Free trial user has no expiration date set');

        return {
          expired: false,
          reason: 'Trial expiration date not set. Please contact support.',
          canExtend: false,
        };
      }

      // Parse expiration date
      const expiresAt = new Date(quotaLimits.trial_expires_at);
      const now = new Date();

      // Check if expired
      if (now > expiresAt) {
        const canExtend = quotaLimits.trial_extended === 0;

        this.logger.info({
          userId: quotaLimits.user_id,
          expiresAt,
          now,
          canExtend
        }, 'Free trial has expired');

        return {
          expired: true,
          reason: canExtend
            ? 'Your free trial has expired. You can extend it for one more month by providing feedback, or upgrade to a paid plan to continue using the service.'
            : 'Your free trial has expired. Please upgrade to a paid plan to continue using the service.',
          daysRemaining: 0,
          canExtend,
        };
      }

      // Trial still active - calculate days remaining
      const daysRemaining = Math.ceil(
        (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );

      this.logger.debug({
        userId: quotaLimits.user_id,
        expiresAt,
        daysRemaining
      }, 'Free trial is active');

      return {
        expired: false,
        daysRemaining,
        canExtend: quotaLimits.trial_extended === 0,
      };

    } catch (err) {
      this.logger.error({
        err,
        userId: quotaLimits.user_id
      }, 'Error checking trial expiration');

      // On error, allow operation (fail open)
      return {
        expired: false,
        reason: 'Error checking trial status',
        canExtend: false,
      };
    }
  }
}

// =====================================================================
// SINGLETON PATTERN
// =====================================================================

/**
 * Singleton instance (lazily initialized)
 */
let quotaValidatorServiceInstance: QuotaValidatorService | null = null;

/**
 * Get QuotaValidatorService singleton instance
 *
 * Factory function that creates or returns the singleton instance.
 * Supports dependency injection for testing.
 *
 * @param pool - Optional database pool (for testing)
 * @param redis - Optional Redis client (for testing)
 * @returns QuotaValidatorService instance
 *
 * @example
 * // Production usage
 * const validator = getQuotaValidatorService();
 * const result = await validator.validateQuota(...);
 *
 * @example
 * // Test usage with mocks
 * const mockPool = createMockPool();
 * const mockRedis = createMockRedis();
 * const validator = getQuotaValidatorService(mockPool, mockRedis);
 */
export function getQuotaValidatorService(
  pool?: ConnectionPool,
  redis?: Redis
): QuotaValidatorService {
  // If dependencies provided, always create new instance (for testing)
  if (pool || redis) {
    return new QuotaValidatorService(pool, redis);
  }

  // Otherwise, use singleton
  if (!quotaValidatorServiceInstance) {
    quotaValidatorServiceInstance = new QuotaValidatorService();
  }

  return quotaValidatorServiceInstance;
}

/**
 * Reset QuotaValidatorService singleton for testing
 *
 * @internal Only for tests - DO NOT use in production
 */
export function __resetQuotaValidatorService(): void {
  quotaValidatorServiceInstance = null;
}
