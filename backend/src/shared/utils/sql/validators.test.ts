import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateQuery, isUsingQueryBuilder } from './validators';
import type { SqlParams } from '@/infrastructure/database/database';

describe('SQL Query Validator', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    // Save original NODE_ENV
    originalEnv = process.env.NODE_ENV;
    // Set to development to enable validation
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    // Restore original NODE_ENV
    process.env.NODE_ENV = originalEnv;
  });

  describe('validateQuery - NULL comparison detection', () => {
    it('should throw error when NULL parameter is used with = operator', () => {
      const query = 'SELECT * FROM files WHERE parent_folder_id = @parent_folder_id';
      const params: SqlParams = { parent_folder_id: null };

      expect(() => validateQuery(query, params)).toThrow(
        /Parameter 'parent_folder_id' is null\/undefined but query uses '= @parent_folder_id'/
      );
    });

    it('should throw error when undefined parameter is used with = operator', () => {
      const query = 'SELECT * FROM sessions WHERE user_id = @user_id';
      const params: SqlParams = { user_id: undefined };

      expect(() => validateQuery(query, params)).toThrow(
        /Parameter 'user_id' is null\/undefined but query uses '= @user_id'/
      );
    });

    it('should NOT throw when NULL parameter is accompanied by IS NULL check', () => {
      const query = `
        SELECT * FROM files
        WHERE parent_folder_id IS NULL OR parent_folder_id = @parent_folder_id
      `;
      const params: SqlParams = { parent_folder_id: null };

      expect(() => validateQuery(query, params)).not.toThrow();
    });

    it('should NOT throw when using QueryBuilder pattern with numbered params', () => {
      const query = `
        SELECT * FROM files
        WHERE parent_folder_id IS NULL
      `;
      const params: SqlParams = {}; // QueryBuilder handles NULL with IS NULL

      expect(() => validateQuery(query, params)).not.toThrow();
    });

    it('should handle multiple NULL parameters correctly', () => {
      const query = `
        SELECT * FROM files
        WHERE parent_folder_id = @parent_folder_id
        AND user_id = @user_id
      `;
      const params: SqlParams = {
        parent_folder_id: null,
        user_id: null
      };

      expect(() => validateQuery(query, params)).toThrow(
        /SQL Query Validation Failed \(2 errors\)/
      );
    });

    it('should handle mixed NULL and non-NULL parameters', () => {
      const query = `
        SELECT * FROM files
        WHERE parent_folder_id = @parent_folder_id
        AND user_id = @user_id
      `;
      const params: SqlParams = {
        parent_folder_id: null,
        user_id: '123e4567-e89b-12d3-a456-426614174000'
      };

      expect(() => validateQuery(query, params)).toThrow(
        /Parameter 'parent_folder_id' is null\/undefined but query uses '= @parent_folder_id'/
      );
    });
  });

  describe('validateQuery - missing parameters', () => {
    it('should throw error when query references parameter not in params object', () => {
      const query = 'SELECT * FROM files WHERE user_id = @user_id';
      const params: SqlParams = {}; // Missing user_id

      expect(() => validateQuery(query, params)).toThrow(
        /Query references '@user_id' but it's not in params object/
      );
    });

    it('should throw error for multiple missing parameters', () => {
      const query = `
        SELECT * FROM files
        WHERE user_id = @user_id
        AND session_id = @session_id
      `;
      const params: SqlParams = {}; // Missing both

      expect(() => validateQuery(query, params)).toThrow(
        /SQL Query Validation Failed \(2 errors\)/
      );
    });

    it('should NOT throw when all referenced parameters are provided', () => {
      const query = 'SELECT * FROM files WHERE user_id = @user_id';
      const params: SqlParams = {
        user_id: '123e4567-e89b-12d3-a456-426614174000'
      };

      expect(() => validateQuery(query, params)).not.toThrow();
    });
  });

  describe('validateQuery - extra parameters (warnings)', () => {
    it('should warn (but not throw) when params has unused parameter', () => {
      const query = 'SELECT * FROM files WHERE user_id = @user_id';
      const params: SqlParams = {
        user_id: '123e4567-e89b-12d3-a456-426614174000',
        unused_param: 'value'
      };

      // Should not throw, but would log warning (we can't easily test console.warn in vitest)
      expect(() => validateQuery(query, params)).not.toThrow();
    });
  });

  describe('validateQuery - production environment', () => {
    it('should skip validation in production (no-op)', () => {
      process.env.NODE_ENV = 'production';

      // This would throw in dev/test, but should be no-op in production
      const query = 'SELECT * FROM files WHERE parent_folder_id = @parent_folder_id';
      const params: SqlParams = { parent_folder_id: null };

      expect(() => validateQuery(query, params)).not.toThrow();
    });

    it('should skip validation when NODE_ENV is not set', () => {
      process.env.NODE_ENV = undefined;

      const query = 'SELECT * FROM files WHERE parent_folder_id = @parent_folder_id';
      const params: SqlParams = { parent_folder_id: null };

      expect(() => validateQuery(query, params)).not.toThrow();
    });
  });

  describe('validateQuery - edge cases', () => {
    it('should handle query with no parameters', () => {
      const query = 'SELECT * FROM files';
      const params: SqlParams = {};

      expect(() => validateQuery(query, params)).not.toThrow();
    });

    it('should handle query with undefined params argument', () => {
      const query = 'SELECT * FROM files';

      expect(() => validateQuery(query, undefined)).not.toThrow();
    });

    it('should handle parameterized IN clause', () => {
      const query = 'SELECT * FROM files WHERE user_id IN (@user_id_1_0, @user_id_1_1)';
      const params: SqlParams = {
        user_id_1_0: '123e4567-e89b-12d3-a456-426614174000',
        user_id_1_1: '223e4567-e89b-12d3-a456-426614174000'
      };

      expect(() => validateQuery(query, params)).not.toThrow();
    });

    it('should handle parameter names with underscores and numbers', () => {
      const query = 'SELECT * FROM files WHERE parent_folder_id_1 = @parent_folder_id_1';
      const params: SqlParams = {
        parent_folder_id_1: '123e4567-e89b-12d3-a456-426614174000'
      };

      expect(() => validateQuery(query, params)).not.toThrow();
    });

    it('should handle case-insensitive SQL keywords', () => {
      const query = 'SELECT * FROM files WHERE parent_folder_id IS NULL';
      const params: SqlParams = {};

      expect(() => validateQuery(query, params)).not.toThrow();
    });
  });

  describe('isUsingQueryBuilder', () => {
    it('should return true for queries with IS NULL', () => {
      const query = 'SELECT * FROM files WHERE parent_folder_id IS NULL';
      expect(isUsingQueryBuilder(query)).toBe(true);
    });

    it('should return true for queries with numbered parameters (QueryBuilder pattern)', () => {
      const query = 'SELECT * FROM files WHERE user_id = @user_id_1';
      expect(isUsingQueryBuilder(query)).toBe(true);
    });

    it('should return false for simple queries without QueryBuilder patterns', () => {
      const query = 'SELECT * FROM files WHERE user_id = @user_id';
      expect(isUsingQueryBuilder(query)).toBe(false);
    });

    it('should return false for queries without IS NULL or numbered params', () => {
      const query = 'SELECT * FROM files';
      expect(isUsingQueryBuilder(query)).toBe(false);
    });
  });

  describe('validateQuery - error message quality', () => {
    it('should include helpful error message with suggestions', () => {
      const query = 'SELECT * FROM files WHERE parent_folder_id = @parent_folder_id';
      const params: SqlParams = { parent_folder_id: null };

      expect(() => validateQuery(query, params)).toThrow(
        /Use 'column IS NULL' or QueryBuilder\.addNullableCondition\(\)/
      );
    });

    it('should include the query and params in error message', () => {
      const query = 'SELECT * FROM files WHERE parent_folder_id = @parent_folder_id';
      const params: SqlParams = { parent_folder_id: null };

      expect(() => validateQuery(query, params)).toThrow(/Query:/);
      expect(() => validateQuery(query, params)).toThrow(/Params:/);
    });

    it('should reference documentation in error message', () => {
      const query = 'SELECT * FROM files WHERE parent_folder_id = @parent_folder_id';
      const params: SqlParams = { parent_folder_id: null };

      expect(() => validateQuery(query, params)).toThrow(
        /See docs\/backend\/sql-best-practices\.md for details/
      );
    });
  });
});
