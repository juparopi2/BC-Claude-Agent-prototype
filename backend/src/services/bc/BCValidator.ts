/**
 * Business Central Validator
 *
 * Business logic validation for Business Central entities.
 * Validates data before creating or updating entities in BC.
 */

import type { BCCustomer, BCVendor, BCItem, BCValidationResult } from '@/types';

/**
 * BC Validator Class
 *
 * Provides validation methods for BC entities with business rules.
 */
export class BCValidator {
  /**
   * Validate Customer Data
   *
   * Business rules:
   * - displayName is required and non-empty
   * - email must be valid format if provided
   * - phoneNumber must be valid format if provided
   * - blocked must be valid value
   *
   * @param data - Customer data to validate
   * @returns Validation result with errors if any
   */
  validateCustomer(data: Partial<BCCustomer>): BCValidationResult {
    const errors: BCValidationResult['errors'] = [];

    // Required: displayName
    if (!data.displayName || data.displayName.trim().length === 0) {
      errors.push({
        field: 'displayName',
        message: 'Customer display name is required',
        code: 'REQUIRED_FIELD',
      });
    }

    // Validate: displayName length
    if (data.displayName && data.displayName.length > 100) {
      errors.push({
        field: 'displayName',
        message: 'Display name must be 100 characters or less',
        code: 'MAX_LENGTH',
      });
    }

    // Validate: email format
    if (data.email && !this.isValidEmail(data.email)) {
      errors.push({
        field: 'email',
        message: 'Invalid email format',
        code: 'INVALID_FORMAT',
      });
    }

    // Validate: phoneNumber format
    if (data.phoneNumber && !this.isValidPhoneNumber(data.phoneNumber)) {
      errors.push({
        field: 'phoneNumber',
        message: 'Invalid phone number format',
        code: 'INVALID_FORMAT',
      });
    }

    // Validate: blocked value
    if (
      data.blocked !== undefined &&
      !['', 'Ship', 'Invoice', 'All'].includes(data.blocked)
    ) {
      errors.push({
        field: 'blocked',
        message: "Blocked must be '', 'Ship', 'Invoice', or 'All'",
        code: 'INVALID_VALUE',
      });
    }

    // Validate: website URL
    if (data.website && !this.isValidUrl(data.website)) {
      errors.push({
        field: 'website',
        message: 'Invalid website URL format',
        code: 'INVALID_FORMAT',
      });
    }

    // Validate: balance (must be non-negative)
    if (data.balance !== undefined && data.balance < 0) {
      errors.push({
        field: 'balance',
        message: 'Balance cannot be negative',
        code: 'INVALID_VALUE',
      });
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate Vendor Data
   *
   * Business rules:
   * - displayName is required and non-empty
   * - email must be valid format if provided
   * - phoneNumber must be valid format if provided
   * - blocked must be valid value
   *
   * @param data - Vendor data to validate
   * @returns Validation result with errors if any
   */
  validateVendor(data: Partial<BCVendor>): BCValidationResult {
    const errors: BCValidationResult['errors'] = [];

    // Required: displayName
    if (!data.displayName || data.displayName.trim().length === 0) {
      errors.push({
        field: 'displayName',
        message: 'Vendor display name is required',
        code: 'REQUIRED_FIELD',
      });
    }

    // Validate: displayName length
    if (data.displayName && data.displayName.length > 100) {
      errors.push({
        field: 'displayName',
        message: 'Display name must be 100 characters or less',
        code: 'MAX_LENGTH',
      });
    }

    // Validate: email format
    if (data.email && !this.isValidEmail(data.email)) {
      errors.push({
        field: 'email',
        message: 'Invalid email format',
        code: 'INVALID_FORMAT',
      });
    }

    // Validate: phoneNumber format
    if (data.phoneNumber && !this.isValidPhoneNumber(data.phoneNumber)) {
      errors.push({
        field: 'phoneNumber',
        message: 'Invalid phone number format',
        code: 'INVALID_FORMAT',
      });
    }

    // Validate: blocked value
    if (
      data.blocked !== undefined &&
      !['', 'Payment', 'All'].includes(data.blocked)
    ) {
      errors.push({
        field: 'blocked',
        message: "Blocked must be '', 'Payment', or 'All'",
        code: 'INVALID_VALUE',
      });
    }

    // Validate: website URL
    if (data.website && !this.isValidUrl(data.website)) {
      errors.push({
        field: 'website',
        message: 'Invalid website URL format',
        code: 'INVALID_FORMAT',
      });
    }

    // Validate: balance (must be non-negative)
    if (data.balance !== undefined && data.balance < 0) {
      errors.push({
        field: 'balance',
        message: 'Balance cannot be negative',
        code: 'INVALID_VALUE',
      });
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate Item Data
   *
   * Business rules:
   * - displayName is required and non-empty
   * - unitPrice must be non-negative
   * - unitCost must be non-negative
   * - inventory must be non-negative
   * - type must be valid value
   *
   * @param data - Item data to validate
   * @returns Validation result with errors if any
   */
  validateItem(data: Partial<BCItem>): BCValidationResult {
    const errors: BCValidationResult['errors'] = [];

    // Required: displayName
    if (!data.displayName || data.displayName.trim().length === 0) {
      errors.push({
        field: 'displayName',
        message: 'Item display name is required',
        code: 'REQUIRED_FIELD',
      });
    }

    // Validate: displayName length
    if (data.displayName && data.displayName.length > 100) {
      errors.push({
        field: 'displayName',
        message: 'Display name must be 100 characters or less',
        code: 'MAX_LENGTH',
      });
    }

    // Validate: type
    if (
      data.type !== undefined &&
      !['Inventory', 'Service', 'Non-Inventory'].includes(data.type)
    ) {
      errors.push({
        field: 'type',
        message: "Type must be 'Inventory', 'Service', or 'Non-Inventory'",
        code: 'INVALID_VALUE',
      });
    }

    // Validate: unitPrice (must be non-negative)
    if (data.unitPrice !== undefined && data.unitPrice < 0) {
      errors.push({
        field: 'unitPrice',
        message: 'Unit price cannot be negative',
        code: 'INVALID_VALUE',
      });
    }

    // Validate: unitCost (must be non-negative)
    if (data.unitCost !== undefined && data.unitCost < 0) {
      errors.push({
        field: 'unitCost',
        message: 'Unit cost cannot be negative',
        code: 'INVALID_VALUE',
      });
    }

    // Validate: inventory (must be non-negative)
    if (data.inventory !== undefined && data.inventory < 0) {
      errors.push({
        field: 'inventory',
        message: 'Inventory cannot be negative',
        code: 'INVALID_VALUE',
      });
    }

    // Business rule: unitPrice should be >= unitCost
    if (
      data.unitPrice !== undefined &&
      data.unitCost !== undefined &&
      data.unitPrice < data.unitCost
    ) {
      errors.push({
        field: 'unitPrice',
        message: 'Unit price should not be less than unit cost',
        code: 'BUSINESS_RULE',
      });
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate Email Format
   *
   * @param email - Email to validate
   * @returns True if valid email format
   */
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Validate Phone Number Format
   *
   * Accepts various formats:
   * - +1234567890
   * - +1 234 567 8900
   * - (123) 456-7890
   * - 123-456-7890
   * - 1234567890
   *
   * @param phone - Phone number to validate
   * @returns True if valid phone format
   */
  private isValidPhoneNumber(phone: string): boolean {
    // Remove common separators
    const cleaned = phone.replace(/[\s\-\(\)\.]/g, '');
    // Check if it's all digits (possibly with + prefix)
    const phoneRegex = /^\+?[\d]{7,15}$/;
    return phoneRegex.test(cleaned);
  }

  /**
   * Validate URL Format
   *
   * @param url - URL to validate
   * @returns True if valid URL format
   */
  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate GUID Format
   *
   * @param guid - GUID to validate
   * @returns True if valid GUID format
   */
  isValidGuid(guid: string): boolean {
    const guidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return guidRegex.test(guid);
  }

  /**
   * Format Validation Errors for Display
   *
   * @param result - Validation result
   * @returns Human-readable error message
   */
  formatErrors(result: BCValidationResult): string {
    if (result.valid) {
      return 'No errors';
    }

    return result.errors
      .map((error) => `${error.field}: ${error.message}`)
      .join('; ');
  }
}

// Singleton instance
let bcValidatorInstance: BCValidator | null = null;

/**
 * Get BC Validator Singleton Instance
 *
 * @returns The shared BCValidator instance
 */
export function getBCValidator(): BCValidator {
  if (!bcValidatorInstance) {
    bcValidatorInstance = new BCValidator();
  }
  return bcValidatorInstance;
}
