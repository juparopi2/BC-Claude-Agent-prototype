/**
 * ModelFactory - Universal Chat Model Initialization
 *
 * Provides a unified interface for creating chat models across different providers.
 * Uses role-based configuration for consistent model selection.
 *
 * @module core/langchain/ModelFactory
 */

import { initChatModel } from 'langchain';
import { ChatAnthropic } from '@langchain/anthropic';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { ModelRole, RoleModelConfig } from '@/infrastructure/config/models';
import { ModelRoleConfigs, AnthropicModels, OpenAIModels, GoogleModels } from '@/infrastructure/config/models';
import { env } from '@/infrastructure/config/environment';

export type ModelProvider = 'anthropic' | 'google' | 'openai';

/**
 * Model configuration for direct instantiation.
 * For role-based usage, prefer ModelFactory.create(role).
 */
export interface ModelConfig {
  provider: ModelProvider;
  modelName: string;
  temperature?: number;
  maxTokens?: number;
  streaming?: boolean;
}

/**
 * Cache key for model instances
 */
function getCacheKey(provider: string, modelName: string, config: { temperature?: number; maxTokens?: number }): string {
  return `${provider}:${modelName}:t${config.temperature ?? 'default'}:m${config.maxTokens ?? 'default'}`;
}

/**
 * ModelFactory provides a unified interface for creating chat models
 * across different providers using LangChain provider packages.
 */
export class ModelFactory {
  private static cache = new Map<string, BaseChatModel>();

  /**
   * Creates a chat model for a specific role.
   * Uses role configuration from ModelRoleConfigs.
   *
   * @param role - The model role (e.g., 'bc_agent', 'rag_agent', 'router')
   * @returns Promise<BaseChatModel> - Configured chat model instance
   *
   * @example
   * ```typescript
   * const model = await ModelFactory.create('bc_agent');
   * const response = await model.invoke([new HumanMessage('Hello')]);
   * ```
   */
  static async create(role: ModelRole): Promise<BaseChatModel> {
    const config = ModelRoleConfigs[role];
    if (!config) {
      throw new Error(`Unknown model role: ${role}`);
    }

    const cacheKey = getCacheKey(config.provider, config.modelName, {
      temperature: config.temperature,
      maxTokens: config.maxTokens,
    });

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const model = await this.createModel(config);
    this.cache.set(cacheKey, model);
    return model;
  }

  /**
   * Creates a chat model for a specific role with a different provider.
   * Useful for A/B testing or provider fallback scenarios.
   *
   * @param role - The model role
   * @param provider - Target provider ('anthropic', 'openai', 'google')
   * @returns Promise<BaseChatModel>
   */
  static async createWithProvider(role: ModelRole, provider: ModelProvider): Promise<BaseChatModel> {
    const config = ModelRoleConfigs[role];
    if (!config) {
      throw new Error(`Unknown model role: ${role}`);
    }

    // Determine model name for the provider
    let modelName: string;
    if (provider === config.provider) {
      modelName = config.modelName;
    } else {
      // Default fallback models per provider (using constants)
      const fallbackModels: Record<ModelProvider, string> = {
        anthropic: AnthropicModels.HAIKU_4_5,
        openai: OpenAIModels.GPT_4O_MINI,
        google: GoogleModels.GEMINI_2_FLASH,
      };
      modelName = fallbackModels[provider];
    }

    const cacheKey = getCacheKey(provider, modelName, {
      temperature: config.temperature,
      maxTokens: config.maxTokens,
    });

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const model = await this.createModel({
      ...config,
      provider,
      modelName,
    });
    this.cache.set(cacheKey, model);
    return model;
  }

  /**
   * Creates a chat model from explicit configuration.
   * For advanced use cases where role config doesn't fit.
   */
  static async createFromConfig(config: ModelConfig): Promise<BaseChatModel> {
    const cacheKey = getCacheKey(config.provider, config.modelName, {
      temperature: config.temperature,
      maxTokens: config.maxTokens,
    });

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const model = await this.createModel({
      ...config,
      role: 'default',
      description: 'Custom configuration',
      modelString: `${config.provider}:${config.modelName}`,
    } as RoleModelConfig);

    this.cache.set(cacheKey, model);
    return model;
  }

  /**
   * Creates a default model using the 'default' role configuration.
   */
  static async createDefault(): Promise<BaseChatModel> {
    return this.create('default');
  }

  /**
   * Internal method to create a model instance via initChatModel.
   * Uses the modelString from config which is already in the correct format
   * for each provider (bare model name for Anthropic, "provider:model" for others).
   */
  private static async createModel(config: RoleModelConfig): Promise<BaseChatModel> {
    const { modelString, temperature, maxTokens } = config;

    return await initChatModel(modelString, {
      temperature,
      maxTokens,
      // Explicit API keys - initChatModel reads env vars by default
      // but our Azure OpenAI key uses a non-standard env var name
      ...(config.provider === 'openai' ? { apiKey: env.AZURE_OPENAI_KEY } : {}),
      ...(config.provider === 'anthropic' ? { apiKey: env.ANTHROPIC_API_KEY } : {}),
    });
  }

  /**
   * Creates a ChatAnthropic model instance with extended thinking enabled.
   *
   * Thinking is an instance-level property in @langchain/anthropic — it cannot be
   * passed via .invoke() or .bind(). This method creates a separate model instance
   * with thinking configured at construction time.
   *
   * Constraints (Anthropic API):
   * - temperature must be undefined (defaults to 1) when thinking is enabled
   * - budget_tokens >= 1024
   * - maxTokens > budget_tokens
   *
   * @param role - The model role (used for maxTokens config)
   * @param budget - Token budget for thinking (default: 10000, minimum: 1024)
   * @returns Promise<BaseChatModel> - ChatAnthropic instance with thinking enabled
   */
  static async createForThinking(
    role: ModelRole,
    budget: number = 10000
  ): Promise<BaseChatModel> {
    const config = ModelRoleConfigs[role];

    // Use orchestrator model (Sonnet) for thinking — Haiku doesn't support extended thinking
    const thinkingModelName = ModelRoleConfigs['orchestrator'].modelName;
    const maxTokens = Math.max(config.maxTokens ?? 16384, budget + 4096);

    const cacheKey = `thinking:${thinkingModelName}:b${budget}:m${maxTokens}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    // Use ChatAnthropic directly — initChatModel doesn't support the thinking param
    const model = new ChatAnthropic({
      model: thinkingModelName,
      maxTokens,
      thinking: { type: 'enabled', budget_tokens: budget },
      apiKey: env.ANTHROPIC_API_KEY,
      // temperature NOT set — Anthropic requires temperature=1 for thinking (default)
    });

    this.cache.set(cacheKey, model as unknown as BaseChatModel);
    return model as unknown as BaseChatModel;
  }

  /**
   * Check if a model role supports a specific feature.
   * Note: Feature detection is best-effort.
   */
  static async supportsFeature(role: ModelRole, feature: string): Promise<boolean> {
    try {
      const model = await this.create(role);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const modelAny = model as any;
      return modelAny.profile?.[feature] ?? modelAny[feature] ?? false;
    } catch {
      return false;
    }
  }

  /**
   * Clears the model cache.
   * Useful for testing or when credentials change.
   */
  static clearCache(): void {
    this.cache.clear();
  }

  /**
   * Gets cache statistics for monitoring.
   */
  static getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }
}

/**
 * Helper function to get model config for a role.
 * Re-exported for convenience.
 */
export function getModelConfig(role: ModelRole): RoleModelConfig {
  const config = ModelRoleConfigs[role];
  if (!config) {
    throw new Error(`Unknown model role: ${role}`);
  }
  return config;
}
