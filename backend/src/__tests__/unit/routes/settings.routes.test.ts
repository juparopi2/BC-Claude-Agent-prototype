/**
 * @module routes/settings.routes.test
 * Unit tests for settings routes.
 * Tests GET and PATCH /api/user/settings endpoints.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';
import settingsRouter from '@/routes/settings';
import { SETTINGS_THEME, SETTINGS_DEFAULT_THEME, ErrorCode } from '@bc-agent/shared';

// Mock authentication middleware
vi.mock('@/domains/auth/middleware/auth-oauth', () => ({
  authenticateMicrosoft: (
    req: express.Request,
    _res: express.Response,
    next: express.NextFunction
  ) => {
    // Simulate authenticated user
    req.userId = 'TEST-USER-123';
    next();
  },
}));

// Mock SettingsService
const mockGetUserSettings = vi.fn();
const mockUpdateUserSettings = vi.fn();

vi.mock('@/domains/settings', () => ({
  getSettingsService: () => ({
    getUserSettings: mockGetUserSettings,
    updateUserSettings: mockUpdateUserSettings,
  }),
}));

// Mock logger
vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('Settings Routes', () => {
  let app: Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/user', settingsRouter);

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('GET /api/user/settings', () => {
    it('should return user settings with defaults when no settings exist', async () => {
      mockGetUserSettings.mockResolvedValue({
        theme: SETTINGS_DEFAULT_THEME,
        updatedAt: null,
      });

      const response = await request(app)
        .get('/api/user/settings')
        .expect(200);

      expect(response.body).toEqual({
        theme: SETTINGS_DEFAULT_THEME,
        updatedAt: null,
      });
      expect(mockGetUserSettings).toHaveBeenCalledWith('TEST-USER-123');
    });

    it('should return user settings when they exist', async () => {
      const mockDate = '2025-01-15T12:00:00.000Z';
      mockGetUserSettings.mockResolvedValue({
        theme: SETTINGS_THEME.DARK,
        updatedAt: mockDate,
      });

      const response = await request(app)
        .get('/api/user/settings')
        .expect(200);

      expect(response.body).toEqual({
        theme: SETTINGS_THEME.DARK,
        updatedAt: mockDate,
      });
    });

    it('should return 500 when service throws error', async () => {
      mockGetUserSettings.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/api/user/settings')
        .expect(500);

      expect(response.body.code).toBe(ErrorCode.INTERNAL_ERROR);
    });

    it('should normalize userId to uppercase', async () => {
      mockGetUserSettings.mockResolvedValue({
        theme: SETTINGS_DEFAULT_THEME,
        updatedAt: null,
      });

      await request(app)
        .get('/api/user/settings')
        .expect(200);

      // The mock sets userId as 'TEST-USER-123', which should be normalized to uppercase
      expect(mockGetUserSettings).toHaveBeenCalledWith('TEST-USER-123');
    });
  });

  describe('PATCH /api/user/settings', () => {
    it('should update theme to dark', async () => {
      const mockDate = '2025-01-15T12:00:00.000Z';
      mockUpdateUserSettings.mockResolvedValue({
        theme: SETTINGS_THEME.DARK,
        updatedAt: mockDate,
      });

      const response = await request(app)
        .patch('/api/user/settings')
        .send({ theme: SETTINGS_THEME.DARK })
        .expect(200);

      expect(response.body).toEqual({
        theme: SETTINGS_THEME.DARK,
        updatedAt: mockDate,
      });
      expect(mockUpdateUserSettings).toHaveBeenCalledWith('TEST-USER-123', {
        theme: SETTINGS_THEME.DARK,
      });
    });

    it('should update theme to light', async () => {
      const mockDate = '2025-01-15T12:00:00.000Z';
      mockUpdateUserSettings.mockResolvedValue({
        theme: SETTINGS_THEME.LIGHT,
        updatedAt: mockDate,
      });

      const response = await request(app)
        .patch('/api/user/settings')
        .send({ theme: SETTINGS_THEME.LIGHT })
        .expect(200);

      expect(response.body.theme).toBe(SETTINGS_THEME.LIGHT);
    });

    it('should update theme to system', async () => {
      const mockDate = '2025-01-15T12:00:00.000Z';
      mockUpdateUserSettings.mockResolvedValue({
        theme: SETTINGS_THEME.SYSTEM,
        updatedAt: mockDate,
      });

      const response = await request(app)
        .patch('/api/user/settings')
        .send({ theme: SETTINGS_THEME.SYSTEM })
        .expect(200);

      expect(response.body.theme).toBe(SETTINGS_THEME.SYSTEM);
    });

    it('should return 400 for invalid theme value', async () => {
      const response = await request(app)
        .patch('/api/user/settings')
        .send({ theme: 'invalid_theme' })
        .expect(400);

      expect(response.body.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(mockUpdateUserSettings).not.toHaveBeenCalled();
    });

    it('should return 400 when no settings provided', async () => {
      const response = await request(app)
        .patch('/api/user/settings')
        .send({})
        .expect(400);

      expect(response.body.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(response.body.message).toBe('No settings to update');
      expect(mockUpdateUserSettings).not.toHaveBeenCalled();
    });

    it('should return 500 when service throws error', async () => {
      mockUpdateUserSettings.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .patch('/api/user/settings')
        .send({ theme: SETTINGS_THEME.DARK })
        .expect(500);

      expect(response.body.code).toBe(ErrorCode.INTERNAL_ERROR);
    });

    it('should ignore extra fields in request body', async () => {
      const mockDate = '2025-01-15T12:00:00.000Z';
      mockUpdateUserSettings.mockResolvedValue({
        theme: SETTINGS_THEME.DARK,
        updatedAt: mockDate,
      });

      await request(app)
        .patch('/api/user/settings')
        .send({
          theme: SETTINGS_THEME.DARK,
          extraField: 'should be ignored',
        })
        .expect(200);

      // Only theme should be passed to the service
      expect(mockUpdateUserSettings).toHaveBeenCalledWith('TEST-USER-123', {
        theme: SETTINGS_THEME.DARK,
      });
    });
  });
});

describe('Settings Routes - Authentication', () => {
  let app: Express;

  beforeEach(() => {
    // Reset mocks to test unauthenticated scenarios
    vi.resetModules();

    // Re-mock auth middleware to simulate no user
    vi.doMock('@/domains/auth/middleware/auth-oauth', () => ({
      authenticateMicrosoft: (
        req: express.Request,
        _res: express.Response,
        next: express.NextFunction
      ) => {
        // Simulate no user (not authenticated or missing userId)
        req.userId = undefined;
        next();
      },
    }));

    vi.doMock('@/domains/settings', () => ({
      getSettingsService: () => ({
        getUserSettings: mockGetUserSettings,
        updateUserSettings: mockUpdateUserSettings,
      }),
    }));

    vi.doMock('@/shared/utils/logger', () => ({
      createChildLogger: () => ({
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      }),
    }));
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should return 401 when userId is missing in GET', async () => {
    // This test requires a fresh import after mocking
    const { default: settingsRouterFresh } = await import('@/routes/settings');

    const appFresh = express();
    appFresh.use(express.json());
    appFresh.use('/api/user', settingsRouterFresh);

    const response = await request(appFresh)
      .get('/api/user/settings')
      .expect(401);

    expect(response.body.code).toBe(ErrorCode.USER_ID_NOT_IN_SESSION);
  });

  it('should return 401 when userId is missing in PATCH', async () => {
    // This test requires a fresh import after mocking
    const { default: settingsRouterFresh } = await import('@/routes/settings');

    const appFresh = express();
    appFresh.use(express.json());
    appFresh.use('/api/user', settingsRouterFresh);

    const response = await request(appFresh)
      .patch('/api/user/settings')
      .send({ theme: SETTINGS_THEME.DARK })
      .expect(401);

    expect(response.body.code).toBe(ErrorCode.USER_ID_NOT_IN_SESSION);
  });
});
