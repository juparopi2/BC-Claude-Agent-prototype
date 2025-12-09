/**
 * Usage Tracking Service Tests
 *
 * Unit tests for UsageTrackingService.
 * These tests mock the database and Redis layers to test service logic.
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
  UsageTrackingService,
  getUsageTrackingService,
  __resetUsageTrackingService,
} from '@/services/tracking/UsageTrackingService';
import { UNIT_COSTS } from '@config/pricing.config';

describe('UsageTrackingService', () => {
  let service: UsageTrackingService;
  let mockPool: Partial<ConnectionPool>;
  let mockRedis: Partial<Redis>;
  let mockRequest: {
    input: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    __resetUsageTrackingService();

    // Mock database request
    mockRequest = {
      input: vi.fn().mockReturnThis(),
      query: vi.fn().mockResolvedValue({
        recordset: [],
        recordsets: [],
        rowsAffected: [1],
        output: {},
      } as IResult<unknown>),
    };

    // Mock database pool
    mockPool = {
      request: vi.fn().mockReturnValue(mockRequest),
    };

    // Mock Redis client
    mockRedis = {
      incrby: vi.fn().mockResolvedValue(100),
      expire: vi.fn().mockResolvedValue(1),
    };

    // Create service with mocked dependencies
    service = new UsageTrackingService(
      mockPool as ConnectionPool,
      mockRedis as Redis
    );
  });

  afterEach(() => {
    __resetUsageTrackingService();
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance when called without dependencies', () => {
      // Reset to test singleton behavior
      __resetUsageTrackingService();

      const instance1 = getUsageTrackingService(mockPool as ConnectionPool, mockRedis as Redis);
      const instance2 = getUsageTrackingService();

      // Should create new instance when dependencies provided
      expect(instance1).not.toBe(instance2);
    });

    it('should create singleton instance on first call', () => {
      __resetUsageTrackingService();

      const instance1 = getUsageTrackingService(mockPool as ConnectionPool, mockRedis as Redis);
      const instance2 = getUsageTrackingService(mockPool as ConnectionPool, mockRedis as Redis);

      // Should create new instances when dependencies provided
      expect(instance1).not.toBe(instance2);
    });
  });

  describe('trackFileUpload', () => {
    it('should track file upload with correct cost calculation', async () => {
      const userId = '123e4567-e89b-12d3-a456-426614174000';
      const fileId = '987fcdeb-51a2-43d7-8765-ba9876543210';
      const sizeBytes = 1048576; // 1MB
      const metadata = { file_name: 'document.pdf', mime_type: 'application/pdf' };

      const expectedCost = sizeBytes * UNIT_COSTS.storage_per_byte;

      await service.trackFileUpload(userId, fileId, sizeBytes, metadata);

      // Verify database insert
      expect(mockPool.request).toHaveBeenCalledTimes(1);
      expect(mockRequest.input).toHaveBeenCalledWith('user_id', userId);
      expect(mockRequest.input).toHaveBeenCalledWith('session_id', fileId);
      expect(mockRequest.input).toHaveBeenCalledWith('category', 'storage');
      expect(mockRequest.input).toHaveBeenCalledWith('event_type', 'file_upload');
      expect(mockRequest.input).toHaveBeenCalledWith('quantity', sizeBytes);
      expect(mockRequest.input).toHaveBeenCalledWith('unit', 'bytes');
      expect(mockRequest.input).toHaveBeenCalledWith('cost', expectedCost);
      expect(mockRequest.input).toHaveBeenCalledWith('metadata', JSON.stringify(metadata));

      // Verify Redis counter increment
      expect(mockRedis.incrby).toHaveBeenCalledTimes(1);
      expect(mockRedis.incrby).toHaveBeenCalledWith(
        expect.stringMatching(/^usage:counter:.+:storage_bytes:\d{4}-\d{2}$/),
        sizeBytes
      );
    });

    it('should handle database errors gracefully', async () => {
      mockRequest.query.mockRejectedValueOnce(new Error('Database connection failed'));

      const userId = '123e4567-e89b-12d3-a456-426614174000';
      const fileId = '987fcdeb-51a2-43d7-8765-ba9876543210';
      const sizeBytes = 1048576;

      // Should not throw error
      await expect(
        service.trackFileUpload(userId, fileId, sizeBytes)
      ).resolves.not.toThrow();

      // Should attempt database insert
      expect(mockPool.request).toHaveBeenCalled();
    });
  });

  describe('trackClaudeUsage', () => {
    it('should track Claude usage with input and output tokens', async () => {
      const userId = '123e4567-e89b-12d3-a456-426614174000';
      const sessionId = '987fcdeb-51a2-43d7-8765-ba9876543210';
      const inputTokens = 506000;
      const outputTokens = 81000;
      const model = 'claude-sonnet-4-5-20250929';
      const metadata = { message_id: 'msg_01ABC' };

      await service.trackClaudeUsage(
        userId,
        sessionId,
        inputTokens,
        outputTokens,
        model,
        metadata
      );

      // Should insert 2 events (input + output)
      expect(mockPool.request).toHaveBeenCalledTimes(2);

      // Verify input tokens event
      expect(mockRequest.input).toHaveBeenCalledWith('event_type', 'claude_input_tokens');
      expect(mockRequest.input).toHaveBeenCalledWith('quantity', inputTokens);
      expect(mockRequest.input).toHaveBeenCalledWith(
        'cost',
        inputTokens * UNIT_COSTS.claude_input_token
      );

      // Verify output tokens event
      expect(mockRequest.input).toHaveBeenCalledWith('event_type', 'claude_output_tokens');
      expect(mockRequest.input).toHaveBeenCalledWith('quantity', outputTokens);
      expect(mockRequest.input).toHaveBeenCalledWith(
        'cost',
        outputTokens * UNIT_COSTS.claude_output_token
      );

      // Verify Redis counters
      expect(mockRedis.incrby).toHaveBeenCalledWith(
        expect.stringMatching(/^usage:counter:.+:ai_tokens:\d{4}-\d{2}$/),
        inputTokens + outputTokens
      );
      expect(mockRedis.incrby).toHaveBeenCalledWith(
        expect.stringMatching(/^usage:counter:.+:ai_calls:\d{4}-\d{2}$/),
        1
      );
    });

    it('should track cache tokens when provided', async () => {
      const userId = '123e4567-e89b-12d3-a456-426614174000';
      const sessionId = '987fcdeb-51a2-43d7-8765-ba9876543210';
      const inputTokens = 100000;
      const outputTokens = 20000;
      const model = 'claude-sonnet-4-5-20250929';
      const metadata = {
        cache_write_tokens: 50000,
        cache_read_tokens: 150000,
      };

      await service.trackClaudeUsage(
        userId,
        sessionId,
        inputTokens,
        outputTokens,
        model,
        metadata
      );

      // Should insert 4 events (input + output + cache_write + cache_read)
      expect(mockPool.request).toHaveBeenCalledTimes(4);

      // Verify cache write tokens event
      expect(mockRequest.input).toHaveBeenCalledWith('event_type', 'cache_write_tokens');
      expect(mockRequest.input).toHaveBeenCalledWith('quantity', 50000);

      // Verify cache read tokens event
      expect(mockRequest.input).toHaveBeenCalledWith('event_type', 'cache_read_tokens');
      expect(mockRequest.input).toHaveBeenCalledWith('quantity', 150000);
    });

    it('should handle errors gracefully', async () => {
      mockRequest.query.mockRejectedValueOnce(new Error('Database error'));

      const userId = '123e4567-e89b-12d3-a456-426614174000';
      const sessionId = '987fcdeb-51a2-43d7-8765-ba9876543210';

      // Should not throw error
      await expect(
        service.trackClaudeUsage(userId, sessionId, 1000, 500, 'claude-sonnet-4-5-20250929')
      ).resolves.not.toThrow();
    });
  });

  describe('trackToolExecution', () => {
    it('should track tool execution with duration', async () => {
      const userId = '123e4567-e89b-12d3-a456-426614174000';
      const sessionId = '987fcdeb-51a2-43d7-8765-ba9876543210';
      const toolName = 'list_all_entities';
      const durationMs = 1234;
      const metadata = { success: true, result_size: 500 };

      await service.trackToolExecution(userId, sessionId, toolName, durationMs, metadata);

      // Verify database insert
      expect(mockPool.request).toHaveBeenCalledTimes(1);
      expect(mockRequest.input).toHaveBeenCalledWith('category', 'ai');
      expect(mockRequest.input).toHaveBeenCalledWith('event_type', 'tool_executed');
      expect(mockRequest.input).toHaveBeenCalledWith('quantity', durationMs);
      expect(mockRequest.input).toHaveBeenCalledWith('unit', 'milliseconds');
      expect(mockRequest.input).toHaveBeenCalledWith('cost', 0); // No direct cost

      // Verify metadata includes tool name
      expect(mockRequest.input).toHaveBeenCalledWith(
        'metadata',
        expect.stringContaining(toolName)
      );

      // Verify Redis counter
      expect(mockRedis.incrby).toHaveBeenCalledWith(
        expect.stringMatching(/^usage:counter:.+:tool_calls:\d{4}-\d{2}$/),
        1
      );
    });

    it('should handle errors gracefully', async () => {
      mockRequest.query.mockRejectedValueOnce(new Error('Database error'));

      const userId = '123e4567-e89b-12d3-a456-426614174000';
      const sessionId = '987fcdeb-51a2-43d7-8765-ba9876543210';

      // Should not throw error
      await expect(
        service.trackToolExecution(userId, sessionId, 'test_tool', 100)
      ).resolves.not.toThrow();
    });
  });

  describe('Future Methods (Stubs)', () => {
    it('should track text extraction', async () => {
      const userId = '123e4567-e89b-12d3-a456-426614174000';
      const fileId = '987fcdeb-51a2-43d7-8765-ba9876543210';
      const pagesCount = 5;

      await service.trackTextExtraction(userId, fileId, pagesCount);

      expect(mockPool.request).toHaveBeenCalledTimes(1);
      expect(mockRequest.input).toHaveBeenCalledWith('category', 'processing');
      expect(mockRequest.input).toHaveBeenCalledWith('event_type', 'text_extraction');
    });

    it('should track embedding generation', async () => {
      const userId = '123e4567-e89b-12d3-a456-426614174000';
      const fileId = '987fcdeb-51a2-43d7-8765-ba9876543210';
      const tokens = 1000;

      await service.trackEmbedding(userId, fileId, tokens, 'text');

      expect(mockPool.request).toHaveBeenCalledTimes(1);
      expect(mockRequest.input).toHaveBeenCalledWith('category', 'embeddings');
      expect(mockRequest.input).toHaveBeenCalledWith('event_type', 'embedding_generation');
    });

    it('should track vector search', async () => {
      const userId = '123e4567-e89b-12d3-a456-426614174000';
      const queryTokens = 50;

      await service.trackVectorSearch(userId, queryTokens);

      expect(mockPool.request).toHaveBeenCalledTimes(1);
      expect(mockRequest.input).toHaveBeenCalledWith('category', 'search');
      expect(mockRequest.input).toHaveBeenCalledWith('event_type', 'semantic_search');
    });
  });

  describe('Redis Counter Management', () => {
    it('should set expiry on new counters', async () => {
      // First call returns the amount (indicating new counter)
      mockRedis.incrby = vi.fn().mockResolvedValueOnce(100);

      const userId = '123e4567-e89b-12d3-a456-426614174000';
      const fileId = '987fcdeb-51a2-43d7-8765-ba9876543210';

      await service.trackFileUpload(userId, fileId, 100);

      // Should set expiry (90 days)
      expect(mockRedis.expire).toHaveBeenCalledWith(
        expect.stringMatching(/^usage:counter:.+:storage_bytes:\d{4}-\d{2}$/),
        90 * 24 * 60 * 60
      );
    });

    it('should not set expiry on existing counters', async () => {
      // Return value greater than increment amount (indicating existing counter)
      mockRedis.incrby = vi.fn().mockResolvedValueOnce(1000);

      const userId = '123e4567-e89b-12d3-a456-426614174000';
      const fileId = '987fcdeb-51a2-43d7-8765-ba9876543210';

      await service.trackFileUpload(userId, fileId, 100);

      // Should NOT set expiry
      expect(mockRedis.expire).not.toHaveBeenCalled();
    });

    it('should handle Redis errors gracefully', async () => {
      mockRedis.incrby = vi.fn().mockRejectedValueOnce(new Error('Redis connection failed'));

      const userId = '123e4567-e89b-12d3-a456-426614174000';
      const fileId = '987fcdeb-51a2-43d7-8765-ba9876543210';

      // Should not throw error
      await expect(
        service.trackFileUpload(userId, fileId, 100)
      ).resolves.not.toThrow();
    });
  });

  describe('Error Handling', () => {
    it('should never throw errors from public methods', async () => {
      // Make all operations fail
      mockRequest.query.mockRejectedValue(new Error('Database error'));
      mockRedis.incrby = vi.fn().mockRejectedValue(new Error('Redis error'));

      const userId = '123e4567-e89b-12d3-a456-426614174000';
      const sessionId = '987fcdeb-51a2-43d7-8765-ba9876543210';

      // All methods should resolve without throwing
      await expect(service.trackFileUpload(userId, sessionId, 100)).resolves.not.toThrow();
      await expect(
        service.trackClaudeUsage(userId, sessionId, 1000, 500, 'claude-sonnet-4-5-20250929')
      ).resolves.not.toThrow();
      await expect(
        service.trackToolExecution(userId, sessionId, 'test_tool', 100)
      ).resolves.not.toThrow();
    });
  });
});
