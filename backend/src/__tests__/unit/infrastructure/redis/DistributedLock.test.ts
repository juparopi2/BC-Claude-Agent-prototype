/**
 * DistributedLock Unit Tests
 *
 * Tests for Redis-based distributed locking mechanism.
 * Covers acquire, release, isLocked, and withLock operations.
 *
 * Created: Phase 3, Task 3.2
 * Coverage Target: 80%+
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DistributedLock,
  initDistributedLock,
  getDistributedLock,
  isDistributedLockInitialized,
  __resetDistributedLock,
} from '@/infrastructure/redis/DistributedLock';
import type Redis from 'ioredis';

// ============================================================================
// MOCKS SETUP
// ============================================================================

// Mock logger
vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'mock-uuid-1234'),
}));

// ============================================================================
// TEST UTILITIES
// ============================================================================

function createMockRedis(): Redis {
  return {
    set: vi.fn(),
    del: vi.fn(),
    exists: vi.fn(),
    eval: vi.fn(),
  } as unknown as Redis;
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('DistributedLock', () => {
  let lock: DistributedLock;
  let mockRedis: Redis;

  beforeEach(() => {
    vi.clearAllMocks();
    __resetDistributedLock();

    mockRedis = createMockRedis();
    lock = new DistributedLock({ redis: mockRedis });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    __resetDistributedLock();
  });

  // ==========================================================================
  // 1. ACQUIRE LOCK TESTS
  // ==========================================================================

  describe('acquire', () => {
    it('should acquire lock successfully when not held', async () => {
      (mockRedis.set as ReturnType<typeof vi.fn>).mockResolvedValue('OK');

      const token = await lock.acquire('test-key', 30000);

      expect(token).toBe('MOCK-UUID-1234'); // UUID uppercase per CLAUDE.md
      expect(mockRedis.set).toHaveBeenCalledWith(
        'lock:test-key',
        'MOCK-UUID-1234',
        'EX',
        30, // 30000ms = 30s
        'NX'
      );
    });

    it('should return null when lock already held', async () => {
      (mockRedis.set as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const token = await lock.acquire('test-key', 30000);

      expect(token).toBeNull();
    });

    it('should return null on Redis error', async () => {
      (mockRedis.set as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Connection failed'));

      const token = await lock.acquire('test-key', 30000);

      expect(token).toBeNull();
    });

    it('should use correct TTL in seconds (ceiling)', async () => {
      (mockRedis.set as ReturnType<typeof vi.fn>).mockResolvedValue('OK');

      await lock.acquire('test-key', 1500); // 1.5 seconds

      expect(mockRedis.set).toHaveBeenCalledWith(
        'lock:test-key',
        'MOCK-UUID-1234',
        'EX',
        2, // Ceiling of 1.5 = 2
        'NX'
      );
    });
  });

  // ==========================================================================
  // 2. RELEASE LOCK TESTS
  // ==========================================================================

  describe('release', () => {
    it('should release lock successfully when token matches', async () => {
      (mockRedis.eval as ReturnType<typeof vi.fn>).mockResolvedValue(1);

      const result = await lock.release('test-key', 'valid-token');

      expect(result).toBe(true);
      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.stringContaining('redis.call("get"'),
        1,
        'lock:test-key',
        'valid-token'
      );
    });

    it('should return false when token does not match', async () => {
      (mockRedis.eval as ReturnType<typeof vi.fn>).mockResolvedValue(0);

      const result = await lock.release('test-key', 'wrong-token');

      expect(result).toBe(false);
    });

    it('should return false on Redis error', async () => {
      (mockRedis.eval as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Connection failed'));

      const result = await lock.release('test-key', 'token');

      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // 3. IS LOCKED TESTS
  // ==========================================================================

  describe('isLocked', () => {
    it('should return true when lock exists', async () => {
      (mockRedis.exists as ReturnType<typeof vi.fn>).mockResolvedValue(1);

      const result = await lock.isLocked('test-key');

      expect(result).toBe(true);
      expect(mockRedis.exists).toHaveBeenCalledWith('lock:test-key');
    });

    it('should return false when lock does not exist', async () => {
      (mockRedis.exists as ReturnType<typeof vi.fn>).mockResolvedValue(0);

      const result = await lock.isLocked('test-key');

      expect(result).toBe(false);
    });

    it('should return false on Redis error', async () => {
      (mockRedis.exists as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Connection failed'));

      const result = await lock.isLocked('test-key');

      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // 4. WITH LOCK TESTS
  // ==========================================================================

  describe('withLock', () => {
    it('should execute function when lock acquired', async () => {
      (mockRedis.set as ReturnType<typeof vi.fn>).mockResolvedValue('OK');
      (mockRedis.eval as ReturnType<typeof vi.fn>).mockResolvedValue(1);

      const fn = vi.fn().mockResolvedValue('result');
      const result = await lock.withLock('test-key', fn);

      expect(fn).toHaveBeenCalled();
      expect(result).toBe('result');
      expect(mockRedis.eval).toHaveBeenCalled(); // Lock released
    });

    it('should release lock even if function throws', async () => {
      (mockRedis.set as ReturnType<typeof vi.fn>).mockResolvedValue('OK');
      (mockRedis.eval as ReturnType<typeof vi.fn>).mockResolvedValue(1);

      const fn = vi.fn().mockRejectedValue(new Error('Function failed'));

      await expect(lock.withLock('test-key', fn)).rejects.toThrow('Function failed');
      expect(mockRedis.eval).toHaveBeenCalled(); // Lock still released
    });

    it('should throw error when lock not acquired (throwOnFailure: true)', async () => {
      (mockRedis.set as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const fn = vi.fn();
      await expect(
        lock.withLock('test-key', fn, { retry: false, throwOnFailure: true })
      ).rejects.toThrow('Failed to acquire lock for key: test-key');

      expect(fn).not.toHaveBeenCalled();
    });

    it('should return { acquired: false } when lock not acquired (throwOnFailure: false)', async () => {
      (mockRedis.set as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const fn = vi.fn().mockResolvedValue('result');
      const result = await lock.withLock('test-key', fn, {
        retry: false,
        throwOnFailure: false,
      });

      expect(result).toEqual({ acquired: false });
      expect(fn).not.toHaveBeenCalled();
    });

    it('should return { acquired: true, result } when throwOnFailure: false', async () => {
      (mockRedis.set as ReturnType<typeof vi.fn>).mockResolvedValue('OK');
      (mockRedis.eval as ReturnType<typeof vi.fn>).mockResolvedValue(1);

      const fn = vi.fn().mockResolvedValue('result');
      const result = await lock.withLock('test-key', fn, { throwOnFailure: false });

      expect(result).toEqual({ acquired: true, result: 'result' });
    });

    it('should retry acquiring lock with exponential backoff', async () => {
      // First 2 attempts fail, 3rd succeeds
      (mockRedis.set as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('OK');
      (mockRedis.eval as ReturnType<typeof vi.fn>).mockResolvedValue(1);

      const fn = vi.fn().mockResolvedValue('result');
      const result = await lock.withLock('test-key', fn, {
        retry: true,
        maxRetries: 5,
        retryDelayMs: 10, // Short delay for testing
      });

      expect(result).toBe('result');
      expect(mockRedis.set).toHaveBeenCalledTimes(3);
    });

    it('should respect custom TTL', async () => {
      (mockRedis.set as ReturnType<typeof vi.fn>).mockResolvedValue('OK');
      (mockRedis.eval as ReturnType<typeof vi.fn>).mockResolvedValue(1);

      await lock.withLock('test-key', async () => 'result', { ttlMs: 60000 });

      expect(mockRedis.set).toHaveBeenCalledWith(
        'lock:test-key',
        'MOCK-UUID-1234',
        'EX',
        60, // 60 seconds
        'NX'
      );
    });
  });

  // ==========================================================================
  // 5. SINGLETON MANAGEMENT TESTS
  // ==========================================================================

  describe('Singleton Management', () => {
    beforeEach(() => {
      __resetDistributedLock();
    });

    it('should initialize singleton', () => {
      expect(isDistributedLockInitialized()).toBe(false);

      initDistributedLock(mockRedis);

      expect(isDistributedLockInitialized()).toBe(true);
    });

    it('should return singleton instance after init', () => {
      initDistributedLock(mockRedis);

      const instance = getDistributedLock();

      expect(instance).toBeInstanceOf(DistributedLock);
    });

    it('should throw when getting instance before init', () => {
      expect(() => getDistributedLock()).toThrow(
        'DistributedLock not initialized. Call initDistributedLock(redis) during server startup.'
      );
    });

    it('should skip re-initialization if already initialized', () => {
      initDistributedLock(mockRedis);
      const firstInstance = getDistributedLock();

      // Re-initialize (should be skipped)
      const newMockRedis = createMockRedis();
      initDistributedLock(newMockRedis);

      const secondInstance = getDistributedLock();
      expect(secondInstance).toBe(firstInstance); // Same instance
    });

    it('should reset singleton', () => {
      initDistributedLock(mockRedis);
      expect(isDistributedLockInitialized()).toBe(true);

      __resetDistributedLock();

      expect(isDistributedLockInitialized()).toBe(false);
    });
  });

  // ==========================================================================
  // 6. EDGE CASES
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle special characters in key', async () => {
      (mockRedis.set as ReturnType<typeof vi.fn>).mockResolvedValue('OK');

      await lock.acquire('user:123:refresh-token', 30000);

      expect(mockRedis.set).toHaveBeenCalledWith(
        'lock:user:123:refresh-token',
        expect.any(String),
        'EX',
        30,
        'NX'
      );
    });

    it('should handle very short TTL (minimum 1 second)', async () => {
      (mockRedis.set as ReturnType<typeof vi.fn>).mockResolvedValue('OK');

      await lock.acquire('test-key', 100); // 100ms

      expect(mockRedis.set).toHaveBeenCalledWith(
        'lock:test-key',
        expect.any(String),
        'EX',
        1, // Minimum 1 second
        'NX'
      );
    });
  });
});
