/**
 * useUserSettings Hook
 *
 * Hook for components to access and update user settings.
 * Syncs theme changes with next-themes.
 *
 * @module domains/settings/hooks/useUserSettings
 */

'use client';

import { useCallback, useEffect } from 'react';
import { useTheme } from 'next-themes';
import type { ThemePreference } from '@bc-agent/shared';
import {
  useUserSettingsStore,
  selectTheme,
  selectIsLoading,
  selectIsSaving,
  selectError,
  selectHasFetched,
} from '../stores/userSettingsStore';

/**
 * Hook for managing user settings with next-themes integration.
 *
 * @example
 * ```tsx
 * function ThemeSelector() {
 *   const { theme, updateTheme, isLoading } = useUserSettings();
 *
 *   return (
 *     <select
 *       value={theme}
 *       onChange={(e) => updateTheme(e.target.value as ThemePreference)}
 *       disabled={isLoading}
 *     >
 *       <option value="light">Light</option>
 *       <option value="dark">Dark</option>
 *       <option value="system">System</option>
 *     </select>
 *   );
 * }
 * ```
 */
export function useUserSettings() {
  const { setTheme } = useTheme();

  // Store selectors
  const theme = useUserSettingsStore(selectTheme);
  const isLoading = useUserSettingsStore(selectIsLoading);
  const isSaving = useUserSettingsStore(selectIsSaving);
  const error = useUserSettingsStore(selectError);
  const hasFetched = useUserSettingsStore(selectHasFetched);

  // Store actions
  const fetchSettings = useUserSettingsStore((s) => s.fetchSettings);
  const updateThemeAction = useUserSettingsStore((s) => s.updateTheme);

  // Sync with next-themes when theme changes from backend
  useEffect(() => {
    if (hasFetched) {
      setTheme(theme);
    }
  }, [theme, hasFetched, setTheme]);

  // Update theme with immediate visual feedback
  const updateTheme = useCallback(
    async (newTheme: ThemePreference) => {
      // Immediate visual update via next-themes
      setTheme(newTheme);
      // Persist to backend
      await updateThemeAction(newTheme);
    },
    [setTheme, updateThemeAction]
  );

  return {
    theme,
    isLoading,
    isSaving,
    error,
    hasFetched,
    fetchSettings,
    updateTheme,
  };
}
