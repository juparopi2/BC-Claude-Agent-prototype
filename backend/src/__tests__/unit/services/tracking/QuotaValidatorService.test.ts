/**
 * Quota Validator Service Tests
 *
 * Comprehensive unit tests for QuotaValidatorService.
 * These tests mock the database and Redis layers to test service logic.
 *
 * Coverage targets:
 * - validateQuota: All scenarios (under/over quota, PAYG enabled/disabled)
 * - canProceed: Quick validation logic
 * - getCurrentUsage: Redis fast path + database fallback
 * - getQuotaLimits: Database queries
 * - checkAllQuotas: Status for all quota types
 * - Singleton pattern
 * - Error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ConnectionPool, IResult } from 'mssql';
import type { Redis } from 'ioredis';

// Mock dependencies
vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// Import after mocking
import {
  QuotaValidatorService,
  getQuotaValidatorService,
  __resetQuotaValidatorService,
} from '@/domains/billing/tracking/QuotaValidatorService';
import type { UserQuotasDbRow } from '@/types/usage.types';

describe('QuotaValidatorService', () => {
  let service: QuotaValidatorService;
  let mockPool: Partial<ConnectionPool>;
  let mockRedis: Partial<Redis>;
  let mockRequest: {
    input: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
  };

  // Mock user quota record
  const mockQuotaRecord: UserQuotasDbRow = {
    user_id: '123e4567-e89b-12d3-a456-426614174000',
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
    __resetQuotaValidatorService();

    // Mock database request
    mockRequest = {
      input: vi.fn().mockReturnThis(),
      query: vi.fn().mockResolvedValue({
        recordset: [mockQuotaRecord],
        recordsets: [],
        rowsAffected: [1],
        output: {},
      } as IResult<UserQuotasDbRow>),
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
      exists: vi.fn().mockResolvedValue(1),
    };

    // Create service with mocked dependencies
    service = new QuotaValidatorService(
      mockPool as ConnectionPool,
      mockRedis as Redis
    );
  });

  afterEach(() => {
    __resetQuotaValidatorService();
  });

  describe('Singleton Pattern', () => {
    it('should return new instance when dependencies provided', () => {
      __resetQuotaValidatorService();

      const instance1 = getQuotaValidatorService(mockPool as ConnectionPool, mockRedis as Redis);
      const instance2 = getQuotaValidatorService(mockPool as ConnectionPool, mockRedis as Redis);

      // Should create new instances when dependencies provided
      expect(instance1).not.toBe(instance2);
    });

    it('should reset singleton for testing', () => {
      __resetQuotaValidatorService();

      const instance1 = getQuotaValidatorService(mockPool as ConnectionPool, mockRedis as Redis);
      __resetQuotaValidatorService();
      const instance2 = getQuotaValidatorService(mockPool as ConnectionPool, mockRedis as Redis);

      // Should be different instances after reset
      expect(instance1).not.toBe(instance2);
    });
  });

  describe('validateQuota', () => {
    it('should allow operation when under quota', async () => {
      // Mock current usage: 400,000 tokens (40% of limit)
      mockRedis.get = vi.fn().mockResolvedValue('400000');

      const result = await service.validateQuota(
        '123e4567-e89b-12d3-a456-426614174000',
        'tokens',
        50000
      );

      expect(result.allowed).toBe(true);
      expect(result.currentUsage).toBe(400000);
      expect(result.limit).toBe(1000000);
      expect(result.remaining).toBe(600000);
      expect(result.usagePercent).toBe(40);
      expect(result.alertThreshold).toBe(null);
      expect(result.overageAllowed).toBe(false);
      expect(result.reason).toBeUndefined();
    });

    it('should deny operation when over quota without PAYG', async () => {
      // Mock current usage: 950,000 tokens (95% of limit)
      mockRedis.get = vi.fn().mockResolvedValue('950000');

      const result = await service.validateQuota(
        '123e4567-e89b-12d3-a456-426614174000',
        'tokens',
        100000
      );

      expect(result.allowed).toBe(false);
      expect(result.currentUsage).toBe(950000);
      expect(result.limit).toBe(1000000);
      expect(result.remaining).toBe(0); // Service returns 0 when quota exceeded
      expect(result.usagePercent).toBe(100);
      expect(result.alertThreshold).toBe(100);
      expect(result.overageAllowed).toBe(false);
      expect(result.reason).toContain('quota exceeded');
    });

    it('should allow operation when over quota with PAYG enabled', async () => {
      // Mock quota record with PAYG enabled
      const quotaWithPayg: UserQuotasDbRow = {
        ...mockQuotaRecord,
        allow_overage: true,
        overage_rate: 0.000015,
      };

      mockRequest.query.mockResolvedValueOnce({
        recordset: [quotaWithPayg],
        recordsets: [],
        rowsAffected: [1],
        output: {},
      } as IResult<UserQuotasDbRow>);

      // Mock current usage: 950,000 tokens (95% of limit)
      mockRedis.get = vi.fn().mockResolvedValue('950000');

      const result = await service.validateQuota(
        '123e4567-e89b-12d3-a456-426614174000',
        'tokens',
        100000
      );

      expect(result.allowed).toBe(true);
      expect(result.overageAllowed).toBe(true);
      expect(result.reason).toContain('PAYG enabled');
      expect(result.alertThreshold).toBe(100);
    });

    it('should calculate percentage correctly at exactly 100%', async () => {
      // Mock current usage: 1,000,000 tokens (100% of limit)
      mockRedis.get = vi.fn().mockResolvedValue('1000000');

      const result = await service.validateQuota(
        '123e4567-e89b-12d3-a456-426614174000',
        'tokens',
        1
      );

      expect(result.usagePercent).toBe(100);
      expect(result.remaining).toBe(0);
      expect(result.allowed).toBe(false);
    });

    it('should handle missing quota record gracefully', async () => {
      // Mock empty recordset (user not found)
      mockRequest.query.mockResolvedValueOnce({
        recordset: [],
        recordsets: [],
        rowsAffected: [0],
        output: {},
      } as IResult<UserQuotasDbRow>);

      const result = await service.validateQuota(
        'nonexistent-user',
        'tokens',
        50000
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('User quota record not found');
      expect(result.currentUsage).toBe(0);
      expect(result.limit).toBe(0);
    });

    it('should handle database errors gracefully', async () => {
      // Mock database error
      mockRequest.query.mockRejectedValueOnce(new Error('Database connection failed'));

      const result = await service.validateQuota(
        '123e4567-e89b-12d3-a456-426614174000',
        'tokens',
        50000
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Quota validation failed');
      expect(result.currentUsage).toBe(0);
    });

    it('should handle Redis errors and fallback to database', async () => {
      // Mock Redis error - getUsageFromRedis returns null on error
      mockRedis.get = vi.fn().mockRejectedValueOnce(new Error('Redis connection failed'));

      // Mock database queries:
      // 1st call: getUsageFromDatabase (called by getCurrentUsage)
      // 2nd call: getQuotaLimits (called by validateQuota)
      mockRequest.query
        .mockResolvedValueOnce({
          recordset: [{ total_tokens: 500000, total_api_calls: 100 }],
          recordsets: [],
          rowsAffected: [1],
          output: {},
        } as IResult<{ total_tokens: number; total_api_calls: number }>)
        .mockResolvedValueOnce({
          recordset: [mockQuotaRecord],
          recordsets: [],
          rowsAffected: [1],
          output: {},
        } as IResult<UserQuotasDbRow>);

      const result = await service.validateQuota(
        '123e4567-e89b-12d3-a456-426614174000',
        'tokens',
        50000
      );

      // Should still work with database fallback
      expect(result.allowed).toBe(true);
      expect(result.currentUsage).toBe(500000);
    });

    it('should validate storage quota correctly', async () => {
      // Mock current storage: 5 GB
      mockRedis.get = vi.fn().mockResolvedValue('5368709120');

      const result = await service.validateQuota(
        '123e4567-e89b-12d3-a456-426614174000',
        'storage',
        1073741824 // 1 GB
      );

      expect(result.allowed).toBe(true);
      expect(result.currentUsage).toBe(5368709120);
      expect(result.limit).toBe(10737418240);
      expect(result.usagePercent).toBe(50);
    });

    it('should validate api_calls quota correctly', async () => {
      // Mock current API calls: 8,000 (80% of limit)
      mockRedis.get = vi.fn().mockResolvedValue('8000');

      const result = await service.validateQuota(
        '123e4567-e89b-12d3-a456-426614174000',
        'api_calls',
        100
      );

      expect(result.allowed).toBe(true);
      expect(result.currentUsage).toBe(8000);
      expect(result.limit).toBe(10000);
      expect(result.usagePercent).toBe(80);
    });
  });

  describe('canProceed', () => {
    it('should return allowed=true when under quota', async () => {
      // Mock current usage: 400,000 tokens (40% of limit)
      mockRedis.get = vi.fn().mockResolvedValue('400000');

      const result = await service.canProceed(
        '123e4567-e89b-12d3-a456-426614174000',
        'tokens',
        50000
      );

      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
      expect(result.paygAllowed).toBe(false);
    });

    it('should return allowed=false when over quota without PAYG', async () => {
      // Mock current usage: 950,000 tokens (95% of limit)
      mockRedis.get = vi.fn().mockResolvedValue('950000');

      const result = await service.canProceed(
        '123e4567-e89b-12d3-a456-426614174000',
        'tokens',
        100000
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('quota exceeded');
      expect(result.paygAllowed).toBe(false);
    });

    it('should return paygAllowed=true when PAYG enabled', async () => {
      // Mock quota record with PAYG enabled
      const quotaWithPayg: UserQuotasDbRow = {
        ...mockQuotaRecord,
        allow_overage: true,
        overage_rate: 0.000015,
      };

      mockRequest.query.mockResolvedValueOnce({
        recordset: [quotaWithPayg],
        recordsets: [],
        rowsAffected: [1],
        output: {},
      } as IResult<UserQuotasDbRow>);

      // Mock current usage: 950,000 tokens
      mockRedis.get = vi.fn().mockResolvedValue('950000');

      const result = await service.canProceed(
        '123e4567-e89b-12d3-a456-426614174000',
        'tokens',
        100000
      );

      expect(result.allowed).toBe(true);
      expect(result.paygAllowed).toBe(true);
      expect(result.reason).toContain('PAYG enabled');
    });

    it('should handle errors and return safe default', async () => {
      // Mock database error
      mockRequest.query.mockRejectedValueOnce(new Error('Database error'));

      const result = await service.canProceed(
        '123e4567-e89b-12d3-a456-426614174000',
        'tokens',
        50000
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('system error'); // Match actual error message (case-insensitive)
      expect(result.paygAllowed).toBe(false);
    });
  });

  describe('getCurrentUsage', () => {
    it('should return Redis counter value (fast path)', async () => {
      // Mock Redis counter
      mockRedis.get = vi.fn().mockResolvedValue('500000');

      const usage = await service.getCurrentUsage(
        '123e4567-e89b-12d3-a456-426614174000',
        'tokens'
      );

      expect(usage).toBe(500000);
      expect(mockRedis.get).toHaveBeenCalledWith(
        expect.stringMatching(/^usage:counter:.+:ai_tokens:\d{4}-\d{2}$/)
      );
    });

    it('should return 0 if Redis counter not found', async () => {
      // Mock Redis returning null (key doesn't exist)
      mockRedis.get = vi.fn().mockResolvedValue(null);

      const usage = await service.getCurrentUsage(
        '123e4567-e89b-12d3-a456-426614174000',
        'tokens'
      );

      expect(usage).toBe(0);
    });

    it('should fallback to database if Redis fails', async () => {
      // Mock Redis error
      mockRedis.get = vi.fn().mockRejectedValueOnce(new Error('Redis connection failed'));

      // Mock database aggregate query
      mockRequest.query.mockResolvedValueOnce({
        recordset: [{ total_tokens: 750000, total_api_calls: 500 }],
        recordsets: [],
        rowsAffected: [1],
        output: {},
      } as IResult<{ total_tokens: number; total_api_calls: number }>);

      const usage = await service.getCurrentUsage(
        '123e4567-e89b-12d3-a456-426614174000',
        'tokens'
      );

      expect(usage).toBe(750000);
      expect(mockPool.request).toHaveBeenCalled();
    });

    it('should return 0 if no usage found in database', async () => {
      // Mock Redis error
      mockRedis.get = vi.fn().mockRejectedValueOnce(new Error('Redis error'));

      // Mock empty database recordset
      mockRequest.query.mockResolvedValueOnce({
        recordset: [],
        recordsets: [],
        rowsAffected: [0],
        output: {},
      } as IResult<{ total_tokens: number; total_api_calls: number }>);

      const usage = await service.getCurrentUsage(
        '123e4567-e89b-12d3-a456-426614174000',
        'tokens'
      );

      expect(usage).toBe(0);
    });

    it('should handle tokens metric correctly', async () => {
      mockRedis.get = vi.fn().mockResolvedValue('100000');

      await service.getCurrentUsage(
        '123e4567-e89b-12d3-a456-426614174000',
        'tokens'
      );

      expect(mockRedis.get).toHaveBeenCalledWith(
        expect.stringMatching(/ai_tokens/)
      );
    });

    it('should handle api_calls metric correctly', async () => {
      mockRedis.get = vi.fn().mockResolvedValue('5000');

      await service.getCurrentUsage(
        '123e4567-e89b-12d3-a456-426614174000',
        'api_calls'
      );

      expect(mockRedis.get).toHaveBeenCalledWith(
        expect.stringMatching(/ai_calls/)
      );
    });

    it('should handle storage metric correctly', async () => {
      mockRedis.get = vi.fn().mockResolvedValue('1073741824');

      await service.getCurrentUsage(
        '123e4567-e89b-12d3-a456-426614174000',
        'storage'
      );

      expect(mockRedis.get).toHaveBeenCalledWith(
        expect.stringMatching(/storage_bytes/)
      );
    });

    it('should return 0 on complete failure', async () => {
      // Mock both Redis and database failing
      mockRedis.get = vi.fn().mockRejectedValueOnce(new Error('Redis error'));
      mockRequest.query.mockRejectedValueOnce(new Error('Database error'));

      const usage = await service.getCurrentUsage(
        '123e4567-e89b-12d3-a456-426614174000',
        'tokens'
      );

      expect(usage).toBe(0);
    });
  });

  describe('getQuotaLimits', () => {
    it('should return quota record from database', async () => {
      const limits = await service.getQuotaLimits(
        '123e4567-e89b-12d3-a456-426614174000'
      );

      expect(limits).toEqual(mockQuotaRecord);
      expect(mockPool.request).toHaveBeenCalled();
      expect(mockRequest.input).toHaveBeenCalledWith('user_id', '123e4567-e89b-12d3-a456-426614174000');
    });

    it('should return null if user not found', async () => {
      // Mock empty recordset
      mockRequest.query.mockResolvedValueOnce({
        recordset: [],
        recordsets: [],
        rowsAffected: [0],
        output: {},
      } as IResult<UserQuotasDbRow>);

      const limits = await service.getQuotaLimits('nonexistent-user');

      expect(limits).toBe(null);
    });

    it('should handle database errors', async () => {
      // Mock database error
      mockRequest.query.mockRejectedValueOnce(new Error('Database connection failed'));

      await expect(
        service.getQuotaLimits('123e4567-e89b-12d3-a456-426614174000')
      ).rejects.toThrow('Database connection failed');
    });

    it('should query correct table and columns', async () => {
      await service.getQuotaLimits('123e4567-e89b-12d3-a456-426614174000');

      const queryCall = mockRequest.query.mock.calls[0]?.[0] as string;
      expect(queryCall).toContain('FROM user_quotas');
      expect(queryCall).toContain('monthly_token_limit');
      expect(queryCall).toContain('allow_overage');
    });
  });

  describe('checkAllQuotas', () => {
    it('should return status for all quota types', async () => {
      // Mock Redis counters for each quota type
      mockRedis.get = vi.fn()
        .mockResolvedValueOnce('400000')  // tokens
        .mockResolvedValueOnce('5000')    // api_calls
        .mockResolvedValueOnce('5368709120'); // storage (5 GB)

      const statuses = await service.checkAllQuotas(
        '123e4567-e89b-12d3-a456-426614174000'
      );

      expect(statuses).toHaveLength(3);

      // Check tokens status
      const tokensStatus = statuses.find(s => s.quotaType === 'tokens');
      expect(tokensStatus?.currentUsage).toBe(400000);
      expect(tokensStatus?.limit).toBe(1000000);
      expect(tokensStatus?.percentageUsed).toBe(40);
      expect(tokensStatus?.remaining).toBe(600000);
      expect(tokensStatus?.willExceed).toBe(false);

      // Check api_calls status
      const apiCallsStatus = statuses.find(s => s.quotaType === 'api_calls');
      expect(apiCallsStatus?.currentUsage).toBe(5000);
      expect(apiCallsStatus?.limit).toBe(10000);
      expect(apiCallsStatus?.percentageUsed).toBe(50);
      expect(apiCallsStatus?.remaining).toBe(5000);
      expect(apiCallsStatus?.willExceed).toBe(false);

      // Check storage status
      const storageStatus = statuses.find(s => s.quotaType === 'storage');
      expect(storageStatus?.currentUsage).toBe(5368709120);
      expect(storageStatus?.limit).toBe(10737418240);
      expect(storageStatus?.percentageUsed).toBe(50);
      expect(storageStatus?.remaining).toBe(5368709120);
      expect(storageStatus?.willExceed).toBe(false);
    });

    it('should calculate percentage and remaining correctly', async () => {
      // Mock quota at 80%
      mockRedis.get = vi.fn()
        .mockResolvedValueOnce('800000')  // tokens: 80%
        .mockResolvedValueOnce('9000')    // api_calls: 90%
        .mockResolvedValueOnce('10737418240'); // storage: 100%

      const statuses = await service.checkAllQuotas(
        '123e4567-e89b-12d3-a456-426614174000'
      );

      const tokensStatus = statuses.find(s => s.quotaType === 'tokens');
      expect(tokensStatus?.percentageUsed).toBe(80);
      expect(tokensStatus?.remaining).toBe(200000);

      const apiCallsStatus = statuses.find(s => s.quotaType === 'api_calls');
      expect(apiCallsStatus?.percentageUsed).toBe(90);
      expect(apiCallsStatus?.remaining).toBe(1000);

      const storageStatus = statuses.find(s => s.quotaType === 'storage');
      expect(storageStatus?.percentageUsed).toBe(100);
      expect(storageStatus?.remaining).toBe(0);
    });

    it('should set willExceed flag correctly', async () => {
      // Mock usage at or over limit
      mockRedis.get = vi.fn()
        .mockResolvedValueOnce('1000001')  // tokens: over limit
        .mockResolvedValueOnce('10000')    // api_calls: at limit
        .mockResolvedValueOnce('5000000000'); // storage: under limit

      const statuses = await service.checkAllQuotas(
        '123e4567-e89b-12d3-a456-426614174000'
      );

      const tokensStatus = statuses.find(s => s.quotaType === 'tokens');
      expect(tokensStatus?.willExceed).toBe(true);

      const apiCallsStatus = statuses.find(s => s.quotaType === 'api_calls');
      expect(apiCallsStatus?.willExceed).toBe(true);

      const storageStatus = statuses.find(s => s.quotaType === 'storage');
      expect(storageStatus?.willExceed).toBe(false);
    });

    it('should return empty array if no quota limits found', async () => {
      // Mock empty recordset (user not found)
      mockRequest.query.mockResolvedValueOnce({
        recordset: [],
        recordsets: [],
        rowsAffected: [0],
        output: {},
      } as IResult<UserQuotasDbRow>);

      const statuses = await service.checkAllQuotas('nonexistent-user');

      expect(statuses).toEqual([]);
    });

    it('should return empty array on error', async () => {
      // Mock database error
      mockRequest.query.mockRejectedValueOnce(new Error('Database error'));

      const statuses = await service.checkAllQuotas(
        '123e4567-e89b-12d3-a456-426614174000'
      );

      expect(statuses).toEqual([]);
    });
  });

  describe('Error Handling', () => {
    it('should never throw errors from validateQuota', async () => {
      // Make all operations fail
      mockRequest.query.mockRejectedValue(new Error('Database error'));
      mockRedis.get = vi.fn().mockRejectedValue(new Error('Redis error'));

      await expect(
        service.validateQuota('123e4567-e89b-12d3-a456-426614174000', 'tokens', 50000)
      ).resolves.not.toThrow();
    });

    it('should never throw errors from canProceed', async () => {
      mockRequest.query.mockRejectedValue(new Error('Database error'));
      mockRedis.get = vi.fn().mockRejectedValue(new Error('Redis error'));

      await expect(
        service.canProceed('123e4567-e89b-12d3-a456-426614174000', 'tokens', 50000)
      ).resolves.not.toThrow();
    });

    it('should never throw errors from getCurrentUsage', async () => {
      mockRedis.get = vi.fn().mockRejectedValue(new Error('Redis error'));
      mockRequest.query.mockRejectedValue(new Error('Database error'));

      await expect(
        service.getCurrentUsage('123e4567-e89b-12d3-a456-426614174000', 'tokens')
      ).resolves.not.toThrow();
    });

    it('should never throw errors from checkAllQuotas', async () => {
      mockRequest.query.mockRejectedValue(new Error('Database error'));
      mockRedis.get = vi.fn().mockRejectedValue(new Error('Redis error'));

      await expect(
        service.checkAllQuotas('123e4567-e89b-12d3-a456-426614174000')
      ).resolves.not.toThrow();
    });

    it('should return safe defaults on validation errors', async () => {
      mockRequest.query.mockRejectedValue(new Error('Database error'));
      mockRedis.get = vi.fn().mockRejectedValue(new Error('Redis error'));

      const result = await service.validateQuota(
        '123e4567-e89b-12d3-a456-426614174000',
        'tokens',
        50000
      );

      // Should deny operation as safe default
      expect(result.allowed).toBe(false);
      expect(result.currentUsage).toBe(0);
      expect(result.limit).toBe(0);
      expect(result.reason).toContain('Quota validation failed');
    });
  });
});
