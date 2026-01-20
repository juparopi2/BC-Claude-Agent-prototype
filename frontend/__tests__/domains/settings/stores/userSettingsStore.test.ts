/**
 * User Settings Store Tests
 *
 * Unit tests for the userSettingsStore with MSW mocks.
 *
 * @module __tests__/domains/settings/stores/userSettingsStore.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from '@testing-library/react';
import {
  useUserSettingsStore,
  selectTheme,
  selectIsLoading,
  selectIsSaving,
  selectError,
  selectHasFetched,
  resetUserSettingsStore,
} from '@/src/domains/settings';
import { SETTINGS_THEME, SETTINGS_DEFAULT_THEME } from '@bc-agent/shared';
import { server } from '../../../../vitest.setup';
import { errorHandlers, mockUserSettings } from '../../../mocks/handlers';

describe('userSettingsStore', () => {
  beforeEach(() => {
    // Reset store to initial state
    act(() => {
      resetUserSettingsStore();
    });
  });

  afterEach(() => {
    act(() => {
      resetUserSettingsStore();
    });
  });

  describe('initial state', () => {
    it('should have correct initial state', () => {
      const state = useUserSettingsStore.getState();

      expect(state.settings).toBeNull();
      expect(state.isLoading).toBe(false);
      expect(state.isSaving).toBe(false);
      expect(state.error).toBeNull();
      expect(state.hasFetched).toBe(false);
    });
  });

  describe('fetchSettings', () => {
    it('should fetch settings and update state', async () => {
      await act(async () => {
        await useUserSettingsStore.getState().fetchSettings();
      });

      const state = useUserSettingsStore.getState();
      expect(state.settings).toEqual(mockUserSettings);
      expect(state.isLoading).toBe(false);
      expect(state.hasFetched).toBe(true);
      expect(state.error).toBeNull();
    });

    it('should not fetch twice if already fetching', async () => {
      // Start first fetch
      const firstFetch = act(async () => {
        await useUserSettingsStore.getState().fetchSettings();
      });

      // Attempt second fetch while first is in progress
      const secondFetch = act(async () => {
        await useUserSettingsStore.getState().fetchSettings();
      });

      await Promise.all([firstFetch, secondFetch]);

      // Should only complete once
      expect(useUserSettingsStore.getState().hasFetched).toBe(true);
    });

    it('should handle fetch error', async () => {
      server.use(errorHandlers.settingsServerError);

      await act(async () => {
        await useUserSettingsStore.getState().fetchSettings();
      });

      const state = useUserSettingsStore.getState();
      expect(state.settings).toBeNull();
      expect(state.isLoading).toBe(false);
      expect(state.hasFetched).toBe(true);
      expect(state.error).toBeTruthy();
    });
  });

  describe('updateTheme', () => {
    it('should update theme optimistically', async () => {
      // First fetch settings
      await act(async () => {
        await useUserSettingsStore.getState().fetchSettings();
      });

      // Update to dark theme
      await act(async () => {
        await useUserSettingsStore.getState().updateTheme(SETTINGS_THEME.DARK);
      });

      const state = useUserSettingsStore.getState();
      expect(state.settings?.theme).toBe(SETTINGS_THEME.DARK);
      expect(state.isSaving).toBe(false);
    });

    it('should update theme to light', async () => {
      await act(async () => {
        await useUserSettingsStore.getState().fetchSettings();
      });

      await act(async () => {
        await useUserSettingsStore.getState().updateTheme(SETTINGS_THEME.LIGHT);
      });

      const state = useUserSettingsStore.getState();
      expect(state.settings?.theme).toBe(SETTINGS_THEME.LIGHT);
    });

    it('should update theme to system', async () => {
      await act(async () => {
        await useUserSettingsStore.getState().fetchSettings();
      });

      await act(async () => {
        await useUserSettingsStore.getState().updateTheme(SETTINGS_THEME.SYSTEM);
      });

      const state = useUserSettingsStore.getState();
      expect(state.settings?.theme).toBe(SETTINGS_THEME.SYSTEM);
    });

    it('should rollback on update error', async () => {
      // First fetch settings
      await act(async () => {
        await useUserSettingsStore.getState().fetchSettings();
      });

      const originalTheme = useUserSettingsStore.getState().settings?.theme;

      // Setup error handler for the update
      server.use(errorHandlers.settingsUpdateError);

      // Attempt to update
      await act(async () => {
        await useUserSettingsStore.getState().updateTheme(SETTINGS_THEME.DARK);
      });

      const state = useUserSettingsStore.getState();
      expect(state.settings?.theme).toBe(originalTheme);
      expect(state.error).toBeTruthy();
      expect(state.isSaving).toBe(false);
    });
  });

  describe('selectors', () => {
    it('selectTheme should return default when no settings', () => {
      const theme = selectTheme(useUserSettingsStore.getState());
      expect(theme).toBe(SETTINGS_DEFAULT_THEME);
    });

    it('selectTheme should return current theme', async () => {
      await act(async () => {
        await useUserSettingsStore.getState().fetchSettings();
      });

      const theme = selectTheme(useUserSettingsStore.getState());
      expect(theme).toBe(mockUserSettings.theme);
    });

    it('selectIsLoading should reflect loading state', async () => {
      expect(selectIsLoading(useUserSettingsStore.getState())).toBe(false);

      const fetchPromise = act(async () => {
        await useUserSettingsStore.getState().fetchSettings();
      });

      // During fetch, isLoading might be true (depending on timing)
      await fetchPromise;

      expect(selectIsLoading(useUserSettingsStore.getState())).toBe(false);
    });

    it('selectIsSaving should reflect saving state', async () => {
      await act(async () => {
        await useUserSettingsStore.getState().fetchSettings();
      });

      expect(selectIsSaving(useUserSettingsStore.getState())).toBe(false);

      // After update completes
      await act(async () => {
        await useUserSettingsStore.getState().updateTheme(SETTINGS_THEME.DARK);
      });

      expect(selectIsSaving(useUserSettingsStore.getState())).toBe(false);
    });

    it('selectError should return error message', async () => {
      server.use(errorHandlers.settingsServerError);

      await act(async () => {
        await useUserSettingsStore.getState().fetchSettings();
      });

      const error = selectError(useUserSettingsStore.getState());
      expect(error).toBeTruthy();
    });

    it('selectHasFetched should indicate fetch completion', async () => {
      expect(selectHasFetched(useUserSettingsStore.getState())).toBe(false);

      await act(async () => {
        await useUserSettingsStore.getState().fetchSettings();
      });

      expect(selectHasFetched(useUserSettingsStore.getState())).toBe(true);
    });
  });

  describe('reset', () => {
    it('should reset store to initial state', async () => {
      // First fetch and modify
      await act(async () => {
        await useUserSettingsStore.getState().fetchSettings();
      });

      // Reset
      act(() => {
        useUserSettingsStore.getState().reset();
      });

      const state = useUserSettingsStore.getState();
      expect(state.settings).toBeNull();
      expect(state.isLoading).toBe(false);
      expect(state.isSaving).toBe(false);
      expect(state.error).toBeNull();
      expect(state.hasFetched).toBe(false);
    });
  });
});
