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

describe('AnthropicStreamAdapter.normalizeStopReason', () => {
  const adapter = new AnthropicStreamAdapter('test-session');

  it('should normalize end_turn to success', () => {
    expect(adapter.normalizeStopReason('end_turn')).toBe('success');
  });

  it('should normalize tool_use to success', () => {
    expect(adapter.normalizeStopReason('tool_use')).toBe('success');
  });

  it('should normalize stop_sequence to success', () => {
    expect(adapter.normalizeStopReason('stop_sequence')).toBe('success');
  });

  it('should normalize max_tokens to max_turns', () => {
    expect(adapter.normalizeStopReason('max_tokens')).toBe('max_turns');
  });

  it('should default unknown stop reasons to success', () => {
    expect(adapter.normalizeStopReason('unknown_reason')).toBe('success');
  });
});
