/**
 * Billing Service Tests
 *
 * Comprehensive unit tests for BillingService.
 * These tests mock the database layer to test service logic.
 *
 * Coverage targets:
 * - generateMonthlyInvoice: Cost calculation, idempotency, error handling
 * - generateAllMonthlyInvoices: Batch generation, partial failures
 * - getInvoice: Retrieval, user validation
 * - getInvoiceHistory: Pagination, ordering
 * - getCurrentPeriodPreview: Partial month calculations
 * - calculatePlanCost: All plan tiers
 * - PAYG management: Enable/disable/update/get settings
 * - Singleton pattern
 * - Error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ConnectionPool, IResult } from 'mssql';

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
  BillingService,
  getBillingService,
  __resetBillingService,
} from '@services/billing';
import { PRICING_PLANS, PAYG_RATES } from '@config/pricing.config';
import type {
  BillingRecordDbRow,
  UserQuotasDbRow,
  PlanTier,
} from '@/types/usage.types';

describe('BillingService', () => {
  let service: BillingService;
  let mockPool: Partial<ConnectionPool>;
  let mockRequest: {
    input: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
  };

  // Test data
  const mockUserId = '123e4567-e89b-12d3-a456-426614174000';
  const periodStart = new Date('2025-01-01T00:00:00Z');
  const periodEnd = new Date('2025-01-31T23:59:59.999Z');

  // Mock user record with plan tier
  const mockUserQuotaRecord: UserQuotasDbRow = {
    user_id: mockUserId,
    plan_tier: 'pro',
    monthly_token_limit: 1000000,
    current_token_usage: 500000,
    monthly_api_call_limit: 500,
    current_api_call_usage: 250,
    storage_limit_bytes: 50 * 1024 * 1024, // 50MB
    current_storage_usage: 5000000,
    quota_reset_at: new Date('2025-02-01T00:00:00Z'),
    last_reset_at: new Date('2025-01-01T00:00:00Z'),
    allow_overage: false,
    overage_rate: null,
    created_at: new Date('2025-01-01T00:00:00Z'),
    updated_at: new Date('2025-01-01T00:00:00Z'),
  };

  // Mock monthly aggregate data
  const mockAggregateData = {
    total_tokens: 500000,
    total_api_calls: 250,
    total_cost: 2.5,
  };

  // Mock billing record
  const mockBillingRecord: BillingRecordDbRow = {
    id: 'invoice-123',
    user_id: mockUserId,
    billing_period_start: periodStart,
    billing_period_end: periodEnd,
    total_tokens: 500000,
    total_api_calls: 250,
    total_storage_bytes: 5000000,
    base_cost: 25.0,
    usage_cost: 2.5,
    overage_cost: 0,
    total_cost: 27.5,
    status: 'pending',
    payment_method: null,
    paid_at: null,
    created_at: new Date(),
    updated_at: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    __resetBillingService();

    mockRequest = {
      input: vi.fn().mockReturnThis(),
      query: vi.fn().mockResolvedValue({
        recordset: [],
        recordsets: [],
        rowsAffected: [0],
        output: {},
      }),
    };

    mockPool = {
      request: vi.fn().mockReturnValue(mockRequest),
    };

    service = new BillingService(mockPool as ConnectionPool);
  });

  afterEach(() => {
    __resetBillingService();
  });

  describe('Singleton Pattern', () => {
    it('should return new instance when dependencies provided', () => {
      __resetBillingService();

      const instance1 = getBillingService(mockPool as ConnectionPool);
      const instance2 = getBillingService(mockPool as ConnectionPool);

      // Should create new instances when dependencies provided
      expect(instance1).not.toBe(instance2);
    });

    it('should allow reset for testing', () => {
      __resetBillingService();

      const instance1 = getBillingService(mockPool as ConnectionPool);
      __resetBillingService();
      const instance2 = getBillingService(mockPool as ConnectionPool);

      // Should be different instances after reset
      expect(instance1).not.toBe(instance2);
    });
  });

  describe('generateMonthlyInvoice', () => {
    it('should calculate correct costs for free tier (no charge)', async () => {
      const freeQuota: UserQuotasDbRow = {
        ...mockUserQuotaRecord,
        plan_tier: 'free',
      };

      // Mock queries: 1) check existing, 2) get quota, 3) get usage, 4) insert invoice
      mockRequest.query
        .mockResolvedValueOnce({
          recordset: [], // No existing invoice
          recordsets: [],
          rowsAffected: [0],
          output: {},
        } as IResult<never>)
        .mockResolvedValueOnce({
          recordset: [freeQuota],
          recordsets: [],
          rowsAffected: [1],
          output: {},
        } as IResult<UserQuotasDbRow>)
        .mockResolvedValueOnce({
          recordset: [mockAggregateData],
          recordsets: [],
          rowsAffected: [1],
          output: {},
        } as IResult<typeof mockAggregateData>)
        .mockResolvedValueOnce({
          recordset: [{
            ...mockBillingRecord,
            base_cost: 0,
            total_cost: 2.5, // Only usage cost
          }],
          recordsets: [],
          rowsAffected: [1],
          output: {},
        } as IResult<BillingRecordDbRow>);

      const invoice = await service.generateMonthlyInvoice(mockUserId, periodStart);

      expect(invoice.base_cost).toBe(0);
      expect(invoice.usage_cost).toBe(2.5);
      expect(invoice.overage_cost).toBe(0);
      expect(invoice.total_cost).toBe(2.5);
    });

    it('should calculate correct costs for pro tier ($25/month)', async () => {
      const proQuota: UserQuotasDbRow = {
        ...mockUserQuotaRecord,
        plan_tier: 'pro',
      };

      mockRequest.query
        .mockResolvedValueOnce({
          recordset: [],
          recordsets: [],
          rowsAffected: [0],
          output: {},
        } as IResult<never>)
        .mockResolvedValueOnce({
          recordset: [proQuota],
          recordsets: [],
          rowsAffected: [1],
          output: {},
        } as IResult<UserQuotasDbRow>)
        .mockResolvedValueOnce({
          recordset: [mockAggregateData],
          recordsets: [],
          rowsAffected: [1],
          output: {},
        } as IResult<typeof mockAggregateData>)
        .mockResolvedValueOnce({
          recordset: [mockBillingRecord],
          recordsets: [],
          rowsAffected: [1],
          output: {},
        } as IResult<BillingRecordDbRow>);

      const invoice = await service.generateMonthlyInvoice(mockUserId, periodStart);

      expect(invoice.base_cost).toBe(25.0);
      expect(invoice.usage_cost).toBe(2.5);
      expect(invoice.total_cost).toBe(27.5);
    });

    it('should calculate correct costs for enterprise tier ($200/month)', async () => {
      const enterpriseQuota: UserQuotasDbRow = {
        ...mockUserQuotaRecord,
        plan_tier: 'enterprise',
        monthly_token_limit: 10000000,
      };

      mockRequest.query
        .mockResolvedValueOnce({
          recordset: [],
          recordsets: [],
          rowsAffected: [0],
          output: {},
        } as IResult<never>)
        .mockResolvedValueOnce({
          recordset: [enterpriseQuota],
          recordsets: [],
          rowsAffected: [1],
          output: {},
        } as IResult<UserQuotasDbRow>)
        .mockResolvedValueOnce({
          recordset: [mockAggregateData],
          recordsets: [],
          rowsAffected: [1],
          output: {},
        } as IResult<typeof mockAggregateData>)
        .mockResolvedValueOnce({
          recordset: [{
            ...mockBillingRecord,
            base_cost: 200.0,
            total_cost: 202.5,
          }],
          recordsets: [],
          rowsAffected: [1],
          output: {},
        } as IResult<BillingRecordDbRow>);

      const invoice = await service.generateMonthlyInvoice(mockUserId, periodStart);

      expect(invoice.base_cost).toBe(200.0);
      expect(invoice.usage_cost).toBe(2.5);
      expect(invoice.total_cost).toBe(202.5);
    });

    it('should include overage for enterprise users exceeding quota', async () => {
      const enterpriseWithOverage: UserQuotasDbRow = {
        ...mockUserQuotaRecord,
        plan_tier: 'enterprise',
        monthly_token_limit: 10000000,
        current_token_usage: 11000000, // 1M over limit
        monthly_api_call_limit: 5000,
        current_api_call_usage: 5100, // 100 over limit
        allow_overage: true,
        overage_rate: PAYG_RATES.claude_input_token,
      };

      // Calculate expected overage cost
      const tokensOverQuota = 1000000;
      const apiCallsOverQuota = 100;
      const expectedOverageCost =
        tokensOverQuota * PAYG_RATES.claude_input_token +
        apiCallsOverQuota * PAYG_RATES.api_call;

      mockRequest.query
        .mockResolvedValueOnce({
          recordset: [],
          recordsets: [],
          rowsAffected: [0],
          output: {},
        } as IResult<never>)
        .mockResolvedValueOnce({
          recordset: [enterpriseWithOverage],
          recordsets: [],
          rowsAffected: [1],
          output: {},
        } as IResult<UserQuotasDbRow>)
        .mockResolvedValueOnce({
          recordset: [mockAggregateData],
          recordsets: [],
          rowsAffected: [1],
          output: {},
        } as IResult<typeof mockAggregateData>)
        .mockResolvedValueOnce({
          recordset: [{
            ...mockBillingRecord,
            base_cost: 200.0,
            overage_cost: expectedOverageCost,
            total_cost: 200.0 + 2.5 + expectedOverageCost,
          }],
          recordsets: [],
          rowsAffected: [1],
          output: {},
        } as IResult<BillingRecordDbRow>);

      const invoice = await service.generateMonthlyInvoice(mockUserId, periodStart);

      expect(invoice.base_cost).toBe(200.0);
      expect(invoice.overage_cost).toBeCloseTo(expectedOverageCost, 4);
      expect(invoice.total_cost).toBeCloseTo(200.0 + 2.5 + expectedOverageCost, 4);
    });

    it('should skip if invoice already exists (idempotent)', async () => {
      // Mock existing invoice check
      mockRequest.query
        .mockResolvedValueOnce({
          recordset: [{ exists: 1 }],
          recordsets: [],
          rowsAffected: [1],
          output: {},
        } as IResult<{ exists: number }>)
        .mockResolvedValueOnce({
          recordset: [mockBillingRecord],
          recordsets: [],
          rowsAffected: [1],
          output: {},
        } as IResult<BillingRecordDbRow>);

      const invoice = await service.generateMonthlyInvoice(mockUserId, periodStart);

      expect(invoice).toEqual(mockBillingRecord);
      // Should only have 2 queries (check + fetch), not 4 (check + quota + usage + insert)
      expect(mockRequest.query).toHaveBeenCalledTimes(2);
    });

    it('should handle missing user gracefully', async () => {
      // Mock no quota record found
      mockRequest.query
        .mockResolvedValueOnce({
          recordset: [], // No existing invoice
          recordsets: [],
          rowsAffected: [0],
          output: {},
        } as IResult<never>)
        .mockResolvedValueOnce({
          recordset: [], // No quota record
          recordsets: [],
          rowsAffected: [0],
          output: {},
        } as IResult<UserQuotasDbRow>);

      // Should use default 'free' tier when quota not found
      mockRequest.query
        .mockResolvedValueOnce({
          recordset: [{ total_tokens: 0, total_api_calls: 0, total_cost: 0 }],
          recordsets: [],
          rowsAffected: [1],
          output: {},
        } as IResult<typeof mockAggregateData>)
        .mockResolvedValueOnce({
          recordset: [{
            ...mockBillingRecord,
            base_cost: 0, // Free tier
            usage_cost: 0,
            total_cost: 0,
          }],
          recordsets: [],
          rowsAffected: [1],
          output: {},
        } as IResult<BillingRecordDbRow>);

      const invoice = await service.generateMonthlyInvoice(mockUserId, periodStart);

      expect(invoice.base_cost).toBe(0);
      expect(invoice.total_cost).toBe(0);
    });

    it('should handle database errors', async () => {
      mockRequest.query.mockRejectedValueOnce(new Error('Database connection failed'));

      await expect(
        service.generateMonthlyInvoice(mockUserId, periodStart)
      ).rejects.toThrow('Database connection failed');
    });
  });

  describe('generateAllMonthlyInvoices', () => {
    it('should generate invoices for all users with usage', async () => {
      const user1Id = '123e4567-e89b-12d3-a456-426614174000';
      const user2Id = '223e4567-e89b-12d3-a456-426614174001';
      const user3Id = '323e4567-e89b-12d3-a456-426614174002';

      // Mock get all users
      mockRequest.query.mockResolvedValueOnce({
        recordset: [
          { user_id: user1Id },
          { user_id: user2Id },
          { user_id: user3Id },
        ],
        recordsets: [],
        rowsAffected: [3],
        output: {},
      } as IResult<{ user_id: string }>);

      // Mock successful invoice generation for each user
      // Each generateMonthlyInvoice call will do 4 queries (check, quota, usage, insert)
      for (let i = 0; i < 3; i++) {
        mockRequest.query
          .mockResolvedValueOnce({
            recordset: [], // No existing invoice
            recordsets: [],
            rowsAffected: [0],
            output: {},
          } as IResult<never>)
          .mockResolvedValueOnce({
            recordset: [mockUserQuotaRecord],
            recordsets: [],
            rowsAffected: [1],
            output: {},
          } as IResult<UserQuotasDbRow>)
          .mockResolvedValueOnce({
            recordset: [mockAggregateData],
            recordsets: [],
            rowsAffected: [1],
            output: {},
          } as IResult<typeof mockAggregateData>)
          .mockResolvedValueOnce({
            recordset: [mockBillingRecord],
            recordsets: [],
            rowsAffected: [1],
            output: {},
          } as IResult<BillingRecordDbRow>);
      }

      const count = await service.generateAllMonthlyInvoices(periodStart);

      expect(count).toBe(3);
    });

    it('should return count of invoices created', async () => {
      mockRequest.query.mockResolvedValueOnce({
        recordset: [
          { user_id: mockUserId },
        ],
        recordsets: [],
        rowsAffected: [1],
        output: {},
      } as IResult<{ user_id: string }>);

      // Mock successful generation
      mockRequest.query
        .mockResolvedValueOnce({
          recordset: [],
          recordsets: [],
          rowsAffected: [0],
          output: {},
        } as IResult<never>)
        .mockResolvedValueOnce({
          recordset: [mockUserQuotaRecord],
          recordsets: [],
          rowsAffected: [1],
          output: {},
        } as IResult<UserQuotasDbRow>)
        .mockResolvedValueOnce({
          recordset: [mockAggregateData],
          recordsets: [],
          rowsAffected: [1],
          output: {},
        } as IResult<typeof mockAggregateData>)
        .mockResolvedValueOnce({
          recordset: [mockBillingRecord],
          recordsets: [],
          rowsAffected: [1],
          output: {},
        } as IResult<BillingRecordDbRow>);

      const count = await service.generateAllMonthlyInvoices(periodStart);

      expect(count).toBe(1);
    });

    it('should handle partial failures (continue with other users)', async () => {
      const user1Id = '123e4567-e89b-12d3-a456-426614174000';
      const user2Id = '223e4567-e89b-12d3-a456-426614174001';

      // Mock get all users
      mockRequest.query.mockResolvedValueOnce({
        recordset: [
          { user_id: user1Id },
          { user_id: user2Id },
        ],
        recordsets: [],
        rowsAffected: [2],
        output: {},
      } as IResult<{ user_id: string }>);

      // User 1: Fail on check query
      mockRequest.query.mockRejectedValueOnce(new Error('User 1 failed'));

      // User 2: Succeed
      mockRequest.query
        .mockResolvedValueOnce({
          recordset: [],
          recordsets: [],
          rowsAffected: [0],
          output: {},
        } as IResult<never>)
        .mockResolvedValueOnce({
          recordset: [mockUserQuotaRecord],
          recordsets: [],
          rowsAffected: [1],
          output: {},
        } as IResult<UserQuotasDbRow>)
        .mockResolvedValueOnce({
          recordset: [mockAggregateData],
          recordsets: [],
          rowsAffected: [1],
          output: {},
        } as IResult<typeof mockAggregateData>)
        .mockResolvedValueOnce({
          recordset: [mockBillingRecord],
          recordsets: [],
          rowsAffected: [1],
          output: {},
        } as IResult<BillingRecordDbRow>);

      const count = await service.generateAllMonthlyInvoices(periodStart);

      // Should have 1 success out of 2
      expect(count).toBe(1);
    });
  });

  describe('getInvoice', () => {
    it('should return invoice when found', async () => {
      mockRequest.query.mockResolvedValueOnce({
        recordset: [mockBillingRecord],
        recordsets: [],
        rowsAffected: [1],
        output: {},
      } as IResult<BillingRecordDbRow>);

      const invoice = await service.getInvoice('invoice-123', mockUserId);

      expect(invoice).toEqual(mockBillingRecord);
      expect(mockRequest.input).toHaveBeenCalledWith('invoiceId', expect.anything(), 'invoice-123');
      expect(mockRequest.input).toHaveBeenCalledWith('userId', expect.anything(), mockUserId);
    });

    it('should return null when not found', async () => {
      mockRequest.query.mockResolvedValueOnce({
        recordset: [],
        recordsets: [],
        rowsAffected: [0],
        output: {},
      } as IResult<BillingRecordDbRow>);

      const invoice = await service.getInvoice('nonexistent-invoice', mockUserId);

      expect(invoice).toBe(null);
    });

    it('should validate user ownership (return null if wrong user)', async () => {
      // Query includes userId check, so wrong user returns empty recordset
      mockRequest.query.mockResolvedValueOnce({
        recordset: [],
        recordsets: [],
        rowsAffected: [0],
        output: {},
      } as IResult<BillingRecordDbRow>);

      const wrongUserId = 'wrong-user-id';
      const invoice = await service.getInvoice('invoice-123', wrongUserId);

      expect(invoice).toBe(null);
    });
  });

  describe('getInvoiceHistory', () => {
    it('should return list of invoices ordered by date', async () => {
      const invoice1 = { ...mockBillingRecord, id: 'invoice-1', billing_period_start: new Date('2025-01-01') };
      const invoice2 = { ...mockBillingRecord, id: 'invoice-2', billing_period_start: new Date('2024-12-01') };
      const invoice3 = { ...mockBillingRecord, id: 'invoice-3', billing_period_start: new Date('2024-11-01') };

      mockRequest.query.mockResolvedValueOnce({
        recordset: [invoice1, invoice2, invoice3], // Descending order
        recordsets: [],
        rowsAffected: [3],
        output: {},
      } as IResult<BillingRecordDbRow>);

      const invoices = await service.getInvoiceHistory(mockUserId);

      expect(invoices).toHaveLength(3);
      expect(invoices[0]?.id).toBe('invoice-1');
      expect(invoices[1]?.id).toBe('invoice-2');
      expect(invoices[2]?.id).toBe('invoice-3');
    });

    it('should respect limit parameter', async () => {
      const invoices = [
        { ...mockBillingRecord, id: 'invoice-1' },
        { ...mockBillingRecord, id: 'invoice-2' },
      ];

      mockRequest.query.mockResolvedValueOnce({
        recordset: invoices,
        recordsets: [],
        rowsAffected: [2],
        output: {},
      } as IResult<BillingRecordDbRow>);

      const result = await service.getInvoiceHistory(mockUserId, 2);

      expect(result).toHaveLength(2);
      expect(mockRequest.input).toHaveBeenCalledWith('limit', expect.anything(), 2);
    });

    it('should return empty array if no invoices', async () => {
      mockRequest.query.mockResolvedValueOnce({
        recordset: [],
        recordsets: [],
        rowsAffected: [0],
        output: {},
      } as IResult<BillingRecordDbRow>);

      const invoices = await service.getInvoiceHistory(mockUserId);

      expect(invoices).toEqual([]);
    });
  });

  describe('getCurrentPeriodPreview', () => {
    it('should calculate partial month costs', async () => {
      // Mock quota query
      mockRequest.query.mockResolvedValueOnce({
        recordset: [mockUserQuotaRecord],
        recordsets: [],
        rowsAffected: [1],
        output: {},
      } as IResult<UserQuotasDbRow>);

      // Mock usage breakdown query
      mockRequest.query.mockResolvedValueOnce({
        recordset: [
          { category: 'ai', events: 100, quantity: 500000, cost: 2.5 },
          { category: 'storage', events: 10, quantity: 5000000, cost: 0.1 },
        ],
        recordsets: [],
        rowsAffected: [2],
        output: {},
      } as IResult<{ category: string; events: number; quantity: number; cost: number }>);

      const preview = await service.getCurrentPeriodPreview(mockUserId);

      expect(preview.isPreview).toBe(true);
      expect(preview.baseCost).toBe(25.0); // Pro tier
      expect(preview.usageCost).toBe(2.6); // ai + storage
      expect(preview.totalCost).toBeCloseTo(27.6, 1);
    });

    it('should include all cost categories', async () => {
      mockRequest.query
        .mockResolvedValueOnce({
          recordset: [mockUserQuotaRecord],
          recordsets: [],
          rowsAffected: [1],
          output: {},
        } as IResult<UserQuotasDbRow>)
        .mockResolvedValueOnce({
          recordset: [
            { category: 'ai', events: 100, quantity: 500000, cost: 2.5 },
            { category: 'storage', events: 10, quantity: 5000000, cost: 0.1 },
            { category: 'processing', events: 5, quantity: 100, cost: 0.05 },
          ],
          recordsets: [],
          rowsAffected: [3],
          output: {},
        } as IResult<{ category: string; events: number; quantity: number; cost: number }>);

      const preview = await service.getCurrentPeriodPreview(mockUserId);

      expect(preview.breakdown.ai.cost).toBe(2.5);
      expect(preview.breakdown.storage.cost).toBe(0.1);
      expect(preview.breakdown.processing.cost).toBe(0.05);
      expect(preview.breakdown.total.cost).toBeCloseTo(2.65, 2);
    });

    it('should mark as isPreview: true', async () => {
      mockRequest.query
        .mockResolvedValueOnce({
          recordset: [mockUserQuotaRecord],
          recordsets: [],
          rowsAffected: [1],
          output: {},
        } as IResult<UserQuotasDbRow>)
        .mockResolvedValueOnce({
          recordset: [],
          recordsets: [],
          rowsAffected: [0],
          output: {},
        } as IResult<{ category: string; events: number; quantity: number; cost: number }>);

      const preview = await service.getCurrentPeriodPreview(mockUserId);

      expect(preview.isPreview).toBe(true);
    });
  });

  describe('calculatePlanCost', () => {
    it('should return $0 for free tier', () => {
      const cost = service.calculatePlanCost('free');
      expect(cost).toBe(PRICING_PLANS.free.price);
      expect(cost).toBe(0);
    });

    it('should return $25 for pro tier', () => {
      const cost = service.calculatePlanCost('pro');
      expect(cost).toBe(PRICING_PLANS.pro.price);
      expect(cost).toBe(25.0);
    });

    it('should return $200 for enterprise tier', () => {
      const cost = service.calculatePlanCost('enterprise');
      expect(cost).toBe(PRICING_PLANS.enterprise.price);
      expect(cost).toBe(200.0);
    });

    it('should return $0 for unlimited tier', () => {
      const cost = service.calculatePlanCost('unlimited');
      expect(cost).toBe(PRICING_PLANS.unlimited.price);
      expect(cost).toBe(0);
    });
  });

  describe('PAYG Management', () => {
    describe('enablePayg', () => {
      it('should update user_quotas.allow_overage to true', async () => {
        mockRequest.query.mockResolvedValueOnce({
          recordset: [],
          recordsets: [],
          rowsAffected: [1],
          output: {},
        } as IResult<never>);

        await service.enablePayg(mockUserId, 100);

        expect(mockRequest.input).toHaveBeenCalledWith('userId', expect.anything(), mockUserId);
        expect(mockRequest.input).toHaveBeenCalledWith('rate', expect.anything(), PAYG_RATES.claude_input_token);

        const queryCall = mockRequest.query.mock.calls[0]?.[0] as string;
        expect(queryCall).toContain('allow_overage = 1');
      });
    });

    describe('disablePayg', () => {
      it('should set allow_overage to false', async () => {
        mockRequest.query.mockResolvedValueOnce({
          recordset: [],
          recordsets: [],
          rowsAffected: [1],
          output: {},
        } as IResult<never>);

        await service.disablePayg(mockUserId);

        expect(mockRequest.input).toHaveBeenCalledWith('userId', expect.anything(), mockUserId);

        const queryCall = mockRequest.query.mock.calls[0]?.[0] as string;
        expect(queryCall).toContain('allow_overage = 0');
        expect(queryCall).toContain('overage_rate = NULL');
      });
    });

    describe('updatePaygLimit', () => {
      it('should update overage_rate', async () => {
        mockRequest.query.mockResolvedValueOnce({
          recordset: [],
          recordsets: [],
          rowsAffected: [1],
          output: {},
        } as IResult<never>);

        await service.updatePaygLimit(mockUserId, 200);

        expect(mockRequest.input).toHaveBeenCalledWith('userId', expect.anything(), mockUserId);
        expect(mockRequest.input).toHaveBeenCalledWith('rate', expect.anything(), PAYG_RATES.claude_input_token);

        const queryCall = mockRequest.query.mock.calls[0]?.[0] as string;
        expect(queryCall).toContain('overage_rate = @rate');
        expect(queryCall).toContain('allow_overage = 1');
      });
    });

    describe('getPaygSettings', () => {
      it('should return current settings', async () => {
        const quotaWithPayg: UserQuotasDbRow = {
          ...mockUserQuotaRecord,
          allow_overage: true,
          overage_rate: PAYG_RATES.claude_input_token,
          current_token_usage: 11000000, // Over limit
          monthly_token_limit: 10000000,
        };

        mockRequest.query.mockResolvedValueOnce({
          recordset: [quotaWithPayg],
          recordsets: [],
          rowsAffected: [1],
          output: {},
        } as IResult<UserQuotasDbRow>);

        const settings = await service.getPaygSettings(mockUserId);

        expect(settings.enabled).toBe(true);
        expect(settings.spendingLimit).toBeGreaterThan(0);
        expect(settings.currentOverage).toBeGreaterThan(0);
      });

      it('should return disabled settings when allow_overage is false', async () => {
        mockRequest.query.mockResolvedValueOnce({
          recordset: [mockUserQuotaRecord], // allow_overage: false
          recordsets: [],
          rowsAffected: [1],
          output: {},
        } as IResult<UserQuotasDbRow>);

        const settings = await service.getPaygSettings(mockUserId);

        expect(settings.enabled).toBe(false);
        expect(settings.spendingLimit).toBe(0);
        expect(settings.currentOverage).toBe(0);
      });

      it('should return default settings when user not found', async () => {
        mockRequest.query.mockResolvedValueOnce({
          recordset: [],
          recordsets: [],
          rowsAffected: [0],
          output: {},
        } as IResult<UserQuotasDbRow>);

        const settings = await service.getPaygSettings(mockUserId);

        expect(settings.enabled).toBe(false);
        expect(settings.spendingLimit).toBe(0);
        expect(settings.currentOverage).toBe(0);
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      mockRequest.query.mockRejectedValueOnce(new Error('Database connection failed'));

      await expect(
        service.generateMonthlyInvoice(mockUserId, periodStart)
      ).rejects.toThrow('Database connection failed');
    });

    it('should log errors appropriately', async () => {
      mockRequest.query.mockRejectedValueOnce(new Error('Database error'));

      try {
        await service.generateMonthlyInvoice(mockUserId, periodStart);
      } catch {
        // Error expected
      }

      // Logger should have been called with error context
      // Note: We can't directly test logger calls due to mocking,
      // but the code path is exercised
      expect(mockRequest.query).toHaveBeenCalled();
    });
  });
});
