import { describe, it, expect } from 'vitest';
import { StreamAdapterFactory } from '@/shared/providers/adapters/StreamAdapterFactory';
import { AnthropicStreamAdapter } from '@/shared/providers/adapters/AnthropicStreamAdapter';

describe('StreamAdapterFactory', () => {
  it('should create Anthropic adapter', () => {
    const adapter = StreamAdapterFactory.create('anthropic', 'session-1');
    expect(adapter).toBeInstanceOf(AnthropicStreamAdapter);
  });

  it('should throw error for unsupported provider', () => {
    expect(() => {
      // @ts-ignore - testing runtime validation
      StreamAdapterFactory.create('azure-openai', 'session-1');
    }).toThrow(/not yet supported/);
  });

  it('should throw error for unknown provider', () => {
    expect(() => {
      // @ts-ignore - testing runtime validation
      StreamAdapterFactory.create('unknown-provider', 'session-1');
    }).toThrow(/Unknown provider type/);
  });
});
