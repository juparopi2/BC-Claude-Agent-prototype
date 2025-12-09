/**
 * Usage Tracking & Billing Type Definitions
 *
 * This module defines the type system for Phase 1.5: Usage Tracking & Billing System.
 * It includes database record types (snake_case), API response types (camelCase),
 * and service parameter types for comprehensive usage tracking and quota management.
 *
 * Key Design Principles:
 * - Database records use snake_case to match SQL schema
 * - API responses use camelCase for JavaScript conventions
 * - Discriminated unions for operation types (type safety)
 * - Strict typing (no `any` allowed)
 * - All financial values use number type (DECIMAL stored as float)
 *
 * Architecture:
 * - usage_events: Append-only event log (immutable)
 * - user_quotas: Per-user quota limits and tracking
 * - usage_aggregates: Pre-computed rollups for dashboards
 * - billing_records: Monthly invoices and payment tracking
 * - quota_alerts: Threshold-based notifications
 */

/**
 * Operation Categories
 *
 * High-level categorization of billable operations:
 * - storage: File uploads, blob storage operations
 * - processing: OCR, text extraction, preview generation
 * - embeddings: Vector embedding generation for search
 * - search: Semantic search queries, file retrieval
 * - ai: Claude API calls, token usage
 */
export type OperationCategory = 'storage' | 'processing' | 'embeddings' | 'search' | 'ai';

/**
 * Storage Operation Types
 *
 * File storage operations:
 * - file_upload: User uploads a file
 * - file_download: User downloads a file
 * - file_delete: User deletes a file
 */
export type StorageOperation = 'file_upload' | 'file_download' | 'file_delete';

/**
 * Processing Operation Types
 *
 * Async processing operations:
 * - text_extraction: OCR or text parsing from document
 * - preview_generation: Thumbnail or preview creation
 * - document_analysis: Content analysis or metadata extraction
 */
export type ProcessingOperation =
  | 'text_extraction'
  | 'preview_generation'
  | 'document_analysis';

/**
 * Embedding Operation Types
 *
 * Vector embedding operations:
 * - embedding_generation: Create embeddings for chunks
 * - embedding_update: Update existing embeddings
 */
export type EmbeddingOperation = 'embedding_generation' | 'embedding_update';

/**
 * Search Operation Types
 *
 * Search and retrieval operations:
 * - semantic_search: Vector similarity search
 * - keyword_search: Full-text search
 * - hybrid_search: Combined semantic + keyword search
 */
export type SearchOperation = 'semantic_search' | 'keyword_search' | 'hybrid_search';

/**
 * AI Operation Types
 *
 * Claude API operations:
 * - message_sent: User sends message to agent
 * - message_received: Agent responds to user
 * - tool_executed: Agent executes a tool
 * - approval_requested: Agent requests user approval
 * - thinking: Extended thinking mode usage
 */
export type AIOperation =
  | 'message_sent'
  | 'message_received'
  | 'tool_executed'
  | 'approval_requested'
  | 'thinking';

/**
 * All Operation Types (Union)
 *
 * Discriminated union of all operation types across categories.
 */
export type OperationType =
  | StorageOperation
  | ProcessingOperation
  | EmbeddingOperation
  | SearchOperation
  | AIOperation;

/**
 * Plan Tier Options
 *
 * Subscription tiers with different quota limits:
 * - free: Default tier for new users (basic limits)
 * - free_trial: Time-limited trial with pro limits (30 days, can extend once with feedback)
 * - pro: Paid tier with higher limits ($25/mo)
 * - enterprise: Custom limits and overage support ($200/mo)
 * - unlimited: Special benefit tier for VIP clients (no limits, full tracking)
 */
export type PlanTier = 'free' | 'free_trial' | 'pro' | 'enterprise' | 'unlimited';

/**
 * Billing Status Options
 *
 * Payment lifecycle states:
 * - pending: Invoice generated, awaiting payment
 * - paid: Payment received and processed
 * - failed: Payment failed (retry or collection needed)
 * - refunded: Payment refunded to customer
 */
export type BillingStatus = 'pending' | 'paid' | 'failed' | 'refunded';

/**
 * Quota Types
 *
 * Different types of quotas that can be enforced:
 * - tokens: Claude API token usage
 * - api_calls: Total API call count
 * - storage: File storage in bytes
 */
export type QuotaType = 'tokens' | 'api_calls' | 'storage';

/**
 * Period Types for Aggregation
 *
 * Time periods for usage rollups:
 * - hourly: Hour-by-hour breakdown
 * - daily: Day-by-day breakdown
 * - weekly: Week-by-week breakdown
 * - monthly: Month-by-month breakdown
 */
export type PeriodType = 'hourly' | 'daily' | 'weekly' | 'monthly';

/**
 * Usage Unit Types
 *
 * Units for measuring usage:
 * - tokens: Claude API tokens
 * - bytes: File storage bytes
 * - calls: API call count
 * - chunks: Document chunks processed
 * - queries: Search queries executed
 */
export type UsageUnit = 'tokens' | 'bytes' | 'calls' | 'chunks' | 'queries';

// =====================================================================
// DATABASE RECORD TYPES (snake_case)
// =====================================================================

/**
 * Database record for usage_events table
 *
 * Append-only event log for all billable operations.
 * This matches the SQL schema exactly with snake_case naming.
 *
 * Important fields:
 * - id: Auto-incrementing BIGINT for chronological ordering
 * - category: High-level operation category
 * - event_type: Specific operation type
 * - quantity: Amount of resource consumed (tokens, bytes, etc.)
 * - cost: Calculated cost in micro-cents (8 decimal precision)
 * - metadata: JSON metadata for additional context
 */
export interface UsageEventDbRow {
  /** Auto-incrementing primary key */
  id: number; // BIGINT

  /** Owner of the usage event */
  user_id: string; // UNIQUEIDENTIFIER

  /** Session where event occurred */
  session_id: string; // UNIQUEIDENTIFIER

  /** High-level category (storage, processing, ai, etc.) */
  category: OperationCategory;

  /** Specific event type within category */
  event_type: string;

  /** Amount of resource consumed */
  quantity: number; // BIGINT

  /** Unit of measurement (tokens, bytes, calls, etc.) */
  unit: string;

  /** Calculated cost (micro-cent precision) */
  cost: number; // DECIMAL(18,8)

  /** JSON metadata for additional context */
  metadata: string | null; // JSON stored as NVARCHAR(MAX)

  /** UTC timestamp when event was created */
  created_at: Date;
}

/**
 * Database record for user_quotas table
 *
 * Per-user quota limits and current usage tracking.
 * This matches the SQL schema exactly with snake_case naming.
 *
 * Important fields:
 * - user_id: Primary key (one quota record per user)
 * - plan_tier: Subscription tier (free, pro, enterprise)
 * - monthly_token_limit: Max tokens per month
 * - current_token_usage: Current period usage
 * - quota_reset_at: When quota resets to zero
 * - allow_overage: Enterprise feature for overage billing
 */
export interface UserQuotasDbRow {
  /** User ID (primary key) */
  user_id: string; // UNIQUEIDENTIFIER

  /** Subscription tier */
  plan_tier: PlanTier;

  /** Monthly token limit */
  monthly_token_limit: number; // BIGINT

  /** Current token usage this period */
  current_token_usage: number; // BIGINT

  /** Monthly API call limit */
  monthly_api_call_limit: number; // INT

  /** Current API call usage this period */
  current_api_call_usage: number; // INT

  /** Storage limit in bytes */
  storage_limit_bytes: number; // BIGINT

  /** Current storage usage in bytes */
  current_storage_usage: number; // BIGINT

  /** UTC timestamp when quota resets */
  quota_reset_at: Date;

  /** UTC timestamp of last reset */
  last_reset_at: Date | null;

  /** Allow overage charges (enterprise feature) */
  allow_overage: boolean; // BIT

  /** Cost per unit over quota (if overage allowed) */
  overage_rate: number | null; // DECIMAL(18,8)

  /** Trial started at (for free_trial users) */
  trial_started_at?: Date | null; // DATETIME2 (nullable, only for free_trial)

  /** Trial expires at (for free_trial users) */
  trial_expires_at?: Date | null; // DATETIME2 (nullable, only for free_trial)

  /** Trial has been extended once (0 = can extend, 1 = already extended) */
  trial_extended?: number; // BIT (defaults to 0)

  /** UTC timestamp when record was created */
  created_at: Date;

  /** UTC timestamp when record was last updated */
  updated_at: Date;
}

/**
 * Database record for usage_aggregates table
 *
 * Pre-computed rollups for fast dashboard queries.
 * This matches the SQL schema exactly with snake_case naming.
 *
 * Important fields:
 * - period_type: Aggregation period (hourly, daily, weekly, monthly)
 * - period_start: Start of aggregation window
 * - total_events: Count of events in period
 * - total_tokens: Sum of tokens consumed
 * - category_breakdown: JSON breakdown by category
 */
export interface UsageAggregateDbRow {
  /** Auto-incrementing primary key */
  id: number; // BIGINT

  /** User ID */
  user_id: string; // UNIQUEIDENTIFIER

  /** Period type (hourly, daily, weekly, monthly) */
  period_type: PeriodType;

  /** Start of aggregation period */
  period_start: Date;

  /** Total event count in period */
  total_events: number; // BIGINT

  /** Total tokens consumed in period */
  total_tokens: number; // BIGINT

  /** Total API calls in period */
  total_api_calls: number; // INT

  /** Total cost in period */
  total_cost: number; // DECIMAL(18,8)

  /** JSON breakdown by category */
  category_breakdown: string | null; // JSON stored as NVARCHAR(MAX)

  /** UTC timestamp when aggregate was created */
  created_at: Date;

  /** UTC timestamp when aggregate was last updated */
  updated_at: Date;
}

/**
 * Database record for billing_records table
 *
 * Monthly invoices and payment tracking.
 * This matches the SQL schema exactly with snake_case naming.
 *
 * Important fields:
 * - billing_period_start: Start of billing period
 * - billing_period_end: End of billing period
 * - base_cost: Subscription cost
 * - usage_cost: Pay-as-you-go usage cost
 * - overage_cost: Over-quota charges
 * - total_cost: Sum of all costs
 * - status: Payment status (pending, paid, failed, refunded)
 */
export interface BillingRecordDbRow {
  /** UUID primary key */
  id: string; // UNIQUEIDENTIFIER

  /** User ID */
  user_id: string; // UNIQUEIDENTIFIER

  /** Start of billing period */
  billing_period_start: Date;

  /** End of billing period */
  billing_period_end: Date;

  /** Total tokens consumed in period */
  total_tokens: number; // BIGINT

  /** Total API calls in period */
  total_api_calls: number; // INT

  /** Total storage bytes in period */
  total_storage_bytes: number; // BIGINT

  /** Plan subscription cost */
  base_cost: number; // DECIMAL(18,8)

  /** Pay-as-you-go usage cost */
  usage_cost: number; // DECIMAL(18,8)

  /** Over-quota charges */
  overage_cost: number; // DECIMAL(18,8)

  /** Total cost (base + usage + overage) */
  total_cost: number; // DECIMAL(18,8)

  /** Payment status */
  status: BillingStatus;

  /** Payment method (stripe, invoice, etc.) */
  payment_method: string | null;

  /** UTC timestamp when payment was received */
  paid_at: Date | null;

  /** UTC timestamp when record was created */
  created_at: Date;

  /** UTC timestamp when record was last updated */
  updated_at: Date;
}

/**
 * Database record for quota_alerts table
 *
 * Threshold-based notifications for quota usage.
 * This matches the SQL schema exactly with snake_case naming.
 *
 * Important fields:
 * - quota_type: Type of quota (tokens, api_calls, storage)
 * - threshold_percent: Alert threshold (50, 80, 90, 100)
 * - threshold_value: Actual value when alert triggered
 * - alerted_at: When alert was sent
 * - acknowledged_at: When user acknowledged alert
 */
export interface QuotaAlertDbRow {
  /** Auto-incrementing primary key */
  id: number; // BIGINT

  /** User ID */
  user_id: string; // UNIQUEIDENTIFIER

  /** Quota type (tokens, api_calls, storage) */
  quota_type: QuotaType;

  /** Alert threshold percent (50, 80, 90, 100) */
  threshold_percent: number; // INT

  /** Actual value when alert triggered */
  threshold_value: number; // BIGINT

  /** UTC timestamp when alert was sent */
  alerted_at: Date;

  /** UTC timestamp when user acknowledged alert */
  acknowledged_at: Date | null;
}

// =====================================================================
// API RESPONSE TYPES (camelCase)
// =====================================================================

/**
 * Parsed usage event for API responses
 *
 * This is the camelCase version sent to clients.
 * Differences from DB record:
 * - camelCase naming
 * - Dates as ISO 8601 strings
 * - Parsed JSON metadata as Record<string, unknown>
 */
export interface UsageEvent {
  /** Event ID */
  id: number;

  /** User ID */
  userId: string;

  /** Session ID */
  sessionId: string;

  /** Operation category */
  category: OperationCategory;

  /** Specific event type */
  eventType: string;

  /** Resource quantity consumed */
  quantity: number;

  /** Unit of measurement */
  unit: string;

  /** Calculated cost */
  cost: number;

  /** Additional metadata */
  metadata: Record<string, unknown> | null;

  /** ISO 8601 timestamp */
  createdAt: string;
}

/**
 * Parsed user quotas for API responses
 *
 * Includes computed fields:
 * - tokenUsagePercent: Current usage as percentage of limit
 * - apiCallUsagePercent: Current usage as percentage of limit
 * - storageUsagePercent: Current usage as percentage of limit
 * - daysUntilReset: Days remaining until quota reset
 */
export interface UserQuotas {
  /** User ID */
  userId: string;

  /** Plan tier */
  planTier: PlanTier;

  /** Monthly token limit */
  monthlyTokenLimit: number;

  /** Current token usage */
  currentTokenUsage: number;

  /** Token usage percentage */
  tokenUsagePercent: number;

  /** Monthly API call limit */
  monthlyApiCallLimit: number;

  /** Current API call usage */
  currentApiCallUsage: number;

  /** API call usage percentage */
  apiCallUsagePercent: number;

  /** Storage limit in bytes */
  storageLimitBytes: number;

  /** Current storage usage in bytes */
  currentStorageUsage: number;

  /** Storage usage percentage */
  storageUsagePercent: number;

  /** ISO 8601 timestamp of quota reset */
  quotaResetAt: string;

  /** ISO 8601 timestamp of last reset */
  lastResetAt: string | null;

  /** Days until quota reset */
  daysUntilReset: number;

  /** Allow overage charges */
  allowOverage: boolean;

  /** Overage rate per unit */
  overageRate: number | null;

  /** ISO 8601 timestamp */
  createdAt: string;

  /** ISO 8601 timestamp */
  updatedAt: string;
}

/**
 * Parsed usage aggregate for API responses
 *
 * Used for dashboard charts and analytics.
 */
export interface UsageAggregate {
  /** Aggregate ID */
  id: number;

  /** User ID */
  userId: string;

  /** Period type */
  periodType: PeriodType;

  /** ISO 8601 timestamp of period start */
  periodStart: string;

  /** Total events in period */
  totalEvents: number;

  /** Total tokens in period */
  totalTokens: number;

  /** Total API calls in period */
  totalApiCalls: number;

  /** Total cost in period */
  totalCost: number;

  /** Category breakdown */
  categoryBreakdown: Record<string, number> | null;

  /** ISO 8601 timestamp */
  createdAt: string;

  /** ISO 8601 timestamp */
  updatedAt: string;
}

/**
 * Parsed billing record for API responses
 */
export interface BillingRecord {
  /** Billing record ID */
  id: string;

  /** User ID */
  userId: string;

  /** ISO 8601 timestamp of period start */
  billingPeriodStart: string;

  /** ISO 8601 timestamp of period end */
  billingPeriodEnd: string;

  /** Total tokens consumed */
  totalTokens: number;

  /** Total API calls made */
  totalApiCalls: number;

  /** Total storage bytes used */
  totalStorageBytes: number;

  /** Base subscription cost */
  baseCost: number;

  /** Usage cost */
  usageCost: number;

  /** Overage cost */
  overageCost: number;

  /** Total cost */
  totalCost: number;

  /** Payment status */
  status: BillingStatus;

  /** Payment method */
  paymentMethod: string | null;

  /** ISO 8601 timestamp of payment */
  paidAt: string | null;

  /** ISO 8601 timestamp */
  createdAt: string;

  /** ISO 8601 timestamp */
  updatedAt: string;
}

/**
 * Parsed quota alert for API responses
 */
export interface QuotaAlert {
  /** Alert ID */
  id: number;

  /** User ID */
  userId: string;

  /** Quota type */
  quotaType: QuotaType;

  /** Threshold percent */
  thresholdPercent: number;

  /** Threshold value */
  thresholdValue: number;

  /** ISO 8601 timestamp of alert */
  alertedAt: string;

  /** ISO 8601 timestamp of acknowledgment */
  acknowledgedAt: string | null;
}

// =====================================================================
// SERVICE PARAMETER TYPES
// =====================================================================

/**
 * Parameters for tracking a usage event
 *
 * Used by UsageEventService.trackEvent()
 */
export interface TrackUsageParams {
  /** User ID */
  userId: string;

  /** Session ID */
  sessionId: string;

  /** Operation category */
  category: OperationCategory;

  /** Specific event type */
  eventType: OperationType | string;

  /** Resource quantity consumed */
  quantity: number;

  /** Unit of measurement */
  unit: UsageUnit | string;

  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Parameters for validating quota
 *
 * Used by QuotaManager.validateQuota()
 */
export interface ValidateQuotaParams {
  /** User ID */
  userId: string;

  /** Quota type to validate */
  quotaType: QuotaType;

  /** Amount to be consumed */
  amount: number;
}

/**
 * Result of quota validation
 *
 * Returned by QuotaManager.validateQuota()
 */
export interface QuotaValidationResult {
  /** Is quota available */
  allowed: boolean;

  /** Current usage */
  currentUsage: number;

  /** Quota limit */
  limit: number;

  /** Remaining quota */
  remaining: number;

  /** Usage percentage */
  usagePercent: number;

  /** Alert threshold reached (50, 80, 90, 100) */
  alertThreshold: number | null;

  /** Is overage allowed */
  overageAllowed: boolean;

  /** Reason if not allowed */
  reason?: string;
}

/**
 * Parameters for incrementing quota usage
 *
 * Used by QuotaManager.incrementUsage()
 */
export interface IncrementUsageParams {
  /** User ID */
  userId: string;

  /** Quota type to increment */
  quotaType: QuotaType;

  /** Amount to increment */
  amount: number;
}

/**
 * Parameters for creating usage aggregate
 *
 * Used by AggregationService.createAggregate()
 */
export interface CreateAggregateParams {
  /** User ID */
  userId: string;

  /** Period type */
  periodType: PeriodType;

  /** Period start timestamp */
  periodStart: Date;
}

/**
 * Parameters for generating billing record
 *
 * Used by BillingService.generateInvoice()
 */
export interface GenerateBillingParams {
  /** User ID */
  userId: string;

  /** Billing period start */
  periodStart: Date;

  /** Billing period end */
  periodEnd: Date;
}

/**
 * Parameters for triggering quota alert
 *
 * Used by AlertService.triggerAlert()
 */
export interface TriggerAlertParams {
  /** User ID */
  userId: string;

  /** Quota type */
  quotaType: QuotaType;

  /** Current usage value */
  currentUsage: number;

  /** Quota limit */
  limit: number;
}

/**
 * Parameters for querying usage events
 *
 * Used by UsageEventService.getEvents()
 */
export interface GetUsageEventsParams {
  /** User ID (required) */
  userId: string;

  /** Filter by category */
  category?: OperationCategory;

  /** Filter by session */
  sessionId?: string;

  /** Start date (inclusive) */
  startDate?: Date;

  /** End date (inclusive) */
  endDate?: Date;

  /** Maximum number of results */
  limit?: number;

  /** Pagination offset */
  offset?: number;
}

/**
 * Parameters for querying usage aggregates
 *
 * Used by AggregationService.getAggregates()
 */
export interface GetAggregatesParams {
  /** User ID (required) */
  userId: string;

  /** Period type (required) */
  periodType: PeriodType;

  /** Start date (inclusive) */
  startDate?: Date;

  /** End date (inclusive) */
  endDate?: Date;

  /** Maximum number of results */
  limit?: number;
}

/**
 * Usage breakdown by category
 *
 * Used for dashboard charts and billing breakdowns.
 */
export interface UsageBreakdown {
  /** Storage operations */
  storage: {
    events: number;
    bytes: number;
    cost: number;
  };

  /** Processing operations */
  processing: {
    events: number;
    chunks: number;
    cost: number;
  };

  /** Embedding operations */
  embeddings: {
    events: number;
    chunks: number;
    cost: number;
  };

  /** Search operations */
  search: {
    events: number;
    queries: number;
    cost: number;
  };

  /** AI operations */
  ai: {
    events: number;
    tokens: number;
    cost: number;
  };

  /** Total across all categories */
  total: {
    events: number;
    cost: number;
  };
}

/**
 * Quota initialization options
 *
 * Used when creating new user quotas.
 */
export interface InitializeQuotasParams {
  /** User ID */
  userId: string;

  /** Plan tier (defaults to 'free') */
  planTier?: PlanTier;
}

/**
 * Update quota limits
 *
 * Used when changing user's plan or quota limits.
 */
export interface UpdateQuotaLimitsParams {
  /** User ID */
  userId: string;

  /** New plan tier */
  planTier?: PlanTier;

  /** New monthly token limit */
  monthlyTokenLimit?: number;

  /** New monthly API call limit */
  monthlyApiCallLimit?: number;

  /** New storage limit */
  storageLimitBytes?: number;

  /** Allow overage charges */
  allowOverage?: boolean;

  /** Overage rate per unit */
  overageRate?: number;
}

// =====================================================================
// TRANSFORMER FUNCTIONS
// =====================================================================

/**
 * Transform usage event database record to API format
 *
 * @param record - Database record from SQL query
 * @returns Parsed event ready for API response
 */
export function parseUsageEvent(record: UsageEventDbRow): UsageEvent {
  return {
    id: record.id,
    userId: record.user_id,
    sessionId: record.session_id,
    category: record.category,
    eventType: record.event_type,
    quantity: record.quantity,
    unit: record.unit,
    cost: record.cost,
    metadata: record.metadata ? JSON.parse(record.metadata) : null,
    createdAt: record.created_at.toISOString(),
  };
}

/**
 * Transform user quotas database record to API format
 *
 * Includes computed fields for usage percentages and time remaining.
 *
 * @param record - Database record from SQL query
 * @returns Parsed quotas ready for API response
 */
export function parseUserQuotas(record: UserQuotasDbRow): UserQuotas {
  const tokenUsagePercent =
    record.monthly_token_limit > 0
      ? Math.round((record.current_token_usage / record.monthly_token_limit) * 100)
      : 0;

  const apiCallUsagePercent =
    record.monthly_api_call_limit > 0
      ? Math.round((record.current_api_call_usage / record.monthly_api_call_limit) * 100)
      : 0;

  const storageUsagePercent =
    record.storage_limit_bytes > 0
      ? Math.round((record.current_storage_usage / record.storage_limit_bytes) * 100)
      : 0;

  const now = new Date();
  const resetDate = new Date(record.quota_reset_at);
  const msUntilReset = resetDate.getTime() - now.getTime();
  const daysUntilReset = Math.max(0, Math.ceil(msUntilReset / (1000 * 60 * 60 * 24)));

  return {
    userId: record.user_id,
    planTier: record.plan_tier,
    monthlyTokenLimit: record.monthly_token_limit,
    currentTokenUsage: record.current_token_usage,
    tokenUsagePercent,
    monthlyApiCallLimit: record.monthly_api_call_limit,
    currentApiCallUsage: record.current_api_call_usage,
    apiCallUsagePercent,
    storageLimitBytes: record.storage_limit_bytes,
    currentStorageUsage: record.current_storage_usage,
    storageUsagePercent,
    quotaResetAt: record.quota_reset_at.toISOString(),
    lastResetAt: record.last_reset_at ? record.last_reset_at.toISOString() : null,
    daysUntilReset,
    allowOverage: record.allow_overage,
    overageRate: record.overage_rate,
    createdAt: record.created_at.toISOString(),
    updatedAt: record.updated_at.toISOString(),
  };
}

/**
 * Transform usage aggregate database record to API format
 *
 * @param record - Database record from SQL query
 * @returns Parsed aggregate ready for API response
 */
export function parseUsageAggregate(record: UsageAggregateDbRow): UsageAggregate {
  return {
    id: record.id,
    userId: record.user_id,
    periodType: record.period_type,
    periodStart: record.period_start.toISOString(),
    totalEvents: record.total_events,
    totalTokens: record.total_tokens,
    totalApiCalls: record.total_api_calls,
    totalCost: record.total_cost,
    categoryBreakdown: record.category_breakdown ? JSON.parse(record.category_breakdown) : null,
    createdAt: record.created_at.toISOString(),
    updatedAt: record.updated_at.toISOString(),
  };
}

/**
 * Transform billing record database record to API format
 *
 * @param record - Database record from SQL query
 * @returns Parsed billing record ready for API response
 */
export function parseBillingRecord(record: BillingRecordDbRow): BillingRecord {
  return {
    id: record.id,
    userId: record.user_id,
    billingPeriodStart: record.billing_period_start.toISOString(),
    billingPeriodEnd: record.billing_period_end.toISOString(),
    totalTokens: record.total_tokens,
    totalApiCalls: record.total_api_calls,
    totalStorageBytes: record.total_storage_bytes,
    baseCost: record.base_cost,
    usageCost: record.usage_cost,
    overageCost: record.overage_cost,
    totalCost: record.total_cost,
    status: record.status,
    paymentMethod: record.payment_method,
    paidAt: record.paid_at ? record.paid_at.toISOString() : null,
    createdAt: record.created_at.toISOString(),
    updatedAt: record.updated_at.toISOString(),
  };
}

/**
 * Transform quota alert database record to API format
 *
 * @param record - Database record from SQL query
 * @returns Parsed alert ready for API response
 */
export function parseQuotaAlert(record: QuotaAlertDbRow): QuotaAlert {
  return {
    id: record.id,
    userId: record.user_id,
    quotaType: record.quota_type,
    thresholdPercent: record.threshold_percent,
    thresholdValue: record.threshold_value,
    alertedAt: record.alerted_at.toISOString(),
    acknowledgedAt: record.acknowledged_at ? record.acknowledged_at.toISOString() : null,
  };
}
