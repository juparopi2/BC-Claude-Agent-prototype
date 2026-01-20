/**
 * @module settings/SettingsService.test
 * Unit tests for SettingsService.
 * Tests user settings CRUD operations with mocked database.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SettingsService, __resetSettingsService } from '@/domains/settings';
import { SETTINGS_DEFAULT_THEME, SETTINGS_THEME } from '@bc-agent/shared';

// Mock the database module
vi.mock('@/infrastructure/database/database', () => ({
  getPool: vi.fn(),
  executeQuery: vi.fn(),
}));

// Mock logger
vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// Create mock pool with request builder
function createMockPool(mockResult: unknown) {
  return {
    request: () => ({
      input: vi.fn().mockReturnThis(),
      query: vi.fn().mockResolvedValue(mockResult),
    }),
  };
}

describe('SettingsService', () => {
  let service: SettingsService;

  beforeEach(() => {
    __resetSettingsService();
    vi.clearAllMocks();
  });

  afterEach(() => {
    __resetSettingsService();
  });

  describe('getUserSettings', () => {
    it('should return default settings when no settings found', async () => {
      const mockPool = createMockPool({ recordset: [] });
      service = new SettingsService(mockPool as any);

      const result = await service.getUserSettings('USER-123');

      expect(result.theme).toBe(SETTINGS_DEFAULT_THEME);
      expect(result.updatedAt).toBeNull();
    });

    it('should return user settings when found', async () => {
      const mockDate = new Date('2025-01-15T12:00:00.000Z');
      const mockPool = createMockPool({
        recordset: [{
          id: 'SETTINGS-123',
          user_id: 'USER-123',
          theme: SETTINGS_THEME.DARK,
          preferences: null,
          created_at: mockDate,
          updated_at: mockDate,
        }],
      });
      service = new SettingsService(mockPool as any);

      const result = await service.getUserSettings('USER-123');

      expect(result.theme).toBe(SETTINGS_THEME.DARK);
      expect(result.updatedAt).toBe(mockDate.toISOString());
    });

    it('should throw error when database pool not initialized', async () => {
      service = new SettingsService(null as any);

      await expect(service.getUserSettings('USER-123')).rejects.toThrow('Database pool not initialized');
    });

    it('should handle light theme correctly', async () => {
      const mockDate = new Date();
      const mockPool = createMockPool({
        recordset: [{
          id: 'SETTINGS-123',
          user_id: 'USER-123',
          theme: SETTINGS_THEME.LIGHT,
          preferences: null,
          created_at: mockDate,
          updated_at: mockDate,
        }],
      });
      service = new SettingsService(mockPool as any);

      const result = await service.getUserSettings('USER-123');

      expect(result.theme).toBe(SETTINGS_THEME.LIGHT);
    });

    it('should handle system theme correctly', async () => {
      const mockDate = new Date();
      const mockPool = createMockPool({
        recordset: [{
          id: 'SETTINGS-123',
          user_id: 'USER-123',
          theme: SETTINGS_THEME.SYSTEM,
          preferences: null,
          created_at: mockDate,
          updated_at: mockDate,
        }],
      });
      service = new SettingsService(mockPool as any);

      const result = await service.getUserSettings('USER-123');

      expect(result.theme).toBe(SETTINGS_THEME.SYSTEM);
    });
  });

  describe('updateUserSettings', () => {
    it('should update theme to dark', async () => {
      const mockDate = new Date('2025-01-15T12:00:00.000Z');
      const mockPool = createMockPool({
        recordset: [{
          id: 'SETTINGS-123',
          user_id: 'USER-123',
          theme: SETTINGS_THEME.DARK,
          preferences: null,
          created_at: mockDate,
          updated_at: mockDate,
        }],
      });
      service = new SettingsService(mockPool as any);

      const result = await service.updateUserSettings('USER-123', {
        theme: SETTINGS_THEME.DARK,
      });

      expect(result.theme).toBe(SETTINGS_THEME.DARK);
      expect(result.updatedAt).toBe(mockDate.toISOString());
    });

    it('should update theme to light', async () => {
      const mockDate = new Date('2025-01-15T12:00:00.000Z');
      const mockPool = createMockPool({
        recordset: [{
          id: 'SETTINGS-123',
          user_id: 'USER-123',
          theme: SETTINGS_THEME.LIGHT,
          preferences: null,
          created_at: mockDate,
          updated_at: mockDate,
        }],
      });
      service = new SettingsService(mockPool as any);

      const result = await service.updateUserSettings('USER-123', {
        theme: SETTINGS_THEME.LIGHT,
      });

      expect(result.theme).toBe(SETTINGS_THEME.LIGHT);
    });

    it('should throw error when database pool not initialized', async () => {
      service = new SettingsService(null as any);

      await expect(
        service.updateUserSettings('USER-123', { theme: SETTINGS_THEME.DARK })
      ).rejects.toThrow('Database pool not initialized');
    });

    it('should throw error when upsert fails', async () => {
      const mockPool = createMockPool({ recordset: [] });
      service = new SettingsService(mockPool as any);

      await expect(
        service.updateUserSettings('USER-123', { theme: SETTINGS_THEME.DARK })
      ).rejects.toThrow('Failed to upsert user settings');
    });
  });

  describe('deleteUserSettings', () => {
    it('should return true when settings deleted', async () => {
      const mockPool = {
        request: () => ({
          input: vi.fn().mockReturnThis(),
          query: vi.fn().mockResolvedValue({ rowsAffected: [1] }),
        }),
      };
      service = new SettingsService(mockPool as any);

      const result = await service.deleteUserSettings('USER-123');

      expect(result).toBe(true);
    });

    it('should return false when no settings to delete', async () => {
      const mockPool = {
        request: () => ({
          input: vi.fn().mockReturnThis(),
          query: vi.fn().mockResolvedValue({ rowsAffected: [0] }),
        }),
      };
      service = new SettingsService(mockPool as any);

      const result = await service.deleteUserSettings('USER-123');

      expect(result).toBe(false);
    });

    it('should throw error when database pool not initialized', async () => {
      service = new SettingsService(null as any);

      await expect(service.deleteUserSettings('USER-123')).rejects.toThrow(
        'Database pool not initialized'
      );
    });
  });
});
