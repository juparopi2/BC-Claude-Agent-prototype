/**
 * FileEventEmitter Unit Tests
 *
 * Tests for centralized WebSocket event emission for file status updates.
 * TDD approach: These tests define the expected behavior before implementation.
 *
 * Coverage Target: 100% (all emission methods, edge cases, error handling)
 *
 * @module __tests__/unit/domains/files/FileEventEmitter
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Server as SocketServer } from 'socket.io';
import { FILE_WS_CHANNELS, FILE_WS_EVENTS } from '@bc-agent/shared';

// ========== MOCKS ==========

// Mock Socket.IO instance
const mockEmit = vi.fn();
const mockTo = vi.fn().mockReturnValue({ emit: mockEmit });
const mockIO = {
  to: mockTo,
  emit: mockEmit,
} as unknown as SocketServer;

// Mock SocketService
vi.mock('@/services/websocket/SocketService', () => ({
  isSocketServiceInitialized: vi.fn(() => true),
  getSocketIO: vi.fn(() => mockIO),
}));

// Mock logger
const mockLogger = {
  info: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
};

vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: vi.fn(() => mockLogger),
}));

// ========== IMPORTS (after mocks) ==========

import {
  FileEventEmitter,
  getFileEventEmitter,
  __resetFileEventEmitter,
} from '@/domains/files/emission/FileEventEmitter';
import { isSocketServiceInitialized, getSocketIO } from '@/services/websocket/SocketService';
import type { FileEventContext } from '@/domains/files/emission/IFileEventEmitter';

// ========== TEST HELPERS ==========

function createTestContext(overrides?: Partial<FileEventContext>): FileEventContext {
  return {
    fileId: 'file-123',
    userId: 'user-456',
    sessionId: 'session-789',
    ...overrides,
  };
}

// ========== TEST SUITES ==========

describe('FileEventEmitter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetFileEventEmitter();
    vi.mocked(isSocketServiceInitialized).mockReturnValue(true);
    vi.mocked(getSocketIO).mockReturnValue(mockIO);
  });

  afterEach(() => {
    __resetFileEventEmitter();
  });

  // ========== SUITE 1: Singleton Pattern ==========
  describe('Singleton Pattern', () => {
    it('should return the same instance on multiple calls', () => {
      const instance1 = getFileEventEmitter();
      const instance2 = getFileEventEmitter();
      expect(instance1).toBe(instance2);
    });

    it('should create new instance after reset', () => {
      const instance1 = getFileEventEmitter();
      __resetFileEventEmitter();
      const instance2 = getFileEventEmitter();
      expect(instance1).not.toBe(instance2);
    });

    it('should be an instance of FileEventEmitter', () => {
      const instance = getFileEventEmitter();
      expect(instance).toBeInstanceOf(FileEventEmitter);
    });
  });

  // ========== SUITE 2: emitReadinessChanged ==========
  describe('emitReadinessChanged()', () => {
    it('should emit to file:status channel', () => {
      const emitter = getFileEventEmitter();
      const ctx = createTestContext();

      emitter.emitReadinessChanged(ctx, {
        previousState: 'uploading',
        newState: 'processing',
        processingStatus: 'processing',
        embeddingStatus: 'pending',
      });

      expect(mockTo).toHaveBeenCalledWith('session-789');
      expect(mockEmit).toHaveBeenCalledWith(
        FILE_WS_CHANNELS.STATUS,
        expect.objectContaining({
          type: FILE_WS_EVENTS.READINESS_CHANGED,
          fileId: 'file-123',
          userId: 'user-456',
          readinessState: 'processing',
          previousState: 'uploading',
          processingStatus: 'processing',
          embeddingStatus: 'pending',
        })
      );
    });

    it('should include timestamp in event payload', () => {
      const emitter = getFileEventEmitter();
      const ctx = createTestContext();

      emitter.emitReadinessChanged(ctx, {
        newState: 'ready',
        processingStatus: 'completed',
        embeddingStatus: 'completed',
      });

      expect(mockEmit).toHaveBeenCalledWith(
        FILE_WS_CHANNELS.STATUS,
        expect.objectContaining({
          timestamp: expect.any(String),
        })
      );
    });

    it('should handle all state transitions', () => {
      const emitter = getFileEventEmitter();
      const ctx = createTestContext();

      // uploading -> processing
      emitter.emitReadinessChanged(ctx, {
        previousState: 'uploading',
        newState: 'processing',
        processingStatus: 'processing',
        embeddingStatus: 'pending',
      });

      // processing -> ready
      emitter.emitReadinessChanged(ctx, {
        previousState: 'processing',
        newState: 'ready',
        processingStatus: 'completed',
        embeddingStatus: 'completed',
      });

      // processing -> failed
      emitter.emitReadinessChanged(ctx, {
        previousState: 'processing',
        newState: 'failed',
        processingStatus: 'failed',
        embeddingStatus: 'pending',
      });

      // 3 events x 2 rooms (userId + sessionId) = 6 emit calls
      expect(mockEmit).toHaveBeenCalledTimes(6);
    });

    it('should skip if no userId and no sessionId provided', () => {
      const emitter = getFileEventEmitter();
      const ctx = createTestContext({ sessionId: undefined, userId: undefined });

      emitter.emitReadinessChanged(ctx, {
        newState: 'processing',
        processingStatus: 'processing',
        embeddingStatus: 'pending',
      });

      expect(mockTo).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('should emit to userId room even without sessionId', () => {
      const emitter = getFileEventEmitter();
      const ctx = createTestContext({ sessionId: undefined });

      emitter.emitReadinessChanged(ctx, {
        newState: 'processing',
        processingStatus: 'processing',
        embeddingStatus: 'pending',
      });

      expect(mockTo).toHaveBeenCalledWith('user:user-456');
      expect(mockEmit).toHaveBeenCalled();
    });

    it('should skip if Socket.IO not initialized', () => {
      vi.mocked(isSocketServiceInitialized).mockReturnValue(false);
      const emitter = getFileEventEmitter();
      const ctx = createTestContext();

      emitter.emitReadinessChanged(ctx, {
        newState: 'ready',
        processingStatus: 'completed',
        embeddingStatus: 'completed',
      });

      expect(mockTo).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
    });
  });

  // ========== SUITE 3: emitPermanentlyFailed ==========
  describe('emitPermanentlyFailed()', () => {
    it('should emit to file:status channel with failure details', () => {
      const emitter = getFileEventEmitter();
      const ctx = createTestContext();

      emitter.emitPermanentlyFailed(ctx, {
        error: 'OCR timeout after 30s',
        processingRetryCount: 2,
        embeddingRetryCount: 0,
        canRetryManually: true,
      });

      expect(mockTo).toHaveBeenCalledWith('session-789');
      expect(mockEmit).toHaveBeenCalledWith(
        FILE_WS_CHANNELS.STATUS,
        expect.objectContaining({
          type: FILE_WS_EVENTS.PERMANENTLY_FAILED,
          fileId: 'file-123',
          userId: 'user-456',
          error: 'OCR timeout after 30s',
          processingRetryCount: 2,
          embeddingRetryCount: 0,
          canRetryManually: true,
        })
      );
    });

    it('should include timestamp in event payload', () => {
      const emitter = getFileEventEmitter();
      const ctx = createTestContext();

      emitter.emitPermanentlyFailed(ctx, {
        error: 'Test error',
        processingRetryCount: 1,
        embeddingRetryCount: 1,
        canRetryManually: true,
      });

      expect(mockEmit).toHaveBeenCalledWith(
        FILE_WS_CHANNELS.STATUS,
        expect.objectContaining({
          timestamp: expect.any(String),
        })
      );
    });

    it('should handle canRetryManually false', () => {
      const emitter = getFileEventEmitter();
      const ctx = createTestContext();

      emitter.emitPermanentlyFailed(ctx, {
        error: 'Unsupported file format',
        processingRetryCount: 0,
        embeddingRetryCount: 0,
        canRetryManually: false,
      });

      expect(mockEmit).toHaveBeenCalledWith(
        FILE_WS_CHANNELS.STATUS,
        expect.objectContaining({
          canRetryManually: false,
        })
      );
    });

    it('should skip if no userId and no sessionId', () => {
      const emitter = getFileEventEmitter();
      const ctx = createTestContext({ sessionId: undefined, userId: undefined });

      emitter.emitPermanentlyFailed(ctx, {
        error: 'Test error',
        processingRetryCount: 2,
        embeddingRetryCount: 0,
        canRetryManually: true,
      });

      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('should emit to userId room even without sessionId', () => {
      const emitter = getFileEventEmitter();
      const ctx = createTestContext({ sessionId: undefined });

      emitter.emitPermanentlyFailed(ctx, {
        error: 'Test error',
        processingRetryCount: 2,
        embeddingRetryCount: 0,
        canRetryManually: true,
      });

      expect(mockTo).toHaveBeenCalledWith('user:user-456');
      expect(mockEmit).toHaveBeenCalled();
    });
  });

  // ========== SUITE 4: emitProgress ==========
  describe('emitProgress()', () => {
    it('should emit to file:processing channel with attempt info', () => {
      const emitter = getFileEventEmitter();
      const ctx = createTestContext();

      emitter.emitProgress(ctx, {
        progress: 50,
        status: 'processing',
        attemptNumber: 2,
        maxAttempts: 3,
      });

      expect(mockTo).toHaveBeenCalledWith('session-789');
      expect(mockEmit).toHaveBeenCalledWith(
        FILE_WS_CHANNELS.PROCESSING,
        expect.objectContaining({
          type: FILE_WS_EVENTS.PROCESSING_PROGRESS,
          fileId: 'file-123',
          progress: 50,
          status: 'processing',
          attemptNumber: 2,
          maxAttempts: 3,
        })
      );
    });

    it('should emit progress at various percentages', () => {
      const emitter = getFileEventEmitter();
      const ctx = createTestContext();

      [0, 25, 50, 75, 100].forEach((progress) => {
        emitter.emitProgress(ctx, {
          progress,
          status: 'processing',
          attemptNumber: 1,
          maxAttempts: 2,
        });
      });

      // 5 events x 2 rooms (userId + sessionId) = 10 emit calls
      expect(mockEmit).toHaveBeenCalledTimes(10);
    });

    it('should include timestamp', () => {
      const emitter = getFileEventEmitter();
      const ctx = createTestContext();

      emitter.emitProgress(ctx, {
        progress: 30,
        status: 'processing',
        attemptNumber: 1,
        maxAttempts: 2,
      });

      expect(mockEmit).toHaveBeenCalledWith(
        FILE_WS_CHANNELS.PROCESSING,
        expect.objectContaining({
          timestamp: expect.any(String),
        })
      );
    });

    it('should skip if no userId and no sessionId', () => {
      const emitter = getFileEventEmitter();
      const ctx = createTestContext({ sessionId: undefined, userId: undefined });

      emitter.emitProgress(ctx, {
        progress: 50,
        status: 'processing',
        attemptNumber: 1,
        maxAttempts: 2,
      });

      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('should emit to userId room even without sessionId', () => {
      const emitter = getFileEventEmitter();
      const ctx = createTestContext({ sessionId: undefined });

      emitter.emitProgress(ctx, {
        progress: 50,
        status: 'processing',
        attemptNumber: 1,
        maxAttempts: 2,
      });

      expect(mockTo).toHaveBeenCalledWith('user:user-456');
      expect(mockEmit).toHaveBeenCalled();
    });
  });

  // ========== SUITE 5: emitCompletion ==========
  describe('emitCompletion()', () => {
    it('should emit to file:processing channel with stats', () => {
      const emitter = getFileEventEmitter();
      const ctx = createTestContext();

      emitter.emitCompletion(ctx, {
        textLength: 5000,
        pageCount: 10,
        ocrUsed: true,
      });

      expect(mockTo).toHaveBeenCalledWith('session-789');
      expect(mockEmit).toHaveBeenCalledWith(
        FILE_WS_CHANNELS.PROCESSING,
        expect.objectContaining({
          type: FILE_WS_EVENTS.PROCESSING_COMPLETED,
          fileId: 'file-123',
          status: 'completed',
          progress: 100,
          stats: {
            textLength: 5000,
            pageCount: 10,
            ocrUsed: true,
          },
        })
      );
    });

    it('should include timestamp', () => {
      const emitter = getFileEventEmitter();
      const ctx = createTestContext();

      emitter.emitCompletion(ctx, {
        textLength: 1000,
        pageCount: 1,
        ocrUsed: false,
      });

      expect(mockEmit).toHaveBeenCalledWith(
        FILE_WS_CHANNELS.PROCESSING,
        expect.objectContaining({
          timestamp: expect.any(String),
        })
      );
    });

    it('should skip if no userId and no sessionId', () => {
      const emitter = getFileEventEmitter();
      const ctx = createTestContext({ sessionId: undefined, userId: undefined });

      emitter.emitCompletion(ctx, {
        textLength: 1000,
        pageCount: 1,
        ocrUsed: false,
      });

      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('should emit to userId room even without sessionId', () => {
      const emitter = getFileEventEmitter();
      const ctx = createTestContext({ sessionId: undefined });

      emitter.emitCompletion(ctx, {
        textLength: 1000,
        pageCount: 1,
        ocrUsed: false,
      });

      expect(mockTo).toHaveBeenCalledWith('user:user-456');
      expect(mockEmit).toHaveBeenCalled();
    });
  });

  // ========== SUITE 6: emitError ==========
  describe('emitError()', () => {
    it('should emit to file:processing channel with error message', () => {
      const emitter = getFileEventEmitter();
      const ctx = createTestContext();

      emitter.emitError(ctx, 'Failed to extract text from PDF');

      expect(mockTo).toHaveBeenCalledWith('session-789');
      expect(mockEmit).toHaveBeenCalledWith(
        FILE_WS_CHANNELS.PROCESSING,
        expect.objectContaining({
          type: FILE_WS_EVENTS.PROCESSING_FAILED,
          fileId: 'file-123',
          status: 'failed',
          error: 'Failed to extract text from PDF',
        })
      );
    });

    it('should include timestamp', () => {
      const emitter = getFileEventEmitter();
      const ctx = createTestContext();

      emitter.emitError(ctx, 'Test error');

      expect(mockEmit).toHaveBeenCalledWith(
        FILE_WS_CHANNELS.PROCESSING,
        expect.objectContaining({
          timestamp: expect.any(String),
        })
      );
    });

    it('should skip if no userId and no sessionId', () => {
      const emitter = getFileEventEmitter();
      const ctx = createTestContext({ sessionId: undefined, userId: undefined });

      emitter.emitError(ctx, 'Test error');

      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('should emit to userId room even without sessionId', () => {
      const emitter = getFileEventEmitter();
      const ctx = createTestContext({ sessionId: undefined });

      emitter.emitError(ctx, 'Test error');

      expect(mockTo).toHaveBeenCalledWith('user:user-456');
      expect(mockEmit).toHaveBeenCalled();
    });
  });

  // ========== SUITE 7: Error Handling ==========
  describe('Error Handling', () => {
    it('should not throw if Socket.IO emit fails', () => {
      mockEmit.mockImplementation(() => {
        throw new Error('Socket connection lost');
      });

      const emitter = getFileEventEmitter();
      const ctx = createTestContext();

      // Should not throw
      expect(() => {
        emitter.emitReadinessChanged(ctx, {
          newState: 'ready',
          processingStatus: 'completed',
          embeddingStatus: 'completed',
        });
      }).not.toThrow();
    });

    it('should log error when emit fails', () => {
      mockEmit.mockImplementation(() => {
        throw new Error('Socket connection lost');
      });

      const emitter = getFileEventEmitter();
      const ctx = createTestContext();

      emitter.emitReadinessChanged(ctx, {
        newState: 'ready',
        processingStatus: 'completed',
        embeddingStatus: 'completed',
      });

      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should not throw if getSocketIO throws', () => {
      vi.mocked(getSocketIO).mockImplementation(() => {
        throw new Error('SocketService not initialized');
      });

      const emitter = getFileEventEmitter();
      const ctx = createTestContext();

      expect(() => {
        emitter.emitProgress(ctx, {
          progress: 50,
          status: 'processing',
          attemptNumber: 1,
          maxAttempts: 2,
        });
      }).not.toThrow();
    });
  });

  // ========== SUITE 8: Logging ==========
  describe('Logging', () => {
    it('should log debug message when event is emitted', () => {
      const emitter = getFileEventEmitter();
      const ctx = createTestContext();

      emitter.emitReadinessChanged(ctx, {
        newState: 'processing',
        processingStatus: 'processing',
        embeddingStatus: 'pending',
      });

      expect(mockLogger.debug).toHaveBeenCalled();
    });

    it('should log debug when skipping due to no sessionId', () => {
      const emitter = getFileEventEmitter();
      const ctx = createTestContext({ sessionId: undefined });

      emitter.emitReadinessChanged(ctx, {
        newState: 'processing',
        processingStatus: 'processing',
        embeddingStatus: 'pending',
      });

      expect(mockLogger.debug).toHaveBeenCalled();
    });

    it('should log info for permanently_failed event', () => {
      const emitter = getFileEventEmitter();
      const ctx = createTestContext();

      emitter.emitPermanentlyFailed(ctx, {
        error: 'Max retries exceeded',
        processingRetryCount: 2,
        embeddingRetryCount: 0,
        canRetryManually: true,
      });

      expect(mockLogger.info).toHaveBeenCalled();
    });
  });

  // ========== SUITE 9: Dependency Injection ==========
  describe('Dependency Injection', () => {
    it('should accept custom dependencies', () => {
      const customLogger = {
        info: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
      };
      const customIsSocketReady = vi.fn(() => true);
      const customGetIO = vi.fn(() => mockIO);

      __resetFileEventEmitter();

      const emitter = getFileEventEmitter({
        logger: customLogger as unknown as Parameters<typeof getFileEventEmitter>[0]['logger'],
        isSocketReady: customIsSocketReady,
        getIO: customGetIO,
      });

      const ctx = createTestContext();
      emitter.emitReadinessChanged(ctx, {
        newState: 'processing',
        processingStatus: 'processing',
        embeddingStatus: 'pending',
      });

      expect(customIsSocketReady).toHaveBeenCalled();
      expect(customGetIO).toHaveBeenCalled();
      expect(customLogger.debug).toHaveBeenCalled();
    });
  });
});
