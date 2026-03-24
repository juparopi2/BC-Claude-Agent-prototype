import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * EmbeddingServiceFactory unit tests (PRD-201)
 *
 * Tests the factory's feature-flag branching, singleton lifecycle, and
 * the convenience predicate isUnifiedIndexEnabled().
 *
 * Pattern: vi.hoisted + vi.mock lets individual tests toggle
 * mockEnv.USE_UNIFIED_INDEX without a full module reload.
 */

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before any imports that reference them
// ---------------------------------------------------------------------------

const mockEnv = vi.hoisted(() => ({
  USE_UNIFIED_INDEX: false as boolean,
  COHERE_ENDPOINT: 'https://test.models.ai.azure.com',
  COHERE_API_KEY: 'test-key',
}));

vi.mock('@/infrastructure/config/environment', () => ({ env: mockEnv }));

// Prevent CohereEmbeddingService constructor side-effects (Redis client,
// usage tracking service) from running during unit tests.
vi.mock('@/infrastructure/redis/redis', () => ({
  createRedisClient: vi.fn(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
  })),
}));

vi.mock('@/domains/billing/tracking/UsageTrackingService', () => ({
  getUsageTrackingService: vi.fn(() => ({ trackEmbedding: vi.fn() })),
}));

// ---------------------------------------------------------------------------
// Subject under test — imported AFTER mocks are registered
// ---------------------------------------------------------------------------

import {
  getUnifiedEmbeddingService,
  isUnifiedIndexEnabled,
  _resetForTesting,
} from '@/services/search/embeddings/EmbeddingServiceFactory';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EmbeddingServiceFactory (PRD-201)', () => {
  beforeEach(() => {
    // Clear the module-level singleton so each test starts clean
    _resetForTesting();
  });

  describe('getUnifiedEmbeddingService()', () => {
    it('returns undefined when USE_UNIFIED_INDEX is false', () => {
      mockEnv.USE_UNIFIED_INDEX = false;

      const result = getUnifiedEmbeddingService();

      expect(result).toBeUndefined();
    });

    it('returns a CohereEmbeddingService instance when USE_UNIFIED_INDEX is true', () => {
      mockEnv.USE_UNIFIED_INDEX = true;

      const result = getUnifiedEmbeddingService();

      expect(result).not.toBeUndefined();
      // Verify it exposes the IEmbeddingService contract
      expect(typeof result?.embedQuery).toBe('function');
      expect(typeof result?.embedText).toBe('function');
      expect(typeof result?.dimensions).toBe('number');
      expect(typeof result?.modelName).toBe('string');
    });

    it('returns the same singleton instance on repeated calls (USE_UNIFIED_INDEX=true)', () => {
      mockEnv.USE_UNIFIED_INDEX = true;

      const first = getUnifiedEmbeddingService();
      const second = getUnifiedEmbeddingService();

      expect(first).toBe(second);
    });

    it('returns a fresh instance after _resetForTesting()', () => {
      mockEnv.USE_UNIFIED_INDEX = true;

      const before = getUnifiedEmbeddingService();
      _resetForTesting();
      const after = getUnifiedEmbeddingService();

      // Both are valid instances but are distinct objects
      expect(before).not.toBeUndefined();
      expect(after).not.toBeUndefined();
      expect(before).not.toBe(after);
    });
  });

  describe('isUnifiedIndexEnabled()', () => {
    it('returns false when USE_UNIFIED_INDEX is false', () => {
      mockEnv.USE_UNIFIED_INDEX = false;

      expect(isUnifiedIndexEnabled()).toBe(false);
    });

    it('returns true when USE_UNIFIED_INDEX is true', () => {
      mockEnv.USE_UNIFIED_INDEX = true;

      expect(isUnifiedIndexEnabled()).toBe(true);
    });
  });
});
