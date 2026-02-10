/**
 * ModelFactory Unit Tests
 *
 * Tests for ModelFactory.createForThinking() method with extended thinking support.
 * Covers thinking model creation, caching, configuration validation, and API key injection.
 *
 * Created: 2026-02-05
 * Coverage Target: 100% for createForThinking method
 * Test Count: 8
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ModelFactory } from '@/core/langchain/ModelFactory';
import type { ModelRole } from '@/infrastructure/config/models';
import { AnthropicModels } from '@/infrastructure/config/models';

// ============================================================================
// MOCKS SETUP
// ============================================================================

// Mock ChatAnthropic class - creates new instance each time
const MockChatAnthropic = vi.hoisted(() => {
  return vi.fn((config: any) => {
    // Return new instance each time to support caching tests
    return {
      model: config.model,
      maxTokens: config.maxTokens,
      thinking: config.thinking,
      apiKey: config.apiKey,
    };
  });
});

vi.mock('@langchain/anthropic', () => ({
  ChatAnthropic: MockChatAnthropic,
}));

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: vi.fn((config: any) => ({
    model: config.model,
    maxTokens: config.maxTokens,
    apiKey: config.apiKey,
  })),
}));

vi.mock('@langchain/google-vertexai', () => ({
  ChatVertexAI: vi.fn((config: any) => ({
    model: config.model,
    maxOutputTokens: config.maxOutputTokens,
  })),
}));

// Mock environment config
vi.mock('@/infrastructure/config/environment', () => ({
  env: {
    ANTHROPIC_API_KEY: 'test-anthropic-key',
    AZURE_OPENAI_KEY: 'test-azure-key',
  },
}));

// Real ModelRoleConfigs for actual config values
// DO NOT mock - we want real config values for assertions
// The models.ts imports are real

// ============================================================================
// TEST SUITE
// ============================================================================

describe('ModelFactory.createForThinking()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ModelFactory.clearCache(); // Clear cache before each test
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // 1. BASIC CREATION (2 tests)
  // ==========================================================================

  describe('Basic Creation', () => {
    it('should create ChatAnthropic with thinking enabled', async () => {
      const role: ModelRole = 'bc_agent';
      const budget = 10000;

      const model = await ModelFactory.createForThinking(role, budget);

      expect(model).toBeDefined();
      expect(MockChatAnthropic).toHaveBeenCalledOnce();
      expect(MockChatAnthropic).toHaveBeenCalledWith({
        model: AnthropicModels.SONNET_4_5, // orchestrator model
        maxTokens: expect.any(Number),
        thinking: {
          type: 'enabled',
          budget_tokens: budget,
        },
        apiKey: 'test-anthropic-key',
      });
    });

    it('should use default budget of 10000 when not specified', async () => {
      const role: ModelRole = 'rag_agent';

      const model = await ModelFactory.createForThinking(role);

      expect(model).toBeDefined();
      expect(MockChatAnthropic).toHaveBeenCalledWith(
        expect.objectContaining({
          thinking: {
            type: 'enabled',
            budget_tokens: 10000,
          },
        })
      );
    });
  });

  // ==========================================================================
  // 2. MODEL SELECTION (1 test)
  // ==========================================================================

  describe('Model Selection', () => {
    it('should use orchestrator model (Sonnet) regardless of role passed', async () => {
      const roles: ModelRole[] = ['bc_agent', 'rag_agent', 'router', 'default'];

      for (const role of roles) {
        vi.clearAllMocks();
        ModelFactory.clearCache();

        await ModelFactory.createForThinking(role, 10000);

        expect(MockChatAnthropic).toHaveBeenCalledWith(
          expect.objectContaining({
            model: AnthropicModels.SONNET_4_5, // Always orchestrator model
          })
        );
      }
    });
  });

  // ==========================================================================
  // 3. MAX TOKENS CALCULATION (2 tests)
  // ==========================================================================

  describe('Max Tokens Calculation', () => {
    it('should compute maxTokens as budget + 4096 when greater than config maxTokens', async () => {
      const role: ModelRole = 'rag_agent'; // rag_agent.maxTokens = 16384
      const budget = 20000; // budget + 4096 = 24096 > 16384

      await ModelFactory.createForThinking(role, budget);

      expect(MockChatAnthropic).toHaveBeenCalledWith(
        expect.objectContaining({
          maxTokens: 24096, // budget + 4096
        })
      );
    });

    it('should use config maxTokens when budget + 4096 is smaller', async () => {
      const role: ModelRole = 'orchestrator'; // orchestrator.maxTokens = 32000
      const budget = 10000; // budget + 4096 = 14096 < 32000

      await ModelFactory.createForThinking(role, budget);

      expect(MockChatAnthropic).toHaveBeenCalledWith(
        expect.objectContaining({
          maxTokens: 32000, // config.maxTokens
        })
      );
    });
  });

  // ==========================================================================
  // 4. CACHING (2 tests)
  // ==========================================================================

  describe('Caching', () => {
    it('should cache model and return same instance on second call', async () => {
      const role: ModelRole = 'bc_agent';
      const budget = 10000;

      const model1 = await ModelFactory.createForThinking(role, budget);
      const model2 = await ModelFactory.createForThinking(role, budget);

      expect(model1).toBe(model2);
      expect(MockChatAnthropic).toHaveBeenCalledOnce();
    });

    it('should create different instances for different budgets', async () => {
      const role: ModelRole = 'bc_agent';

      const model1 = await ModelFactory.createForThinking(role, 10000);
      const model2 = await ModelFactory.createForThinking(role, 20000);

      expect(model1).not.toBe(model2);
      expect(MockChatAnthropic).toHaveBeenCalledTimes(2);
    });
  });

  // ==========================================================================
  // 5. CACHE CLEARING (1 test)
  // ==========================================================================

  describe('Cache Clearing', () => {
    it('should clear thinking models when clearCache() is called', async () => {
      const role: ModelRole = 'bc_agent';
      const budget = 10000;

      // Create and cache model
      const model1 = await ModelFactory.createForThinking(role, budget);
      expect(MockChatAnthropic).toHaveBeenCalledOnce();

      // Clear cache
      ModelFactory.clearCache();

      // Create again (should call constructor again)
      const model2 = await ModelFactory.createForThinking(role, budget);
      expect(MockChatAnthropic).toHaveBeenCalledTimes(2);

      // Different instances after cache clear
      expect(model1).not.toBe(model2);
    });
  });

  // ==========================================================================
  // 6. API KEY INJECTION (1 test)
  // ==========================================================================

  describe('API Key Injection', () => {
    it('should pass ANTHROPIC_API_KEY from environment', async () => {
      const role: ModelRole = 'bc_agent';

      await ModelFactory.createForThinking(role);

      expect(MockChatAnthropic).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'test-anthropic-key',
        })
      );
    });
  });

  // ==========================================================================
  // 7. CACHE KEY FORMAT (1 test)
  // ==========================================================================

  describe('Cache Key Format', () => {
    it('should generate correct cache key format', async () => {
      const role: ModelRole = 'bc_agent'; // bc_agent.maxTokens = 32000
      const budget = 15000; // budget + 4096 = 19096 < 32000
      const expectedMaxTokens = 32000; // Math.max(32000, 19096) = 32000

      await ModelFactory.createForThinking(role, budget);

      const stats = ModelFactory.getCacheStats();
      const expectedKey = `thinking:${AnthropicModels.SONNET_4_5}:b${budget}:m${expectedMaxTokens}`;

      expect(stats.keys).toContain(expectedKey);
      expect(stats.size).toBe(1);
    });
  });
});
