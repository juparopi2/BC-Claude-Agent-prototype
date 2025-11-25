/**
 * Input Sanitization Unit Tests
 *
 * F6-003-FIX: Tests for edge cases identified in QA Master Review:
 * - Entity name case sensitivity
 * - Path traversal protection
 * - Special characters in keyword search
 * - Operation ID validation
 *
 * @module __tests__/unit/services/agent/input-sanitization.test
 */

import { describe, it, expect } from 'vitest';
import { __testExports } from '@/services/agent/DirectAgentService';

const {
  sanitizeEntityName,
  sanitizeKeyword,
  isValidOperationType,
  sanitizeOperationId,
  VALID_OPERATION_TYPES,
} = __testExports;

// ===== 1. SANITIZE ENTITY NAME TESTS =====
describe('sanitizeEntityName', () => {
  describe('case sensitivity', () => {
    it('should convert entity name to lowercase', () => {
      expect(sanitizeEntityName('Customer')).toBe('customer');
      expect(sanitizeEntityName('CUSTOMER')).toBe('customer');
      expect(sanitizeEntityName('SalesOrder')).toBe('salesorder');
      expect(sanitizeEntityName('salesInvoice')).toBe('salesinvoice');
    });

    it('should handle mixed case entity names', () => {
      expect(sanitizeEntityName('CustomerPaymentJournal')).toBe('customerpaymentjournal');
      expect(sanitizeEntityName('GLEntry')).toBe('glentry');
    });
  });

  describe('path traversal protection', () => {
    it('should reject path traversal attempts with ../', () => {
      expect(() => sanitizeEntityName('../etc/passwd')).toThrow('path traversal not allowed');
      expect(() => sanitizeEntityName('customer/../admin')).toThrow('path traversal not allowed');
    });

    it('should reject path traversal attempts with ..\\', () => {
      expect(() => sanitizeEntityName('..\\etc\\passwd')).toThrow('path traversal not allowed');
      expect(() => sanitizeEntityName('customer\\..\\admin')).toThrow('path traversal not allowed');
    });

    it('should reject forward slashes', () => {
      expect(() => sanitizeEntityName('customer/payment')).toThrow('path traversal not allowed');
      expect(() => sanitizeEntityName('/etc/passwd')).toThrow('path traversal not allowed');
    });

    it('should reject backslashes', () => {
      expect(() => sanitizeEntityName('customer\\payment')).toThrow('path traversal not allowed');
      expect(() => sanitizeEntityName('\\windows\\system32')).toThrow('path traversal not allowed');
    });

    it('should reject double dots even without slashes', () => {
      expect(() => sanitizeEntityName('customer..admin')).toThrow('path traversal not allowed');
      expect(() => sanitizeEntityName('..customer')).toThrow('path traversal not allowed');
    });
  });

  describe('character validation', () => {
    it('should allow valid entity names with alphanumeric characters', () => {
      expect(sanitizeEntityName('customer')).toBe('customer');
      expect(sanitizeEntityName('salesorder1')).toBe('salesorder1');
      expect(sanitizeEntityName('invoice2024')).toBe('invoice2024');
    });

    it('should allow underscores in entity names', () => {
      expect(sanitizeEntityName('customer_payment')).toBe('customer_payment');
      expect(sanitizeEntityName('sales_order_line')).toBe('sales_order_line');
    });

    it('should allow hyphens in entity names', () => {
      expect(sanitizeEntityName('customer-payment')).toBe('customer-payment');
      expect(sanitizeEntityName('sales-order-line')).toBe('sales-order-line');
    });

    it('should reject special characters', () => {
      expect(() => sanitizeEntityName("customer's")).toThrow('only alphanumeric');
      expect(() => sanitizeEntityName('customer;DROP')).toThrow('only alphanumeric');
      expect(() => sanitizeEntityName('customer@email')).toThrow('only alphanumeric');
      expect(() => sanitizeEntityName('customer#1')).toThrow('only alphanumeric');
      expect(() => sanitizeEntityName('customer$money')).toThrow('only alphanumeric');
      expect(() => sanitizeEntityName('customer%20')).toThrow('only alphanumeric');
    });

    it('should reject names starting with numbers', () => {
      expect(() => sanitizeEntityName('123customer')).toThrow('only alphanumeric');
      expect(() => sanitizeEntityName('1stCustomer')).toThrow('only alphanumeric');
    });

    it('should reject names starting with underscore', () => {
      expect(() => sanitizeEntityName('_customer')).toThrow('only alphanumeric');
    });

    it('should reject names starting with hyphen', () => {
      expect(() => sanitizeEntityName('-customer')).toThrow('only alphanumeric');
    });
  });

  describe('input validation', () => {
    it('should reject non-string inputs', () => {
      expect(() => sanitizeEntityName(123)).toThrow('must be a string');
      expect(() => sanitizeEntityName(null)).toThrow('must be a string');
      expect(() => sanitizeEntityName(undefined)).toThrow('must be a string');
      expect(() => sanitizeEntityName({})).toThrow('must be a string');
      expect(() => sanitizeEntityName(['customer'])).toThrow('must be a string');
    });

    it('should reject empty strings', () => {
      expect(() => sanitizeEntityName('')).toThrow('cannot be empty');
      expect(() => sanitizeEntityName('   ')).toThrow('cannot be empty');
    });

    it('should reject names exceeding max length', () => {
      const longName = 'a'.repeat(101);
      expect(() => sanitizeEntityName(longName)).toThrow('too long');
    });

    it('should accept names at max length boundary', () => {
      const maxLengthName = 'a'.repeat(100);
      expect(sanitizeEntityName(maxLengthName)).toBe(maxLengthName);
    });

    it('should trim whitespace', () => {
      expect(sanitizeEntityName('  customer  ')).toBe('customer');
      expect(sanitizeEntityName('\tcustomer\n')).toBe('customer');
    });
  });
});

// ===== 2. SANITIZE KEYWORD TESTS =====
describe('sanitizeKeyword', () => {
  describe('basic sanitization', () => {
    it('should convert keyword to lowercase', () => {
      expect(sanitizeKeyword('Customer')).toBe('customer');
      expect(sanitizeKeyword('INVOICE')).toBe('invoice');
      expect(sanitizeKeyword('SalesOrder')).toBe('salesorder');
    });

    it('should trim whitespace', () => {
      expect(sanitizeKeyword('  customer  ')).toBe('customer');
      expect(sanitizeKeyword('\tcustomer\n')).toBe('customer');
    });
  });

  describe('special character handling', () => {
    it('should remove SQL injection attempts (semicolons and double dashes)', () => {
      const result = sanitizeKeyword("customer; DROP TABLE--");
      expect(result).not.toContain(';');
      // Note: Single quotes are allowed as they're common in search terms (e.g., "customer's")
      // The keyword is used for string matching, not SQL queries
      expect(result).toContain('customer');
      expect(result).toContain('drop table');
    });

    it('should remove HTML/script tags', () => {
      const result = sanitizeKeyword('<script>alert("xss")</script>customer');
      expect(result).not.toContain('<');
      expect(result).not.toContain('>');
      expect(result).toContain('customer');
    });

    it('should allow safe punctuation', () => {
      expect(sanitizeKeyword("customer's invoice")).toBe("customer's invoice");
      expect(sanitizeKeyword('order-123')).toBe('order-123');
      expect(sanitizeKeyword('item_code')).toBe('item_code');
      expect(sanitizeKeyword('price.50')).toBe('price.50');
      expect(sanitizeKeyword('customer, order')).toBe('customer, order');
    });

    it('should remove dangerous characters', () => {
      const result = sanitizeKeyword('customer`rm -rf`');
      expect(result).not.toContain('`');
      expect(result).toContain('customer');
    });
  });

  describe('length limits', () => {
    it('should truncate keywords exceeding max length', () => {
      const longKeyword = 'a'.repeat(250);
      const result = sanitizeKeyword(longKeyword);
      expect(result.length).toBe(200);
    });

    it('should preserve keywords under max length', () => {
      const keyword = 'customer invoice';
      expect(sanitizeKeyword(keyword)).toBe(keyword);
    });
  });

  describe('non-string handling', () => {
    it('should return empty string for non-string inputs', () => {
      expect(sanitizeKeyword(123)).toBe('');
      expect(sanitizeKeyword(null)).toBe('');
      expect(sanitizeKeyword(undefined)).toBe('');
      expect(sanitizeKeyword({})).toBe('');
      expect(sanitizeKeyword(['keyword'])).toBe('');
    });
  });
});

// ===== 3. IS VALID OPERATION TYPE TESTS =====
describe('isValidOperationType', () => {
  describe('valid operation types', () => {
    it('should accept all valid operation types', () => {
      expect(isValidOperationType('list')).toBe(true);
      expect(isValidOperationType('get')).toBe(true);
      expect(isValidOperationType('create')).toBe(true);
      expect(isValidOperationType('update')).toBe(true);
      expect(isValidOperationType('delete')).toBe(true);
    });
  });

  describe('invalid operation types', () => {
    it('should reject "action" (removed from enum)', () => {
      expect(isValidOperationType('action')).toBe(false);
    });

    it('should reject unknown operation types', () => {
      expect(isValidOperationType('patch')).toBe(false);
      expect(isValidOperationType('put')).toBe(false);
      expect(isValidOperationType('post')).toBe(false);
      expect(isValidOperationType('query')).toBe(false);
      expect(isValidOperationType('execute')).toBe(false);
    });

    it('should reject non-string inputs', () => {
      expect(isValidOperationType(123)).toBe(false);
      expect(isValidOperationType(null)).toBe(false);
      expect(isValidOperationType(undefined)).toBe(false);
      expect(isValidOperationType({})).toBe(false);
      expect(isValidOperationType(['list'])).toBe(false);
    });

    it('should reject empty string', () => {
      expect(isValidOperationType('')).toBe(false);
    });

    it('should be case-sensitive', () => {
      expect(isValidOperationType('LIST')).toBe(false);
      expect(isValidOperationType('List')).toBe(false);
      expect(isValidOperationType('GET')).toBe(false);
    });
  });

  describe('VALID_OPERATION_TYPES constant', () => {
    it('should contain exactly 5 operation types', () => {
      expect(VALID_OPERATION_TYPES).toHaveLength(5);
    });

    it('should not contain "action"', () => {
      expect(VALID_OPERATION_TYPES).not.toContain('action');
    });

    it('should contain all expected operations', () => {
      expect(VALID_OPERATION_TYPES).toContain('list');
      expect(VALID_OPERATION_TYPES).toContain('get');
      expect(VALID_OPERATION_TYPES).toContain('create');
      expect(VALID_OPERATION_TYPES).toContain('update');
      expect(VALID_OPERATION_TYPES).toContain('delete');
    });
  });
});

// ===== 4. SANITIZE OPERATION ID TESTS =====
describe('sanitizeOperationId', () => {
  describe('valid operation IDs', () => {
    it('should accept valid camelCase operation IDs', () => {
      expect(sanitizeOperationId('postCustomer')).toBe('postCustomer');
      expect(sanitizeOperationId('listSalesInvoices')).toBe('listSalesInvoices');
      expect(sanitizeOperationId('getCustomerPaymentJournal')).toBe('getCustomerPaymentJournal');
    });

    it('should accept operation IDs with numbers', () => {
      expect(sanitizeOperationId('getCustomer123')).toBe('getCustomer123');
      expect(sanitizeOperationId('list2024Invoices')).toBe('list2024Invoices');
    });

    it('should preserve case', () => {
      expect(sanitizeOperationId('POST')).toBe('POST');
      expect(sanitizeOperationId('GetCustomer')).toBe('GetCustomer');
    });

    it('should trim whitespace', () => {
      expect(sanitizeOperationId('  postCustomer  ')).toBe('postCustomer');
      expect(sanitizeOperationId('\tlistItems\n')).toBe('listItems');
    });
  });

  describe('invalid operation IDs', () => {
    it('should reject IDs with underscores', () => {
      expect(() => sanitizeOperationId('post_customer')).toThrow('Invalid operation ID format');
    });

    it('should reject IDs with hyphens', () => {
      expect(() => sanitizeOperationId('post-customer')).toThrow('Invalid operation ID format');
    });

    it('should reject IDs starting with numbers', () => {
      expect(() => sanitizeOperationId('123postCustomer')).toThrow('Invalid operation ID format');
    });

    it('should reject IDs with special characters', () => {
      expect(() => sanitizeOperationId('postCustomer!')).toThrow('Invalid operation ID format');
      expect(() => sanitizeOperationId('post@customer')).toThrow('Invalid operation ID format');
      expect(() => sanitizeOperationId('post.customer')).toThrow('Invalid operation ID format');
    });

    it('should reject IDs with spaces', () => {
      expect(() => sanitizeOperationId('post customer')).toThrow('Invalid operation ID format');
    });

    it('should reject path traversal in operation IDs', () => {
      expect(() => sanitizeOperationId('../../../etc')).toThrow('Invalid operation ID format');
      expect(() => sanitizeOperationId('post/../admin')).toThrow('Invalid operation ID format');
    });
  });

  describe('input validation', () => {
    it('should reject non-string inputs', () => {
      expect(() => sanitizeOperationId(123)).toThrow('must be a string');
      expect(() => sanitizeOperationId(null)).toThrow('must be a string');
      expect(() => sanitizeOperationId(undefined)).toThrow('must be a string');
      expect(() => sanitizeOperationId({})).toThrow('must be a string');
    });

    it('should reject empty strings', () => {
      expect(() => sanitizeOperationId('')).toThrow('cannot be empty');
      expect(() => sanitizeOperationId('   ')).toThrow('cannot be empty');
    });

    it('should reject IDs exceeding max length', () => {
      const longId = 'a'.repeat(101);
      expect(() => sanitizeOperationId(longId)).toThrow('too long');
    });

    it('should accept IDs at max length boundary', () => {
      const maxLengthId = 'a'.repeat(100);
      expect(sanitizeOperationId(maxLengthId)).toBe(maxLengthId);
    });
  });
});

// ===== 5. INTEGRATION-LIKE TESTS (COMBINED SCENARIOS) =====
describe('Combined Sanitization Scenarios', () => {
  describe('realistic attack vectors', () => {
    it('should prevent directory traversal to read system files', () => {
      expect(() => sanitizeEntityName('../../../etc/passwd')).toThrow();
      expect(() => sanitizeEntityName('....//....//etc/passwd')).toThrow();
      expect(() => sanitizeEntityName('%2e%2e%2f')).toThrow(); // URL encoded ../
    });

    it('should prevent null byte injection', () => {
      expect(() => sanitizeEntityName('customer\x00.json')).toThrow();
    });

    it('should prevent command injection via keywords', () => {
      const result = sanitizeKeyword('customer`id`');
      expect(result).not.toContain('`');

      const result2 = sanitizeKeyword('$(whoami)');
      expect(result2).not.toContain('$');
      expect(result2).not.toContain('(');
    });

    it('should handle Unicode normalization attacks', () => {
      // Some Unicode characters look like ASCII but aren't
      // The sanitizer should handle these gracefully
      expect(() => sanitizeEntityName('\u2024customer')).toThrow(); // One dot leader
    });
  });

  describe('edge case combinations', () => {
    it('should handle entity name with max allowed characters', () => {
      const validName = 'customer-payment_2024';
      expect(sanitizeEntityName(validName)).toBe(validName.toLowerCase());
    });

    it('should handle keyword with mixed safe special chars', () => {
      const keyword = "customer's order-123, invoice.pdf";
      const result = sanitizeKeyword(keyword);
      expect(result).toContain("customer's");
      expect(result).toContain('-');
      expect(result).toContain('.');
      expect(result).toContain(',');
    });

    it('should validate operation chain', () => {
      // Simulating what would happen in a workflow validation
      const steps = ['postCustomer', 'listItems', 'createInvoice'];
      for (const step of steps) {
        expect(() => sanitizeOperationId(step)).not.toThrow();
      }
    });
  });
});
