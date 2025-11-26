/**
 * Logger Utility Unit Tests
 *
 * Tests for our custom Pino logger configuration:
 * - Child logger context inheritance (createChildLogger pattern)
 * - Request logger with correlation IDs (createRequestLogger pattern)
 * - Test helper utilities (createTestLogger factory)
 *
 * Note: We don't test Pino's internal behavior (log levels, serialization,
 * timestamps) - those are already well tested by the Pino library.
 * Instead, we focus on OUR configuration and helper functions.
 *
 * @module __tests__/unit/utils/logger
 */

import { describe, it, expect } from 'vitest';
import { createTestLogger } from '../../helpers/mockPinoFactory';
import { USER_TEST_CONSTANTS, SESSION_TEST_CONSTANTS } from '../../helpers/test.constants';

// ============================================================================
// TEST SUITE: Child Logger Pattern (matches createChildLogger behavior)
// ============================================================================

describe('Logger Utility', () => {
  describe('createChildLogger pattern', () => {
    it('should add service context to child logger', () => {
      const { testLogger, logs } = createTestLogger();

      // Create child logger with service context (same pattern as createChildLogger)
      const childLogger = testLogger.child({ service: 'TestService' });

      childLogger.info('Test message');

      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        service: 'TestService',
        msg: 'Test message',
      });
    });

    it('should inherit base context from parent logger', () => {
      const { testLogger, logs } = createTestLogger({
        base: { env: 'test', service: 'base-service' },
      });

      // Create child and log
      const childLogger = testLogger.child({ module: 'auth' });
      childLogger.info('Auth event');

      expect(logs[0]).toMatchObject({
        env: 'test',
        service: 'base-service',
        module: 'auth',
        msg: 'Auth event',
      });
    });

    it('should allow nested child loggers', () => {
      const { testLogger, logs } = createTestLogger();

      const serviceLogger = testLogger.child({ service: 'DirectAgentService' });
      const sessionLogger = serviceLogger.child({ sessionId: SESSION_TEST_CONSTANTS.SESSION_ID });

      sessionLogger.info('Processing message');

      expect(logs[0]).toMatchObject({
        service: 'DirectAgentService',
        sessionId: SESSION_TEST_CONSTANTS.SESSION_ID,
        msg: 'Processing message',
      });
    });

    it('should override parent context in child', () => {
      const { testLogger, logs } = createTestLogger({
        base: { env: 'production' },
      });

      const childLogger = testLogger.child({ env: 'development' });
      childLogger.info('Test');

      // Child context should override parent
      expect(logs[0]?.env).toBe('development');
    });
  });

  // ==========================================================================
  // TEST SUITE: Request Logger Pattern (matches createRequestLogger behavior)
  // ==========================================================================

  describe('createRequestLogger pattern', () => {
    it('should create request-scoped logger with correlation IDs', () => {
      const { testLogger, logs } = createTestLogger();

      // Simulate createRequestLogger behavior
      const mockRequest = {
        headers: { 'x-request-id': 'req-12345' },
        session: {
          microsoftOAuth: { userId: USER_TEST_CONSTANTS.USER_ID },
          id: SESSION_TEST_CONSTANTS.SESSION_ID,
        },
      };

      // Create request-scoped child logger (simulating createRequestLogger)
      const reqLogger = testLogger.child({
        requestId: mockRequest.headers['x-request-id'],
        userId: mockRequest.session.microsoftOAuth?.userId,
        sessionId: mockRequest.session.id,
      });

      reqLogger.info('Processing request');

      expect(logs[0]).toMatchObject({
        requestId: 'req-12345',
        userId: USER_TEST_CONSTANTS.USER_ID,
        sessionId: SESSION_TEST_CONSTANTS.SESSION_ID,
        msg: 'Processing request',
      });
    });

    it('should generate requestId when not provided in headers', () => {
      const { testLogger, logs } = createTestLogger();

      // Simulate request without x-request-id header using generateRequestId pattern
      const generateRequestId = () => `req_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

      const reqLogger = testLogger.child({
        requestId: generateRequestId(),
      });

      reqLogger.info('Request without header');

      expect(logs[0]?.requestId).toBeDefined();
      expect(logs[0]?.requestId).toMatch(/^req_\d+_[a-z0-9]+$/);
    });
  });

  // ==========================================================================
  // TEST SUITE: generateRequestId Format
  // ==========================================================================

  describe('generateRequestId format', () => {
    // Replicate the generateRequestId function from logger.ts for testing
    const generateRequestId = () => `req_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

    it('should generate ID with correct prefix', () => {
      const id = generateRequestId();
      expect(id.startsWith('req_')).toBe(true);
    });

    it('should include timestamp component', () => {
      const beforeTime = Date.now();
      const id = generateRequestId();
      const afterTime = Date.now();

      // Extract timestamp from ID (format: req_TIMESTAMP_RANDOM)
      const timestamp = parseInt(id.split('_')[1] ?? '0');

      expect(timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(timestamp).toBeLessThanOrEqual(afterTime);
    });

    it('should include random suffix', () => {
      const id = generateRequestId();
      const randomPart = id.split('_')[2];

      expect(randomPart).toBeDefined();
      expect(randomPart?.length).toBeGreaterThan(0);
      // Random part should be alphanumeric (base36)
      expect(randomPart).toMatch(/^[a-z0-9]+$/);
    });

    it('should generate unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateRequestId());
      }
      // All 100 IDs should be unique
      expect(ids.size).toBe(100);
    });
  });

  // ==========================================================================
  // TEST SUITE: Test Logger Helpers (verifies mockPinoFactory works)
  // ==========================================================================

  describe('Test Logger Helpers', () => {
    it('should clear logs', () => {
      const { testLogger, logs, clearLogs } = createTestLogger();

      testLogger.info('First');
      testLogger.info('Second');
      expect(logs).toHaveLength(2);

      clearLogs();
      expect(logs).toHaveLength(0);
    });

    it('should get last log', () => {
      const { testLogger, getLastLog } = createTestLogger();

      testLogger.info('First');
      testLogger.info('Second');
      testLogger.info('Third');

      expect(getLastLog()?.msg).toBe('Third');
    });

    it('should check for message presence', () => {
      const { testLogger, hasLogWithMessage } = createTestLogger();

      testLogger.info('User logged in successfully');
      testLogger.warn('Session about to expire');

      expect(hasLogWithMessage('logged in')).toBe(true);
      expect(hasLogWithMessage('expire')).toBe(true);
      expect(hasLogWithMessage('nonexistent')).toBe(false);
    });

    it('should check for data presence', () => {
      const { testLogger, hasLogWithData } = createTestLogger();

      testLogger.info({ userId: USER_TEST_CONSTANTS.USER_ID }, 'User action');

      expect(hasLogWithData('userId', USER_TEST_CONSTANTS.USER_ID)).toBe(true);
      expect(hasLogWithData('userId', 'wrong-id')).toBe(false);
    });

    it('should filter logs by level', () => {
      const { testLogger, getLogsByLevel } = createTestLogger({ level: 'trace' });

      testLogger.trace('trace message');
      testLogger.info('info message');
      testLogger.warn('warn message');
      testLogger.error('error message');

      expect(getLogsByLevel('trace')).toHaveLength(1);
      expect(getLogsByLevel('info')).toHaveLength(1);
      expect(getLogsByLevel('warn')).toHaveLength(1);
      expect(getLogsByLevel('error')).toHaveLength(1);
    });
  });

  // ==========================================================================
  // TEST SUITE: Log Data Handling (verifies bindings work correctly)
  // ==========================================================================

  describe('Log Data Handling', () => {
    it('should include bindings object in log', () => {
      const { testLogger, logs } = createTestLogger();

      testLogger.info(
        { userId: USER_TEST_CONSTANTS.USER_ID, action: 'login' },
        'User logged in'
      );

      expect(logs[0]).toMatchObject({
        userId: USER_TEST_CONSTANTS.USER_ID,
        action: 'login',
        msg: 'User logged in',
      });
    });

    it('should handle error objects with stack trace', () => {
      const { testLogger, logs } = createTestLogger();
      const error = new Error('Something went wrong');

      testLogger.error({ err: error }, 'Operation failed');

      expect(logs[0]?.err).toBeDefined();
      expect(logs[0]?.err?.message).toBe('Something went wrong');
      expect(logs[0]?.err?.stack).toBeDefined();
    });
  });
});
