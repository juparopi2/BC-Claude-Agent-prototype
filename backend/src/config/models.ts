/**
 * Centralized Model Configuration
 *
 * This file defines all AI model configurations used across the application.
 * Models are organized by ROLE, not by name, allowing easy swapping and
 * cost optimization based on task requirements.
 *
 * Philosophy:
 * - Orchestrator: Most powerful model for complex decision-making (Opus)
 * - Router: Fast, economic model for intent classification (Haiku)
 * - Execution: Balanced model for task execution (Sonnet)
 * - Economic: Cheapest model for simple tasks (Haiku)
 */

import { ModelConfig, ModelProvider } from '../core/langchain/ModelFactory';

// =============================================================================
// ANTHROPIC MODEL IDENTIFIERS
// These are the official model IDs from Anthropic's API
// @see https://docs.anthropic.com/en/docs/about-claude/models
// =============================================================================

/**
 * Anthropic model identifiers.
 * Using const assertion for type safety while allowing string extensibility.
 */
export const AnthropicModels = {
  // Claude 4.5 Series (Latest)
  OPUS_4_5: 'claude-opus-4-5-20250929',
  SONNET_4_5: 'claude-sonnet-4-5-20250929',

  // Claude 3.5 Series
  SONNET_3_5: 'claude-3-5-sonnet-latest',
  HAIKU_3_5: 'claude-3-5-haiku-latest',

  // Claude 3 Series (Legacy)
  OPUS_3: 'claude-3-opus-latest',
  SONNET_3: 'claude-3-sonnet-20240229',
  HAIKU_3: 'claude-3-haiku-20240307',
} as const;

export type AnthropicModelId = (typeof AnthropicModels)[keyof typeof AnthropicModels];

// =============================================================================
// MODEL PRICING (per million tokens)
// @see https://www.anthropic.com/pricing
// =============================================================================

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cachedInputPerMillion?: number; // For prompt caching
}

export const AnthropicPricing: Record<AnthropicModelId, ModelPricing> = {
  [AnthropicModels.OPUS_4_5]: {
    inputPerMillion: 5.0,
    outputPerMillion: 25.0,
    cachedInputPerMillion: 0.5,
  },
  [AnthropicModels.SONNET_4_5]: {
    inputPerMillion: 3.0,
    outputPerMillion: 15.0,
    cachedInputPerMillion: 0.3,
  },
  [AnthropicModels.SONNET_3_5]: {
    inputPerMillion: 3.0,
    outputPerMillion: 15.0,
    cachedInputPerMillion: 0.3,
  },
  [AnthropicModels.HAIKU_3_5]: {
    inputPerMillion: 0.8,
    outputPerMillion: 4.0,
    cachedInputPerMillion: 0.08,
  },
  [AnthropicModels.OPUS_3]: {
    inputPerMillion: 15.0,
    outputPerMillion: 75.0,
  },
  [AnthropicModels.SONNET_3]: {
    inputPerMillion: 3.0,
    outputPerMillion: 15.0,
  },
  [AnthropicModels.HAIKU_3]: {
    inputPerMillion: 0.25,
    outputPerMillion: 1.25,
  },
};

// =============================================================================
// MODEL ROLES
// Define the purpose/role of each model usage in the system
// =============================================================================

/**
 * Model roles define the PURPOSE of the model, not the model itself.
 * This allows swapping models without changing business logic.
 */
export type ModelRole =
  | 'orchestrator'    // Complex orchestration and decision-making
  | 'router'          // Fast intent classification and routing
  | 'bc_agent'        // Business Central operations
  | 'rag_agent'       // RAG/Knowledge retrieval
  | 'session_title'   // Generate session titles
  | 'embedding'       // Text embeddings (special case, not LLM)
  | 'default';        // Fallback for unspecified uses

/**
 * Extended model config with role metadata
 */
export interface RoleModelConfig extends ModelConfig {
  role: ModelRole;
  description: string;
  estimatedTokensPerCall?: {
    input: number;
    output: number;
  };
}

// =============================================================================
// ROLE-BASED MODEL CONFIGURATION
// =============================================================================

/**
 * Central configuration mapping roles to their model settings.
 * Change these to swap models across the entire application.
 */
export const ModelRoleConfigs: Record<ModelRole, RoleModelConfig> = {
  orchestrator: {
    role: 'orchestrator',
    description: 'Complex orchestration, multi-step planning, and tool coordination',
    provider: 'anthropic' as ModelProvider,
    modelName: AnthropicModels.OPUS_4_5,
    temperature: 0.7,
    maxTokens: 16384,
    streaming: true,
    enableThinking: true,
    thinkingBudget: 4096,
    estimatedTokensPerCall: {
      input: 2000,
      output: 1000,
    },
  },

  router: {
    role: 'router',
    description: 'Fast intent classification and query routing',
    provider: 'anthropic' as ModelProvider,
    modelName: AnthropicModels.HAIKU_3_5,
    temperature: 0.0, // Deterministic routing
    maxTokens: 512,
    streaming: false, // No need for streaming in router
    estimatedTokensPerCall: {
      input: 500,
      output: 100,
    },
  },

  bc_agent: {
    role: 'bc_agent',
    description: 'Business Central operations and API interactions',
    provider: 'anthropic' as ModelProvider,
    modelName: AnthropicModels.SONNET_4_5,
    temperature: 0.3, // More deterministic for BC operations
    maxTokens: 8192,
    streaming: true,
    enableCaching: true, // Cache BC tool definitions
    estimatedTokensPerCall: {
      input: 3000,
      output: 2000,
    },
  },

  rag_agent: {
    role: 'rag_agent',
    description: 'RAG retrieval and knowledge synthesis - economic model',
    provider: 'anthropic' as ModelProvider,
    modelName: AnthropicModels.HAIKU_3_5, // Economic for retrieval
    temperature: 0.5,
    maxTokens: 4096,
    streaming: true,
    estimatedTokensPerCall: {
      input: 1000,
      output: 500,
    },
  },

  session_title: {
    role: 'session_title',
    description: 'Generate concise session titles from conversation',
    provider: 'anthropic' as ModelProvider,
    modelName: AnthropicModels.HAIKU_3_5, // Economic for simple task
    temperature: 0.7,
    maxTokens: 50,
    streaming: false,
    estimatedTokensPerCall: {
      input: 200,
      output: 20,
    },
  },

  embedding: {
    role: 'embedding',
    description: 'Text embeddings for semantic search (OpenAI)',
    provider: 'openai' as ModelProvider,
    modelName: 'text-embedding-3-small',
    temperature: 0,
    streaming: false,
    estimatedTokensPerCall: {
      input: 500,
      output: 0, // Embeddings don't have output tokens
    },
  },

  default: {
    role: 'default',
    description: 'Default fallback model for unspecified uses',
    provider: 'anthropic' as ModelProvider,
    modelName: AnthropicModels.SONNET_4_5,
    temperature: 0.7,
    maxTokens: 4096,
    streaming: true,
    estimatedTokensPerCall: {
      input: 1000,
      output: 500,
    },
  },
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get model configuration by role.
 * @param role - The model role
 * @returns ModelConfig ready for ModelFactory.create()
 */
export function getModelConfig(role: ModelRole): ModelConfig {
  const config = ModelRoleConfigs[role];
  if (!config) {
    throw new Error(`Unknown model role: ${role}`);
  }

  // Return only ModelConfig fields (exclude role metadata)
  const { role: _role, description: _desc, estimatedTokensPerCall: _est, ...modelConfig } = config;
  return modelConfig;
}

/**
 * Get model name by role (for quick access)
 */
export function getModelName(role: ModelRole): string {
  return ModelRoleConfigs[role].modelName;
}

/**
 * Estimate cost for a model role based on token counts
 */
export function estimateCost(
  role: ModelRole,
  inputTokens: number,
  outputTokens: number
): { cost: number; breakdown: { input: number; output: number } } {
  const config = ModelRoleConfigs[role];

  // Only Anthropic models have pricing defined
  if (config.provider !== 'anthropic') {
    return { cost: 0, breakdown: { input: 0, output: 0 } };
  }

  const pricing = AnthropicPricing[config.modelName as AnthropicModelId];
  if (!pricing) {
    return { cost: 0, breakdown: { input: 0, output: 0 } };
  }

  const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;

  return {
    cost: inputCost + outputCost,
    breakdown: { input: inputCost, output: outputCost },
  };
}

/**
 * Get monthly cost estimate for a role based on estimated usage
 * @param role - Model role
 * @param sessionsPerMonth - Expected sessions per month
 * @param callsPerSession - Average calls per session for this role
 */
export function estimateMonthlyCost(
  role: ModelRole,
  sessionsPerMonth: number,
  callsPerSession: number = 1
): number {
  const config = ModelRoleConfigs[role];
  const estimated = config.estimatedTokensPerCall;

  if (!estimated) return 0;

  const totalCalls = sessionsPerMonth * callsPerSession;
  const totalInput = totalCalls * estimated.input;
  const totalOutput = totalCalls * estimated.output;

  return estimateCost(role, totalInput, totalOutput).cost;
}

/**
 * Print a summary of all model configurations and estimated costs
 */
export function printModelSummary(sessionsPerMonth: number = 1000): void {
  console.log('\n=== Model Configuration Summary ===\n');

  let totalMonthlyCost = 0;

  for (const [role, config] of Object.entries(ModelRoleConfigs)) {
    const monthlyCost = estimateMonthlyCost(role as ModelRole, sessionsPerMonth);
    totalMonthlyCost += monthlyCost;

    console.log(`[${role.toUpperCase()}]`);
    console.log(`  Model: ${config.modelName}`);
    console.log(`  Provider: ${config.provider}`);
    console.log(`  Description: ${config.description}`);
    console.log(`  Est. Monthly Cost (${sessionsPerMonth} sessions): $${monthlyCost.toFixed(2)}`);
    console.log('');
  }

  console.log(`=== TOTAL ESTIMATED MONTHLY COST: $${totalMonthlyCost.toFixed(2)} ===\n`);
}
