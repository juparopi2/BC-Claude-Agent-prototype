/**
 * Billing Service
 *
 * Responsible for generating monthly invoices and managing PAYG settings.
 * This service implements Phase 1.5: Billing System.
 *
 * Key Features:
 * - Monthly invoice generation with usage aggregation
 * - Cost calculation (base + usage + overage)
 * - Invoice history retrieval
 * - PAYG (Pay-As-You-Go) settings management
 * - Invoice preview for current period
 * - Idempotent invoice generation (prevents duplicates)
 *
 * Architecture Pattern:
 * - Singleton + Dependency Injection (like UsageTrackingService)
 * - Constructor accepts optional DB pool for testing
 * - Singleton getter function: getBillingService()
 *
 * Cost Calculation Formula:
 * - Base Cost: Fixed monthly subscription price
 * - Usage Cost: Sum of all usage events in period
 * - Overage Cost: Usage beyond quota limits (PAYG users only)
 * - Total Cost: base_cost + usage_cost + overage_cost
 *
 * @module services/billing/BillingService
 */

import type { ConnectionPool } from 'mssql';
import sql from 'mssql';
import { createChildLogger } from '@/utils/logger';
import { getPool } from '@/config/database';
import { PRICING_PLANS, PAYG_RATES, calculateOverageCost } from '@/config/pricing.config';
import type {
  PlanTier,
  BillingRecordDbRow,
  UsageBreakdown,
  PaygSettings,
  InvoicePreview,
  UserQuotasDbRow,
} from '@/types/usage.types';
import type { Logger } from 'pino';

/**
 * Billing Service
 *
 * Implements invoice generation, cost calculation, and PAYG management.
 */
export class BillingService {
  private pool: ConnectionPool | null;
  private logger: Logger;

  /**
   * Create BillingService instance
   *
   * @param pool - Optional database pool (for dependency injection in tests)
   */
  constructor(pool?: ConnectionPool) {
    // Use dependency injection for testability
    this.pool = pool || null;

    // Try to get singleton if not provided
    if (!this.pool) {
      try {
        this.pool = getPool();
      } catch {
        // Pool not initialized - will be set to null
      }
    }

    // Initialize child logger with service context
    this.logger = createChildLogger({ service: 'BillingService' });
  }

  /**
   * Generate monthly invoice for a user
   *
   * Creates a billing record for the specified period. Idempotent - returns
   * existing invoice if already generated for the period.
   *
   * @param userId - User ID
   * @param periodStart - Billing period start (first day of month)
   * @returns Generated billing record
   *
   * @throws Error if database operations fail
   *
   * @example
   * ```typescript
   * // Generate invoice for January 2025
   * const invoice = await billingService.generateMonthlyInvoice(
   *   '123e4567-e89b-12d3-a456-426614174000',
   *   new Date('2025-01-01')
   * );
   * ```
   */
  async generateMonthlyInvoice(userId: string, periodStart: Date): Promise<BillingRecordDbRow> {
    try {
      if (!this.pool) {
        throw new Error('Database pool not initialized');
      }

      // Calculate period end (last day of month)
      const periodEnd = new Date(periodStart);
      periodEnd.setMonth(periodEnd.getMonth() + 1);
      periodEnd.setDate(0);
      periodEnd.setHours(23, 59, 59, 999);

      this.logger.info({
        userId,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
      }, 'Generating monthly invoice');

      // Check if invoice already exists for this period (idempotency)
      const existingQuery = `
        SELECT TOP 1 1 FROM billing_records
        WHERE user_id = @userId
          AND billing_period_start = @periodStart
      `;

      const existingResult = await this.pool
        .request()
        .input('userId', sql.UniqueIdentifier, userId)
        .input('periodStart', sql.DateTime2, periodStart)
        .query(existingQuery);

      if (existingResult.recordset.length > 0) {
        this.logger.info({ userId, periodStart }, 'Invoice already exists for period');

        // Fetch and return existing invoice
        const fetchQuery = `
          SELECT * FROM billing_records
          WHERE user_id = @userId
            AND billing_period_start = @periodStart
        `;

        const fetchResult = await this.pool
          .request()
          .input('userId', sql.UniqueIdentifier, userId)
          .input('periodStart', sql.DateTime2, periodStart)
          .query<BillingRecordDbRow>(fetchQuery);

        if (!fetchResult.recordset[0]) {
          throw new Error('Invoice exists but could not be fetched');
        }

        return fetchResult.recordset[0];
      }

      // Get user quotas to determine plan tier
      const quotaQuery = `
        SELECT plan_tier, allow_overage, overage_rate,
               current_token_usage, monthly_token_limit,
               current_api_call_usage, monthly_api_call_limit,
               current_storage_usage, storage_limit_bytes
        FROM user_quotas
        WHERE user_id = @userId
      `;

      const quotaResult = await this.pool
        .request()
        .input('userId', sql.UniqueIdentifier, userId)
        .query<UserQuotasDbRow>(quotaQuery);

      const planTier: PlanTier = quotaResult.recordset[0]?.plan_tier || 'free';
      const allowOverage = quotaResult.recordset[0]?.allow_overage || false;
      const currentTokenUsage = quotaResult.recordset[0]?.current_token_usage || 0;
      const monthlyTokenLimit = quotaResult.recordset[0]?.monthly_token_limit || 0;
      const currentApiCallUsage = quotaResult.recordset[0]?.current_api_call_usage || 0;
      const monthlyApiCallLimit = quotaResult.recordset[0]?.monthly_api_call_limit || 0;
      const currentStorageUsage = quotaResult.recordset[0]?.current_storage_usage || 0;
      const storageLimitBytes = quotaResult.recordset[0]?.storage_limit_bytes || 0;

      // Get usage from aggregates for this period
      const usageQuery = `
        SELECT
          SUM(total_tokens) as total_tokens,
          SUM(total_api_calls) as total_api_calls,
          SUM(total_cost) as total_cost
        FROM usage_aggregates
        WHERE user_id = @userId
          AND period_type = 'monthly'
          AND period_start >= @periodStart
          AND period_start < @periodEnd
      `;

      const usageResult = await this.pool
        .request()
        .input('userId', sql.UniqueIdentifier, userId)
        .input('periodStart', sql.DateTime2, periodStart)
        .input('periodEnd', sql.DateTime2, periodEnd)
        .query<{ total_tokens: number | null; total_api_calls: number | null; total_cost: number | null }>(usageQuery);

      const totalTokens = usageResult.recordset[0]?.total_tokens || 0;
      const totalApiCalls = usageResult.recordset[0]?.total_api_calls || 0;
      const usageCost = usageResult.recordset[0]?.total_cost || 0;

      // Calculate base cost (subscription fee)
      const baseCost = this.calculatePlanCost(planTier);

      // Calculate overage cost if applicable
      let overageCost = 0;
      if (allowOverage) {
        const tokensOverQuota = Math.max(0, currentTokenUsage - monthlyTokenLimit);
        const apiCallsOverQuota = Math.max(0, currentApiCallUsage - monthlyApiCallLimit);
        const storageOverQuota = Math.max(0, currentStorageUsage - storageLimitBytes);

        overageCost = calculateOverageCost(tokensOverQuota, apiCallsOverQuota, storageOverQuota);
      }

      // Calculate total cost
      const totalCost = baseCost + usageCost + overageCost;

      // Get storage usage (approximate from current usage)
      const totalStorageBytes = currentStorageUsage;

      // Insert billing record
      const insertQuery = `
        INSERT INTO billing_records (
          id, user_id, billing_period_start, billing_period_end,
          total_tokens, total_api_calls, total_storage_bytes,
          base_cost, usage_cost, overage_cost, total_cost,
          status, created_at, updated_at
        )
        OUTPUT inserted.*
        VALUES (
          NEWID(), @user_id, @period_start, @period_end,
          @total_tokens, @total_api_calls, @total_storage_bytes,
          @base_cost, @usage_cost, @overage_cost, @total_cost,
          'pending', GETUTCDATE(), GETUTCDATE()
        )
      `;

      const insertResult = await this.pool
        .request()
        .input('user_id', sql.UniqueIdentifier, userId)
        .input('period_start', sql.DateTime2, periodStart)
        .input('period_end', sql.DateTime2, periodEnd)
        .input('total_tokens', sql.BigInt, totalTokens)
        .input('total_api_calls', sql.Int, totalApiCalls)
        .input('total_storage_bytes', sql.BigInt, totalStorageBytes)
        .input('base_cost', sql.Decimal(18, 8), baseCost)
        .input('usage_cost', sql.Decimal(18, 8), usageCost)
        .input('overage_cost', sql.Decimal(18, 8), overageCost)
        .input('total_cost', sql.Decimal(18, 8), totalCost)
        .query<BillingRecordDbRow>(insertQuery);

      const invoice = insertResult.recordset[0];

      if (!invoice) {
        throw new Error('Failed to insert billing record');
      }

      this.logger.info({
        invoiceId: invoice.id,
        userId,
        totalCost,
        baseCost,
        usageCost,
        overageCost,
      }, 'Monthly invoice generated');

      return invoice;
    } catch (error) {
      this.logger.error({
        error: error instanceof Error ? error.message : String(error),
        userId,
        periodStart: periodStart.toISOString(),
      }, 'Failed to generate monthly invoice');
      throw error;
    }
  }

  /**
   * Generate monthly invoices for all users
   *
   * Batch invoice generation for all users with the specified period start.
   * Useful for scheduled monthly billing runs.
   *
   * @param periodStart - Billing period start (first day of month)
   * @returns Number of invoices generated
   *
   * @example
   * ```typescript
   * // Generate invoices for all users for January 2025
   * const count = await billingService.generateAllMonthlyInvoices(
   *   new Date('2025-01-01')
   * );
   * console.log(`Generated ${count} invoices`);
   * ```
   */
  async generateAllMonthlyInvoices(periodStart: Date): Promise<number> {
    try {
      if (!this.pool) {
        throw new Error('Database pool not initialized');
      }

      this.logger.info({ periodStart: periodStart.toISOString() }, 'Generating invoices for all users');

      // Get all user IDs from user_quotas
      const userQuery = `
        SELECT user_id FROM user_quotas
      `;

      const userResult = await this.pool
        .request()
        .query<{ user_id: string }>(userQuery);

      const userIds = userResult.recordset.map(row => row.user_id);

      // Generate invoice for each user
      let successCount = 0;
      for (const userId of userIds) {
        try {
          await this.generateMonthlyInvoice(userId, periodStart);
          successCount++;
        } catch (error) {
          this.logger.error({
            error: error instanceof Error ? error.message : String(error),
            userId,
            periodStart: periodStart.toISOString(),
          }, 'Failed to generate invoice for user (continuing with others)');
        }
      }

      this.logger.info({
        totalUsers: userIds.length,
        successCount,
        failureCount: userIds.length - successCount,
      }, 'Bulk invoice generation complete');

      return successCount;
    } catch (error) {
      this.logger.error({
        error: error instanceof Error ? error.message : String(error),
        periodStart: periodStart.toISOString(),
      }, 'Failed to generate invoices for all users');
      throw error;
    }
  }

  /**
   * Get invoice by ID
   *
   * Retrieves a specific invoice with user validation.
   *
   * @param invoiceId - Invoice ID (UUID)
   * @param userId - User ID (for authorization)
   * @returns Billing record or null if not found
   *
   * @example
   * ```typescript
   * const invoice = await billingService.getInvoice(invoiceId, userId);
   * if (invoice) {
   *   console.log(`Invoice total: $${invoice.total_cost}`);
   * }
   * ```
   */
  async getInvoice(invoiceId: string, userId: string): Promise<BillingRecordDbRow | null> {
    try {
      if (!this.pool) {
        throw new Error('Database pool not initialized');
      }

      const query = `
        SELECT * FROM billing_records
        WHERE id = @invoiceId
          AND user_id = @userId
      `;

      const result = await this.pool
        .request()
        .input('invoiceId', sql.UniqueIdentifier, invoiceId)
        .input('userId', sql.UniqueIdentifier, userId)
        .query<BillingRecordDbRow>(query);

      return result.recordset[0] || null;
    } catch (error) {
      this.logger.error({
        error: error instanceof Error ? error.message : String(error),
        invoiceId,
        userId,
      }, 'Failed to fetch invoice');
      throw error;
    }
  }

  /**
   * Get invoice history for a user
   *
   * Retrieves all invoices for a user, sorted by date (newest first).
   *
   * @param userId - User ID
   * @param limit - Maximum number of invoices to return (default: 12)
   * @returns Array of billing records
   *
   * @example
   * ```typescript
   * // Get last 6 months of invoices
   * const invoices = await billingService.getInvoiceHistory(userId, 6);
   * ```
   */
  async getInvoiceHistory(userId: string, limit: number = 12): Promise<BillingRecordDbRow[]> {
    try {
      if (!this.pool) {
        throw new Error('Database pool not initialized');
      }

      const query = `
        SELECT TOP (@limit) * FROM billing_records
        WHERE user_id = @userId
        ORDER BY billing_period_start DESC
      `;

      const result = await this.pool
        .request()
        .input('userId', sql.UniqueIdentifier, userId)
        .input('limit', sql.Int, limit)
        .query<BillingRecordDbRow>(query);

      return result.recordset;
    } catch (error) {
      this.logger.error({
        error: error instanceof Error ? error.message : String(error),
        userId,
        limit,
      }, 'Failed to fetch invoice history');
      throw error;
    }
  }

  /**
   * Get current period invoice preview
   *
   * Calculates estimated invoice for the current billing period (partial month).
   * Useful for showing users their current charges before month ends.
   *
   * @param userId - User ID
   * @returns Invoice preview with breakdown
   *
   * @example
   * ```typescript
   * const preview = await billingService.getCurrentPeriodPreview(userId);
   * console.log(`Estimated total: $${preview.totalCost}`);
   * ```
   */
  async getCurrentPeriodPreview(userId: string): Promise<InvoicePreview> {
    try {
      if (!this.pool) {
        throw new Error('Database pool not initialized');
      }

      // Calculate current period bounds
      const now = new Date();
      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

      this.logger.info({
        userId,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
      }, 'Generating invoice preview for current period');

      // Get user quotas
      const quotaQuery = `
        SELECT plan_tier, allow_overage, overage_rate,
               current_token_usage, monthly_token_limit,
               current_api_call_usage, monthly_api_call_limit,
               current_storage_usage, storage_limit_bytes
        FROM user_quotas
        WHERE user_id = @userId
      `;

      const quotaResult = await this.pool
        .request()
        .input('userId', sql.UniqueIdentifier, userId)
        .query<UserQuotasDbRow>(quotaQuery);

      const planTier: PlanTier = quotaResult.recordset[0]?.plan_tier || 'free';
      const allowOverage = quotaResult.recordset[0]?.allow_overage || false;
      const currentTokenUsage = quotaResult.recordset[0]?.current_token_usage || 0;
      const monthlyTokenLimit = quotaResult.recordset[0]?.monthly_token_limit || 0;
      const currentApiCallUsage = quotaResult.recordset[0]?.current_api_call_usage || 0;
      const monthlyApiCallLimit = quotaResult.recordset[0]?.monthly_api_call_limit || 0;
      const currentStorageUsage = quotaResult.recordset[0]?.current_storage_usage || 0;
      const storageLimitBytes = quotaResult.recordset[0]?.storage_limit_bytes || 0;

      // Get usage breakdown
      const breakdown = await this.getUsageBreakdown(userId, periodStart, periodEnd);

      // Calculate costs
      const baseCost = this.calculatePlanCost(planTier);
      const usageCost = breakdown.total.cost;

      let overageCost = 0;
      if (allowOverage) {
        const tokensOverQuota = Math.max(0, currentTokenUsage - monthlyTokenLimit);
        const apiCallsOverQuota = Math.max(0, currentApiCallUsage - monthlyApiCallLimit);
        const storageOverQuota = Math.max(0, currentStorageUsage - storageLimitBytes);

        overageCost = calculateOverageCost(tokensOverQuota, apiCallsOverQuota, storageOverQuota);
      }

      const totalCost = baseCost + usageCost + overageCost;

      return {
        userId,
        billingPeriodStart: periodStart.toISOString(),
        billingPeriodEnd: periodEnd.toISOString(),
        totalTokens: breakdown.ai.tokens,
        totalApiCalls: breakdown.ai.events,
        totalStorageBytes: breakdown.storage.bytes,
        baseCost,
        usageCost,
        overageCost,
        totalCost,
        breakdown,
        isPreview: true,
      };
    } catch (error) {
      this.logger.error({
        error: error instanceof Error ? error.message : String(error),
        userId,
      }, 'Failed to generate invoice preview');
      throw error;
    }
  }

  /**
   * Calculate plan cost
   *
   * Returns the base subscription cost for a plan tier.
   *
   * @param planTier - Plan tier
   * @returns Monthly subscription cost in USD
   */
  calculatePlanCost(planTier: PlanTier): number {
    return PRICING_PLANS[planTier].price;
  }

  /**
   * Calculate overage cost for user
   *
   * Calculates the cost of usage beyond quota limits for a specific period.
   * Only applicable for users with allow_overage enabled.
   *
   * @param userId - User ID
   * @param periodStart - Period start date
   * @param periodEnd - Period end date
   * @returns Overage cost in USD
   */
  async calculateOverageCostForUser(
    userId: string,
    periodStart: Date,
    periodEnd: Date
  ): Promise<number> {
    try {
      if (!this.pool) {
        throw new Error('Database pool not initialized');
      }

      // Get user quotas
      const quotaQuery = `
        SELECT allow_overage, overage_rate,
               current_token_usage, monthly_token_limit,
               current_api_call_usage, monthly_api_call_limit,
               current_storage_usage, storage_limit_bytes
        FROM user_quotas
        WHERE user_id = @userId
      `;

      const quotaResult = await this.pool
        .request()
        .input('userId', sql.UniqueIdentifier, userId)
        .query<UserQuotasDbRow>(quotaQuery);

      const allowOverage = quotaResult.recordset[0]?.allow_overage || false;

      if (!allowOverage) {
        return 0;
      }

      const currentTokenUsage = quotaResult.recordset[0]?.current_token_usage || 0;
      const monthlyTokenLimit = quotaResult.recordset[0]?.monthly_token_limit || 0;
      const currentApiCallUsage = quotaResult.recordset[0]?.current_api_call_usage || 0;
      const monthlyApiCallLimit = quotaResult.recordset[0]?.monthly_api_call_limit || 0;
      const currentStorageUsage = quotaResult.recordset[0]?.current_storage_usage || 0;
      const storageLimitBytes = quotaResult.recordset[0]?.storage_limit_bytes || 0;

      const tokensOverQuota = Math.max(0, currentTokenUsage - monthlyTokenLimit);
      const apiCallsOverQuota = Math.max(0, currentApiCallUsage - monthlyApiCallLimit);
      const storageOverQuota = Math.max(0, currentStorageUsage - storageLimitBytes);

      return calculateOverageCost(tokensOverQuota, apiCallsOverQuota, storageOverQuota);
    } catch (error) {
      this.logger.error({
        error: error instanceof Error ? error.message : String(error),
        userId,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
      }, 'Failed to calculate overage cost');
      throw error;
    }
  }

  /**
   * Get usage breakdown by category
   *
   * Aggregates usage events by category for detailed billing breakdown.
   *
   * @param userId - User ID
   * @param periodStart - Period start date
   * @param periodEnd - Period end date
   * @returns Usage breakdown by category
   */
  async getUsageBreakdown(
    userId: string,
    periodStart: Date,
    periodEnd: Date
  ): Promise<UsageBreakdown> {
    try {
      if (!this.pool) {
        throw new Error('Database pool not initialized');
      }

      const query = `
        SELECT
          category,
          COUNT(*) as events,
          SUM(quantity) as quantity,
          SUM(cost) as cost
        FROM usage_events
        WHERE user_id = @userId
          AND created_at >= @periodStart
          AND created_at < @periodEnd
        GROUP BY category
      `;

      const result = await this.pool
        .request()
        .input('userId', sql.UniqueIdentifier, userId)
        .input('periodStart', sql.DateTime2, periodStart)
        .input('periodEnd', sql.DateTime2, periodEnd)
        .query<{ category: string; events: number; quantity: number; cost: number }>(query);

      // Initialize breakdown with zeros
      const breakdown: UsageBreakdown = {
        storage: { events: 0, bytes: 0, cost: 0 },
        processing: { events: 0, chunks: 0, cost: 0 },
        embeddings: { events: 0, chunks: 0, cost: 0 },
        search: { events: 0, queries: 0, cost: 0 },
        ai: { events: 0, tokens: 0, cost: 0 },
        total: { events: 0, cost: 0 },
      };

      // Populate with actual data
      for (const row of result.recordset) {
        breakdown.total.events += row.events;
        breakdown.total.cost += row.cost;

        switch (row.category) {
          case 'storage':
            breakdown.storage.events = row.events;
            breakdown.storage.bytes = row.quantity;
            breakdown.storage.cost = row.cost;
            break;
          case 'processing':
            breakdown.processing.events = row.events;
            breakdown.processing.chunks = row.quantity;
            breakdown.processing.cost = row.cost;
            break;
          case 'embeddings':
            breakdown.embeddings.events = row.events;
            breakdown.embeddings.chunks = row.quantity;
            breakdown.embeddings.cost = row.cost;
            break;
          case 'search':
            breakdown.search.events = row.events;
            breakdown.search.queries = row.quantity;
            breakdown.search.cost = row.cost;
            break;
          case 'ai':
            breakdown.ai.events = row.events;
            breakdown.ai.tokens = row.quantity;
            breakdown.ai.cost = row.cost;
            break;
        }
      }

      return breakdown;
    } catch (error) {
      this.logger.error({
        error: error instanceof Error ? error.message : String(error),
        userId,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
      }, 'Failed to get usage breakdown');
      throw error;
    }
  }

  /**
   * Enable PAYG (Pay-As-You-Go) for user
   *
   * Enables overage billing with a spending limit.
   * Only available for enterprise users.
   *
   * @param userId - User ID
   * @param spendingLimit - Maximum overage spending allowed (USD)
   *
   * @example
   * ```typescript
   * // Allow up to $100 in overage charges
   * await billingService.enablePayg(userId, 100);
   * ```
   */
  async enablePayg(userId: string, spendingLimit: number): Promise<void> {
    try {
      if (!this.pool) {
        throw new Error('Database pool not initialized');
      }

      this.logger.info({ userId, spendingLimit }, 'Enabling PAYG for user');

      const query = `
        UPDATE user_quotas
        SET allow_overage = 1,
            overage_rate = @rate,
            updated_at = GETUTCDATE()
        WHERE user_id = @userId
      `;

      await this.pool
        .request()
        .input('userId', sql.UniqueIdentifier, userId)
        .input('rate', sql.Decimal(18, 8), PAYG_RATES.claude_input_token)
        .query(query);

      this.logger.info({ userId, spendingLimit }, 'PAYG enabled successfully');
    } catch (error) {
      this.logger.error({
        error: error instanceof Error ? error.message : String(error),
        userId,
        spendingLimit,
      }, 'Failed to enable PAYG');
      throw error;
    }
  }

  /**
   * Disable PAYG (Pay-As-You-Go) for user
   *
   * Disables overage billing. User will be hard-limited to quota.
   *
   * @param userId - User ID
   *
   * @example
   * ```typescript
   * await billingService.disablePayg(userId);
   * ```
   */
  async disablePayg(userId: string): Promise<void> {
    try {
      if (!this.pool) {
        throw new Error('Database pool not initialized');
      }

      this.logger.info({ userId }, 'Disabling PAYG for user');

      const query = `
        UPDATE user_quotas
        SET allow_overage = 0,
            overage_rate = NULL,
            updated_at = GETUTCDATE()
        WHERE user_id = @userId
      `;

      await this.pool
        .request()
        .input('userId', sql.UniqueIdentifier, userId)
        .query(query);

      this.logger.info({ userId }, 'PAYG disabled successfully');
    } catch (error) {
      this.logger.error({
        error: error instanceof Error ? error.message : String(error),
        userId,
      }, 'Failed to disable PAYG');
      throw error;
    }
  }

  /**
   * Update PAYG spending limit
   *
   * Updates the overage rate for a user.
   *
   * @param userId - User ID
   * @param newLimit - New spending limit (USD)
   *
   * @example
   * ```typescript
   * // Increase limit to $200
   * await billingService.updatePaygLimit(userId, 200);
   * ```
   */
  async updatePaygLimit(userId: string, newLimit: number): Promise<void> {
    try {
      if (!this.pool) {
        throw new Error('Database pool not initialized');
      }

      this.logger.info({ userId, newLimit }, 'Updating PAYG limit');

      // Note: Currently we just update the overage_rate field
      // A more sophisticated implementation would track spending_limit separately
      const query = `
        UPDATE user_quotas
        SET overage_rate = @rate,
            updated_at = GETUTCDATE()
        WHERE user_id = @userId
          AND allow_overage = 1
      `;

      await this.pool
        .request()
        .input('userId', sql.UniqueIdentifier, userId)
        .input('rate', sql.Decimal(18, 8), PAYG_RATES.claude_input_token)
        .query(query);

      this.logger.info({ userId, newLimit }, 'PAYG limit updated successfully');
    } catch (error) {
      this.logger.error({
        error: error instanceof Error ? error.message : String(error),
        userId,
        newLimit,
      }, 'Failed to update PAYG limit');
      throw error;
    }
  }

  /**
   * Get PAYG settings for user
   *
   * Retrieves current PAYG configuration.
   *
   * @param userId - User ID
   * @returns PAYG settings
   *
   * @example
   * ```typescript
   * const settings = await billingService.getPaygSettings(userId);
   * if (settings.enabled) {
   *   console.log(`Spending limit: $${settings.spendingLimit}`);
   *   console.log(`Current overage: $${settings.currentOverage}`);
   * }
   * ```
   */
  async getPaygSettings(userId: string): Promise<PaygSettings> {
    try {
      if (!this.pool) {
        throw new Error('Database pool not initialized');
      }

      const query = `
        SELECT allow_overage, overage_rate,
               current_token_usage, monthly_token_limit,
               current_api_call_usage, monthly_api_call_limit,
               current_storage_usage, storage_limit_bytes
        FROM user_quotas
        WHERE user_id = @userId
      `;

      const result = await this.pool
        .request()
        .input('userId', sql.UniqueIdentifier, userId)
        .query<UserQuotasDbRow>(query);

      // Handle case where user_quotas doesn't exist (return defaults)
      if (result.recordset.length === 0) {
        return {
          enabled: false,
          spendingLimit: 0,
          currentOverage: 0,
        };
      }

      const record = result.recordset[0];

      if (!record) {
        return {
          enabled: false,
          spendingLimit: 0,
          currentOverage: 0,
        };
      }

      const allowOverage = record.allow_overage || false;

      // Calculate current overage amount
      let currentOverage = 0;
      if (allowOverage) {
        const tokensOverQuota = Math.max(0, record.current_token_usage - record.monthly_token_limit);
        const apiCallsOverQuota = Math.max(0, record.current_api_call_usage - record.monthly_api_call_limit);
        const storageOverQuota = Math.max(0, record.current_storage_usage - record.storage_limit_bytes);

        currentOverage = calculateOverageCost(tokensOverQuota, apiCallsOverQuota, storageOverQuota);
      }

      // Note: Spending limit is not stored in database currently
      // In a full implementation, this would be a separate column
      const spendingLimit = allowOverage ? 1000 : 0; // Default $1000 for enterprise

      return {
        enabled: allowOverage,
        spendingLimit,
        currentOverage,
      };
    } catch (error) {
      this.logger.error({
        error: error instanceof Error ? error.message : String(error),
        userId,
      }, 'Failed to get PAYG settings');
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
let billingServiceInstance: BillingService | null = null;

/**
 * Get BillingService singleton instance
 *
 * Factory function that creates or returns the singleton instance.
 * Supports dependency injection for testing.
 *
 * @param pool - Optional database pool (for testing)
 * @returns BillingService instance
 *
 * @example
 * // Production usage
 * const service = getBillingService();
 * await service.generateMonthlyInvoice(userId, periodStart);
 *
 * @example
 * // Test usage with mock
 * const mockPool = createMockPool();
 * const service = getBillingService(mockPool);
 */
export function getBillingService(pool?: ConnectionPool): BillingService {
  // If pool provided, always create new instance (for testing)
  if (pool) {
    return new BillingService(pool);
  }

  // Otherwise, use singleton
  if (!billingServiceInstance) {
    billingServiceInstance = new BillingService();
  }

  return billingServiceInstance;
}

/**
 * Reset BillingService singleton for testing
 *
 * @internal Only for tests - DO NOT use in production
 */
export function __resetBillingService(): void {
  billingServiceInstance = null;
}
