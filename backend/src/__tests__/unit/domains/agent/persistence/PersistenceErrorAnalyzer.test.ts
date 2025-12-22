/**
 * @module PersistenceErrorAnalyzer.test
 *
 * Unit tests for PersistenceErrorAnalyzer.
 * Tests error categorization logic extracted from DirectAgentService.
 *
 * These tests mirror the original DirectAgentService.persistence-errors.test.ts
 * but test the standalone extracted class.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  PersistenceErrorAnalyzer,
  getPersistenceErrorAnalyzer,
  __resetPersistenceErrorAnalyzer,
} from '@/domains/agent/persistence';

describe('PersistenceErrorAnalyzer', () => {
  let analyzer: PersistenceErrorAnalyzer;

  beforeEach(() => {
    __resetPersistenceErrorAnalyzer();
    analyzer = getPersistenceErrorAnalyzer();
  });

  afterEach(() => {
    __resetPersistenceErrorAnalyzer();
  });

  describe('singleton pattern', () => {
    it('should return same instance on multiple calls', () => {
      const instance1 = getPersistenceErrorAnalyzer();
      const instance2 = getPersistenceErrorAnalyzer();
      expect(instance1).toBe(instance2);
    });

    it('should return new instance after reset', () => {
      const instance1 = getPersistenceErrorAnalyzer();
      __resetPersistenceErrorAnalyzer();
      const instance2 = getPersistenceErrorAnalyzer();
      expect(instance1).not.toBe(instance2);
    });
  });

  describe('analyze()', () => {
    describe('duplicate key violations', () => {
      it('should detect PRIMARY KEY violations', () => {
        const error = new Error('Violation of PRIMARY KEY constraint');
        const causes = analyzer.analyze(error);
        expect(causes).toContain('DUPLICATE_ID: El ID del mensaje ya existe en la base de datos');
      });

      it('should detect duplicate key messages', () => {
        const error = new Error('Cannot insert duplicate key in object');
        const causes = analyzer.analyze(error);
        expect(causes).toContain('DUPLICATE_ID: El ID del mensaje ya existe en la base de datos');
      });
    });

    describe('foreign key violations', () => {
      it('should detect FOREIGN KEY constraint', () => {
        const error = new Error('FOREIGN KEY constraint FK_sessions_users failed');
        const causes = analyzer.analyze(error);
        expect(causes).toContain('FK_VIOLATION: Referencia a sesión o usuario que no existe');
      });

      it('should detect FK_ prefix in constraint name', () => {
        const error = new Error('The INSERT statement conflicted with the FK_message_events_sessions constraint');
        const causes = analyzer.analyze(error);
        expect(causes).toContain('FK_VIOLATION: Referencia a sesión o usuario que no existe');
      });
    });

    describe('sequence conflicts', () => {
      it('should detect sequence_number in error message', () => {
        const error = new Error('Duplicate value in sequence_number column');
        const causes = analyzer.analyze(error);
        expect(causes).toContain('SEQUENCE_CONFLICT: Conflicto en el número de secuencia (posible race condition D1)');
      });
    });

    describe('timeout errors', () => {
      it('should detect timeout keyword', () => {
        const error = new Error('Query timeout after 30000ms');
        const causes = analyzer.analyze(error);
        expect(causes).toContain('DB_TIMEOUT: La base de datos no respondió a tiempo');
      });

      it('should detect ETIMEDOUT', () => {
        const error = new Error('ETIMEDOUT: connection timed out');
        const causes = analyzer.analyze(error);
        expect(causes).toContain('DB_TIMEOUT: La base de datos no respondió a tiempo');
      });
    });

    describe('Redis errors', () => {
      it('should detect Redis keyword (uppercase)', () => {
        const error = new Error('Redis INCR failed for sequence');
        const causes = analyzer.analyze(error);
        expect(causes).toContain('REDIS_ERROR: Problema con Redis al obtener sequence number');
      });

      it('should detect redis keyword (lowercase)', () => {
        const error = new Error('Failed to connect to redis server');
        const causes = analyzer.analyze(error);
        expect(causes).toContain('REDIS_ERROR: Problema con Redis al obtener sequence number');
      });
    });

    describe('connection errors', () => {
      it('should detect connection keyword', () => {
        const error = new Error('A transport-level error with connection failure');
        const causes = analyzer.analyze(error);
        expect(causes).toContain('CONNECTION_ERROR: No se pudo conectar a la base de datos');
      });

      it('should detect ECONNREFUSED', () => {
        const error = new Error('ECONNREFUSED: connection refused');
        const causes = analyzer.analyze(error);
        expect(causes).toContain('CONNECTION_ERROR: No se pudo conectar a la base de datos');
      });
    });

    describe('database unavailable', () => {
      it('should detect Database not available', () => {
        const error = new Error('Database not available: server is starting');
        const causes = analyzer.analyze(error);
        expect(causes).toContain('DB_UNAVAILABLE: El servicio de base de datos no está disponible');
      });
    });

    describe('unknown errors', () => {
      it('should return UNKNOWN for unrecognized errors', () => {
        const error = new Error('Something completely unexpected happened');
        const causes = analyzer.analyze(error);
        expect(causes).toContain('UNKNOWN: Error no categorizado - revisar logs completos');
      });

      it('should handle non-Error objects', () => {
        const causes = analyzer.analyze('string error message');
        expect(causes).toHaveLength(1);
        expect(causes[0]).toContain('UNKNOWN');
      });

      it('should handle null/undefined', () => {
        const causesNull = analyzer.analyze(null);
        const causesUndefined = analyzer.analyze(undefined);
        expect(causesNull[0]).toContain('UNKNOWN');
        expect(causesUndefined[0]).toContain('UNKNOWN');
      });
    });

    describe('multiple causes', () => {
      it('should detect multiple causes in one error', () => {
        const error = new Error('FOREIGN KEY constraint with connection error on FK_sessions');
        const causes = analyzer.analyze(error);
        expect(causes).toContain('FK_VIOLATION: Referencia a sesión o usuario que no existe');
        expect(causes).toContain('CONNECTION_ERROR: No se pudo conectar a la base de datos');
      });
    });
  });

  describe('getDetailedAnalysis()', () => {
    it('should return primary category from first cause', () => {
      const error = new Error('Violation of PRIMARY KEY constraint');
      const analysis = analyzer.getDetailedAnalysis(error);
      expect(analysis.primaryCategory).toBe('DUPLICATE_ID');
    });

    it('should recommend retry for transient errors', () => {
      const timeoutError = new Error('Query timeout');
      const connectionError = new Error('connection refused');

      expect(analyzer.getDetailedAnalysis(timeoutError).shouldRetry).toBe(true);
      expect(analyzer.getDetailedAnalysis(connectionError).shouldRetry).toBe(true);
    });

    it('should NOT recommend retry for constraint violations', () => {
      const duplicateError = new Error('duplicate key');
      const fkError = new Error('FOREIGN KEY constraint');

      expect(analyzer.getDetailedAnalysis(duplicateError).shouldRetry).toBe(false);
      expect(analyzer.getDetailedAnalysis(fkError).shouldRetry).toBe(false);
    });

    it('should provide retry delay for transient errors', () => {
      const timeoutError = new Error('timeout');
      const analysis = analyzer.getDetailedAnalysis(timeoutError);

      expect(analysis.retryDelayMs).toBeDefined();
      expect(analysis.retryDelayMs).toBeGreaterThan(0);
    });

    it('should set appropriate log levels', () => {
      // Constraint violations should be error level
      expect(analyzer.getDetailedAnalysis(new Error('FOREIGN KEY')).logLevel).toBe('error');

      // Duplicate might be expected in some cases
      expect(analyzer.getDetailedAnalysis(new Error('duplicate key')).logLevel).toBe('warn');

      // Infrastructure issues should be error level
      expect(analyzer.getDetailedAnalysis(new Error('timeout')).logLevel).toBe('error');
    });
  });

  describe('SQL Server specific errors', () => {
    it('should detect SQL Server duplicate key format', () => {
      const error = new Error('Cannot insert duplicate key row in object');
      const causes = analyzer.analyze(error);
      expect(causes.some(c => c.includes('DUPLICATE_ID'))).toBe(true);
    });

    it('should detect SQL Server FK constraint format', () => {
      const error = new Error('The statement has been terminated. FOREIGN KEY constraint');
      const causes = analyzer.analyze(error);
      expect(causes.some(c => c.includes('FK_VIOLATION'))).toBe(true);
    });
  });

  describe('Azure SQL specific errors', () => {
    it('should detect Azure login failures with connection', () => {
      const error = new Error('Login failed for user. The connection has been closed by the remote host.');
      const causes = analyzer.analyze(error);
      expect(causes.some(c => c.includes('CONNECTION_ERROR'))).toBe(true);
    });

    it('should detect Azure request limit with timeout', () => {
      const error = new Error('Resource ID : 1. The request limit for the database is 30 and has been reached. timeout');
      const causes = analyzer.analyze(error);
      expect(causes.some(c => c.includes('DB_TIMEOUT'))).toBe(true);
    });
  });
});
