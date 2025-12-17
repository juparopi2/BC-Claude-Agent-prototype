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
  // Claude 4.5 Series (2025)
  OPUS_4_5: 'claude-opus-4-5-20250929',
  SONNET_4_5: 'claude-sonnet-4-5-20250929',

  // Claude 3.5 Series (Legacy 2024)
  SONNET_3_5: 'claude-3-5-sonnet-20241022',
  HAIKU_3_5: 'claude-3-5-haiku-20241022',

  // Claude 3 Series (Legacy)
  OPUS_3: 'claude-3-opus-20240229',
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
    maxTokens: 32000, // Increased for deep thinking workflows
    streaming: true,
    enableThinking: true,
    thinkingBudget: 16000,
    estimatedTokensPerCall: {
      input: 2000,
      output: 2000,
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
    maxTokens: 32000, // Increased to support long tool sequences
    streaming: true,
    enableCaching: true, // Cache BC tool definitions
    enableThinking: true, // Enable thinking for complex BC logic
    thinkingBudget: 4096,
    estimatedTokensPerCall: {
      input: 3000,
      output: 4000,
    },
  },

  rag_agent: {
    role: 'rag_agent',
    description: 'RAG retrieval and knowledge synthesis - smarter model for reasoning',
    provider: 'anthropic' as ModelProvider,
    modelName: AnthropicModels.SONNET_4_5, // Upgraded to Sonnet 4.5 as requested
    temperature: 0.5,
    maxTokens: 16384, // Increased for document synthesis
    streaming: true,
    estimatedTokensPerCall: {
      input: 2000,
      output: 1000,
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

// =============================================================================
// AZURE AI SERVICES CONFIGURATION
// Centralized configuration for Azure Vision, Document Intelligence, and Embeddings
// =============================================================================

/**
 * Azure OpenAI Embedding Models
 * @see https://learn.microsoft.com/en-us/azure/ai-services/openai/concepts/models
 */
export const AzureEmbeddingModels = {
  // Text Embedding Models
  TEXT_EMBEDDING_3_SMALL: 'text-embedding-3-small',  // 1536 dims, $0.02/1M tokens
  TEXT_EMBEDDING_3_LARGE: 'text-embedding-3-large',  // 3072 dims, $0.13/1M tokens
  TEXT_EMBEDDING_ADA_002: 'text-embedding-ada-002',  // 1536 dims, legacy
} as const;

export type AzureEmbeddingModelId = (typeof AzureEmbeddingModels)[keyof typeof AzureEmbeddingModels];

/**
 * Azure Computer Vision API Versions
 * Different versions have different capabilities for image understanding
 * @see https://learn.microsoft.com/en-us/azure/ai-services/computer-vision/
 */
export const AzureVisionModels = {
  // Image Vectorization (Embeddings)
  VECTORIZE_2023_04_15: '2023-04-15',    // 1024 dims, standard
  VECTORIZE_2024_02_01: '2024-02-01',    // Latest stable, better semantic understanding
} as const;

export type AzureVisionModelId = (typeof AzureVisionModels)[keyof typeof AzureVisionModels];

/**
 * Azure Document Intelligence Models
 * @see https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/
 */
export const AzureDocumentModels = {
  // Prebuilt Models
  PREBUILT_READ: 'prebuilt-read',           // Basic OCR, text extraction
  PREBUILT_LAYOUT: 'prebuilt-layout',       // Tables, structure, selection marks
  PREBUILT_DOCUMENT: 'prebuilt-document',   // Key-value pairs, entities
  PREBUILT_INVOICE: 'prebuilt-invoice',     // Invoice-specific extraction
  PREBUILT_RECEIPT: 'prebuilt-receipt',     // Receipt-specific extraction
} as const;

export type AzureDocumentModelId = (typeof AzureDocumentModels)[keyof typeof AzureDocumentModels];

/**
 * Azure AI Services Pricing (per unit)
 * @see https://azure.microsoft.com/en-us/pricing/details/cognitive-services/
 */
export interface AzureServicePricing {
  pricePerUnit: number;
  unit: string;
  tier: 'free' | 'standard' | 'premium';
}

export const AzureEmbeddingPricing: Record<AzureEmbeddingModelId, AzureServicePricing> = {
  [AzureEmbeddingModels.TEXT_EMBEDDING_3_SMALL]: {
    pricePerUnit: 0.02,
    unit: '1M tokens',
    tier: 'standard',
  },
  [AzureEmbeddingModels.TEXT_EMBEDDING_3_LARGE]: {
    pricePerUnit: 0.13,
    unit: '1M tokens',
    tier: 'premium',
  },
  [AzureEmbeddingModels.TEXT_EMBEDDING_ADA_002]: {
    pricePerUnit: 0.10,
    unit: '1M tokens',
    tier: 'standard',
  },
};

export const AzureVisionPricing: Record<AzureVisionModelId, AzureServicePricing> = {
  [AzureVisionModels.VECTORIZE_2023_04_15]: {
    pricePerUnit: 1.0,
    unit: '1K images',
    tier: 'standard',
  },
  [AzureVisionModels.VECTORIZE_2024_02_01]: {
    pricePerUnit: 1.0,
    unit: '1K images',
    tier: 'standard',
  },
};

export const AzureDocumentPricing: Record<AzureDocumentModelId, AzureServicePricing> = {
  [AzureDocumentModels.PREBUILT_READ]: {
    pricePerUnit: 1.5,
    unit: '1K pages',
    tier: 'standard',
  },
  [AzureDocumentModels.PREBUILT_LAYOUT]: {
    pricePerUnit: 10.0,
    unit: '1K pages',
    tier: 'premium',
  },
  [AzureDocumentModels.PREBUILT_DOCUMENT]: {
    pricePerUnit: 10.0,
    unit: '1K pages',
    tier: 'premium',
  },
  [AzureDocumentModels.PREBUILT_INVOICE]: {
    pricePerUnit: 10.0,
    unit: '1K pages',
    tier: 'premium',
  },
  [AzureDocumentModels.PREBUILT_RECEIPT]: {
    pricePerUnit: 10.0,
    unit: '1K pages',
    tier: 'premium',
  },
};

// =============================================================================
// AZURE AI SERVICE ROLES
// =============================================================================

/**
 * Azure service roles for different use cases
 */
export type AzureServiceRole =
  | 'text_embedding'      // Text to vector for semantic search
  | 'image_embedding'     // Image to vector for visual search
  | 'document_ocr'        // PDF/document text extraction
  | 'document_structure'; // Document layout and table extraction

/**
 * Azure service configuration with role metadata
 */
export interface AzureServiceConfig {
  role: AzureServiceRole;
  description: string;
  modelId: string;
  apiVersion: string;
  dimensions?: number;
  tier: 'free' | 'standard' | 'premium';
}

/**
 * Central configuration for Azure AI Services
 * Change these to swap models across the entire application
 */
export const AzureServiceConfigs: Record<AzureServiceRole, AzureServiceConfig> = {
  text_embedding: {
    role: 'text_embedding',
    description: 'Convert text queries to vectors for semantic search',
    modelId: AzureEmbeddingModels.TEXT_EMBEDDING_3_SMALL,
    apiVersion: '2024-06-01',
    dimensions: 1536,
    tier: 'standard',
  },

  image_embedding: {
    role: 'image_embedding',
    description: 'Convert images to vectors for visual similarity search',
    modelId: 'vectorize-image', // Azure Vision endpoint
    apiVersion: AzureVisionModels.VECTORIZE_2024_02_01,
    dimensions: 1024,
    tier: 'standard',
  },

  document_ocr: {
    role: 'document_ocr',
    description: 'Extract text from PDFs and scanned documents',
    modelId: AzureDocumentModels.PREBUILT_READ,
    apiVersion: '2024-02-29-preview',
    tier: 'standard',
  },

  document_structure: {
    role: 'document_structure',
    description: 'Extract tables, structure, and layout from documents',
    modelId: AzureDocumentModels.PREBUILT_LAYOUT,
    apiVersion: '2024-02-29-preview',
    tier: 'premium',
  },
};

/**
 * Get Azure service configuration by role
 */
export function getAzureServiceConfig(role: AzureServiceRole): AzureServiceConfig {
  const config = AzureServiceConfigs[role];
  if (!config) {
    throw new Error(`Unknown Azure service role: ${role}`);
  }
  return config;
}

/**
 * Get Azure model ID by role
 */
export function getAzureModelId(role: AzureServiceRole): string {
  return AzureServiceConfigs[role].modelId;
}

/**
 * Get Azure API version by role
 */
export function getAzureApiVersion(role: AzureServiceRole): string {
  return AzureServiceConfigs[role].apiVersion;
}

// =============================================================================
// PREMIUM TIER CONFIGURATIONS (for high-value customers)
// =============================================================================

/**
 * Premium configuration overrides for customers requiring higher accuracy
 * Use these when standard tier doesn't meet quality requirements
 */
export const PremiumAzureServiceConfigs: Partial<Record<AzureServiceRole, AzureServiceConfig>> = {
  text_embedding: {
    role: 'text_embedding',
    description: 'Premium text embeddings with 3072 dimensions for better semantic accuracy',
    modelId: AzureEmbeddingModels.TEXT_EMBEDDING_3_LARGE,
    apiVersion: '2024-06-01',
    dimensions: 3072,
    tier: 'premium',
  },

  document_ocr: {
    role: 'document_ocr',
    description: 'Premium document extraction with table and structure support',
    modelId: AzureDocumentModels.PREBUILT_LAYOUT,
    apiVersion: '2024-02-29-preview',
    tier: 'premium',
  },
};

/**
 * Get configuration for a specific tier
 * @param role - Azure service role
 * @param tier - 'standard' or 'premium'
 */
export function getAzureServiceConfigByTier(
  role: AzureServiceRole,
  tier: 'standard' | 'premium' = 'standard'
): AzureServiceConfig {
  if (tier === 'premium' && PremiumAzureServiceConfigs[role]) {
    return PremiumAzureServiceConfigs[role]!;
  }
  return AzureServiceConfigs[role];
}
