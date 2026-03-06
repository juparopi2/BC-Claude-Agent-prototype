/**
 * Shared Pricing for Scripts
 *
 * Single source of truth for model pricing in operational scripts.
 * Mirrors `backend/src/infrastructure/config/pricing.config.ts` — scripts can't use `@/` aliases.
 *
 * When Anthropic updates pricing, update BOTH this file and `pricing.config.ts`.
 */

export interface ModelPricingEntry {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

/**
 * Model-specific pricing per 1M tokens.
 *
 * @see https://www.anthropic.com/pricing
 */
export const MODEL_PRICING: Record<string, ModelPricingEntry> = {
  // Haiku 4.5
  'claude-haiku-4-5-20251001': { input: 1.0, output: 5.0, cacheWrite: 1.25, cacheRead: 0.10 },
  // Sonnet 3.5
  'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.30 },
  // Sonnet 4.5
  'claude-sonnet-4-5-20250929': { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.30 },
  // Opus 4.6
  'claude-opus-4-6-20250514': { input: 15.0, output: 75.0, cacheWrite: 18.75, cacheRead: 1.50 },
};

export const DEFAULT_PRICING = MODEL_PRICING['claude-haiku-4-5-20251001'];

export function getPricing(model: string | null): ModelPricingEntry {
  if (!model) return DEFAULT_PRICING;
  return MODEL_PRICING[model] ?? DEFAULT_PRICING;
}

export function calculateCost(
  model: string | null,
  inputTokens: number,
  outputTokens: number,
  cacheWriteTokens = 0,
  cacheReadTokens = 0
): number {
  const p = getPricing(model);
  return (
    (inputTokens * p.input) / 1_000_000 +
    (outputTokens * p.output) / 1_000_000 +
    (cacheWriteTokens * p.cacheWrite) / 1_000_000 +
    (cacheReadTokens * p.cacheRead) / 1_000_000
  );
}
