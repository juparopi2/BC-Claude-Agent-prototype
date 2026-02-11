import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ModelFactory } from '@/core/langchain/ModelFactory';

// Mock the provider classes with vi.hoisted for proper mock factory hoisting
const mockChatAnthropicConstructor = vi.hoisted(() => vi.fn().mockImplementation(() => ({
  invoke: vi.fn(),
  bindTools: vi.fn(),
  withStructuredOutput: vi.fn(),
})));

vi.mock('@langchain/anthropic', () => ({
  ChatAnthropic: mockChatAnthropicConstructor,
}));

vi.mock('@langchain/google-vertexai', () => ({
  ChatVertexAI: vi.fn().mockImplementation(() => ({
    invoke: vi.fn(),
    bindTools: vi.fn(),
  })),
}));

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: vi.fn().mockImplementation(() => ({
    invoke: vi.fn(),
    bindTools: vi.fn(),
  })),
}));

describe('ModelFactory', () => {
  beforeEach(() => {
    // Clear cache before each test
    ModelFactory.clearCache();
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('should create model by role', async () => {
      const model = await ModelFactory.create('bc_agent');
      expect(model).toBeDefined();
      expect(model.invoke).toBeDefined();
    });

    it('should create model for different roles', async () => {
      const bcModel = await ModelFactory.create('bc_agent');
      const ragModel = await ModelFactory.create('rag_agent');
      const supervisorModel = await ModelFactory.create('supervisor');

      expect(bcModel).toBeDefined();
      expect(ragModel).toBeDefined();
      expect(supervisorModel).toBeDefined();
    });

    it('should throw for unknown role', async () => {
      await expect(ModelFactory.create('unknown_role' as never)).rejects.toThrow('Unknown model role');
    });

    it('should cache models with same configuration', async () => {
      const model1 = await ModelFactory.create('bc_agent');
      const model2 = await ModelFactory.create('bc_agent');

      // Should be the same cached instance
      expect(model1).toBe(model2);
    });

    it('should not cache models with different configurations', async () => {
      const model1 = await ModelFactory.create('bc_agent');
      const model2 = await ModelFactory.create('rag_agent');

      // Should be different instances
      expect(model1).not.toBe(model2);
    });

    it('should pass streaming to ChatAnthropic constructor', async () => {
      await ModelFactory.create('bc_agent');

      expect(mockChatAnthropicConstructor).toHaveBeenCalledWith(
        expect.objectContaining({
          streaming: true,
        })
      );
    });

    it('should pass clientOptions.timeout to ChatAnthropic constructor', async () => {
      await ModelFactory.create('bc_agent');

      expect(mockChatAnthropicConstructor).toHaveBeenCalledWith(
        expect.objectContaining({
          clientOptions: expect.objectContaining({
            timeout: 15 * 60 * 1000,
          }),
        })
      );
    });

    it('should pass thinking config to ChatAnthropic constructor', async () => {
      await ModelFactory.create('bc_agent');

      expect(mockChatAnthropicConstructor).toHaveBeenCalledWith(
        expect.objectContaining({
          thinking: { type: 'enabled', budget_tokens: 5000 },
        })
      );
    });

    it('should omit temperature when thinking is enabled', async () => {
      await ModelFactory.create('bc_agent');

      const call = mockChatAnthropicConstructor.mock.calls[0][0];
      expect(call.thinking).toEqual({ type: 'enabled', budget_tokens: 5000 });
      expect(call.temperature).toBeUndefined();
    });

    it('should pass temperature when thinking is disabled', async () => {
      await ModelFactory.create('supervisor');

      const call = mockChatAnthropicConstructor.mock.calls[0][0];
      expect(call.thinking).toBeUndefined();
      expect(call.temperature).toBeDefined();
      expect(typeof call.temperature).toBe('number');
    });

    it('should pass prompt caching headers to ChatAnthropic constructor', async () => {
      await ModelFactory.create('bc_agent');

      expect(mockChatAnthropicConstructor).toHaveBeenCalledWith(
        expect.objectContaining({
          clientOptions: expect.objectContaining({
            defaultHeaders: { 'anthropic-beta': 'prompt-caching-2024-07-31' },
          }),
        })
      );
    });

    it('should not pass thinking config when disabled', async () => {
      await ModelFactory.create('supervisor');

      // Supervisor has thinking: { type: 'disabled' }, so thinking should NOT be passed
      const call = mockChatAnthropicConstructor.mock.calls[0][0];
      expect(call.thinking).toBeUndefined();
    });

    it('should include streaming and thinking in cache key', async () => {
      // bc_agent has streaming: true, session_title has streaming: false
      await ModelFactory.create('bc_agent');
      await ModelFactory.create('session_title');

      const stats = ModelFactory.getCacheStats();
      const keys = stats.keys;
      // Both should have different streaming in cache key
      expect(keys.some(k => k.includes(':strue'))).toBe(true);
      expect(keys.some(k => k.includes(':sfalse'))).toBe(true);
      // bc_agent has thinking enabled, session_title has none
      expect(keys.some(k => k.includes(':thenabled'))).toBe(true);
      expect(keys.some(k => k.includes(':thnone'))).toBe(true);
    });
  });

  describe('createWithProvider', () => {
    it('should create model with specified provider', async () => {
      const model = await ModelFactory.createWithProvider('bc_agent', 'openai');
      expect(model).toBeDefined();
    });

    it('should throw for unknown role', async () => {
      await expect(ModelFactory.createWithProvider('unknown_role' as never, 'openai')).rejects.toThrow('Unknown model role');
    });
  });

  describe('createFromConfig', () => {
    it('should create model from explicit config', async () => {
      const model = await ModelFactory.createFromConfig({
        provider: 'anthropic',
        modelName: 'claude-haiku-4-5-20251001',
        temperature: 0.5,
        maxTokens: 8192,
      });

      expect(model).toBeDefined();
    });
  });

  describe('supportsFeature', () => {
    it('should check if model supports a feature', async () => {
      const supportsTools = await ModelFactory.supportsFeature('bc_agent', 'tools');
      expect(typeof supportsTools).toBe('boolean');
    });
  });

  describe('cache management', () => {
    it('should clear cache', async () => {
      await ModelFactory.create('bc_agent');
      const statsBefore = ModelFactory.getCacheStats();
      expect(statsBefore.size).toBeGreaterThan(0);

      ModelFactory.clearCache();
      const statsAfter = ModelFactory.getCacheStats();
      expect(statsAfter.size).toBe(0);
    });

    it('should return cache statistics', async () => {
      await ModelFactory.create('bc_agent');
      await ModelFactory.create('rag_agent');

      const stats = ModelFactory.getCacheStats();
      expect(stats.size).toBe(2);
      expect(stats.keys).toHaveLength(2);
    });
  });
});
