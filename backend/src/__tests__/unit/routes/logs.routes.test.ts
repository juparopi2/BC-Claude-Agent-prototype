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

// ============================================
// Mock Dependencies
// ============================================

// Mock logger with child logger support
const mockChildLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

vi.mock('@/utils/logger', () => ({
  logger: {
    child: vi.fn(() => mockChildLogger),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
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

      // Assert
      expect(response.body.error).toBe('Invalid log format');
      expect(response.body.details).toBeDefined();
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

      // Assert
      expect(response.body.error).toBe('Invalid log format');
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

      // Assert
      expect(response.body.error).toBe('Invalid log format');
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

      // Assert
      expect(response.body.error).toBe('Invalid log format');
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

      // Assert
      expect(response.body.error).toBe('Invalid log format');
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
  });
});
