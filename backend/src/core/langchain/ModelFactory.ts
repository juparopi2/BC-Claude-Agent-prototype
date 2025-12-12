import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatVertexAI } from '@langchain/google-vertexai';
import { ChatOpenAI } from '@langchain/openai';
import { env } from '../../config';

export type ModelProvider = 'anthropic' | 'google' | 'openai';

export interface ModelConfig {
  provider: ModelProvider;
  modelName: string;
  temperature?: number;
  maxTokens?: number;
  streaming?: boolean;
}

export class ModelFactory {
  /**
   * Creates a configured ChatModel instance based on the provider
   */
  static create(config: ModelConfig): BaseChatModel {
    const { provider, modelName, temperature = 0.7, maxTokens, streaming = true } = config;

    switch (provider) {
      case 'anthropic':
        return new ChatAnthropic({
          modelName,
          temperature,
          maxTokens,
          streaming,
          apiKey: env.ANTHROPIC_API_KEY,
        });

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

  static createDefault(): BaseChatModel {
    return this.create({
        provider: 'anthropic',
        modelName: 'claude-3-5-sonnet-20241022'
    });
  }
}
