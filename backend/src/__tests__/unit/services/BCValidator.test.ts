/**
 * BCValidator Unit Tests
 *
 * Tests for Business Central entity validation.
 * Coverage target: 90%+ for BCValidator.ts
 *
 * @module tests/unit/services/BCValidator
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BCValidator, getBCValidator } from '@/services/bc/BCValidator';

describe('BCValidator', () => {
  let validator: BCValidator;

  beforeEach(() => {
    validator = new BCValidator();
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance on multiple calls', () => {
      const instance1 = getBCValidator();
      const instance2 = getBCValidator();
      expect(instance1).toBe(instance2);
    });

    it('should create a new BCValidator instance', () => {
      const validator = new BCValidator();
      expect(validator).toBeInstanceOf(BCValidator);
    });
  });

  describe('validateCustomer', () => {
    describe('displayName validation', () => {
      it('should return valid result for valid customer data', () => {
        const result = validator.validateCustomer({
          displayName: 'Acme Corp',
          email: 'contact@acme.com',
        });
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should require displayName', () => {
        const result = validator.validateCustomer({});
        expect(result.valid).toBe(false);
        expect(result.errors).toContainEqual({
          field: 'displayName',
          message: 'Customer display name is required',
          code: 'REQUIRED_FIELD',
        });
      });

      it('should reject empty displayName', () => {
        const result = validator.validateCustomer({ displayName: '' });
        expect(result.valid).toBe(false);
        expect(result.errors[0]?.code).toBe('REQUIRED_FIELD');
      });

      it('should reject whitespace-only displayName', () => {
        const result = validator.validateCustomer({ displayName: '   ' });
        expect(result.valid).toBe(false);
        expect(result.errors[0]?.code).toBe('REQUIRED_FIELD');
      });

      it('should reject displayName exceeding 100 characters', () => {
        const longName = 'A'.repeat(101);
        const result = validator.validateCustomer({ displayName: longName });
        expect(result.valid).toBe(false);
        expect(result.errors).toContainEqual({
          field: 'displayName',
          message: 'Display name must be 100 characters or less',
          code: 'MAX_LENGTH',
        });
      });

      it('should accept displayName with exactly 100 characters', () => {
        const exactName = 'A'.repeat(100);
        const result = validator.validateCustomer({ displayName: exactName });
        expect(result.valid).toBe(true);
      });
    });

    describe('email validation', () => {
      it('should accept valid email', () => {
        const result = validator.validateCustomer({
          displayName: 'Test',
          email: 'user@example.com',
        });
        expect(result.valid).toBe(true);
      });

      it('should reject invalid email format', () => {
        const result = validator.validateCustomer({
          displayName: 'Test',
          email: 'invalid-email',
        });
        expect(result.valid).toBe(false);
        expect(result.errors).toContainEqual({
          field: 'email',
          message: 'Invalid email format',
          code: 'INVALID_FORMAT',
        });
      });

      it('should reject email without domain', () => {
        const result = validator.validateCustomer({
          displayName: 'Test',
          email: 'user@',
        });
        expect(result.valid).toBe(false);
      });

      it('should reject email without @ symbol', () => {
        const result = validator.validateCustomer({
          displayName: 'Test',
          email: 'userexample.com',
        });
        expect(result.valid).toBe(false);
      });

      it('should allow empty email (optional field)', () => {
        const result = validator.validateCustomer({
          displayName: 'Test',
        });
        expect(result.valid).toBe(true);
      });
    });

    describe('phoneNumber validation', () => {
      it('should accept valid phone number formats', () => {
        const validPhones = [
          '+1234567890',
          '+1 234 567 8900',
          '(123) 456-7890',
          '123-456-7890',
          '1234567890',
          '+52.55.1234.5678',
        ];

        for (const phone of validPhones) {
          const result = validator.validateCustomer({
            displayName: 'Test',
            phoneNumber: phone,
          });
          expect(result.valid).toBe(true);
        }
      });

      it('should reject invalid phone number', () => {
        const result = validator.validateCustomer({
          displayName: 'Test',
          phoneNumber: 'not-a-phone',
        });
        expect(result.valid).toBe(false);
        expect(result.errors).toContainEqual({
          field: 'phoneNumber',
          message: 'Invalid phone number format',
          code: 'INVALID_FORMAT',
        });
      });

      it('should reject too short phone number', () => {
        const result = validator.validateCustomer({
          displayName: 'Test',
          phoneNumber: '123456',
        });
        expect(result.valid).toBe(false);
      });
    });

    describe('blocked validation', () => {
      it('should accept valid blocked values', () => {
        const validBlocked = ['', 'Ship', 'Invoice', 'All'];

        for (const blocked of validBlocked) {
          const result = validator.validateCustomer({
            displayName: 'Test',
            blocked,
          });
          expect(result.valid).toBe(true);
        }
      });

      it('should reject invalid blocked value', () => {
        const result = validator.validateCustomer({
          displayName: 'Test',
          blocked: 'InvalidValue' as 'Ship',
        });
        expect(result.valid).toBe(false);
        expect(result.errors).toContainEqual({
          field: 'blocked',
          message: "Blocked must be '', 'Ship', 'Invoice', or 'All'",
          code: 'INVALID_VALUE',
        });
      });
    });

    describe('website validation', () => {
      it('should accept valid URLs', () => {
        const validUrls = [
          'https://example.com',
          'http://example.org',
          'https://sub.domain.co.uk/path',
        ];

        for (const website of validUrls) {
          const result = validator.validateCustomer({
            displayName: 'Test',
            website,
          });
          expect(result.valid).toBe(true);
        }
      });

      it('should reject invalid URL', () => {
        const result = validator.validateCustomer({
          displayName: 'Test',
          website: 'not-a-url',
        });
        expect(result.valid).toBe(false);
        expect(result.errors).toContainEqual({
          field: 'website',
          message: 'Invalid website URL format',
          code: 'INVALID_FORMAT',
        });
      });
    });

    describe('balance validation', () => {
      it('should accept positive balance', () => {
        const result = validator.validateCustomer({
          displayName: 'Test',
          balance: 1000,
        });
        expect(result.valid).toBe(true);
      });

      it('should accept zero balance', () => {
        const result = validator.validateCustomer({
          displayName: 'Test',
          balance: 0,
        });
        expect(result.valid).toBe(true);
      });

      it('should reject negative balance', () => {
        const result = validator.validateCustomer({
          displayName: 'Test',
          balance: -100,
        });
        expect(result.valid).toBe(false);
        expect(result.errors).toContainEqual({
          field: 'balance',
          message: 'Balance cannot be negative',
          code: 'INVALID_VALUE',
        });
      });
    });

    describe('multiple validation errors', () => {
      it('should return all validation errors', () => {
        const result = validator.validateCustomer({
          displayName: '',
          email: 'invalid',
          phoneNumber: 'abc',
          blocked: 'Wrong' as 'Ship',
          website: 'bad-url',
          balance: -50,
        });

        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThanOrEqual(5);
      });
    });
  });

  describe('validateVendor', () => {
    describe('displayName validation', () => {
      it('should return valid result for valid vendor data', () => {
        const result = validator.validateVendor({
          displayName: 'Supplier Inc',
        });
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should require displayName', () => {
        const result = validator.validateVendor({});
        expect(result.valid).toBe(false);
        expect(result.errors).toContainEqual({
          field: 'displayName',
          message: 'Vendor display name is required',
          code: 'REQUIRED_FIELD',
        });
      });

      it('should reject empty displayName', () => {
        const result = validator.validateVendor({ displayName: '' });
        expect(result.valid).toBe(false);
      });

      it('should reject displayName exceeding 100 characters', () => {
        const longName = 'B'.repeat(101);
        const result = validator.validateVendor({ displayName: longName });
        expect(result.valid).toBe(false);
        expect(result.errors[0]?.code).toBe('MAX_LENGTH');
      });
    });

    describe('blocked validation for vendors', () => {
      it('should accept valid vendor blocked values', () => {
        const validBlocked = ['', 'Payment', 'All'];

        for (const blocked of validBlocked) {
          const result = validator.validateVendor({
            displayName: 'Test Vendor',
            blocked,
          });
          expect(result.valid).toBe(true);
        }
      });

      it('should reject customer-specific blocked values for vendor', () => {
        const result = validator.validateVendor({
          displayName: 'Test Vendor',
          blocked: 'Ship' as 'Payment',
        });
        expect(result.valid).toBe(false);
        expect(result.errors).toContainEqual({
          field: 'blocked',
          message: "Blocked must be '', 'Payment', or 'All'",
          code: 'INVALID_VALUE',
        });
      });
    });

    describe('email, phone, website, balance validation', () => {
      it('should validate email for vendors', () => {
        const result = validator.validateVendor({
          displayName: 'Vendor',
          email: 'bad-email',
        });
        expect(result.valid).toBe(false);
        expect(result.errors[0]?.field).toBe('email');
      });

      it('should validate phone for vendors', () => {
        const result = validator.validateVendor({
          displayName: 'Vendor',
          phoneNumber: 'abc',
        });
        expect(result.valid).toBe(false);
        expect(result.errors[0]?.field).toBe('phoneNumber');
      });

      it('should validate website for vendors', () => {
        const result = validator.validateVendor({
          displayName: 'Vendor',
          website: 'not-url',
        });
        expect(result.valid).toBe(false);
        expect(result.errors[0]?.field).toBe('website');
      });

      it('should validate balance for vendors', () => {
        const result = validator.validateVendor({
          displayName: 'Vendor',
          balance: -1,
        });
        expect(result.valid).toBe(false);
        expect(result.errors[0]?.field).toBe('balance');
      });
    });
  });

  describe('validateItem', () => {
    describe('displayName validation', () => {
      it('should return valid result for valid item data', () => {
        const result = validator.validateItem({
          displayName: 'Widget Pro',
          type: 'Inventory',
          unitPrice: 100,
          unitCost: 50,
        });
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should require displayName', () => {
        const result = validator.validateItem({});
        expect(result.valid).toBe(false);
        expect(result.errors).toContainEqual({
          field: 'displayName',
          message: 'Item display name is required',
          code: 'REQUIRED_FIELD',
        });
      });

      it('should reject displayName exceeding 100 characters', () => {
        const longName = 'C'.repeat(101);
        const result = validator.validateItem({ displayName: longName });
        expect(result.valid).toBe(false);
        expect(result.errors[0]?.code).toBe('MAX_LENGTH');
      });
    });

    describe('type validation', () => {
      it('should accept valid item types', () => {
        const validTypes = ['Inventory', 'Service', 'Non-Inventory'] as const;

        for (const type of validTypes) {
          const result = validator.validateItem({
            displayName: 'Test Item',
            type,
          });
          expect(result.valid).toBe(true);
        }
      });

      it('should reject invalid type', () => {
        const result = validator.validateItem({
          displayName: 'Test Item',
          type: 'InvalidType' as 'Inventory',
        });
        expect(result.valid).toBe(false);
        expect(result.errors).toContainEqual({
          field: 'type',
          message: "Type must be 'Inventory', 'Service', or 'Non-Inventory'",
          code: 'INVALID_VALUE',
        });
      });
    });

    describe('price and cost validation', () => {
      it('should accept positive unitPrice', () => {
        const result = validator.validateItem({
          displayName: 'Item',
          unitPrice: 50,
        });
        expect(result.valid).toBe(true);
      });

      it('should accept zero unitPrice', () => {
        const result = validator.validateItem({
          displayName: 'Item',
          unitPrice: 0,
        });
        expect(result.valid).toBe(true);
      });

      it('should reject negative unitPrice', () => {
        const result = validator.validateItem({
          displayName: 'Item',
          unitPrice: -10,
        });
        expect(result.valid).toBe(false);
        expect(result.errors).toContainEqual({
          field: 'unitPrice',
          message: 'Unit price cannot be negative',
          code: 'INVALID_VALUE',
        });
      });

      it('should reject negative unitCost', () => {
        const result = validator.validateItem({
          displayName: 'Item',
          unitCost: -5,
        });
        expect(result.valid).toBe(false);
        expect(result.errors).toContainEqual({
          field: 'unitCost',
          message: 'Unit cost cannot be negative',
          code: 'INVALID_VALUE',
        });
      });
    });

    describe('inventory validation', () => {
      it('should accept positive inventory', () => {
        const result = validator.validateItem({
          displayName: 'Item',
          inventory: 100,
        });
        expect(result.valid).toBe(true);
      });

      it('should accept zero inventory', () => {
        const result = validator.validateItem({
          displayName: 'Item',
          inventory: 0,
        });
        expect(result.valid).toBe(true);
      });

      it('should reject negative inventory', () => {
        const result = validator.validateItem({
          displayName: 'Item',
          inventory: -10,
        });
        expect(result.valid).toBe(false);
        expect(result.errors).toContainEqual({
          field: 'inventory',
          message: 'Inventory cannot be negative',
          code: 'INVALID_VALUE',
        });
      });
    });

    describe('business rule: unitPrice vs unitCost', () => {
      it('should allow unitPrice greater than unitCost', () => {
        const result = validator.validateItem({
          displayName: 'Item',
          unitPrice: 100,
          unitCost: 50,
        });
        expect(result.valid).toBe(true);
      });

      it('should allow unitPrice equal to unitCost', () => {
        const result = validator.validateItem({
          displayName: 'Item',
          unitPrice: 50,
          unitCost: 50,
        });
        expect(result.valid).toBe(true);
      });

      it('should warn when unitPrice is less than unitCost', () => {
        const result = validator.validateItem({
          displayName: 'Item',
          unitPrice: 30,
          unitCost: 50,
        });
        expect(result.valid).toBe(false);
        expect(result.errors).toContainEqual({
          field: 'unitPrice',
          message: 'Unit price should not be less than unit cost',
          code: 'BUSINESS_RULE',
        });
      });
    });
  });

  describe('isValidGuid', () => {
    it('should accept valid GUID format', () => {
      const validGuids = [
        '00000000-0000-0000-0000-000000000000',
        'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        'A1B2C3D4-E5F6-7890-ABCD-EF1234567890',
        '12345678-1234-1234-1234-123456789abc',
      ];

      for (const guid of validGuids) {
        expect(validator.isValidGuid(guid)).toBe(true);
      }
    });

    it('should reject invalid GUID format', () => {
      const invalidGuids = [
        'not-a-guid',
        '00000000-0000-0000-0000',
        '00000000-0000-0000-0000-00000000000',
        '00000000-0000-0000-0000-0000000000000',
        '0000000000000000000000000000000000',
        '00000000_0000_0000_0000_000000000000',
        'g0000000-0000-0000-0000-000000000000',
      ];

      for (const guid of invalidGuids) {
        expect(validator.isValidGuid(guid)).toBe(false);
      }
    });
  });

  describe('formatErrors', () => {
    it('should return "No errors" for valid result', () => {
      const result = validator.validateCustomer({ displayName: 'Valid' });
      const formatted = validator.formatErrors(result);
      expect(formatted).toBe('No errors');
    });

    it('should format single error', () => {
      const result = validator.validateCustomer({});
      const formatted = validator.formatErrors(result);
      expect(formatted).toBe('displayName: Customer display name is required');
    });

    it('should format multiple errors with semicolon separator', () => {
      const result = validator.validateCustomer({
        displayName: '',
        email: 'bad',
      });
      const formatted = validator.formatErrors(result);
      expect(formatted).toContain(';');
      expect(formatted).toContain('displayName');
      expect(formatted).toContain('email');
    });
  });

  describe('Edge Cases', () => {
    it('should handle undefined fields gracefully', () => {
      const result = validator.validateCustomer({
        displayName: 'Test',
        email: undefined,
        phoneNumber: undefined,
        website: undefined,
        blocked: undefined,
        balance: undefined,
      });
      expect(result.valid).toBe(true);
    });

    it('should handle empty string vs undefined differently for blocked', () => {
      const emptyBlocked = validator.validateCustomer({
        displayName: 'Test',
        blocked: '',
      });
      expect(emptyBlocked.valid).toBe(true);

      const undefinedBlocked = validator.validateCustomer({
        displayName: 'Test',
        blocked: undefined,
      });
      expect(undefinedBlocked.valid).toBe(true);
    });

    it('should validate complex email addresses', () => {
      const validEmails = [
        'user+tag@example.com',
        'user.name@example.co.uk',
        'user@subdomain.example.org',
      ];

      for (const email of validEmails) {
        const result = validator.validateCustomer({
          displayName: 'Test',
          email,
        });
        expect(result.valid).toBe(true);
      }
    });

    it('should handle very long valid phone numbers', () => {
      const result = validator.validateCustomer({
        displayName: 'Test',
        phoneNumber: '+123456789012345',
      });
      expect(result.valid).toBe(true);
    });

    it('should reject phone numbers exceeding 15 digits', () => {
      const result = validator.validateCustomer({
        displayName: 'Test',
        phoneNumber: '+1234567890123456',
      });
      expect(result.valid).toBe(false);
    });
  });
});
