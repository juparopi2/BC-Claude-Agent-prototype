import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatVertexAI } from '@langchain/google-vertexai';
import { ChatOpenAI } from '@langchain/openai';
import { env } from '@/infrastructure/config/environment';
import { getModelConfig } from '@/infrastructure/config/models';

export type ModelProvider = 'anthropic' | 'google' | 'openai';

export interface ModelConfig {
  provider: ModelProvider;
  modelName: string;
  temperature?: number;
  maxTokens?: number;
  streaming?: boolean;
  /**
   * Enable prompt caching for Anthropic models.
   * When enabled, cache control breakpoints can be set on system prompts and tools
   * to reduce costs and latency for repeated content.
   * @see https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
   */
  enableCaching?: boolean;
  /**
   * Enable extended thinking for Anthropic models.
   * When enabled, Claude uses internal reasoning before responding.
   * @see https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking
   */
  enableThinking?: boolean;
  /**
   * Budget for extended thinking in tokens.
   * Only used when enableThinking is true.
   * Must be >= 1024 and less than maxTokens.
   */
  thinkingBudget?: number;
}

export class ModelFactory {
  /**
   * Creates a configured ChatModel instance based on the provider
   */
  static create(config: ModelConfig): BaseChatModel {
    const {
      provider,
      modelName,
      temperature = 0.7,
      maxTokens,
      streaming = true,
      enableCaching = false,
      enableThinking = false,
      thinkingBudget,
    } = config;

    switch (provider) {
      case 'anthropic': {
        // Prepare thinking configuration
        let thinkingConfig: { type: 'enabled'; budget_tokens: number } | { type: 'disabled' } | undefined;

        if (enableThinking) {
          // Validate thinking budget
          let budget = thinkingBudget ?? 2048; // Default to 2048 tokens
          
          if (budget < 1024) {
             budget = 1024; // Minimum required by Anthropic
          }
          
          // Safety: Ensure budget doesn't exceed maxTokens
          if (maxTokens && budget >= maxTokens) {
             // AUTO-FIX: Clamp budget to 80% of maxTokens to prevent crash
             budget = Math.floor(maxTokens * 0.8);
             if (budget < 1024) budget = 1024; // Hard floor
          }

          if (maxTokens && budget >= maxTokens) {
             throw new Error(`Thinking budget (${budget}) must be less than maxTokens (${maxTokens})`);
          }

          thinkingConfig = {
            type: 'enabled',
            budget_tokens: budget,
          };
        } else {
          thinkingConfig = { type: 'disabled' };
        }

        // Prepare client options with beta headers
        // Always include PDF beta for document support (required for multi-modal PDF uploads)
        // Combine with caching beta header when caching is enabled
        const betaFeatures = ['pdfs-2024-09-25'];
        if (enableCaching) {
          betaFeatures.push('prompt-caching-2024-07-31');
        }

        const clientOptions = {
          defaultHeaders: {
            'anthropic-beta': betaFeatures.join(','),
          },
        };

        return new ChatAnthropic({
          modelName,
          // Temperature must be omitted/undefined when thinking is enabled
          temperature: enableThinking ? undefined : temperature,
          maxTokens,
          streaming,
          apiKey: env.ANTHROPIC_API_KEY,
          thinking: thinkingConfig,
          clientOptions,
        });
      }

      case 'google':
        // Ensure Google credentials are set in env or via ADC
        return new ChatVertexAI({
          model: modelName,
          temperature,
          maxOutputTokens: maxTokens,
          // VertexAI handles auth via GoogleAuth library automatically if GOOGLE_APPLICATION_CREDENTIALS is set
        });

      case 'openai':
        return new ChatOpenAI({
          modelName,
          temperature,
          maxTokens,
          streaming,
          apiKey: env.AZURE_OPENAI_KEY, // Mapping Azure key if using Azure, or standard OpenAI
          // If using Azure OpenAI specifically, we might need different config class
          // For now assuming standard OpenAI interface or Azure-compatible base
        });

      default:
        throw new Error(`Unsupported model provider: ${provider}`);
    }
  }

  /**
   * Create default model using centralized configuration
   */
  static createDefault(): BaseChatModel {
    // Use 'default' role from centralized config
    return this.create(getModelConfig('default'));
  }
}
