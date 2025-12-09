import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { executeQuery } from '@/config/database';
import type { SqlParams } from '@/config/database';

/**
 * DEMONSTRATION TEST: Shows how the validator catches SQL NULL comparison bugs
 *
 * This test demonstrates the REAL bug that existed in FileService.getFiles()
 * before QueryBuilder was introduced. The validator would have caught this bug
 * at runtime in development.
 */
describe('SQL Validator - Real World Bug Demo', () => {
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

  describe('FileService.getFiles() bug (would have been caught)', () => {
    it('should catch NULL comparison bug from FileService.getFiles()', async () => {
      // This is the ACTUAL buggy query from FileService before QueryBuilder
      const buggyQuery = `
        SELECT
          f.id,
          f.file_name,
          f.file_type,
          f.file_size_bytes,
          f.parent_folder_id,
          f.is_folder,
          f.is_favorite,
          f.created_at,
          f.updated_at
        FROM session_files f
        WHERE f.session_id = @session_id
          AND f.user_id = @user_id
          AND f.parent_folder_id = @parent_folder_id
        ORDER BY f.is_folder DESC, f.file_name ASC
      `;

      const buggyParams: SqlParams = {
        session_id: '123e4567-e89b-12d3-a456-426614174000',
        user_id: '223e4567-e89b-12d3-a456-426614174000',
        parent_folder_id: null // BUG: This will cause "parent_folder_id = NULL" (always FALSE!)
      };

      // The validator should throw and prevent this from reaching the database
      await expect(executeQuery(buggyQuery, buggyParams)).rejects.toThrow(
        /Parameter 'parent_folder_id' is null\/undefined but query uses '= @parent_folder_id'/
      );
    });

    it('should show correct fix using QueryBuilder pattern', async () => {
      // This is the CORRECT query using QueryBuilder pattern
      const correctQuery = `
        SELECT
          f.id,
          f.file_name,
          f.file_type,
          f.file_size_bytes,
          f.parent_folder_id,
          f.is_folder,
          f.is_favorite,
          f.created_at,
          f.updated_at
        FROM session_files f
        WHERE f.session_id = @session_id
          AND f.user_id = @user_id
          AND f.parent_folder_id IS NULL
        ORDER BY f.is_folder DESC, f.file_name ASC
      `;

      const correctParams: SqlParams = {
        session_id: '123e4567-e89b-12d3-a456-426614174000',
        user_id: '223e4567-e89b-12d3-a456-426614174000'
        // No parent_folder_id parameter - using IS NULL directly
      };

      // This would pass validation (but fail at DB level because pool isn't initialized in test)
      // In real code with initialized DB, this would work correctly
      await expect(executeQuery(correctQuery, correctParams)).rejects.toThrow(
        /Database not connected/
      );

      // The important thing is it does NOT throw validation error
    });
  });

  describe('Other common SQL bugs the validator catches', () => {
    it('should catch undefined user_id comparison', async () => {
      const query = 'SELECT * FROM sessions WHERE user_id = @user_id';
      const params: SqlParams = {
        user_id: undefined // BUG: undefined should use IS NULL
      };

      await expect(executeQuery(query, params)).rejects.toThrow(
        /Parameter 'user_id' is null\/undefined but query uses '= @user_id'/
      );
    });

    it('should catch missing parameter', async () => {
      const query = 'SELECT * FROM files WHERE session_id = @session_id AND user_id = @user_id';
      const params: SqlParams = {
        session_id: '123e4567-e89b-12d3-a456-426614174000'
        // Missing user_id parameter!
      };

      await expect(executeQuery(query, params)).rejects.toThrow(
        /Query references '@user_id' but it's not in params object/
      );
    });

    it('should catch typo in parameter name', async () => {
      const query = 'SELECT * FROM files WHERE session_id = @session_id';
      const params: SqlParams = {
        sesion_id: '123e4567-e89b-12d3-a456-426614174000' // Typo: "sesion" instead of "session"
      };

      await expect(executeQuery(query, params)).rejects.toThrow(
        /Query references '@session_id' but it's not in params object/
      );
    });
  });

  describe('Validator does NOT interfere with correct code', () => {
    it('should allow valid queries to pass validation', async () => {
      const query = 'SELECT * FROM files WHERE session_id = @session_id';
      const params: SqlParams = {
        session_id: '123e4567-e89b-12d3-a456-426614174000'
      };

      // Validation passes, but DB query fails because pool not initialized
      await expect(executeQuery(query, params)).rejects.toThrow(
        /Database not connected/
      );
    });

    it('should allow IS NULL pattern with NULL parameter', async () => {
      const query = `
        SELECT * FROM files
        WHERE parent_folder_id IS NULL OR parent_folder_id = @parent_folder_id
      `;
      const params: SqlParams = {
        parent_folder_id: null // OK because query has IS NULL check
      };

      // Validation passes
      await expect(executeQuery(query, params)).rejects.toThrow(
        /Database not connected/
      );
    });
  });

  describe('Production environment behavior', () => {
    it('should skip validation in production (zero overhead)', async () => {
      process.env.NODE_ENV = 'production';

      // This would throw in dev, but is a no-op in production
      const buggyQuery = 'SELECT * FROM files WHERE parent_folder_id = @parent_folder_id';
      const buggyParams: SqlParams = { parent_folder_id: null };

      // In production, validation is skipped, so only DB connection error occurs
      await expect(executeQuery(buggyQuery, buggyParams)).rejects.toThrow(
        /Database not connected/
      );

      // If validation ran, it would throw a different error about NULL comparison
    });
  });
});
