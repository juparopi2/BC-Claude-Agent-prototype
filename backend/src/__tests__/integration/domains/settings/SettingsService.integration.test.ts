/**
 * Settings Service Integration Tests
 *
 * Tests SettingsService against a real database.
 * Validates CRUD operations and data persistence.
 *
 * @module __tests__/integration/domains/settings/SettingsService.integration.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import {
  setupDatabaseForTests,
  createTestSessionFactory,
  TestSessionFactory,
  cleanupAllTestData,
  TEST_TIMEOUTS,
} from '../../helpers';
import { SettingsService, __resetSettingsService, getSettingsService } from '@/domains/settings';
import { executeQuery } from '@/infrastructure/database/database';
import { SETTINGS_THEME, SETTINGS_DEFAULT_THEME } from '@bc-agent/shared';

describe('SettingsService Integration', () => {
  // Setup database connection
  setupDatabaseForTests();

  let factory: TestSessionFactory;
  let service: SettingsService;
  const testUserIds: string[] = [];

  beforeAll(async () => {
    factory = createTestSessionFactory();
    __resetSettingsService();
    service = getSettingsService();
  }, TEST_TIMEOUTS.BEFORE_ALL);

  afterAll(async () => {
    // Clean up test data
    for (const userId of testUserIds) {
      try {
        await executeQuery('DELETE FROM user_settings WHERE user_id = @userId', { userId });
      } catch {
        // Ignore cleanup errors
      }
    }
    await cleanupAllTestData();
    __resetSettingsService();
  }, TEST_TIMEOUTS.AFTER_ALL);

  beforeEach(() => {
    // Get fresh service instance
    __resetSettingsService();
    service = getSettingsService();
  });

  afterEach(async () => {
    // Clean up settings created in each test
    for (const userId of testUserIds) {
      try {
        await executeQuery('DELETE FROM user_settings WHERE user_id = @userId', { userId });
      } catch {
        // Ignore cleanup errors
      }
    }
    testUserIds.length = 0;
  });

  describe('getUserSettings', () => {
    it('should return default settings for new user', async () => {
      // Create a test user
      const user = await factory.createTestUser({ prefix: 'settings_new_' });
      testUserIds.push(user.id);

      const settings = await service.getUserSettings(user.id);

      expect(settings.theme).toBe(SETTINGS_DEFAULT_THEME);
      expect(settings.updatedAt).toBeNull();
    });

    it('should return persisted settings for existing user', async () => {
      // Create a test user
      const user = await factory.createTestUser({ prefix: 'settings_exist_' });
      testUserIds.push(user.id);

      // First, create settings
      await service.updateUserSettings(user.id, { theme: SETTINGS_THEME.DARK });

      // Now fetch them
      const settings = await service.getUserSettings(user.id);

      expect(settings.theme).toBe(SETTINGS_THEME.DARK);
      expect(settings.updatedAt).not.toBeNull();
    });
  });

  describe('updateUserSettings', () => {
    it('should create settings for new user', async () => {
      // Create a test user
      const user = await factory.createTestUser({ prefix: 'settings_create_' });
      testUserIds.push(user.id);

      const result = await service.updateUserSettings(user.id, {
        theme: SETTINGS_THEME.DARK,
      });

      expect(result.theme).toBe(SETTINGS_THEME.DARK);
      expect(result.updatedAt).not.toBeNull();

      // Verify persisted
      const settings = await service.getUserSettings(user.id);
      expect(settings.theme).toBe(SETTINGS_THEME.DARK);
    });

    it('should update existing settings', async () => {
      // Create a test user
      const user = await factory.createTestUser({ prefix: 'settings_update_' });
      testUserIds.push(user.id);

      // Create initial settings
      await service.updateUserSettings(user.id, { theme: SETTINGS_THEME.LIGHT });

      // Update to different theme
      const result = await service.updateUserSettings(user.id, {
        theme: SETTINGS_THEME.DARK,
      });

      expect(result.theme).toBe(SETTINGS_THEME.DARK);

      // Verify persisted
      const settings = await service.getUserSettings(user.id);
      expect(settings.theme).toBe(SETTINGS_THEME.DARK);
    });

    it('should support all theme values', async () => {
      // Create a test user
      const user = await factory.createTestUser({ prefix: 'settings_themes_' });
      testUserIds.push(user.id);

      const themes = [SETTINGS_THEME.LIGHT, SETTINGS_THEME.DARK, SETTINGS_THEME.SYSTEM];

      for (const theme of themes) {
        const result = await service.updateUserSettings(user.id, { theme });
        expect(result.theme).toBe(theme);

        const settings = await service.getUserSettings(user.id);
        expect(settings.theme).toBe(theme);
      }
    });

    it('should update updatedAt timestamp on each update', async () => {
      // Create a test user
      const user = await factory.createTestUser({ prefix: 'settings_timestamp_' });
      testUserIds.push(user.id);

      // First update
      const first = await service.updateUserSettings(user.id, { theme: SETTINGS_THEME.LIGHT });
      const firstTimestamp = new Date(first.updatedAt!).getTime();

      // Small delay to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 100));

      // Second update
      const second = await service.updateUserSettings(user.id, { theme: SETTINGS_THEME.DARK });
      const secondTimestamp = new Date(second.updatedAt!).getTime();

      expect(secondTimestamp).toBeGreaterThanOrEqual(firstTimestamp);
    });
  });

  describe('deleteUserSettings', () => {
    it('should delete existing settings', async () => {
      // Create a test user
      const user = await factory.createTestUser({ prefix: 'settings_delete_' });
      testUserIds.push(user.id);

      // Create settings first
      await service.updateUserSettings(user.id, { theme: SETTINGS_THEME.DARK });

      // Delete
      const deleted = await service.deleteUserSettings(user.id);
      expect(deleted).toBe(true);

      // Verify deleted (should return defaults)
      const settings = await service.getUserSettings(user.id);
      expect(settings.theme).toBe(SETTINGS_DEFAULT_THEME);
      expect(settings.updatedAt).toBeNull();
    });

    it('should return false when no settings to delete', async () => {
      // Create a test user WITHOUT settings
      const user = await factory.createTestUser({ prefix: 'settings_nodelete_' });
      testUserIds.push(user.id);

      const deleted = await service.deleteUserSettings(user.id);
      expect(deleted).toBe(false);
    });
  });

  describe('multi-tenant isolation', () => {
    it('should isolate settings between users', async () => {
      // Create two test users
      const userA = await factory.createTestUser({ prefix: 'settings_iso_a_' });
      const userB = await factory.createTestUser({ prefix: 'settings_iso_b_' });
      testUserIds.push(userA.id, userB.id);

      // Set different themes for each user
      await service.updateUserSettings(userA.id, { theme: SETTINGS_THEME.DARK });
      await service.updateUserSettings(userB.id, { theme: SETTINGS_THEME.LIGHT });

      // Verify isolation
      const settingsA = await service.getUserSettings(userA.id);
      const settingsB = await service.getUserSettings(userB.id);

      expect(settingsA.theme).toBe(SETTINGS_THEME.DARK);
      expect(settingsB.theme).toBe(SETTINGS_THEME.LIGHT);
    });

    it('should not affect other users when updating settings', async () => {
      // Create two test users
      const userA = await factory.createTestUser({ prefix: 'settings_noeffect_a_' });
      const userB = await factory.createTestUser({ prefix: 'settings_noeffect_b_' });
      testUserIds.push(userA.id, userB.id);

      // Set initial settings
      await service.updateUserSettings(userA.id, { theme: SETTINGS_THEME.DARK });
      await service.updateUserSettings(userB.id, { theme: SETTINGS_THEME.LIGHT });

      // Update user A's settings
      await service.updateUserSettings(userA.id, { theme: SETTINGS_THEME.SYSTEM });

      // Verify user B's settings unchanged
      const settingsB = await service.getUserSettings(userB.id);
      expect(settingsB.theme).toBe(SETTINGS_THEME.LIGHT);
    });
  });

  describe('edge cases', () => {
    it('should handle uppercase user ID correctly', async () => {
      // Create a test user
      const user = await factory.createTestUser({ prefix: 'settings_upper_' });
      testUserIds.push(user.id);

      // User IDs should be uppercase per CLAUDE.md
      const uppercaseId = user.id.toUpperCase();

      await service.updateUserSettings(uppercaseId, { theme: SETTINGS_THEME.DARK });
      const settings = await service.getUserSettings(uppercaseId);

      expect(settings.theme).toBe(SETTINGS_THEME.DARK);
    });

    it('should handle concurrent updates gracefully', async () => {
      // Create a test user
      const user = await factory.createTestUser({ prefix: 'settings_concurrent_' });
      testUserIds.push(user.id);

      // Perform concurrent updates
      const updates = await Promise.all([
        service.updateUserSettings(user.id, { theme: SETTINGS_THEME.DARK }),
        service.updateUserSettings(user.id, { theme: SETTINGS_THEME.LIGHT }),
        service.updateUserSettings(user.id, { theme: SETTINGS_THEME.SYSTEM }),
      ]);

      // All should succeed
      expect(updates.every(u => u.updatedAt !== null)).toBe(true);

      // Final state should be one of the themes
      const settings = await service.getUserSettings(user.id);
      expect([SETTINGS_THEME.DARK, SETTINGS_THEME.LIGHT, SETTINGS_THEME.SYSTEM]).toContain(settings.theme);
    });
  });
});
