/**
 * Settings Service
 *
 * Manages user settings persistence and retrieval.
 *
 * Architecture Pattern:
 * - Singleton + Dependency Injection (like BillingService)
 * - Constructor accepts optional DB pool for testing
 * - Singleton getter function: getSettingsService()
 *
 * @module domains/settings/SettingsService
 */

import type { ConnectionPool } from 'mssql';
import sql from 'mssql';
import { createChildLogger } from '@/shared/utils/logger';
import { getPool } from '@/infrastructure/database/database';
import type {
  UserSettings,
  UserSettingsResponse,
  UserSettingsRow,
} from '@bc-agent/shared';
import { SETTINGS_DEFAULT_THEME } from '@bc-agent/shared';
import type { Logger } from 'pino';

/**
 * Settings Service
 *
 * Implements user settings CRUD operations.
 */
export class SettingsService {
  private pool: ConnectionPool | null;
  private logger: Logger;

  /**
   * Create SettingsService instance
   *
   * @param pool - Optional database pool (for dependency injection in tests)
   */
  constructor(pool?: ConnectionPool) {
    // Use dependency injection for testability
    this.pool = pool || null;

    // Try to get singleton if not provided
    if (!this.pool) {
      try {
        this.pool = getPool();
      } catch {
        // Pool not initialized - will be set to null
      }
    }

    // Initialize child logger with service context
    this.logger = createChildLogger({ service: 'SettingsService' });
  }

  /**
   * Get user settings with defaults applied
   *
   * Returns user's settings if they exist, otherwise returns default settings.
   *
   * @param userId - User ID (UPPERCASE)
   * @returns User settings response
   *
   * @example
   * ```typescript
   * const settings = await settingsService.getUserSettings(userId);
   * console.log(`Theme: ${settings.theme}`);
   * ```
   */
  async getUserSettings(userId: string): Promise<UserSettingsResponse> {
    try {
      if (!this.pool) {
        throw new Error('Database pool not initialized');
      }

      const query = `
        SELECT id, user_id, theme, preferences, created_at, updated_at
        FROM user_settings
        WHERE user_id = @userId
      `;

      const result = await this.pool
        .request()
        .input('userId', sql.UniqueIdentifier, userId)
        .query<UserSettingsRow>(query);

      if (result.recordset.length === 0) {
        // Return defaults if no settings found
        this.logger.debug({ userId }, 'No settings found, returning defaults');
        return {
          theme: SETTINGS_DEFAULT_THEME,
          updatedAt: null,
        };
      }

      const row = result.recordset[0];

      return {
        theme: row.theme as UserSettings['theme'],
        updatedAt: row.updated_at.toISOString(),
      };
    } catch (error) {
      this.logger.error({
        error: error instanceof Error
          ? { message: error.message, stack: error.stack, name: error.name }
          : { value: String(error) },
        userId,
      }, 'Failed to get user settings');
      throw error;
    }
  }

  /**
   * Upsert user settings
   *
   * Creates or updates user settings. Uses SQL MERGE for atomic upsert.
   *
   * @param userId - User ID (UPPERCASE)
   * @param settings - Partial settings to update
   * @returns Updated user settings response
   *
   * @example
   * ```typescript
   * const updated = await settingsService.updateUserSettings(userId, { theme: 'dark' });
   * console.log(`Updated theme: ${updated.theme}`);
   * ```
   */
  async updateUserSettings(
    userId: string,
    settings: Partial<UserSettings>
  ): Promise<UserSettingsResponse> {
    try {
      if (!this.pool) {
        throw new Error('Database pool not initialized');
      }

      this.logger.info({ userId, settings }, 'Updating user settings');

      // Use MERGE for atomic upsert
      const query = `
        MERGE user_settings AS target
        USING (SELECT @userId AS user_id) AS source
        ON target.user_id = source.user_id
        WHEN MATCHED THEN
          UPDATE SET
            theme = COALESCE(@theme, target.theme),
            updated_at = GETUTCDATE()
        WHEN NOT MATCHED THEN
          INSERT (id, user_id, theme, created_at, updated_at)
          VALUES (NEWID(), @userId, COALESCE(@theme, '${SETTINGS_DEFAULT_THEME}'), GETUTCDATE(), GETUTCDATE())
        OUTPUT inserted.id, inserted.user_id, inserted.theme, inserted.preferences, inserted.created_at, inserted.updated_at;
      `;

      const result = await this.pool
        .request()
        .input('userId', sql.UniqueIdentifier, userId)
        .input('theme', sql.NVarChar(20), settings.theme ?? null)
        .query<UserSettingsRow>(query);

      const row = result.recordset[0];

      if (!row) {
        throw new Error('Failed to upsert user settings');
      }

      this.logger.info({ userId, theme: row.theme }, 'User settings updated');

      return {
        theme: row.theme as UserSettings['theme'],
        updatedAt: row.updated_at.toISOString(),
      };
    } catch (error) {
      this.logger.error({
        error: error instanceof Error
          ? { message: error.message, stack: error.stack, name: error.name }
          : { value: String(error) },
        userId,
        settings,
      }, 'Failed to update user settings');
      throw error;
    }
  }

  /**
   * Delete user settings
   *
   * Removes user settings from the database. Used for GDPR compliance
   * and account cleanup. Note: The FK with CASCADE will also delete
   * settings when the user is deleted.
   *
   * @param userId - User ID (UPPERCASE)
   * @returns true if settings were deleted, false if no settings existed
   */
  async deleteUserSettings(userId: string): Promise<boolean> {
    try {
      if (!this.pool) {
        throw new Error('Database pool not initialized');
      }

      this.logger.info({ userId }, 'Deleting user settings');

      const query = `
        DELETE FROM user_settings
        WHERE user_id = @userId
      `;

      const result = await this.pool
        .request()
        .input('userId', sql.UniqueIdentifier, userId)
        .query(query);

      const deleted = (result.rowsAffected[0] ?? 0) > 0;

      if (deleted) {
        this.logger.info({ userId }, 'User settings deleted');
      } else {
        this.logger.debug({ userId }, 'No settings to delete');
      }

      return deleted;
    } catch (error) {
      this.logger.error({
        error: error instanceof Error
          ? { message: error.message, stack: error.stack, name: error.name }
          : { value: String(error) },
        userId,
      }, 'Failed to delete user settings');
      throw error;
    }
  }
}

// =====================================================================
// SINGLETON PATTERN
// =====================================================================

/**
 * Singleton instance (lazily initialized)
 */
let settingsServiceInstance: SettingsService | null = null;

/**
 * Get SettingsService singleton instance
 *
 * Factory function that creates or returns the singleton instance.
 * Supports dependency injection for testing.
 *
 * @param pool - Optional database pool (for testing)
 * @returns SettingsService instance
 *
 * @example
 * // Production usage
 * const service = getSettingsService();
 * await service.getUserSettings(userId);
 *
 * @example
 * // Test usage with mock
 * const mockPool = createMockPool();
 * const service = getSettingsService(mockPool);
 */
export function getSettingsService(pool?: ConnectionPool): SettingsService {
  // If pool provided, always create new instance (for testing)
  if (pool) {
    return new SettingsService(pool);
  }

  // Otherwise, use singleton
  if (!settingsServiceInstance) {
    settingsServiceInstance = new SettingsService();
  }

  return settingsServiceInstance;
}

/**
 * Reset SettingsService singleton for testing
 *
 * @internal Only for tests - DO NOT use in production
 */
export function __resetSettingsService(): void {
  settingsServiceInstance = null;
}
