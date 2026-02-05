import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ModelFactory } from './ModelFactory';

// Mock the provider classes
vi.mock('@langchain/anthropic', () => ({
  ChatAnthropic: vi.fn().mockImplementation(() => ({
    invoke: vi.fn(),
    bindTools: vi.fn(),
    withStructuredOutput: vi.fn(),
  })),
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
      const routerModel = await ModelFactory.create('router');

      expect(bcModel).toBeDefined();
      expect(ragModel).toBeDefined();
      expect(routerModel).toBeDefined();
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
        modelName: 'claude-sonnet-4-5-20250929',
        temperature: 0.5,
        maxTokens: 8192,
      });

      expect(model).toBeDefined();
    });
  });

  describe('createDefault', () => {
    it('should create default model', async () => {
      const model = await ModelFactory.createDefault();
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
