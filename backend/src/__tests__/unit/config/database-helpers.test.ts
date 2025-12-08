/**
 * Unit Tests for Database Helper Utilities
 *
 * Tests UUID parameter binding helpers for SQL queries.
 */

import { describe, it, expect } from 'vitest';
import sql from 'mssql';
import {
  uuidInput,
  multiUuidInput,
  applyUuidInputs,
  isValidUuidString,
  extractUuid,
  createUuidParams,
} from '@/config/database-helpers';

describe('database-helpers', () => {
  describe('uuidInput', () => {
    it('should return tuple with normalized lowercase UUID', () => {
      const [name, type, value] = uuidInput('userId', '322A1BAC-77DB-4A15-B1F0-48A51604642B');

      expect(name).toBe('userId');
      expect(type).toBe(sql.UniqueIdentifier);
      expect(value).toBe('322a1bac-77db-4a15-b1f0-48a51604642b');
    });

    it('should handle null value', () => {
      const [name, type, value] = uuidInput('optionalId', null);

      expect(name).toBe('optionalId');
      expect(type).toBe(sql.UniqueIdentifier);
      expect(value).toBe(null);
    });

    it('should handle undefined value', () => {
      const [name, type, value] = uuidInput('optionalId', undefined);

      expect(name).toBe('optionalId');
      expect(type).toBe(sql.UniqueIdentifier);
      expect(value).toBe(null);
    });

    it('should throw error for invalid UUID format', () => {
      expect(() => {
        uuidInput('userId', 'invalid-uuid');
      }).toThrow("Invalid UUID for parameter 'userId': invalid-uuid");
    });

    it('should throw error for partial UUID', () => {
      expect(() => {
        uuidInput('userId', '322a1bac-77db-4a15');
      }).toThrow("Invalid UUID for parameter 'userId'");
    });
  });

  describe('multiUuidInput', () => {
    it('should handle multiple UUIDs', () => {
      const params = multiUuidInput({
        userId: '322A1BAC-77DB-4A15-B1F0-48A51604642B',
        sessionId: '422A1BAC-77DB-4A15-B1F0-48A51604642B',
        approvalId: '522a1bac-77db-4a15-b1f0-48a51604642b',
      });

      expect(params).toHaveLength(3);

      // Check first param
      expect(params[0]).toEqual(['userId', sql.UniqueIdentifier, '322a1bac-77db-4a15-b1f0-48a51604642b']);

      // Check second param
      expect(params[1]).toEqual(['sessionId', sql.UniqueIdentifier, '422a1bac-77db-4a15-b1f0-48a51604642b']);

      // Check third param
      expect(params[2]).toEqual(['approvalId', sql.UniqueIdentifier, '522a1bac-77db-4a15-b1f0-48a51604642b']);
    });

    it('should handle mix of valid UUIDs and null', () => {
      const params = multiUuidInput({
        userId: '322a1bac-77db-4a15-b1f0-48a51604642b',
        sessionId: null,
        approvalId: undefined,
      });

      expect(params).toHaveLength(3);
      expect(params[0][2]).toBe('322a1bac-77db-4a15-b1f0-48a51604642b');
      expect(params[1][2]).toBe(null);
      expect(params[2][2]).toBe(null);
    });

    it('should throw error if any UUID is invalid', () => {
      expect(() => {
        multiUuidInput({
          userId: '322a1bac-77db-4a15-b1f0-48a51604642b',
          sessionId: 'invalid',
        });
      }).toThrow("Invalid UUID for parameter 'sessionId'");
    });
  });

  describe('applyUuidInputs', () => {
    it('should apply all UUID inputs to request', () => {
      // Create mock request
      const inputs: Array<[string, any, string | null]> = [];
      const mockRequest = {
        input(name: string, type: any, value: string | null) {
          inputs.push([name, type, value]);
          return this;
        },
      } as unknown as sql.Request;

      // Apply inputs
      const result = applyUuidInputs(mockRequest, {
        userId: '322A1BAC-77DB-4A15-B1F0-48A51604642B',
        sessionId: '422a1bac-77db-4a15-b1f0-48a51604642b',
      });

      // Verify chaining
      expect(result).toBe(mockRequest);

      // Verify inputs were applied
      expect(inputs).toHaveLength(2);
      expect(inputs[0]).toEqual(['userId', sql.UniqueIdentifier, '322a1bac-77db-4a15-b1f0-48a51604642b']);
      expect(inputs[1]).toEqual(['sessionId', sql.UniqueIdentifier, '422a1bac-77db-4a15-b1f0-48a51604642b']);
    });
  });

  describe('isValidUuidString', () => {
    it('should return true for valid UUID', () => {
      expect(isValidUuidString('322a1bac-77db-4a15-b1f0-48a51604642b')).toBe(true);
      expect(isValidUuidString('322A1BAC-77DB-4A15-B1F0-48A51604642B')).toBe(true);
    });

    it('should return false for invalid UUID', () => {
      expect(isValidUuidString('invalid')).toBe(false);
      expect(isValidUuidString('322a1bac-77db')).toBe(false);
      expect(isValidUuidString('')).toBe(false);
    });

    it('should return false for non-string values', () => {
      expect(isValidUuidString(null)).toBe(false);
      expect(isValidUuidString(undefined)).toBe(false);
      expect(isValidUuidString(123)).toBe(false);
      expect(isValidUuidString({})).toBe(false);
    });
  });

  describe('extractUuid', () => {
    it('should extract and normalize valid UUID', () => {
      const result = extractUuid('322A1BAC-77DB-4A15-B1F0-48A51604642B', 'userId');
      expect(result).toBe('322a1bac-77db-4a15-b1f0-48a51604642b');
    });

    it('should throw error for missing value', () => {
      expect(() => {
        extractUuid(null, 'userId');
      }).toThrow('Missing or invalid userId: expected UUID string');
    });

    it('should throw error for invalid UUID format', () => {
      expect(() => {
        extractUuid('invalid-uuid', 'sessionId');
      }).toThrow('Invalid UUID format for sessionId: invalid-uuid');
    });

    it('should throw error for non-string value', () => {
      expect(() => {
        extractUuid(12345, 'approvalId');
      }).toThrow('Missing or invalid approvalId: expected UUID string');
    });
  });

  describe('createUuidParams', () => {
    it('should create params object with normalized UUIDs', () => {
      const params = createUuidParams({
        userId: '322A1BAC-77DB-4A15-B1F0-48A51604642B',
        sessionId: '422a1bac-77db-4a15-b1f0-48a51604642b',
      });

      expect(params).toEqual({
        userId: '322a1bac-77db-4a15-b1f0-48a51604642b',
        sessionId: '422a1bac-77db-4a15-b1f0-48a51604642b',
      });
    });

    it('should handle null values', () => {
      const params = createUuidParams({
        userId: '322a1bac-77db-4a15-b1f0-48a51604642b',
        optionalId: null,
        undefinedId: undefined,
      });

      expect(params).toEqual({
        userId: '322a1bac-77db-4a15-b1f0-48a51604642b',
        optionalId: null,
        undefinedId: null,
      });
    });

    it('should throw error for invalid UUID', () => {
      expect(() => {
        createUuidParams({
          userId: 'invalid',
        });
      }).toThrow("Invalid UUID for parameter 'userId': invalid");
    });
  });

  describe('UUID normalization', () => {
    it('should normalize uppercase UUIDs to lowercase', () => {
      const uppercase = '322A1BAC-77DB-4A15-B1F0-48A51604642B';
      const expected = '322a1bac-77db-4a15-b1f0-48a51604642b';

      const [, , value1] = uuidInput('test', uppercase);
      expect(value1).toBe(expected);

      const value2 = extractUuid(uppercase, 'test');
      expect(value2).toBe(expected);

      const params = createUuidParams({ test: uppercase });
      expect(params.test).toBe(expected);
    });

    it('should preserve lowercase UUIDs', () => {
      const lowercase = '322a1bac-77db-4a15-b1f0-48a51604642b';

      const [, , value1] = uuidInput('test', lowercase);
      expect(value1).toBe(lowercase);

      const value2 = extractUuid(lowercase, 'test');
      expect(value2).toBe(lowercase);

      const params = createUuidParams({ test: lowercase });
      expect(params.test).toBe(lowercase);
    });
  });
});
