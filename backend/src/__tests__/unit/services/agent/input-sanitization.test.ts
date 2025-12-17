/**
 * Input Sanitization Unit Tests
 *
 * Tests for security-critical sanitization functions used in BC tool execution.
 * These functions protect against path traversal, injection attacks, and
 * invalid input that could compromise system security.
 *
 * Functions tested:
 * - sanitizeEntityName: Validates and sanitizes BC entity names
 * - sanitizeKeyword: Sanitizes search keywords
 * - isValidOperationType: Validates operation types (list/get/create/update/delete)
 * - sanitizeOperationId: Validates operation IDs (camelCase format)
 *
 * @module __tests__/unit/services/agent/input-sanitization.test
 */

import { describe, it, expect } from 'vitest';
import {
  sanitizeEntityName,
  sanitizeKeyword,
  isValidOperationType,
  sanitizeOperationId,
} from '@/modules/agents/business-central/tools';

describe('Input Sanitization', () => {
  describe('sanitizeEntityName', () => {
    describe('valid inputs', () => {
      it('should accept lowercase entity names', () => {
        expect(sanitizeEntityName('customers')).toBe('customers');
      });

      it('should convert to lowercase', () => {
        expect(sanitizeEntityName('Customers')).toBe('customers');
        expect(sanitizeEntityName('CUSTOMERS')).toBe('customers');
        expect(sanitizeEntityName('CuStOmErS')).toBe('customers');
      });

      it('should accept names with underscores', () => {
        expect(sanitizeEntityName('sales_invoices')).toBe('sales_invoices');
      });

      it('should accept names with hyphens', () => {
        expect(sanitizeEntityName('sales-orders')).toBe('sales-orders');
      });

      it('should accept names with numbers', () => {
        expect(sanitizeEntityName('item123')).toBe('item123');
        expect(sanitizeEntityName('123item')).toBe('123item');
      });

      it('should handle mixed valid characters', () => {
        expect(sanitizeEntityName('Sales_Invoice-Items2024')).toBe('sales_invoice-items2024');
      });
    });

    describe('path traversal protection', () => {
      it('should remove dots (not throw, since regex strips them first)', () => {
        // The regex [^a-z0-9_-] removes dots BEFORE the check
        // So '..' becomes '' (empty string)
        expect(sanitizeEntityName('..')).toBe('');
        expect(sanitizeEntityName('..customers')).toBe('customers');
        expect(sanitizeEntityName('customers..')).toBe('customers');
      });

      it('should remove forward slashes', () => {
        // Slashes are removed by regex, not throwing
        const result = sanitizeEntityName('customers/items');
        expect(result).toBe('customersitems');
      });

      it('should remove backslashes', () => {
        const result = sanitizeEntityName('customers\\items');
        expect(result).toBe('customersitems');
      });

      it('should sanitize path traversal attempts to safe strings', () => {
        // '../etc/passwd' -> 'etcpasswd' (dots and slashes removed by regex)
        expect(sanitizeEntityName('../etc/passwd')).toBe('etcpasswd');
      });
    });

    describe('special character handling', () => {
      it('should remove spaces', () => {
        expect(sanitizeEntityName('sales invoices')).toBe('salesinvoices');
      });

      it('should remove special characters', () => {
        expect(sanitizeEntityName('customers!@#$%')).toBe('customers');
        expect(sanitizeEntityName('items<>?')).toBe('items');
        expect(sanitizeEntityName("vendor's")).toBe('vendors');
      });

      it('should handle SQL injection attempts by removing special chars', () => {
        // Regex [^a-z0-9_-] removes quotes, semicolons, spaces, equals
        // Hyphens are kept but everything else including spaces gets removed
        // "customers'; DROP TABLE--" -> "customersdroptable--" (spaces removed too)
        expect(sanitizeEntityName("customers'; DROP TABLE--")).toBe('customersdroptable--');
        // "customers OR 1=1" -> "customersor11" (spaces and = removed)
        expect(sanitizeEntityName('customers OR 1=1')).toBe('customersor11');
      });
    });

    describe('length validation', () => {
      it('should accept names up to 50 characters', () => {
        const validName = 'a'.repeat(50);
        expect(sanitizeEntityName(validName)).toBe(validName);
      });

      it('should reject names over 50 characters', () => {
        const longName = 'a'.repeat(51);
        expect(() => sanitizeEntityName(longName)).toThrow('Entity name too long');
      });
    });

    describe('type validation', () => {
      it('should throw for non-string input', () => {
        expect(() => sanitizeEntityName(123 as unknown as string)).toThrow('Entity name must be a string');
        expect(() => sanitizeEntityName(null as unknown as string)).toThrow('Entity name must be a string');
        expect(() => sanitizeEntityName(undefined as unknown as string)).toThrow('Entity name must be a string');
        expect(() => sanitizeEntityName({} as unknown as string)).toThrow('Entity name must be a string');
        expect(() => sanitizeEntityName([] as unknown as string)).toThrow('Entity name must be a string');
      });
    });
  });

  describe('sanitizeKeyword', () => {
    describe('valid inputs', () => {
      it('should accept lowercase keywords', () => {
        expect(sanitizeKeyword('invoice')).toBe('invoice');
      });

      it('should convert to lowercase', () => {
        expect(sanitizeKeyword('INVOICE')).toBe('invoice');
        expect(sanitizeKeyword('Invoice')).toBe('invoice');
      });

      it('should trim whitespace', () => {
        expect(sanitizeKeyword('  invoice  ')).toBe('invoice');
      });

      it('should preserve spaces within keyword', () => {
        expect(sanitizeKeyword('sales invoice')).toBe('sales invoice');
      });

      it('should accept hyphens and underscores', () => {
        expect(sanitizeKeyword('sales-invoice')).toBe('sales-invoice');
        expect(sanitizeKeyword('sales_invoice')).toBe('sales_invoice');
      });

      it('should accept numbers', () => {
        expect(sanitizeKeyword('invoice123')).toBe('invoice123');
        expect(sanitizeKeyword('2024')).toBe('2024');
      });
    });

    describe('special character removal', () => {
      it('should remove dangerous characters', () => {
        expect(sanitizeKeyword('invoice!@#$%')).toBe('invoice');
        expect(sanitizeKeyword('item<script>')).toBe('itemscript');
      });

      it('should remove quotes', () => {
        expect(sanitizeKeyword("vendor's")).toBe('vendors');
        expect(sanitizeKeyword('vendor"s')).toBe('vendors');
      });

      it('should handle regex-unsafe characters', () => {
        expect(sanitizeKeyword('item.*')).toBe('item');
        expect(sanitizeKeyword('item[0-9]')).toBe('item0-9');
      });
    });

    describe('length validation', () => {
      it('should truncate keywords over 100 characters', () => {
        const longKeyword = 'a'.repeat(150);
        expect(sanitizeKeyword(longKeyword)).toBe('a'.repeat(100));
      });

      it('should preserve keywords up to 100 characters', () => {
        const validKeyword = 'a'.repeat(100);
        expect(sanitizeKeyword(validKeyword)).toBe(validKeyword);
      });
    });

    describe('type handling', () => {
      it('should return empty string for non-string input', () => {
        expect(sanitizeKeyword(123 as unknown as string)).toBe('');
        expect(sanitizeKeyword(null as unknown as string)).toBe('');
        expect(sanitizeKeyword(undefined as unknown as string)).toBe('');
        expect(sanitizeKeyword({} as unknown as string)).toBe('');
      });
    });
  });

  describe('isValidOperationType', () => {
    describe('valid operation types', () => {
      // Note: Valid types are 'list', 'get', 'create', 'update', 'delete'
      // NOT 'read' - the BC API uses 'get' instead
      it('should accept "list"', () => {
        expect(isValidOperationType('list')).toBe(true);
      });

      it('should accept "get"', () => {
        expect(isValidOperationType('get')).toBe(true);
      });

      it('should accept "create"', () => {
        expect(isValidOperationType('create')).toBe(true);
      });

      it('should accept "update"', () => {
        expect(isValidOperationType('update')).toBe(true);
      });

      it('should accept "delete"', () => {
        expect(isValidOperationType('delete')).toBe(true);
      });
    });

    describe('invalid operation types', () => {
      it('should reject "read" (BC uses "get" instead)', () => {
        expect(isValidOperationType('read')).toBe(false);
      });

      it('should reject unknown operations', () => {
        expect(isValidOperationType('patch')).toBe(false);
        expect(isValidOperationType('upsert')).toBe(false);
        expect(isValidOperationType('execute')).toBe(false);
      });

      it('should reject case variations', () => {
        expect(isValidOperationType('GET')).toBe(false);
        expect(isValidOperationType('Get')).toBe(false);
        expect(isValidOperationType('LIST')).toBe(false);
      });

      it('should reject empty string', () => {
        expect(isValidOperationType('')).toBe(false);
      });

      it('should reject whitespace', () => {
        expect(isValidOperationType(' list ')).toBe(false);
        expect(isValidOperationType('get ')).toBe(false);
      });
    });

    describe('type handling', () => {
      it('should reject non-string types', () => {
        expect(isValidOperationType(123)).toBe(false);
        expect(isValidOperationType(null)).toBe(false);
        expect(isValidOperationType(undefined)).toBe(false);
        expect(isValidOperationType({})).toBe(false);
        expect(isValidOperationType([])).toBe(false);
        expect(isValidOperationType(true)).toBe(false);
      });
    });
  });

  describe('sanitizeOperationId', () => {
    describe('valid operation IDs', () => {
      it('should accept camelCase IDs', () => {
        expect(sanitizeOperationId('getCustomer')).toBe('getCustomer');
        expect(sanitizeOperationId('listSalesInvoices')).toBe('listSalesInvoices');
        expect(sanitizeOperationId('postVendor')).toBe('postVendor');
      });

      it('should accept PascalCase IDs', () => {
        expect(sanitizeOperationId('GetCustomer')).toBe('GetCustomer');
        expect(sanitizeOperationId('ListItems')).toBe('ListItems');
      });

      it('should accept single word IDs', () => {
        expect(sanitizeOperationId('get')).toBe('get');
        expect(sanitizeOperationId('post')).toBe('post');
      });

      it('should accept IDs with numbers', () => {
        expect(sanitizeOperationId('getItem123')).toBe('getItem123');
        expect(sanitizeOperationId('list2024Invoices')).toBe('list2024Invoices');
      });

      it('should trim whitespace', () => {
        expect(sanitizeOperationId('  getCustomer  ')).toBe('getCustomer');
      });
    });

    describe('invalid operation IDs', () => {
      it('should reject IDs starting with numbers', () => {
        expect(() => sanitizeOperationId('123get')).toThrow('Invalid operation ID format');
        expect(() => sanitizeOperationId('1abc')).toThrow('Invalid operation ID format');
      });

      it('should reject IDs with underscores', () => {
        expect(() => sanitizeOperationId('get_customer')).toThrow('Invalid operation ID format');
      });

      it('should reject IDs with hyphens', () => {
        expect(() => sanitizeOperationId('get-customer')).toThrow('Invalid operation ID format');
      });

      it('should reject IDs with spaces', () => {
        expect(() => sanitizeOperationId('get customer')).toThrow('Invalid operation ID format');
      });

      it('should reject IDs with special characters', () => {
        expect(() => sanitizeOperationId('get!customer')).toThrow('Invalid operation ID format');
        expect(() => sanitizeOperationId('get@customer')).toThrow('Invalid operation ID format');
      });

      it('should reject empty IDs', () => {
        expect(() => sanitizeOperationId('')).toThrow('Operation ID cannot be empty');
        expect(() => sanitizeOperationId('   ')).toThrow('Operation ID cannot be empty');
      });
    });

    describe('length validation', () => {
      it('should accept IDs up to 100 characters', () => {
        const validId = 'a' + 'b'.repeat(99);
        expect(sanitizeOperationId(validId)).toBe(validId);
      });

      it('should reject IDs over 100 characters', () => {
        const longId = 'a' + 'b'.repeat(100);
        expect(() => sanitizeOperationId(longId)).toThrow('Operation ID too long');
      });
    });

    describe('type validation', () => {
      it('should throw for non-string input', () => {
        expect(() => sanitizeOperationId(123 as unknown as string)).toThrow('Operation ID must be a string');
        expect(() => sanitizeOperationId(null as unknown as string)).toThrow('Operation ID must be a string');
        expect(() => sanitizeOperationId(undefined as unknown as string)).toThrow('Operation ID must be a string');
      });
    });
  });
});
