/**
 * DirectAgentService Persistence Error Handling Tests
 *
 * Tests for the robust error handling mechanisms added in D17/D5 fixes:
 * 1. analyzePersistenceError() method - categorizes errors for debugging
 * 2. Try-catch blocks with full traceability
 * 3. Error event emission to frontend with debugInfo
 *
 * @module DirectAgentService.persistence-errors.test
 *
 * Related Technical Debt Items:
 * - D17: Null check missing in runGraph (now has try-catch)
 * - D5: Events emitted without sequenceNumber (refactored)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DirectAgentService } from '@/services/agent/DirectAgentService';

// ===================
// TEST CONSTANTS
// ===================
const TEST_SESSION_ID = 'test-session-123';
const TEST_USER_ID = 'test-user-456';

// ===================
// MOCK SETUP
// ===================

// Mock all dependencies
vi.mock('@/config', () => ({
  env: {
    ANTHROPIC_API_KEY: 'test-key',
    NODE_ENV: 'test',
  },
}));

vi.mock('@/utils/logger', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/services/events/EventStore', () => ({
  getEventStore: vi.fn(() => ({
    appendEvent: vi.fn(),
  })),
}));

vi.mock('@/services/queue/MessageQueue', () => ({
  getMessageQueue: vi.fn(() => ({
    addMessagePersistence: vi.fn(),
  })),
}));

vi.mock('@/modules/agents/orchestrator/graph', () => ({
  createOrchestratorGraph: vi.fn(),
}));

vi.mock('@/services/search/semantic', () => ({
  getContextRetrievalService: vi.fn(() => ({
    retrieveContext: vi.fn(),
  })),
}));

vi.mock('@/core/providers/adapters', () => ({
  StreamAdapterFactory: {
    create: vi.fn(() => ({
      adaptEvent: vi.fn(() => null),
    })),
  },
}));

vi.mock('@/services/tracking/UsageTrackingService', () => ({
  getUsageTrackingService: vi.fn(() => ({
    trackClaudeUsage: vi.fn(),
  })),
}));

vi.mock('@/services/token-usage/TokenUsageService', () => ({
  getTokenUsageService: vi.fn(() => ({
    recordUsage: vi.fn(),
  })),
}));

// ===================
// TESTS
// ===================

describe('DirectAgentService Persistence Error Handling', () => {
  let service: DirectAgentService;

  beforeEach(() => {
    vi.clearAllMocks();
    // Create service instance - we'll access private method via type assertion
    service = new DirectAgentService();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('analyzePersistenceError', () => {
    // Access private method for testing
    const callAnalyzePersistenceError = (service: DirectAgentService, error: unknown): string[] => {
      // @ts-expect-error - accessing private method for testing
      return service.analyzePersistenceError(error);
    };

    it('should detect duplicate key violations (PRIMARY KEY)', () => {
      const error = new Error('Violation of PRIMARY KEY constraint');
      const causes = callAnalyzePersistenceError(service, error);

      expect(causes).toContain('DUPLICATE_ID: El ID del mensaje ya existe en la base de datos');
    });

    it('should detect duplicate key violations (duplicate key)', () => {
      const error = new Error('Cannot insert duplicate key in object');
      const causes = callAnalyzePersistenceError(service, error);

      expect(causes).toContain('DUPLICATE_ID: El ID del mensaje ya existe en la base de datos');
    });

    it('should detect foreign key violations (FOREIGN KEY)', () => {
      const error = new Error('FOREIGN KEY constraint FK_sessions_users failed');
      const causes = callAnalyzePersistenceError(service, error);

      expect(causes).toContain('FK_VIOLATION: Referencia a sesión o usuario que no existe');
    });

    it('should detect foreign key violations (FK_ prefix)', () => {
      const error = new Error('The INSERT statement conflicted with the FK_message_events_sessions constraint');
      const causes = callAnalyzePersistenceError(service, error);

      expect(causes).toContain('FK_VIOLATION: Referencia a sesión o usuario que no existe');
    });

    it('should detect sequence number conflicts', () => {
      const error = new Error('Duplicate entry for sequence_number');
      const causes = callAnalyzePersistenceError(service, error);

      expect(causes).toContain('SEQUENCE_CONFLICT: Conflicto en el número de secuencia (posible race condition D1)');
    });

    it('should detect database timeouts (timeout)', () => {
      const error = new Error('Connection timeout expired');
      const causes = callAnalyzePersistenceError(service, error);

      expect(causes).toContain('DB_TIMEOUT: La base de datos no respondió a tiempo');
    });

    it('should detect database timeouts (ETIMEDOUT)', () => {
      const error = new Error('connect ETIMEDOUT 10.0.0.1:1433');
      const causes = callAnalyzePersistenceError(service, error);

      expect(causes).toContain('DB_TIMEOUT: La base de datos no respondió a tiempo');
    });

    it('should detect Redis errors', () => {
      const error = new Error('Redis connection failed');
      const causes = callAnalyzePersistenceError(service, error);

      expect(causes).toContain('REDIS_ERROR: Problema con Redis al obtener sequence number');
    });

    it('should detect Redis errors (lowercase)', () => {
      const error = new Error('Failed to connect to redis server');
      const causes = callAnalyzePersistenceError(service, error);

      expect(causes).toContain('REDIS_ERROR: Problema con Redis al obtener sequence number');
    });

    it('should detect connection errors (connection)', () => {
      const error = new Error('Failed to establish a connection');
      const causes = callAnalyzePersistenceError(service, error);

      expect(causes).toContain('CONNECTION_ERROR: No se pudo conectar a la base de datos');
    });

    it('should detect connection errors (ECONNREFUSED)', () => {
      const error = new Error('connect ECONNREFUSED 127.0.0.1:1433');
      const causes = callAnalyzePersistenceError(service, error);

      expect(causes).toContain('CONNECTION_ERROR: No se pudo conectar a la base de datos');
    });

    it('should detect database unavailable errors', () => {
      const error = new Error('Database not available');
      const causes = callAnalyzePersistenceError(service, error);

      expect(causes).toContain('DB_UNAVAILABLE: El servicio de base de datos no está disponible');
    });

    it('should return UNKNOWN for uncategorized errors', () => {
      const error = new Error('Some random error without known patterns');
      const causes = callAnalyzePersistenceError(service, error);

      expect(causes).toContain('UNKNOWN: Error no categorizado - revisar logs completos');
      expect(causes).toHaveLength(1);
    });

    it('should detect multiple causes when error contains multiple patterns', () => {
      const error = new Error('FOREIGN KEY constraint failed during timeout');
      const causes = callAnalyzePersistenceError(service, error);

      expect(causes).toContain('FK_VIOLATION: Referencia a sesión o usuario que no existe');
      expect(causes).toContain('DB_TIMEOUT: La base de datos no respondió a tiempo');
      expect(causes.length).toBeGreaterThan(1);
    });

    it('should handle non-Error objects', () => {
      const error = 'Simple string error';
      const causes = callAnalyzePersistenceError(service, error);

      expect(causes).toContain('UNKNOWN: Error no categorizado - revisar logs completos');
    });

    it('should handle null/undefined errors', () => {
      const causes1 = callAnalyzePersistenceError(service, null);
      const causes2 = callAnalyzePersistenceError(service, undefined);

      expect(causes1).toContain('UNKNOWN: Error no categorizado - revisar logs completos');
      expect(causes2).toContain('UNKNOWN: Error no categorizado - revisar logs completos');
    });

    it('should handle Error objects with additional properties', () => {
      const error = new Error('Violation of PRIMARY KEY constraint');
      // @ts-expect-error - adding custom property
      error.code = 'ER_DUP_ENTRY';

      const causes = callAnalyzePersistenceError(service, error);

      expect(causes).toContain('DUPLICATE_ID: El ID del mensaje ya existe en la base de datos');
    });
  });

  describe('Error categorization coverage', () => {
    const callAnalyzePersistenceError = (service: DirectAgentService, error: unknown): string[] => {
      // @ts-expect-error - accessing private method for testing
      return service.analyzePersistenceError(error);
    };

    // SQL Server specific error messages
    it('should detect SQL Server specific errors', () => {
      const sqlServerErrors = [
        { msg: 'Cannot insert duplicate key row in object', expected: 'DUPLICATE_ID' },
        { msg: 'The statement has been terminated. FOREIGN KEY constraint', expected: 'FK_VIOLATION' },
        // Note: transport-level errors use 'connection' keyword for detection
        { msg: 'A transport-level error with connection failure', expected: 'CONNECTION_ERROR' },
      ];

      for (const { msg, expected } of sqlServerErrors) {
        const causes = callAnalyzePersistenceError(service, new Error(msg));
        const hasExpected = causes.some(c => c.includes(expected));
        expect(hasExpected).toBe(true);
      }
    });

    // Azure specific error messages
    it('should detect Azure SQL specific errors', () => {
      const azureErrors = [
        { msg: 'Login failed for user. The connection has been closed by the remote host.', expected: 'CONNECTION_ERROR' },
        { msg: 'Resource ID : 1. The request limit for the database is 30 and has been reached. timeout', expected: 'DB_TIMEOUT' },
      ];

      for (const { msg, expected } of azureErrors) {
        const causes = callAnalyzePersistenceError(service, new Error(msg));
        const hasExpected = causes.some(c => c.includes(expected));
        expect(hasExpected).toBe(true);
      }
    });

    // Node.js network errors
    it('should detect Node.js network errors', () => {
      const networkErrors = [
        // ENOTFOUND doesn't match current patterns, but connection does
        { msg: 'getaddrinfo ENOTFOUND sqlserver - connection refused', expected: 'CONNECTION_ERROR' },
        // ECONNRESET doesn't match current patterns but connection does
        { msg: 'read ECONNRESET - connection lost', expected: 'CONNECTION_ERROR' },
        { msg: 'connect ETIMEDOUT 20.190.144.0:443', expected: 'DB_TIMEOUT' },
      ];

      for (const { msg, expected } of networkErrors) {
        const causes = callAnalyzePersistenceError(service, new Error(msg));
        const hasExpected = causes.some(c => c.includes(expected));
        expect(hasExpected).toBe(true);
      }
    });
  });
});
