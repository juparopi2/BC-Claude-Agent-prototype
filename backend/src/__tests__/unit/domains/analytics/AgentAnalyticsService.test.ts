import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

// Mock the prisma module to prevent database connection at import time
vi.mock('@/infrastructure/database/prisma', () => ({
  prisma: {} as PrismaClient,
}));

import { AgentAnalyticsService } from '@/domains/analytics/AgentAnalyticsService';
import type {
  AgentInvocationMetrics,
  AgentUsageSummary,
  DailyUsage,
} from '@/domains/analytics/AgentAnalyticsService';

function createMockPrisma() {
  return {
    $executeRaw: vi.fn().mockResolvedValue(1),
    agent_usage_analytics: {
      groupBy: vi.fn().mockResolvedValue([]),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
}

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

describe('AgentAnalyticsService', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let service: AgentAnalyticsService;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    service = new AgentAnalyticsService({
      prisma: mockPrisma as unknown as PrismaClient,
      logger: mockLogger,
    });
    vi.clearAllMocks();
  });

  describe('recordInvocation', () => {
    it('should call $executeRaw with MERGE statement', async () => {
      const metrics: AgentInvocationMetrics = {
        agentId: 'bc-agent',
        success: true,
        inputTokens: 1000,
        outputTokens: 500,
        latencyMs: 1200,
      };

      await service.recordInvocation(metrics);

      expect(mockPrisma.$executeRaw).toHaveBeenCalledOnce();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        {
          agentId: 'bc-agent',
          success: true,
          inputTokens: 1000,
          outputTokens: 500,
          latencyMs: 1200,
        },
        'Agent invocation recorded'
      );
    });

    it('should NOT throw on DB failure', async () => {
      const dbError = new Error('Database connection lost');
      mockPrisma.$executeRaw.mockRejectedValueOnce(dbError);

      const metrics: AgentInvocationMetrics = {
        agentId: 'rag-agent',
        success: false,
        inputTokens: 500,
        outputTokens: 200,
        latencyMs: 800,
      };

      // Should not throw
      await expect(service.recordInvocation(metrics)).resolves.toBeUndefined();
    });

    it('should log warning on DB failure', async () => {
      const dbError = new Error('Database connection lost');
      mockPrisma.$executeRaw.mockRejectedValueOnce(dbError);

      const metrics: AgentInvocationMetrics = {
        agentId: 'supervisor',
        success: true,
        inputTokens: 300,
        outputTokens: 150,
        latencyMs: 600,
      };

      await service.recordInvocation(metrics);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        {
          error: {
            message: 'Database connection lost',
            stack: expect.any(String),
            name: 'Error',
          },
          metrics,
        },
        'Failed to record agent invocation'
      );
    });

    it('should handle success and error metrics correctly', async () => {
      const successMetrics: AgentInvocationMetrics = {
        agentId: 'bc-agent',
        success: true,
        inputTokens: 1000,
        outputTokens: 500,
        latencyMs: 1200,
      };

      await service.recordInvocation(successMetrics);
      expect(mockPrisma.$executeRaw).toHaveBeenCalledOnce();

      const errorMetrics: AgentInvocationMetrics = {
        agentId: 'bc-agent',
        success: false,
        inputTokens: 800,
        outputTokens: 0,
        latencyMs: 200,
      };

      await service.recordInvocation(errorMetrics);
      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(2);
    });
  });

  describe('getUsageSummary', () => {
    it('should return aggregated results', async () => {
      const mockGroupByResults = [
        {
          agent_id: 'bc-agent',
          _sum: {
            invocation_count: 10,
            success_count: 8,
            error_count: 2,
            total_input_tokens: 5000n,
            total_output_tokens: 3000n,
            total_latency_ms: 10000n,
          },
        },
        {
          agent_id: 'rag-agent',
          _sum: {
            invocation_count: 5,
            success_count: 5,
            error_count: 0,
            total_input_tokens: 2000n,
            total_output_tokens: 1000n,
            total_latency_ms: 3000n,
          },
        },
      ];

      mockPrisma.agent_usage_analytics.groupBy.mockResolvedValueOnce(
        mockGroupByResults
      );

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');

      const result = await service.getUsageSummary(startDate, endDate);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        agentId: 'bc-agent',
        totalInvocations: 10,
        totalSuccesses: 8,
        totalErrors: 2,
        totalInputTokens: 5000,
        totalOutputTokens: 3000,
        avgLatencyMs: 1000, // 10000 / 10
      });
      expect(result[1]).toEqual({
        agentId: 'rag-agent',
        totalInvocations: 5,
        totalSuccesses: 5,
        totalErrors: 0,
        totalInputTokens: 2000,
        totalOutputTokens: 1000,
        avgLatencyMs: 600, // 3000 / 5
      });

      expect(mockPrisma.agent_usage_analytics.groupBy).toHaveBeenCalledWith({
        by: ['agent_id'],
        where: {
          date: {
            gte: expect.any(Date),
            lte: expect.any(Date),
          },
        },
        _sum: {
          invocation_count: true,
          success_count: true,
          error_count: true,
          total_input_tokens: true,
          total_output_tokens: true,
          total_latency_ms: true,
        },
      });
    });

    it('should return empty array for no data', async () => {
      mockPrisma.agent_usage_analytics.groupBy.mockResolvedValueOnce([]);

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');

      const result = await service.getUsageSummary(startDate, endDate);

      expect(result).toEqual([]);
    });

    it('should calculate avgLatencyMs correctly', async () => {
      const mockGroupByResults = [
        {
          agent_id: 'test-agent',
          _sum: {
            invocation_count: 3,
            success_count: 3,
            error_count: 0,
            total_input_tokens: 1500n,
            total_output_tokens: 750n,
            total_latency_ms: 4567n, // Odd number to test rounding
          },
        },
      ];

      mockPrisma.agent_usage_analytics.groupBy.mockResolvedValueOnce(
        mockGroupByResults
      );

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');

      const result = await service.getUsageSummary(startDate, endDate);

      expect(result[0].avgLatencyMs).toBe(1522); // Math.round(4567 / 3)
    });

    it('should handle zero invocations gracefully', async () => {
      const mockGroupByResults = [
        {
          agent_id: 'idle-agent',
          _sum: {
            invocation_count: 0,
            success_count: 0,
            error_count: 0,
            total_input_tokens: 0n,
            total_output_tokens: 0n,
            total_latency_ms: 0n,
          },
        },
      ];

      mockPrisma.agent_usage_analytics.groupBy.mockResolvedValueOnce(
        mockGroupByResults
      );

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');

      const result = await service.getUsageSummary(startDate, endDate);

      expect(result[0].avgLatencyMs).toBe(0); // Avoid division by zero
    });
  });

  describe('getDailyUsage', () => {
    it('should return sorted daily data', async () => {
      const mockFindManyResults = [
        {
          date: new Date('2024-01-01T00:00:00Z'),
          agent_id: 'bc-agent',
          invocation_count: 5,
          success_count: 4,
          error_count: 1,
          total_input_tokens: 2500n,
          total_output_tokens: 1500n,
          total_latency_ms: 5000n,
          min_latency_ms: 500,
          max_latency_ms: 1500,
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          date: new Date('2024-01-02T00:00:00Z'),
          agent_id: 'bc-agent',
          invocation_count: 8,
          success_count: 7,
          error_count: 1,
          total_input_tokens: 4000n,
          total_output_tokens: 2400n,
          total_latency_ms: 9600n,
          min_latency_ms: 600,
          max_latency_ms: 1800,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      mockPrisma.agent_usage_analytics.findMany.mockResolvedValueOnce(
        mockFindManyResults
      );

      const result = await service.getDailyUsage('bc-agent', 7);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        date: '2024-01-01',
        invocationCount: 5,
        successCount: 4,
        errorCount: 1,
        totalInputTokens: 2500,
        totalOutputTokens: 1500,
        avgLatencyMs: 1000, // 5000 / 5
      });
      expect(result[1]).toEqual({
        date: '2024-01-02',
        invocationCount: 8,
        successCount: 7,
        errorCount: 1,
        totalInputTokens: 4000,
        totalOutputTokens: 2400,
        avgLatencyMs: 1200, // 9600 / 8
      });

      expect(mockPrisma.agent_usage_analytics.findMany).toHaveBeenCalledWith({
        where: {
          agent_id: 'bc-agent',
          date: {
            gte: expect.any(Date),
            lte: expect.any(Date),
          },
        },
        orderBy: {
          date: 'asc',
        },
      });
    });

    it('should respect days parameter', async () => {
      mockPrisma.agent_usage_analytics.findMany.mockResolvedValueOnce([]);

      await service.getDailyUsage('rag-agent', 15);

      const call = mockPrisma.agent_usage_analytics.findMany.mock.calls[0][0];
      const startDate = call.where.date.gte as Date;
      const endDate = call.where.date.lte as Date;

      // Verify the date range is approximately 15 days
      const daysDiff = Math.round(
        (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      expect(daysDiff).toBeGreaterThanOrEqual(14);
      expect(daysDiff).toBeLessThanOrEqual(16); // Allow for rounding
    });

    it('should use default 30 days when not specified', async () => {
      mockPrisma.agent_usage_analytics.findMany.mockResolvedValueOnce([]);

      await service.getDailyUsage('supervisor');

      const call = mockPrisma.agent_usage_analytics.findMany.mock.calls[0][0];
      const startDate = call.where.date.gte as Date;
      const endDate = call.where.date.lte as Date;

      const daysDiff = Math.round(
        (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      expect(daysDiff).toBeGreaterThanOrEqual(29);
      expect(daysDiff).toBeLessThanOrEqual(31);
    });

    it('should format date as ISO YYYY-MM-DD', async () => {
      const mockFindManyResults = [
        {
          date: new Date('2024-12-25T10:30:45.123Z'), // Time should be stripped
          agent_id: 'test-agent',
          invocation_count: 1,
          success_count: 1,
          error_count: 0,
          total_input_tokens: 100n,
          total_output_tokens: 50n,
          total_latency_ms: 200n,
          min_latency_ms: 200,
          max_latency_ms: 200,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      mockPrisma.agent_usage_analytics.findMany.mockResolvedValueOnce(
        mockFindManyResults
      );

      const result = await service.getDailyUsage('test-agent');

      expect(result[0].date).toBe('2024-12-25');
    });

    it('should return empty array when no data', async () => {
      mockPrisma.agent_usage_analytics.findMany.mockResolvedValueOnce([]);

      const result = await service.getDailyUsage('nonexistent-agent');

      expect(result).toEqual([]);
    });
  });
});
