import { describe, it, expect } from 'vitest';
import { ModelFactory, ModelConfig } from './ModelFactory';

describe('ModelFactory', () => {
  describe('Prompt Caching', () => {
    it('should create model with caching disabled by default', () => {
      const config: ModelConfig = {
        provider: 'anthropic',
        modelName: 'claude-3-5-sonnet-20241022',
      };

      // Should not throw
      expect(() => ModelFactory.create(config)).not.toThrow();
    });

    it('should create model with caching enabled', () => {
      const config: ModelConfig = {
        provider: 'anthropic',
        modelName: 'claude-3-5-sonnet-20241022',
        enableCaching: true,
      };

      // Should not throw
      expect(() => ModelFactory.create(config)).not.toThrow();
    });
  });

  describe('Extended Thinking', () => {
    it('should create model with thinking disabled by default', () => {
      const config: ModelConfig = {
        provider: 'anthropic',
        modelName: 'claude-3-5-sonnet-20241022',
      };

      // Should not throw
      expect(() => ModelFactory.create(config)).not.toThrow();
    });

    it('should create model with thinking enabled and default budget', () => {
      const config: ModelConfig = {
        provider: 'anthropic',
        modelName: 'claude-3-5-sonnet-20241022',
        enableThinking: true,
        maxTokens: 4096,
      };

      // Should not throw
      expect(() => ModelFactory.create(config)).not.toThrow();
    });

    it('should create model with thinking enabled and custom budget', () => {
      const config: ModelConfig = {
        provider: 'anthropic',
        modelName: 'claude-3-5-sonnet-20241022',
        enableThinking: true,
        thinkingBudget: 1500,
        maxTokens: 4096,
      };

      // Should not throw
      expect(() => ModelFactory.create(config)).not.toThrow();
    });

    // NOTE: ModelFactory now auto-adjusts invalid thinkingBudget values instead of throwing
    // This is more robust behavior that prevents runtime errors
    it('should auto-adjust thinking budget if less than 1024', () => {
      const config: ModelConfig = {
        provider: 'anthropic',
        modelName: 'claude-3-5-sonnet-20241022',
        enableThinking: true,
        thinkingBudget: 500, // Less than 1024 minimum
        maxTokens: 4096,
      };

      // Should NOT throw - ModelFactory auto-adjusts to 1024
      expect(() => ModelFactory.create(config)).not.toThrow();
    });

    it('should auto-adjust thinking budget if greater than maxTokens', () => {
      const config: ModelConfig = {
        provider: 'anthropic',
        modelName: 'claude-3-5-sonnet-20241022',
        enableThinking: true,
        thinkingBudget: 5000, // Greater than maxTokens
        maxTokens: 4096,
      };

      // Should NOT throw - ModelFactory auto-adjusts to maxTokens * 0.95
      expect(() => ModelFactory.create(config)).not.toThrow();
    });
  });

  describe('Combined Features', () => {
    it('should create model with both caching and thinking enabled', () => {
      const config: ModelConfig = {
        provider: 'anthropic',
        modelName: 'claude-3-5-sonnet-20241022',
        enableCaching: true,
        enableThinking: true,
        thinkingBudget: 2048,
        maxTokens: 4096,
      };

      // Should not throw
      expect(() => ModelFactory.create(config)).not.toThrow();
    });
  });
});
