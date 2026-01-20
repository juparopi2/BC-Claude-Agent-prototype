/**
 * User Settings Store
 *
 * Zustand store for user settings with backend persistence.
 * Uses optimistic updates for immediate UI feedback.
 *
 * @module domains/settings/stores/userSettingsStore
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { ThemePreference, UserSettingsResponse } from '@bc-agent/shared';
import { SETTINGS_DEFAULT_THEME, SETTINGS_API } from '@bc-agent/shared';
import { env } from '@/lib/config/env';

// ============================================
// State Interface
// ============================================

interface UserSettingsState {
  settings: UserSettingsResponse | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  hasFetched: boolean;
}

// ============================================
// Actions Interface
// ============================================

interface UserSettingsActions {
  fetchSettings: () => Promise<void>;
  updateTheme: (theme: ThemePreference) => Promise<void>;
  reset: () => void;
}

type UserSettingsStore = UserSettingsState & UserSettingsActions;

// ============================================
// Initial State
// ============================================

const initialState: UserSettingsState = {
  settings: null,
  isLoading: false,
  isSaving: false,
  error: null,
  hasFetched: false,
};

// ============================================
// API Helpers
// ============================================

async function fetchSettingsFromApi(): Promise<UserSettingsResponse> {
  const response = await fetch(`${env.apiUrl}${SETTINGS_API.BASE}`, {
    method: 'GET',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to fetch settings' }));
    throw new Error(error.message || 'Failed to fetch settings');
  }

  return response.json();
}

async function updateSettingsOnApi(theme: ThemePreference): Promise<UserSettingsResponse> {
  const response = await fetch(`${env.apiUrl}${SETTINGS_API.BASE}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ theme }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to update settings' }));
    throw new Error(error.message || 'Failed to update settings');
  }

  return response.json();
}

// ============================================
// Store Implementation
// ============================================

export const useUserSettingsStore = create<UserSettingsStore>()(
  subscribeWithSelector((set, get) => ({
    ...initialState,

    fetchSettings: async () => {
      // Skip if already fetching or already fetched
      if (get().isLoading) return;

      set({ isLoading: true, error: null });

      try {
        const data = await fetchSettingsFromApi();
        set({
          settings: data,
          isLoading: false,
          hasFetched: true,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to fetch settings';
        set({
          error: message,
          isLoading: false,
          hasFetched: true,
        });
        console.error('[UserSettingsStore] Fetch failed:', message);
      }
    },

    updateTheme: async (theme: ThemePreference) => {
      const previous = get().settings;

      // Optimistic update
      set({
        settings: {
          theme,
          updatedAt: new Date().toISOString(),
        },
        isSaving: true,
        error: null,
      });

      try {
        const data = await updateSettingsOnApi(theme);
        set({
          settings: data,
          isSaving: false,
        });
      } catch (error) {
        // Rollback on error
        const message = error instanceof Error ? error.message : 'Failed to save theme';
        set({
          settings: previous,
          error: message,
          isSaving: false,
        });
        console.error('[UserSettingsStore] Update failed:', message);
      }
    },

    reset: () => set(initialState),
  }))
);

// ============================================
// Selectors
// ============================================

export const selectTheme = (state: UserSettingsStore) =>
  state.settings?.theme ?? SETTINGS_DEFAULT_THEME;

export const selectIsLoading = (state: UserSettingsStore) => state.isLoading;
export const selectIsSaving = (state: UserSettingsStore) => state.isSaving;
export const selectError = (state: UserSettingsStore) => state.error;
export const selectHasFetched = (state: UserSettingsStore) => state.hasFetched;

// ============================================
// Testing Utilities
// ============================================

/**
 * Reset user settings store for testing
 */
export function resetUserSettingsStore(): void {
  useUserSettingsStore.setState(initialState);
}
