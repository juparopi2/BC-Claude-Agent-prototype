/**
 * Agent Rendered Result Type Guard Tests
 *
 * Tests for the isAgentRenderedResult() type guard function.
 * Validates correct detection of agent-rendered results by _type field.
 *
 * @module @bc-agent/shared/types/__tests__/agent-rendered-result.types
 */

import { describe, it, expect } from 'vitest';
import { isAgentRenderedResult } from '../agent-rendered-result.types';

describe('isAgentRenderedResult', () => {
  describe('Valid agent-rendered results', () => {
    it('returns true for object with _type: "chart_config"', () => {
      const value = { _type: 'chart_config' };
      expect(isAgentRenderedResult(value)).toBe(true);
    });

    it('returns true for object with _type: "citation_result" and additional data', () => {
      const value = { _type: 'citation_result', other: 'data' };
      expect(isAgentRenderedResult(value)).toBe(true);
    });

    it('returns true for object with _type and other properties', () => {
      const value = {
        _type: 'bc_entity',
        entityName: 'Customer',
        data: { id: 1, name: 'Test' },
      };
      expect(isAgentRenderedResult(value)).toBe(true);
    });
  });

  describe('Invalid values', () => {
    it('returns false for null', () => {
      expect(isAgentRenderedResult(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isAgentRenderedResult(undefined)).toBe(false);
    });

    it('returns false for a string', () => {
      expect(isAgentRenderedResult('test string')).toBe(false);
    });

    it('returns false for a number', () => {
      expect(isAgentRenderedResult(42)).toBe(false);
    });

    it('returns false for an empty object', () => {
      expect(isAgentRenderedResult({})).toBe(false);
    });

    it('returns false for object without _type field', () => {
      const value = { name: 'test', data: 'value' };
      expect(isAgentRenderedResult(value)).toBe(false);
    });

    it('returns false for object with non-string _type', () => {
      const value = { _type: 123 };
      expect(isAgentRenderedResult(value)).toBe(false);
    });

    it('returns false for array', () => {
      expect(isAgentRenderedResult([])).toBe(false);
    });

    it('returns false for array with objects', () => {
      const value = [{ _type: 'chart_config' }];
      expect(isAgentRenderedResult(value)).toBe(false);
    });
  });
});
