/**
 * Pricing Configuration
 *
 * This module defines the pricing strategy for the BC Claude Agent,
 * including unit costs, subscription plans, and pay-as-you-go overage rates.
 *
 * **Pricing Strategy**:
 * - Free tier: Generous limits for trial users (100K tokens, 500 API calls)
 * - Starter tier: $25/mo with 1M tokens, 500 API calls, 50MB storage (41% margin)
 * - Professional tier: $200/mo with 10M tokens, 5K API calls, 500MB storage (80% margin)
 * - Overage charges: 25% markup over cost for usage beyond limits
 *
 * **Cost Basis** (based on actual Azure/Anthropic pricing):
 * - User usage example: 506K input tokens + 81K output tokens + 207 messages = $3.29
 * - Azure infrastructure fixed costs: $114.91/month
 * - Target margins: 41% (Starter), 80% (Professional)
 *
 * @module config/pricing
 */

import type { PlanTier } from '@/types/usage.types';

/**
 * Unit Costs (per unit consumed)
 *
 * These are the actual costs we pay to Azure/Anthropic for compute and storage.
 * All token costs are per million tokens.
 * Storage cost is per byte.
 *
 * **Sources**:
 * - Claude API: https://www.anthropic.com/api (as of 2025-01)
 * - Azure Blob Storage: Standard LRS pricing
 * - Azure SQL: Serverless pricing
 * - Azure Redis: Basic tier pricing
 */
export const UNIT_COSTS = {
  /**
   * Claude input token cost
   * $3.00 per 1M tokens
   */
  claude_input_token: 3.0 / 1_000_000,

  /**
   * Claude output token cost
   * $15.00 per 1M tokens
   */
  claude_output_token: 15.0 / 1_000_000,

  /**
   * Prompt caching - cache write cost
   * $3.75 per 1M tokens (25% premium over input)
   */
  cache_write_token: 3.75 / 1_000_000,

  /**
   * Prompt caching - cache read cost
   * $0.30 per 1M tokens (90% discount vs input)
   */
  cache_read_token: 0.3 / 1_000_000,

  /**
   * Azure Blob Storage cost per byte
   * $0.018 per GB = $0.018 / 1,073,741,824 bytes
   */
  storage_per_byte: 0.018 / 1_073_741_824,

  /**
   * Azure SQL cost per vCore-hour
   * Approximate $0.52 per vCore-hour (serverless, 0.5-2 vCore range)
   */
  sql_vcore_hour: 0.52,

  /**
   * Azure Redis cost per hour
   * Basic C0 (250MB) = $0.016/hour
   */
  redis_hour: 0.016,

  /**
   * Network egress cost per GB
   * First 5GB free, then $0.087/GB
   */
  network_egress_gb: 0.087,

  // ===== Document Processing Costs =====
  /**
   * Azure Document Intelligence - text extraction per page
   * $0.01 per page (prebuilt-read model)
   */
  document_intelligence_page: 0.01,

  /**
   * Azure Document Intelligence - OCR per page
   * $0.015 per page (when OCR is needed for scanned docs)
   */
  document_intelligence_ocr_page: 0.015,

  /**
   * Local document processing (DOCX via mammoth)
   * Minimal cost for compute - $0.001 per document
   */
  docx_processing: 0.001,

  /**
   * Local document processing (Excel via xlsx)
   * Minimal cost for compute - $0.001 per sheet
   */
  excel_sheet_processing: 0.001,

  // ===== Embedding Costs =====
  /**
   * Azure OpenAI text-embedding-3-small
   * $0.02 per 1M tokens = $0.00000002 per token
   */
  text_embedding_token: 0.02 / 1_000_000,

  /**
   * Azure Computer Vision - image embedding
   * $0.10 per 1,000 images = $0.0001 per image
   */
  image_embedding: 0.0001,

  // ===== Vector Search Costs =====
  /**
   * Azure AI Search - vector search query
   * Prorated from Basic tier ($73/mo) assuming 100K queries
   * $0.00073 per query (conservative estimate)
   */
  vector_search_query: 0.00073,

  /**
   * Azure AI Search - hybrid search query (vector + text)
   * Slightly higher due to dual index lookup
   */
  hybrid_search_query: 0.001,

  // ===== Audio Transcription Costs (Azure OpenAI GPT-4o-mini-transcribe) =====
  /**
   * Audio input token cost
   * $6.00 per 1M tokens
   */
  audio_transcription_input_token: 6.0 / 1_000_000,

  /**
   * Text output token cost (transcribed text)
   * $10.00 per 1M tokens
   */
  audio_transcription_output_token: 10.0 / 1_000_000,
} as const;

/**
 * Subscription Plan Configurations
 *
 * Three tiers: free (trial), starter (small teams), professional (power users).
 *
 * **Pricing Strategy Notes**:
 * - Free tier: Generous limits to allow thorough evaluation (100K tokens = ~33 sessions)
 * - Starter tier: Based on real user consumption (506K tokens) with 2x headroom
 * - Professional tier: 10x starter limits for high-volume users
 * - Document limits prevent storage abuse
 */
export const PRICING_PLANS: Record<
  PlanTier,
  {
    /** Display name */
    name: string;
    /** Monthly subscription price (USD) */
    price: number;
    /** Monthly token limit (input + output combined) */
    monthly_token_limit: number;
    /** Monthly API call limit */
    monthly_api_call_limit: number;
    /** Storage limit in bytes */
    storage_limit_bytes: number;
    /** Maximum number of documents */
    max_documents: number;
    /** Allow overage charges (enterprise feature) */
    allow_overage: boolean;
    /** Feature flags */
    features: {
      extended_thinking: boolean;
      prompt_caching: boolean;
      priority_support: boolean;
      custom_integrations: boolean;
    };
  }
> = {
  /**
   * Free Tier - Default for new users
   *
   * Generous limits for evaluation:
   * - 100K tokens = ~33 agent sessions (3K tokens/session avg)
   * - 500 API calls = sufficient for trial period
   * - 10MB storage = ~10 PDF documents
   * - No overage allowed (upgrade required)
   */
  free: {
    name: 'Free',
    price: 0,
    monthly_token_limit: 100_000, // 100K tokens
    monthly_api_call_limit: 500,
    storage_limit_bytes: 10 * 1024 * 1024, // 10MB
    max_documents: 10,
    allow_overage: false,
    features: {
      extended_thinking: false,
      prompt_caching: false,
      priority_support: false,
      custom_integrations: false,
    },
  },

  /**
   * Free Trial - Time-limited trial with Pro limits
   *
   * Marketing strategy for user acquisition:
   * - Same limits as Pro tier (1M tokens, 500 API calls, 50MB storage)
   * - Duration: 30 calendar days from registration
   * - Can be extended ONCE for additional 30 days by providing feedback
   * - After expiration: Complete service block until upgrade
   * - Full usage tracking enabled for conversion insights
   */
  free_trial: {
    name: 'Free Trial',
    price: 0,
    monthly_token_limit: 1_000_000, // Same as Pro
    monthly_api_call_limit: 500,
    storage_limit_bytes: 50 * 1024 * 1024, // 50MB
    max_documents: 20,
    allow_overage: false,
    features: {
      extended_thinking: true,
      prompt_caching: true,
      priority_support: false,
      custom_integrations: false,
    },
  },

  /**
   * Pro Tier (formerly "Starter") - $25/month
   *
   * Based on real user consumption analysis:
   * - User consumed 506K input + 81K output + 207 messages = $3.29 cost
   * - Azure infrastructure: $114.91/month fixed
   * - 1M tokens provides 2x headroom over observed usage
   * - 50MB storage = ~50 documents
   * - Target margin: 41% after infrastructure costs
   */
  pro: {
    name: 'Pro',
    price: 25.0,
    monthly_token_limit: 1_000_000, // 1M tokens
    monthly_api_call_limit: 500,
    storage_limit_bytes: 50 * 1024 * 1024, // 50MB
    max_documents: 20,
    allow_overage: false,
    features: {
      extended_thinking: true,
      prompt_caching: true,
      priority_support: false,
      custom_integrations: false,
    },
  },

  /**
   * Enterprise Tier (formerly "Professional") - $200/month
   *
   * For power users and teams:
   * - 10M tokens = 10x pro tier (supports ~3,300 sessions/month)
   * - 5K API calls = 10x pro tier
   * - 500MB storage = ~500 documents
   * - Overage allowed with 25% markup pricing
   * - Target margin: 80% after infrastructure costs
   */
  enterprise: {
    name: 'Enterprise',
    price: 200.0,
    monthly_token_limit: 10_000_000, // 10M tokens
    monthly_api_call_limit: 5_000,
    storage_limit_bytes: 500 * 1024 * 1024, // 500MB
    max_documents: 200,
    allow_overage: true,
    features: {
      extended_thinking: true,
      prompt_caching: true,
      priority_support: true,
      custom_integrations: true,
    },
  },

  /**
   * Unlimited Tier - Special benefit for VIP clients
   *
   * For special partners and VIP clients:
   * - No practical limits (999M tokens, 999K API calls, 999GB storage)
   * - Still tracks all usage for cost analysis and insights
   * - No billing/overage charges
   * - All premium features enabled
   * - Dedicated support
   *
   * Implementation note: Extremely high limits act as "unlimited" while
   * maintaining quota validation infrastructure and usage tracking.
   */
  unlimited: {
    name: 'Unlimited',
    price: 0, // Special benefit - no charge
    monthly_token_limit: 999_999_999, // Effectively unlimited
    monthly_api_call_limit: 999_999,
    storage_limit_bytes: 999 * 1024 * 1024 * 1024, // 999GB
    max_documents: 999_999,
    allow_overage: true, // Allow any usage beyond even these limits
    features: {
      extended_thinking: true,
      prompt_caching: true,
      priority_support: true,
      custom_integrations: true,
    },
  },
} as const;

/**
 * Pay-As-You-Go Overage Rates
 *
 * Applied when enterprise users exceed their quota limits.
 * All rates include 25% markup over cost for margin and processing fees.
 *
 * **Calculation**: cost_per_unit * 1.25
 *
 * Example:
 * - Input token cost: $3.00/M * 1.25 = $3.75/M
 * - User exceeds quota by 100K tokens: 0.1M * $3.75 = $0.375
 */
export const PAYG_RATES = {
  /**
   * Overage rate for input tokens
   * $3.75 per 1M tokens (25% markup over $3.00 cost)
   */
  claude_input_token: UNIT_COSTS.claude_input_token * 1.25,

  /**
   * Overage rate for output tokens
   * $18.75 per 1M tokens (25% markup over $15.00 cost)
   */
  claude_output_token: UNIT_COSTS.claude_output_token * 1.25,

  /**
   * Overage rate for cache write tokens
   * $4.69 per 1M tokens (25% markup over $3.75 cost)
   */
  cache_write_token: UNIT_COSTS.cache_write_token * 1.25,

  /**
   * Overage rate for cache read tokens
   * $0.375 per 1M tokens (25% markup over $0.30 cost)
   */
  cache_read_token: UNIT_COSTS.cache_read_token * 1.25,

  /**
   * Overage rate for storage
   * $0.0225 per GB (25% markup over $0.018 cost)
   */
  storage_per_byte: UNIT_COSTS.storage_per_byte * 1.25,

  /**
   * Overage rate for API calls
   * $0.01 per call (estimated based on infrastructure allocation)
   */
  api_call: 0.01,

  // Document Processing PAYG
  document_intelligence_page: UNIT_COSTS.document_intelligence_page * 1.25,
  document_intelligence_ocr_page: UNIT_COSTS.document_intelligence_ocr_page * 1.25,
  docx_processing: UNIT_COSTS.docx_processing * 1.25,
  excel_sheet_processing: UNIT_COSTS.excel_sheet_processing * 1.25,

  // Embedding PAYG
  text_embedding_token: UNIT_COSTS.text_embedding_token * 1.25,
  image_embedding: UNIT_COSTS.image_embedding * 1.25,

  // Search PAYG
  vector_search_query: UNIT_COSTS.vector_search_query * 1.25,
  hybrid_search_query: UNIT_COSTS.hybrid_search_query * 1.25,

  // Audio Transcription PAYG
  audio_transcription_input_token: UNIT_COSTS.audio_transcription_input_token * 1.25,
  audio_transcription_output_token: UNIT_COSTS.audio_transcription_output_token * 1.25,
} as const;

/**
 * Calculate cost for token usage
 *
 * @param inputTokens - Number of input tokens
 * @param outputTokens - Number of output tokens
 * @param cacheWriteTokens - Number of cache write tokens (optional)
 * @param cacheReadTokens - Number of cache read tokens (optional)
 * @returns Total cost in USD
 *
 * @example
 * ```typescript
 * // Example: 506K input, 81K output (from user analysis)
 * const cost = calculateTokenCost(506_000, 81_000);
 * console.log(cost); // $2.73 (506K * $0.000003 + 81K * $0.000015)
 * ```
 */
export function calculateTokenCost(
  inputTokens: number,
  outputTokens: number,
  cacheWriteTokens = 0,
  cacheReadTokens = 0
): number {
  return (
    inputTokens * UNIT_COSTS.claude_input_token +
    outputTokens * UNIT_COSTS.claude_output_token +
    cacheWriteTokens * UNIT_COSTS.cache_write_token +
    cacheReadTokens * UNIT_COSTS.cache_read_token
  );
}

/**
 * Calculate overage charges for enterprise users
 *
 * @param tokensOverQuota - Number of tokens exceeding quota
 * @param apiCallsOverQuota - Number of API calls exceeding quota
 * @param storageOverQuota - Number of bytes exceeding quota
 * @returns Total overage cost in USD
 *
 * @example
 * ```typescript
 * // User exceeds quota by 100K tokens, 50 API calls, 10MB storage
 * const overage = calculateOverageCost(100_000, 50, 10 * 1024 * 1024);
 * console.log(overage); // $0.88 (tokens + API calls + storage)
 * ```
 */
export function calculateOverageCost(
  tokensOverQuota: number,
  apiCallsOverQuota: number,
  storageOverQuota: number
): number {
  return (
    tokensOverQuota * PAYG_RATES.claude_input_token +
    apiCallsOverQuota * PAYG_RATES.api_call +
    storageOverQuota * PAYG_RATES.storage_per_byte
  );
}

/**
 * Get plan configuration by tier
 *
 * @param tier - Plan tier (free, pro, enterprise)
 * @returns Plan configuration object
 *
 * @example
 * ```typescript
 * const plan = getPlanConfig('pro');
 * console.log(plan.monthly_token_limit); // 1_000_000
 * ```
 */
export function getPlanConfig(tier: PlanTier): (typeof PRICING_PLANS)[PlanTier] {
  return PRICING_PLANS[tier];
}

/**
 * Check if user is within quota limits
 *
 * @param currentUsage - Current usage stats
 * @param planTier - User's plan tier
 * @returns true if within limits, false if quota exceeded
 *
 * @example
 * ```typescript
 * const withinQuota = isWithinQuota({
 *   tokens: 800_000,
 *   apiCalls: 400,
 *   storageBytes: 40 * 1024 * 1024
 * }, 'pro');
 * console.log(withinQuota); // true (all limits OK)
 * ```
 */
export function isWithinQuota(
  currentUsage: {
    tokens: number;
    apiCalls: number;
    storageBytes: number;
  },
  planTier: PlanTier
): boolean {
  const plan = getPlanConfig(planTier);

  return (
    currentUsage.tokens <= plan.monthly_token_limit &&
    currentUsage.apiCalls <= plan.monthly_api_call_limit &&
    currentUsage.storageBytes <= plan.storage_limit_bytes
  );
}
