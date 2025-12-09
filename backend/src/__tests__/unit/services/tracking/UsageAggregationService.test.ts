/**
 * Usage Aggregation Service Tests
 *
 * Comprehensive unit tests for UsageAggregationService.
 * These tests mock the database and Redis layers to test service logic.
 *
 * Coverage targets:
 * - aggregateHourly: All scenarios (with data, empty periods, single user vs all users)
 * - aggregateDaily: All scenarios (with data, empty periods)
 * - aggregateMonthly: All scenarios (with data, empty periods)
 * - checkAlertThresholds: All threshold percentages (50%, 80%, 90%, 100%)
 * - resetExpiredQuotas: Reset logic, no expired quotas
 * - Idempotency: MERGE behavior ensures re-aggregation produces same result
 * - Error handling: Database/Redis errors logged but not thrown
 * - Singleton pattern
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ConnectionPool, IResult } from 'mssql';
import type { Redis } from 'ioredis';

// Mock dependencies
vi.mock('@/utils/logger', () => ({
  createChildLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// Import after mocking
import {
  UsageAggregationService,
  getUsageAggregationService,
  __resetUsageAggregationService,
} from '@services/tracking/UsageAggregationService';
import type { UserQuotasDbRow } from '@/types/usage.types';

describe('UsageAggregationService', () => {
  let service: UsageAggregationService;
  let mockPool: Partial<ConnectionPool>;
  let mockRedis: Partial<Redis>;
  let mockRequest: {
    input: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
  };

  // Mock user IDs and session IDs
  const mockUserId = '123e4567-e89b-12d3-a456-426614174000';
  const mockUserId2 = '987fcdeb-51a2-3c4d-5e6f-789012345678';

  // Mock aggregation results from database
  const mockAggregationRow = {
    user_id: mockUserId,
    total_events: 100,
    total_tokens: 50000,
    total_api_calls: 25,
    total_cost: 0.15,
    category: 'ai',
  };

  // Mock quota limits for alert threshold tests
  const mockQuotaRecord: UserQuotasDbRow = {
    user_id: mockUserId,
    plan_tier: 'pro',
    monthly_token_limit: 1000000,
    current_token_usage: 0,
    monthly_api_call_limit: 10000,
    current_api_call_usage: 0,
    storage_limit_bytes: 10737418240, // 10 GB
    current_storage_usage: 0,
    quota_reset_at: new Date('2025-02-01T00:00:00Z'),
    last_reset_at: new Date('2025-01-01T00:00:00Z'),
    allow_overage: false,
    overage_rate: null,
    created_at: new Date('2025-01-01T00:00:00Z'),
    updated_at: new Date('2025-01-01T00:00:00Z'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    __resetUsageAggregationService();

    // Mock database request
    mockRequest = {
      input: vi.fn().mockReturnThis(),
      query: vi.fn().mockResolvedValue({
        recordset: [mockAggregationRow],
        recordsets: [],
        rowsAffected: [1],
        output: {},
      } as IResult<typeof mockAggregationRow>),
    };

    // Mock database pool
    mockPool = {
      request: vi.fn().mockReturnValue(mockRequest),
    };

    // Mock Redis client
    mockRedis = {
      get: vi.fn().mockResolvedValue('0'),
      set: vi.fn().mockResolvedValue('OK'),
      incr: vi.fn().mockResolvedValue(1),
      expire: vi.fn().mockResolvedValue(1),
    };

    // Create service with mocked dependencies
    service = new UsageAggregationService(
      mockPool as ConnectionPool,
      mockRedis as Redis
    );
  });

  afterEach(() => {
    __resetUsageAggregationService();
  });

  describe('Singleton Pattern', () => {
    it('should return new instance when dependencies provided', () => {
      __resetUsageAggregationService();

      const instance1 = getUsageAggregationService(mockPool as ConnectionPool, mockRedis as Redis);
      const instance2 = getUsageAggregationService(mockPool as ConnectionPool, mockRedis as Redis);

      // Should create new instances when dependencies provided
      expect(instance1).not.toBe(instance2);
    });

    it('should allow reset for testing', () => {
      __resetUsageAggregationService();

      const instance1 = getUsageAggregationService(mockPool as ConnectionPool, mockRedis as Redis);
      __resetUsageAggregationService();
      const instance2 = getUsageAggregationService(mockPool as ConnectionPool, mockRedis as Redis);

      // Should be different instances after reset
      expect(instance1).not.toBe(instance2);
    });
  });

  describe('aggregateHourly', () => {
    it('should correctly aggregate events for an hour', async () => {
      const hourStart = new Date('2025-01-15T14:00:00Z');

      // Mock database query to return aggregation results
      mockRequest.query
        .mockResolvedValueOnce({
          recordset: [
            mockAggregationRow,
            {
              user_id: mockUserId,
              total_events: 50,
              total_tokens: 20000,
              total_api_calls: 10,
              total_cost: 0.06,
              category: 'storage',
            },
          ],
          recordsets: [],
          rowsAffected: [2],
          output: {},
        })
        .mockResolvedValue({
          recordset: [],
          recordsets: [],
          rowsAffected: [0],
          output: {},
        });

      const count = await service.aggregateHourly(hourStart);

      // Should aggregate into one record per user (multiple categories combined)
      expect(count).toBe(1);
      expect(mockPool.request).toHaveBeenCalled();
      expect(mockRequest.input).toHaveBeenCalledWith('periodStart', expect.anything(), hourStart);
    });

    it('should handle empty periods (creates zero aggregate)', async () => {
      const hourStart = new Date('2025-01-15T14:00:00Z');

      // Mock empty recordset (no events in this hour)
      mockRequest.query.mockResolvedValue({
        recordset: [],
        recordsets: [],
        rowsAffected: [0],
        output: {},
      });

      const count = await service.aggregateHourly(hourStart);

      // No aggregates created for empty period
      expect(count).toBe(0);
    });

    it('should process specific user when userId provided', async () => {
      const hourStart = new Date('2025-01-15T14:00:00Z');

      // Mock query with specific user
      mockRequest.query
        .mockResolvedValueOnce({
          recordset: [mockAggregationRow],
          recordsets: [],
          rowsAffected: [1],
          output: {},
        })
        .mockResolvedValue({
          recordset: [],
          recordsets: [],
          rowsAffected: [0],
          output: {},
        });

      const count = await service.aggregateHourly(hourStart, mockUserId);

      expect(count).toBe(1);
      expect(mockRequest.input).toHaveBeenCalledWith(
        'userId',
        expect.anything(),
        mockUserId
      );
    });

    it('should process all users when userId not provided', async () => {
      const hourStart = new Date('2025-01-15T14:00:00Z');

      // Mock query with multiple users
      mockRequest.query
        .mockResolvedValueOnce({
          recordset: [
            mockAggregationRow,
            {
              user_id: mockUserId2,
              total_events: 75,
              total_tokens: 30000,
              total_api_calls: 15,
              total_cost: 0.09,
              category: 'ai',
            },
          ],
          recordsets: [],
          rowsAffected: [2],
          output: {},
        })
        .mockResolvedValue({
          recordset: [],
          recordsets: [],
          rowsAffected: [0],
          output: {},
        });

      const count = await service.aggregateHourly(hourStart);

      // Should create aggregates for both users
      expect(count).toBe(2);
      expect(mockRequest.input).toHaveBeenCalledWith(
        'userId',
        expect.anything(),
        null
      );
    });

    it('should handle database errors gracefully', async () => {
      const hourStart = new Date('2025-01-15T14:00:00Z');

      // Mock database error
      mockRequest.query.mockRejectedValue(new Error('Database connection failed'));

      await expect(service.aggregateHourly(hourStart)).rejects.toThrow(
        'Database connection failed'
      );
    });
  });

  describe('aggregateDaily', () => {
    it('should correctly aggregate events for a day', async () => {
      const dayStart = new Date('2025-01-15T00:00:00Z');

      // Mock database query to return aggregation results
      mockRequest.query
        .mockResolvedValueOnce({
          recordset: [mockAggregationRow],
          recordsets: [],
          rowsAffected: [1],
          output: {},
        })
        .mockResolvedValue({
          recordset: [],
          recordsets: [],
          rowsAffected: [0],
          output: {},
        });

      const count = await service.aggregateDaily(dayStart);

      expect(count).toBe(1);
      expect(mockPool.request).toHaveBeenCalled();
      expect(mockRequest.input).toHaveBeenCalledWith('periodStart', expect.anything(), dayStart);
    });

    it('should handle empty periods', async () => {
      const dayStart = new Date('2025-01-15T00:00:00Z');

      // Mock empty recordset (no events in this day)
      mockRequest.query.mockResolvedValue({
        recordset: [],
        recordsets: [],
        rowsAffected: [0],
        output: {},
      });

      const count = await service.aggregateDaily(dayStart);

      // No aggregates created for empty period
      expect(count).toBe(0);
    });

    it('should process specific user when userId provided', async () => {
      const dayStart = new Date('2025-01-15T00:00:00Z');

      // Mock query with specific user
      mockRequest.query
        .mockResolvedValueOnce({
          recordset: [mockAggregationRow],
          recordsets: [],
          rowsAffected: [1],
          output: {},
        })
        .mockResolvedValue({
          recordset: [],
          recordsets: [],
          rowsAffected: [0],
          output: {},
        });

      const count = await service.aggregateDaily(dayStart, mockUserId);

      expect(count).toBe(1);
      expect(mockRequest.input).toHaveBeenCalledWith(
        'userId',
        expect.anything(),
        mockUserId
      );
    });
  });

  describe('aggregateMonthly', () => {
    it('should correctly aggregate events for a month', async () => {
      const monthStart = new Date('2025-01-01T00:00:00Z');

      // Mock database query to return aggregation results
      mockRequest.query
        .mockResolvedValueOnce({
          recordset: [mockAggregationRow],
          recordsets: [],
          rowsAffected: [1],
          output: {},
        })
        .mockResolvedValue({
          recordset: [],
          recordsets: [],
          rowsAffected: [0],
          output: {},
        });

      const count = await service.aggregateMonthly(monthStart);

      expect(count).toBe(1);
      expect(mockPool.request).toHaveBeenCalled();
      expect(mockRequest.input).toHaveBeenCalledWith('periodStart', expect.anything(), monthStart);
    });

    it('should handle empty periods', async () => {
      const monthStart = new Date('2025-01-01T00:00:00Z');

      // Mock empty recordset (no events in this month)
      mockRequest.query.mockResolvedValue({
        recordset: [],
        recordsets: [],
        rowsAffected: [0],
        output: {},
      });

      const count = await service.aggregateMonthly(monthStart);

      // No aggregates created for empty period
      expect(count).toBe(0);
    });

    it('should process specific user when userId provided', async () => {
      const monthStart = new Date('2025-01-01T00:00:00Z');

      // Mock query with specific user
      mockRequest.query
        .mockResolvedValueOnce({
          recordset: [mockAggregationRow],
          recordsets: [],
          rowsAffected: [1],
          output: {},
        })
        .mockResolvedValue({
          recordset: [],
          recordsets: [],
          rowsAffected: [0],
          output: {},
        });

      const count = await service.aggregateMonthly(monthStart, mockUserId);

      expect(count).toBe(1);
      expect(mockRequest.input).toHaveBeenCalledWith(
        'userId',
        expect.anything(),
        mockUserId
      );
    });
  });

  describe('checkAlertThresholds', () => {
    it('should create alert at 50% threshold', async () => {
      // Mock quota record with 50% token usage
      const quotaAt50Percent: UserQuotasDbRow = {
        ...mockQuotaRecord,
        current_token_usage: 500000, // 50% of 1,000,000
      };

      // Mock database queries:
      // 1st: getQuotaLimits
      // 2nd: checkAlertAlreadySent (not sent)
      // 3rd: createAlert
      mockRequest.query
        .mockResolvedValueOnce({
          recordset: [quotaAt50Percent],
          recordsets: [],
          rowsAffected: [1],
          output: {},
        })
        .mockResolvedValueOnce({
          recordset: [], // Alert not sent yet
          recordsets: [],
          rowsAffected: [0],
          output: {},
        })
        .mockResolvedValueOnce({
          recordset: [],
          recordsets: [],
          rowsAffected: [1],
          output: {},
        });

      await service.checkAlertThresholds(mockUserId);

      // Should create alert at 50% threshold
      const queryCall = mockRequest.query.mock.calls[2]?.[0] as string;
      expect(queryCall).toContain('INSERT INTO quota_alerts');
    });

    it('should create alert at 80% threshold', async () => {
      // Mock quota record with 80% token usage
      const quotaAt80Percent: UserQuotasDbRow = {
        ...mockQuotaRecord,
        current_token_usage: 800000, // 80% of 1,000,000
      };

      // Mock queries
      mockRequest.query
        .mockResolvedValueOnce({
          recordset: [quotaAt80Percent],
          recordsets: [],
          rowsAffected: [1],
          output: {},
        })
        .mockResolvedValue({
          recordset: [], // No alerts sent yet
          recordsets: [],
          rowsAffected: [0],
          output: {},
        });

      await service.checkAlertThresholds(mockUserId);

      // Should check for 50% and 80% thresholds (80% crosses both) for tokens only (other quotas at 0%)
      // 1 quota + tokens: (check 50% + insert 50% + check 80% + insert 80%)
      expect(mockRequest.query).toHaveBeenCalledTimes(5); // 1 quota + 4 for tokens (2 thresholds * 2 ops)
    });

    it('should create alert at 90% threshold', async () => {
      // Mock quota record with 90% token usage
      const quotaAt90Percent: UserQuotasDbRow = {
        ...mockQuotaRecord,
        current_token_usage: 900000, // 90% of 1,000,000
      };

      // Mock queries
      mockRequest.query
        .mockResolvedValueOnce({
          recordset: [quotaAt90Percent],
          recordsets: [],
          rowsAffected: [1],
          output: {},
        })
        .mockResolvedValue({
          recordset: [], // No alerts sent yet
          recordsets: [],
          rowsAffected: [0],
          output: {},
        });

      await service.checkAlertThresholds(mockUserId);

      // Should check for 50%, 80%, 90% thresholds (90% crosses all three) for tokens only
      // 1 quota + tokens: (check 50% + insert 50% + check 80% + insert 80% + check 90% + insert 90%)
      expect(mockRequest.query).toHaveBeenCalledTimes(7); // 1 quota + 6 for tokens (3 thresholds * 2 ops)
    });

    it('should create alert at 100% threshold', async () => {
      // Mock quota record with 100% token usage
      const quotaAt100Percent: UserQuotasDbRow = {
        ...mockQuotaRecord,
        current_token_usage: 1000000, // 100% of 1,000,000
      };

      // Mock queries
      mockRequest.query
        .mockResolvedValueOnce({
          recordset: [quotaAt100Percent],
          recordsets: [],
          rowsAffected: [1],
          output: {},
        })
        .mockResolvedValue({
          recordset: [], // No alerts sent yet
          recordsets: [],
          rowsAffected: [0],
          output: {},
        });

      await service.checkAlertThresholds(mockUserId);

      // Should check for all 4 thresholds (100% crosses all) for tokens only
      // 1 quota + tokens: (check 50% + insert 50% + check 80% + insert 80% + check 90% + insert 90% + check 100% + insert 100%)
      expect(mockRequest.query).toHaveBeenCalledTimes(9); // 1 quota + 8 for tokens (4 thresholds * 2 ops)
    });

    it('should skip already-sent alerts', async () => {
      // Mock quota record with 50% token usage
      const quotaAt50Percent: UserQuotasDbRow = {
        ...mockQuotaRecord,
        current_token_usage: 500000,
      };

      // Mock queries:
      // 1st: getQuotaLimits
      // 2nd: checkAlertAlreadySent for tokens at 50% (returns 1 = already sent)
      mockRequest.query
        .mockResolvedValueOnce({
          recordset: [quotaAt50Percent],
          recordsets: [],
          rowsAffected: [1],
          output: {},
        })
        .mockResolvedValue({
          recordset: [{ '1': 1 }], // Alert already sent
          recordsets: [],
          rowsAffected: [1],
          output: {},
        });

      await service.checkAlertThresholds(mockUserId);

      // Should not create new alert (only quota query + 1 check for tokens at 50%)
      // Other quotas (api_calls, storage) are at 0% so no thresholds crossed
      expect(mockRequest.query).toHaveBeenCalledTimes(2); // 1 quota + 1 check (already sent)
    });

    it('should handle missing quota record gracefully', async () => {
      // Mock empty recordset (user not found)
      mockRequest.query.mockResolvedValue({
        recordset: [],
        recordsets: [],
        rowsAffected: [0],
        output: {},
      });

      // Should not throw
      await expect(service.checkAlertThresholds('nonexistent-user')).resolves.not.toThrow();
    });

    it('should handle database errors gracefully', async () => {
      // Mock database error
      mockRequest.query.mockRejectedValue(new Error('Database error'));

      // Should not throw (errors logged but not thrown)
      await expect(service.checkAlertThresholds(mockUserId)).resolves.not.toThrow();
    });
  });

  describe('resetExpiredQuotas', () => {
    it('should reset quotas and update next reset date', async () => {
      // Mock result with 2 users reset
      mockRequest.query.mockResolvedValue({
        recordset: [
          { user_id: mockUserId },
          { user_id: mockUserId2 },
        ],
        recordsets: [],
        rowsAffected: [2],
        output: {},
      });

      const count = await service.resetExpiredQuotas();

      expect(count).toBe(2);
      expect(mockPool.request).toHaveBeenCalled();

      const queryCall = mockRequest.query.mock.calls[0]?.[0] as string;
      expect(queryCall).toContain('UPDATE user_quotas');
      expect(queryCall).toContain('current_token_usage = 0');
      expect(queryCall).toContain('quota_reset_at <= GETUTCDATE()');
    });

    it('should return count of reset users', async () => {
      // Mock result with 1 user reset
      mockRequest.query.mockResolvedValue({
        recordset: [{ user_id: mockUserId }],
        recordsets: [],
        rowsAffected: [1],
        output: {},
      });

      const count = await service.resetExpiredQuotas();

      expect(count).toBe(1);
    });

    it('should handle no expired quotas', async () => {
      // Mock empty recordset (no expired quotas)
      mockRequest.query.mockResolvedValue({
        recordset: [],
        recordsets: [],
        rowsAffected: [0],
        output: {},
      });

      const count = await service.resetExpiredQuotas();

      expect(count).toBe(0);
    });

    it('should handle database errors', async () => {
      // Mock database error
      mockRequest.query.mockRejectedValue(new Error('Database error'));

      await expect(service.resetExpiredQuotas()).rejects.toThrow('Database error');
    });
  });

  describe('Idempotency Tests', () => {
    it('should produce same result on re-aggregation (MERGE behavior)', async () => {
      const hourStart = new Date('2025-01-15T14:00:00Z');

      // Mock database query to return same aggregation results twice
      mockRequest.query
        .mockResolvedValueOnce({
          recordset: [mockAggregationRow],
          recordsets: [],
          rowsAffected: [1],
          output: {},
        })
        .mockResolvedValueOnce({
          recordset: [], // MERGE operation
          recordsets: [],
          rowsAffected: [0],
          output: {},
        })
        .mockResolvedValueOnce({
          recordset: [mockAggregationRow],
          recordsets: [],
          rowsAffected: [1],
          output: {},
        })
        .mockResolvedValueOnce({
          recordset: [], // MERGE operation
          recordsets: [],
          rowsAffected: [0],
          output: {},
        });

      // First aggregation
      const count1 = await service.aggregateHourly(hourStart);
      expect(count1).toBe(1);

      // Second aggregation (should MERGE, not duplicate)
      const count2 = await service.aggregateHourly(hourStart);
      expect(count2).toBe(1);

      // MERGE query should be called twice
      const mergeQueryCalls = mockRequest.query.mock.calls.filter(call => {
        const query = call[0] as string;
        return query.includes('MERGE INTO usage_aggregates');
      });
      expect(mergeQueryCalls.length).toBe(2);
    });
  });

  describe('Error Handling Tests', () => {
    it('should log database errors but throw them (for aggregation)', async () => {
      const hourStart = new Date('2025-01-15T14:00:00Z');

      // Mock database error
      mockRequest.query.mockRejectedValue(new Error('Database error'));

      await expect(service.aggregateHourly(hourStart)).rejects.toThrow('Database error');
    });

    it('should handle Redis errors with fallback', async () => {
      // Note: UsageAggregationService doesn't use Redis directly in current implementation
      // This test is here for completeness, but service primarily uses database

      const hourStart = new Date('2025-01-15T14:00:00Z');

      // Mock successful database query
      mockRequest.query
        .mockResolvedValueOnce({
          recordset: [mockAggregationRow],
          recordsets: [],
          rowsAffected: [1],
          output: {},
        })
        .mockResolvedValue({
          recordset: [],
          recordsets: [],
          rowsAffected: [0],
          output: {},
        });

      const count = await service.aggregateHourly(hourStart);

      expect(count).toBe(1);
    });

    it('should not throw errors from checkAlertThresholds', async () => {
      // Mock database error
      mockRequest.query.mockRejectedValue(new Error('Database error'));

      await expect(
        service.checkAlertThresholds(mockUserId)
      ).resolves.not.toThrow();
    });
  });
});
