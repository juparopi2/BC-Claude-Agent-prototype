/**
 * Token Usage Service Tests
 *
 * Unit tests for TokenUsageService.
 * These tests mock the database layer to test service logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TokenUsageRecord } from '@/services/token-usage/TokenUsageService';

// Mock the database module
vi.mock('@/config/database', () => ({
  executeQuery: vi.fn(),
}));

// Mock the logger
vi.mock('@/utils/logger', () => ({
  createChildLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// Import after mocking
import { TokenUsageService, getTokenUsageService } from '@/services/token-usage/TokenUsageService';
import { executeQuery } from '@/config/database';

describe('TokenUsageService', () => {
  let service: TokenUsageService;
  const mockExecuteQuery = vi.mocked(executeQuery);

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset singleton for each test
    // @ts-expect-error - accessing private static for testing
    TokenUsageService.instance = null;
    service = getTokenUsageService();
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance', () => {
      const instance1 = getTokenUsageService();
      const instance2 = getTokenUsageService();
      expect(instance1).toBe(instance2);
    });
  });

  describe('recordUsage', () => {
    it('should insert token usage record into database', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [],
        recordsets: [],
        rowsAffected: [1],
        output: {},
      });

      const record: TokenUsageRecord = {
        userId: 'user-123',
        sessionId: 'session-456',
        messageId: 'msg_01ABC',
        model: 'claude-sonnet-4-5-20250929',
        inputTokens: 1000,
        outputTokens: 500,
        thinkingEnabled: false,
      };

      await service.recordUsage(record);

      expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO token_usage'),
        expect.objectContaining({
          user_id: 'user-123',
          session_id: 'session-456',
          message_id: 'msg_01ABC',
          model: 'claude-sonnet-4-5-20250929',
          input_tokens: 1000,
          output_tokens: 500,
          thinking_enabled: 0,
        })
      );
    });

    it('should include cache tokens when provided', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [],
        recordsets: [],
        rowsAffected: [1],
        output: {},
      });

      const record: TokenUsageRecord = {
        userId: 'user-123',
        sessionId: 'session-456',
        messageId: 'msg_01ABC',
        model: 'claude-sonnet-4-5-20250929',
        inputTokens: 1000,
        outputTokens: 500,
        cacheCreationInputTokens: 200,
        cacheReadInputTokens: 800,
        thinkingEnabled: true,
        thinkingBudget: 15000,
        serviceTier: 'standard',
      };

      await service.recordUsage(record);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO token_usage'),
        expect.objectContaining({
          cache_creation_input_tokens: 200,
          cache_read_input_tokens: 800,
          thinking_enabled: 1,
          thinking_budget: 15000,
          service_tier: 'standard',
        })
      );
    });

    it('should not throw on database error (fire-and-forget)', async () => {
      mockExecuteQuery.mockRejectedValueOnce(new Error('Database error'));

      const record: TokenUsageRecord = {
        userId: 'user-123',
        sessionId: 'session-456',
        messageId: 'msg_01ABC',
        model: 'claude-sonnet-4-5-20250929',
        inputTokens: 1000,
        outputTokens: 500,
        thinkingEnabled: false,
      };

      // Should not throw
      await expect(service.recordUsage(record)).resolves.toBeUndefined();
    });
  });

  describe('getUserTotals', () => {
    it('should return user totals from view', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{
          user_id: 'user-123',
          total_requests: 10,
          total_input_tokens: 5000,
          total_output_tokens: 2500,
          total_tokens: 7500,
          total_cache_creation_tokens: 500,
          total_cache_read_tokens: 4000,
          thinking_requests: 3,
          first_request: new Date('2025-01-01'),
          last_request: new Date('2025-01-24'),
        }],
        recordsets: [],
        rowsAffected: [1],
        output: {},
      });

      const totals = await service.getUserTotals('user-123');

      expect(totals).toEqual({
        userId: 'user-123',
        totalRequests: 10,
        totalInputTokens: 5000,
        totalOutputTokens: 2500,
        totalTokens: 7500,
        totalCacheCreationTokens: 500,
        totalCacheReadTokens: 4000,
        thinkingRequests: 3,
        firstRequest: new Date('2025-01-01'),
        lastRequest: new Date('2025-01-24'),
      });
    });

    it('should return null when no usage found', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [],
        recordsets: [],
        rowsAffected: [0],
        output: {},
      });

      const totals = await service.getUserTotals('nonexistent-user');

      expect(totals).toBeNull();
    });
  });

  describe('getSessionTotals', () => {
    it('should return session totals from view', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{
          session_id: 'session-456',
          user_id: 'user-123',
          total_requests: 5,
          total_input_tokens: 2500,
          total_output_tokens: 1250,
          total_tokens: 3750,
          total_cache_creation_tokens: 250,
          total_cache_read_tokens: 2000,
          session_start: new Date('2025-01-24T10:00:00Z'),
          session_last_activity: new Date('2025-01-24T11:30:00Z'),
        }],
        recordsets: [],
        rowsAffected: [1],
        output: {},
      });

      const totals = await service.getSessionTotals('session-456');

      expect(totals).toEqual({
        sessionId: 'session-456',
        userId: 'user-123',
        totalRequests: 5,
        totalInputTokens: 2500,
        totalOutputTokens: 1250,
        totalTokens: 3750,
        totalCacheCreationTokens: 250,
        totalCacheReadTokens: 2000,
        sessionStart: new Date('2025-01-24T10:00:00Z'),
        sessionLastActivity: new Date('2025-01-24T11:30:00Z'),
      });
    });

    it('should return null when no session found', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [],
        recordsets: [],
        rowsAffected: [0],
        output: {},
      });

      const totals = await service.getSessionTotals('nonexistent-session');

      expect(totals).toBeNull();
    });
  });

  describe('getMonthlyUsageByModel', () => {
    it('should return monthly breakdown by model', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [
          { model: 'claude-sonnet-4-5-20250929', year: 2025, month: 1, total_tokens: 10000, requests: 20 },
          { model: 'claude-opus-4-5-20251101', year: 2025, month: 1, total_tokens: 5000, requests: 5 },
          { model: 'claude-sonnet-4-5-20250929', year: 2024, month: 12, total_tokens: 8000, requests: 15 },
        ],
        recordsets: [],
        rowsAffected: [3],
        output: {},
      });

      const usage = await service.getMonthlyUsageByModel('user-123', 12);

      expect(usage).toHaveLength(3);
      expect(usage[0]).toEqual({
        model: 'claude-sonnet-4-5-20250929',
        year: 2025,
        month: 1,
        totalTokens: 10000,
        requests: 20,
      });
    });
  });

  describe('getTopSessionsByUsage', () => {
    it('should return top sessions ordered by total tokens', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [
          {
            session_id: 'session-1',
            user_id: 'user-123',
            total_requests: 10,
            total_input_tokens: 5000,
            total_output_tokens: 2500,
            total_tokens: 7500,
            total_cache_creation_tokens: 500,
            total_cache_read_tokens: 4000,
            session_start: new Date('2025-01-20'),
            session_last_activity: new Date('2025-01-24'),
          },
          {
            session_id: 'session-2',
            user_id: 'user-123',
            total_requests: 5,
            total_input_tokens: 2000,
            total_output_tokens: 1000,
            total_tokens: 3000,
            total_cache_creation_tokens: 200,
            total_cache_read_tokens: 1500,
            session_start: new Date('2025-01-15'),
            session_last_activity: new Date('2025-01-15'),
          },
        ],
        recordsets: [],
        rowsAffected: [2],
        output: {},
      });

      const sessions = await service.getTopSessionsByUsage('user-123', 10);

      expect(sessions).toHaveLength(2);
      expect(sessions[0]?.sessionId).toBe('session-1');
      expect(sessions[0]?.totalTokens).toBe(7500);
    });
  });

  describe('getCacheEfficiency', () => {
    it('should calculate cache efficiency metrics', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{
          total_input_tokens: 10000,
          cache_read_tokens: 8000,
          cache_creation_tokens: 500,
        }],
        recordsets: [],
        rowsAffected: [1],
        output: {},
      });

      const efficiency = await service.getCacheEfficiency('user-123');

      expect(efficiency.totalInputTokens).toBe(10000);
      expect(efficiency.cacheReadTokens).toBe(8000);
      expect(efficiency.cacheCreationTokens).toBe(500);
      // Cache hit rate = 8000 / (10000 + 500) = 0.762
      expect(efficiency.cacheHitRate).toBeCloseTo(0.762, 2);
      // Estimated savings = 8000 * 0.9 = 7200
      expect(efficiency.estimatedSavings).toBe(7200);
    });

    it('should handle zero totals gracefully', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{
          total_input_tokens: 0,
          cache_read_tokens: 0,
          cache_creation_tokens: 0,
        }],
        recordsets: [],
        rowsAffected: [1],
        output: {},
      });

      const efficiency = await service.getCacheEfficiency('user-123');

      expect(efficiency.cacheHitRate).toBe(0);
      expect(efficiency.estimatedSavings).toBe(0);
    });
  });
});
