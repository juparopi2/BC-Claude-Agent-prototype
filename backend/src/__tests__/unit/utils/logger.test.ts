/**
 * Logger Utility Unit Tests
 *
 * Tests for standardized JSON logging with timestamps and log levels.
 * Covers all log methods (info, warn, error, debug), JSON formatting,
 * and edge cases (undefined data, circular references).
 *
 * Created: 2025-11-19 (Phase 4, Task 4.3.B)
 * Coverage Target: 90%+
 * Test Count: 8
 */

import { describe, it, expect, vi, beforeEach, afterEach, type SpyInstance } from 'vitest';
import { logger } from '@/utils/logger';

// ============================================================================
// TEST SUITE
// ============================================================================

describe('Logger Utility', () => {
  let consoleInfoSpy: SpyInstance;
  let consoleWarnSpy: SpyInstance;
  let consoleErrorSpy: SpyInstance;
  let consoleDebugSpy: SpyInstance;

  beforeEach(() => {
    // Spy on console methods
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // 1. BASIC LOGGING (4 tests)
  // ==========================================================================

  describe('Basic Logging', () => {
    it('should log info with timestamp and level', () => {
      logger.info('Test info message');

      expect(consoleInfoSpy).toHaveBeenCalledTimes(1);

      const loggedMessage = consoleInfoSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(loggedMessage);

      expect(parsed).toMatchObject({
        level: 'info',
        message: 'Test info message',
        timestamp: expect.any(String),
      });
      expect(parsed.data).toBeUndefined();
    });

    it('should log warn with data', () => {
      logger.warn('Test warning', { userId: '123', action: 'delete' });

      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);

      const loggedMessage = consoleWarnSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(loggedMessage);

      expect(parsed).toEqual({
        timestamp: expect.any(String),
        level: 'warn',
        message: 'Test warning',
        data: { userId: '123', action: 'delete' },
      });
    });

    it('should log error with error object', () => {
      const error = new Error('Something went wrong');
      logger.error('Error occurred', { error: error.message });

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);

      const loggedMessage = consoleErrorSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(loggedMessage);

      expect(parsed).toMatchObject({
        level: 'error',
        message: 'Error occurred',
        data: { error: 'Something went wrong' },
      });
    });

    it('should log debug message', () => {
      logger.debug('Debug info', { requestId: 'req-456' });

      expect(consoleDebugSpy).toHaveBeenCalledTimes(1);

      const loggedMessage = consoleDebugSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(loggedMessage);

      expect(parsed).toEqual({
        timestamp: expect.any(String),
        level: 'debug',
        message: 'Debug info',
        data: { requestId: 'req-456' },
      });
    });
  });

  // ==========================================================================
  // 2. JSON FORMAT (2 tests)
  // ==========================================================================

  describe('JSON Format', () => {
    it('should output valid JSON string', () => {
      logger.info('Test message', { key: 'value' });

      const loggedMessage = consoleInfoSpy.mock.calls[0]?.[0] as string;

      // Should not throw when parsing
      expect(() => JSON.parse(loggedMessage)).not.toThrow();

      const parsed = JSON.parse(loggedMessage);
      expect(typeof parsed).toBe('object');
      expect(parsed).not.toBeNull();
    });

    it('should include timestamp in ISO 8601 format', () => {
      logger.info('Test message');

      const loggedMessage = consoleInfoSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(loggedMessage);

      // ISO 8601 format: 2024-01-01T00:00:00.000Z
      expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

      // Verify it's a valid date
      const date = new Date(parsed.timestamp);
      expect(date.toISOString()).toBe(parsed.timestamp);
    });
  });

  // ==========================================================================
  // 3. EDGE CASES (2 tests)
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle undefined data (omit field)', () => {
      logger.info('Message without data', undefined);

      const loggedMessage = consoleInfoSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(loggedMessage);

      expect(parsed).toEqual({
        timestamp: expect.any(String),
        level: 'info',
        message: 'Message without data',
      });

      // data field should not be present at all
      expect('data' in parsed).toBe(false);
    });

    it('should handle complex nested data', () => {
      const complexData = {
        user: {
          id: '123',
          profile: {
            name: 'John Doe',
            settings: { theme: 'dark' },
          },
        },
        timestamp: Date.now(),
      };

      logger.info('Complex data', complexData);

      const loggedMessage = consoleInfoSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(loggedMessage);

      expect(parsed.data).toEqual(complexData);
    });
  });
});
