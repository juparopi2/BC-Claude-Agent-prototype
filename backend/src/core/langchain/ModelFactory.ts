/**
 * ModelFactory - Universal Chat Model Initialization
 *
 * Provides a unified interface for creating chat models across different providers.
 * Uses role-based configuration for consistent model selection.
 *
 * @module core/langchain/ModelFactory
 */

import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI } from '@langchain/openai';
import { ChatVertexAI } from '@langchain/google-vertexai';
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
function getCacheKey(provider: string, modelName: string, config: { temperature?: number; maxTokens?: number; streaming?: boolean; thinking?: { type: string } }): string {
  const thinkingKey = config.thinking?.type ?? 'none';
  return `${provider}:${modelName}:t${config.temperature ?? 'default'}:m${config.maxTokens ?? 'default'}:s${config.streaming ?? 'default'}:th${thinkingKey}`;
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
   * @param role - The model role (e.g., 'bc_agent', 'rag_agent', 'supervisor')
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
      streaming: config.streaming,
      thinking: config.thinking,
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
      streaming: config.streaming,
      thinking: config.thinking,
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
      streaming: config.streaming,
    });

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const model = await this.createModel({
      ...config,
      role: 'supervisor' as ModelRole, // Dummy role for type compatibility; not used by createModel
      description: 'Custom configuration',
      modelString: `${config.provider}:${config.modelName}`,
    } as RoleModelConfig);

    this.cache.set(cacheKey, model);
    return model;
  }

  /**
   * Internal method to create a model instance using direct provider constructors.
   * Avoids initChatModel's ConfigurableModel wrapper which calls JSON.stringify
   * on config (crashes with circular refs from LangGraph checkpointer objects).
   */
  private static async createModel(config: RoleModelConfig): Promise<BaseChatModel> {
    const { provider, modelName, temperature, maxTokens, streaming } = config;

    switch (provider) {
      case 'anthropic': {
        // Build default headers for prompt caching
        const defaultHeaders: Record<string, string> | undefined = config.promptCaching
          ? { 'anthropic-beta': 'prompt-caching-2024-07-31' }
          : undefined;

        // Build thinking config (only pass if enabled)
        const thinking = config.thinking?.type === 'enabled'
          ? config.thinking
          : undefined;

        return new ChatAnthropic({
          model: modelName,
          // Omit temperature when thinking is enabled (API requires temperature=1)
          ...(thinking ? {} : { temperature }),
          maxTokens,
          streaming,
          apiKey: env.ANTHROPIC_API_KEY,
          ...(thinking && { thinking }),
          clientOptions: {
            timeout: 15 * 60 * 1000, // 15 min safety net
            ...(defaultHeaders && { defaultHeaders }),
          },
        }) as unknown as BaseChatModel;
      }

      case 'openai':
        return new ChatOpenAI({
          model: modelName,
          temperature,
          maxTokens,
          apiKey: env.AZURE_OPENAI_KEY,
        }) as unknown as BaseChatModel;

      case 'google':
        return new ChatVertexAI({
          model: modelName,
          temperature,
          maxOutputTokens: maxTokens,
        }) as unknown as BaseChatModel;

      default: {
        const _exhaustive: never = provider;
        throw new Error(`Unsupported model provider: ${_exhaustive}`);
      }
    }
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
