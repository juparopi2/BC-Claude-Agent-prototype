import { IStreamAdapter, ProviderType } from '../interfaces';
import { AnthropicStreamAdapter } from './AnthropicStreamAdapter';

/**
 * Factory class for creating provider-specific stream adapters.
 * Ensures the correct adapter is used for the configured provider.
 */
export class StreamAdapterFactory {
  /**
   * Creates a stream adapter instance for the specified provider.
   *
   * @param provider - The provider type (e.g., 'anthropic', 'azure-openai')
   * @param sessionId - The session ID for context tracking
   * @returns An instance of IStreamAdapter
   * @throws Error if the provider is not supported
   */
  static create(provider: ProviderType, sessionId: string): IStreamAdapter {
    switch (provider) {
      case 'anthropic':
        return new AnthropicStreamAdapter(sessionId);
      
      case 'azure-openai':
      case 'openai':
      case 'google':
        throw new Error(`Provider '${provider}' is not yet supported in Phase 0.5`);
        
      default:
        // TypeScript exhaustive check or runtime safety
        throw new Error(`Unknown provider type: ${provider}`);
    }
  }
}
