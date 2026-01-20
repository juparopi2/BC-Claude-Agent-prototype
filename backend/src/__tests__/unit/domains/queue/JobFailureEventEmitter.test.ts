/**
 * JobFailureEventEmitter Unit Tests
 *
 * Tests for WebSocket-based job failure notifications.
 * Phase 3, Task 3.3
 *
 * Coverage Target: 80%+
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  JobFailureEventEmitter,
  getJobFailureEventEmitter,
  __resetJobFailureEventEmitter,
} from '@/domains/queue/emission/JobFailureEventEmitter';
import type { Server as SocketServer } from 'socket.io';
import type { JobFailedPayload, JobFailureContext } from '@bc-agent/shared';

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

// Mock SocketService
const mockIsSocketServiceInitialized = vi.hoisted(() => vi.fn());
const mockGetSocketIO = vi.hoisted(() => vi.fn());

vi.mock('@/services/websocket/SocketService', () => ({
  isSocketServiceInitialized: mockIsSocketServiceInitialized,
  getSocketIO: mockGetSocketIO,
}));

// ============================================================================
// TEST UTILITIES
// ============================================================================

function createMockSocket(): SocketServer {
  const mockRoom = {
    emit: vi.fn(),
  };
  return {
    to: vi.fn().mockReturnValue(mockRoom),
  } as unknown as SocketServer;
}

function createTestPayload(overrides: Partial<JobFailedPayload> = {}): JobFailedPayload {
  return {
    jobId: 'test-job-123',
    queueName: 'file-processing',
    error: 'Test error message',
    attemptsMade: 3,
    maxAttempts: 3,
    failedAt: new Date().toISOString(),
    ...overrides,
  };
}

function createTestContext(overrides: Partial<JobFailureContext> = {}): JobFailureContext {
  return {
    userId: 'USER-123',
    sessionId: 'SESSION-456',
    ...overrides,
  };
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('JobFailureEventEmitter', () => {
  let emitter: JobFailureEventEmitter;
  let mockSocket: SocketServer;

  beforeEach(() => {
    vi.clearAllMocks();
    __resetJobFailureEventEmitter();

    mockSocket = createMockSocket();
    mockIsSocketServiceInitialized.mockReturnValue(true);
    mockGetSocketIO.mockReturnValue(mockSocket);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    __resetJobFailureEventEmitter();
  });

  // ==========================================================================
  // 1. SINGLETON TESTS
  // ==========================================================================

  describe('Singleton Management', () => {
    it('should return singleton instance', () => {
      const instance1 = getJobFailureEventEmitter();
      const instance2 = getJobFailureEventEmitter();

      expect(instance1).toBe(instance2);
    });

    it('should reset singleton', () => {
      const instance1 = getJobFailureEventEmitter();
      __resetJobFailureEventEmitter();
      const instance2 = getJobFailureEventEmitter();

      expect(instance1).not.toBe(instance2);
    });

    it('should accept custom dependencies', () => {
      const customLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      };

      emitter = getJobFailureEventEmitter({
        logger: customLogger as ReturnType<typeof import('@/shared/utils/logger').createChildLogger>,
        isSocketReady: () => true,
        getIO: () => mockSocket,
      });

      // Should use custom logger (verify by calling a method)
      emitter.emitJobFailed(createTestContext(), createTestPayload());
      expect(customLogger.info).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // 2. EMIT JOB FAILED TESTS
  // ==========================================================================

  describe('emitJobFailed', () => {
    beforeEach(() => {
      emitter = getJobFailureEventEmitter({
        isSocketReady: () => true,
        getIO: () => mockSocket,
      });
    });

    it('should emit to user room', () => {
      const ctx = createTestContext({ sessionId: undefined });
      const payload = createTestPayload();

      emitter.emitJobFailed(ctx, payload);

      expect(mockSocket.to).toHaveBeenCalledWith('user:USER-123');
      expect((mockSocket.to('') as { emit: ReturnType<typeof vi.fn> }).emit).toHaveBeenCalledWith(
        'job:failed',
        payload
      );
    });

    it('should emit to both user room and session room', () => {
      const ctx = createTestContext();
      const payload = createTestPayload();

      emitter.emitJobFailed(ctx, payload);

      // Should emit to both rooms
      expect(mockSocket.to).toHaveBeenCalledWith('user:USER-123');
      expect(mockSocket.to).toHaveBeenCalledWith('SESSION-456');
    });

    it('should skip emission when Socket.IO not initialized', () => {
      // Reset singleton first
      __resetJobFailureEventEmitter();

      // Create emitter with socket not ready
      const emitterNoSocket = getJobFailureEventEmitter({
        isSocketReady: () => false,
        getIO: () => { throw new Error('Not initialized'); },
      });

      const ctx = createTestContext();
      const payload = createTestPayload({ jobId: 'no-socket-test' });

      // This should not throw
      emitterNoSocket.emitJobFailed(ctx, payload);

      expect(mockSocket.to).not.toHaveBeenCalled();
    });

    it('should skip emission when no userId provided', () => {
      const ctx = { userId: '' };
      const payload = createTestPayload();

      emitter.emitJobFailed(ctx, payload);

      expect(mockSocket.to).not.toHaveBeenCalled();
    });

    it('should handle Socket.IO errors gracefully', () => {
      const errorSocket = {
        to: vi.fn().mockImplementation(() => {
          throw new Error('Socket error');
        }),
      } as unknown as SocketServer;

      emitter = getJobFailureEventEmitter({
        isSocketReady: () => true,
        getIO: () => errorSocket,
      });

      __resetJobFailureEventEmitter();
      const freshEmitter = getJobFailureEventEmitter({
        isSocketReady: () => true,
        getIO: () => errorSocket,
      });

      const ctx = createTestContext();
      const payload = createTestPayload();

      // Should not throw
      expect(() => freshEmitter.emitJobFailed(ctx, payload)).not.toThrow();
    });
  });

  // ==========================================================================
  // 3. DEDUPLICATION TESTS
  // ==========================================================================

  describe('Deduplication', () => {
    beforeEach(() => {
      emitter = getJobFailureEventEmitter({
        isSocketReady: () => true,
        getIO: () => mockSocket,
      });
    });

    it('should suppress duplicate notifications within window', () => {
      const ctx = createTestContext();
      const payload = createTestPayload({ jobId: 'dedup-test-1' });

      // First emission
      emitter.emitJobFailed(ctx, payload);
      expect(mockSocket.to).toHaveBeenCalledTimes(2); // user + session

      vi.clearAllMocks();

      // Second emission (same jobId, should be suppressed)
      emitter.emitJobFailed(ctx, payload);
      expect(mockSocket.to).not.toHaveBeenCalled();
    });

    it('should allow emissions for different jobIds', () => {
      const ctx = createTestContext();

      emitter.emitJobFailed(ctx, createTestPayload({ jobId: 'job-1' }));
      vi.clearAllMocks();

      emitter.emitJobFailed(ctx, createTestPayload({ jobId: 'job-2' }));
      expect(mockSocket.to).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // 4. CREATE PAYLOAD TESTS
  // ==========================================================================

  describe('createPayload', () => {
    beforeEach(() => {
      emitter = getJobFailureEventEmitter();
    });

    it('should create valid payload', () => {
      const payload = emitter.createPayload(
        'job-123',
        'file-processing',
        'Test error',
        3,
        3,
        { fileId: 'file-abc', fileName: 'test.pdf' }
      );

      expect(payload).toEqual({
        jobId: 'job-123',
        queueName: 'file-processing',
        error: 'Test error',
        attemptsMade: 3,
        maxAttempts: 3,
        failedAt: expect.any(String),
        context: {
          fileId: 'file-abc',
          fileName: 'test.pdf',
        },
      });
    });

    it('should create payload without context', () => {
      const payload = emitter.createPayload(
        'job-456',
        'message-persistence',
        'Database error',
        1,
        5
      );

      expect(payload.context).toBeUndefined();
      expect(payload.queueName).toBe('message-persistence');
    });

    it('should include ISO timestamp', () => {
      const before = new Date().toISOString();
      const payload = emitter.createPayload('job', 'file-processing', 'err', 1, 1);
      const after = new Date().toISOString();

      expect(payload.failedAt >= before).toBe(true);
      expect(payload.failedAt <= after).toBe(true);
    });
  });

  // ==========================================================================
  // 5. EDGE CASES
  // ==========================================================================

  describe('Edge Cases', () => {
    beforeEach(() => {
      emitter = getJobFailureEventEmitter({
        isSocketReady: () => true,
        getIO: () => mockSocket,
      });
    });

    it('should handle very long error messages', () => {
      const longError = 'A'.repeat(10000);
      const ctx = createTestContext();
      const payload = createTestPayload({ error: longError });

      // Should not throw
      expect(() => emitter.emitJobFailed(ctx, payload)).not.toThrow();
    });

    it('should handle special characters in context', () => {
      const ctx = createTestContext();
      const payload = createTestPayload({
        context: {
          fileName: 'file with "quotes" & <special> chars.pdf',
          sessionId: "session'with'apostrophes",
        },
      });

      // Should not throw
      expect(() => emitter.emitJobFailed(ctx, payload)).not.toThrow();
    });

    it('should work with all valid queue names', () => {
      const queueNames: Array<'file-processing' | 'file-chunking' | 'message-persistence'> = [
        'file-processing',
        'file-chunking',
        'message-persistence',
      ];

      for (let i = 0; i < queueNames.length; i++) {
        const queueName = queueNames[i];
        vi.clearAllMocks();
        // Use unique jobId for each to avoid deduplication
        const payload = emitter.createPayload(`job-${queueName}-${i}`, queueName, 'error', 1, 1);
        const ctx = createTestContext();

        emitter.emitJobFailed(ctx, payload);
        expect(mockSocket.to).toHaveBeenCalled();
      }
    });
  });
});
