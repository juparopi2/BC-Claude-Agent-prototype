import { describe, it, expect, beforeEach } from 'vitest';
import { WhereClauseBuilder, createWhereClause } from '@/utils/sql/QueryBuilder';

describe('WhereClauseBuilder', () => {
  let builder: WhereClauseBuilder;

  beforeEach(() => {
    builder = createWhereClause();
  });

  describe('NULL Handling', () => {
    it('should use IS NULL for null values', () => {
      const { whereClause, params } = builder
        .addCondition('user_id', 'user-123')
        .addNullableCondition('parent_folder_id', null)
        .build();

      expect(whereClause).toContain('user_id = @user_id_1');
      expect(whereClause).toContain('parent_folder_id IS NULL');
      expect(whereClause).not.toContain('parent_folder_id = @');
      expect(params).toHaveProperty('user_id_1', 'user-123');
      expect(params).not.toHaveProperty('parent_folder_id');
    });

    it('should use IS NULL for undefined values', () => {
      const { whereClause, params } = builder
        .addCondition('user_id', 'user-123')
        .addNullableCondition('parent_folder_id', undefined)
        .build();

      expect(whereClause).toContain('parent_folder_id IS NULL');
      expect(params).not.toHaveProperty('parent_folder_id');
    });

    it('should use parameterized query for non-null values', () => {
      const { whereClause, params } = builder
        .addCondition('user_id', 'user-123')
        .addNullableCondition('parent_folder_id', 'folder-456')
        .build();

      expect(whereClause).toContain('parent_folder_id = @parent_folder_id_2');
      expect(params).toHaveProperty('parent_folder_id_2', 'folder-456');
    });

    it('should throw error if addCondition receives null (required fields)', () => {
      expect(() => {
        builder.addCondition('user_id', null);
      }).toThrow('Required condition cannot be null or undefined');
    });

    it('should throw error if addCondition receives undefined', () => {
      expect(() => {
        builder.addCondition('user_id', undefined);
      }).toThrow('Required condition cannot be null or undefined');
    });
  });

  describe('Multiple Conditions', () => {
    it('should chain multiple conditions with AND', () => {
      const { whereClause, params } = builder
        .addCondition('user_id', 'user-123')
        .addCondition('is_folder', true)
        .addNullableCondition('parent_folder_id', 'folder-456')
        .build();

      expect(whereClause).toContain('user_id = @user_id_1');
      expect(whereClause).toContain('is_folder = @is_folder_2');
      expect(whereClause).toContain('parent_folder_id = @parent_folder_id_3');
      expect(whereClause).toMatch(/AND.*AND/); // Multiple ANDs
      expect(params).toHaveProperty('user_id_1', 'user-123');
      expect(params).toHaveProperty('is_folder_2', true);
      expect(params).toHaveProperty('parent_folder_id_3', 'folder-456');
    });

    it('should handle mix of null and non-null conditions', () => {
      const { whereClause, params } = builder
        .addCondition('user_id', 'user-123')
        .addNullableCondition('parent_folder_id', null)
        .addCondition('is_favorite', false)
        .build();

      expect(whereClause).toContain('user_id = @user_id_1');
      expect(whereClause).toContain('parent_folder_id IS NULL');
      expect(whereClause).toContain('is_favorite = @is_favorite_2');
    });
  });

  describe('Custom Operators', () => {
    it('should support != operator', () => {
      const { whereClause, params } = builder
        .addCondition('status', 'pending', '!=')
        .build();

      expect(whereClause).toContain('status != @status_1');
      expect(params).toHaveProperty('status_1', 'pending');
    });

    it('should support > operator', () => {
      const { whereClause, params } = builder
        .addCondition('size_bytes', 1024, '>')
        .build();

      expect(whereClause).toContain('size_bytes > @size_bytes_1');
      expect(params).toHaveProperty('size_bytes_1', 1024);
    });

    it('should support < operator', () => {
      const { whereClause, params } = builder
        .addCondition('created_at', '2024-01-01', '<')
        .build();

      expect(whereClause).toContain('created_at < @created_at_1');
    });
  });

  describe('IN Clause', () => {
    it('should generate IN clause with multiple values', () => {
      const { whereClause, params } = builder
        .addInCondition('status', ['pending', 'completed', 'failed'])
        .build();

      expect(whereClause).toContain('status IN (@status_1_0, @status_1_1, @status_1_2)');
      expect(params).toHaveProperty('status_1_0', 'pending');
      expect(params).toHaveProperty('status_1_1', 'completed');
      expect(params).toHaveProperty('status_1_2', 'failed');
    });

    it('should handle IN clause with single value', () => {
      const { whereClause, params } = builder
        .addInCondition('status', ['pending'])
        .build();

      expect(whereClause).toContain('status IN (@status_1_0)');
      expect(params).toHaveProperty('status_1_0', 'pending');
    });

    it('should generate 1=0 for empty IN clause (no matches)', () => {
      const { whereClause, params } = builder
        .addInCondition('status', [])
        .build();

      expect(whereClause).toContain('1=0'); // SQL that always returns false
      expect(Object.keys(params)).toHaveLength(0);
    });
  });

  describe('Raw SQL', () => {
    it('should allow raw SQL conditions', () => {
      const { whereClause } = builder
        .addCondition('user_id', 'user-123')
        .addRawCondition('created_at > DATEADD(day, -7, GETUTCDATE())')
        .build();

      expect(whereClause).toContain('user_id = @user_id_1');
      expect(whereClause).toContain('created_at > DATEADD(day, -7, GETUTCDATE())');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty builder (no conditions)', () => {
      const { whereClause, params } = builder.build();

      expect(whereClause).toBe('');
      expect(Object.keys(params)).toHaveLength(0);
    });

    it('should escape special characters in column names', () => {
      const { whereClause } = builder
        .addCondition('[user].[id]', 'user-123')
        .build();

      expect(whereClause).toContain('[user].[id] = @user_id_1');
    });

    it('should generate unique param names with counter', () => {
      const { whereClause, params } = builder
        .addCondition('user_id', 'user-1')
        .addCondition('user_id', 'user-2') // Same column, different value
        .build();

      expect(whereClause).toContain('user_id = @user_id_1');
      expect(whereClause).toContain('user_id = @user_id_2');
      expect(params).toHaveProperty('user_id_1', 'user-1');
      expect(params).toHaveProperty('user_id_2', 'user-2');
    });

    it('should allow method chaining', () => {
      expect(() => {
        builder
          .addCondition('user_id', 'user-123')
          .addNullableCondition('parent_folder_id', null)
          .addInCondition('status', ['pending'])
          .addRawCondition('created_at > GETUTCDATE()')
          .build();
      }).not.toThrow();
    });
  });
});
