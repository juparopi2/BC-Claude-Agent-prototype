'use client';

import { useEffect } from 'react';
import { useTheme } from 'next-themes';
import { useUserSettings } from '@/src/domains/settings';
import { useAuthStore } from '@/src/domains/auth';
import { SETTINGS_THEME } from '@bc-agent/shared';
import type { ThemePreference } from '@bc-agent/shared';
import { Sun, Moon, Monitor, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const THEME_OPTIONS: Array<{
  value: ThemePreference;
  label: string;
  icon: typeof Sun;
  description: string;
}> = [
  {
    value: SETTINGS_THEME.LIGHT,
    label: 'Light',
    icon: Sun,
    description: 'Always use light mode',
  },
  {
    value: SETTINGS_THEME.DARK,
    label: 'Dark',
    icon: Moon,
    description: 'Always use dark mode',
  },
  {
    value: SETTINGS_THEME.SYSTEM,
    label: 'System',
    icon: Monitor,
    description: 'Follow system preference',
  },
];

/**
 * Appearance Tab
 *
 * Theme selector with visual preview and backend persistence.
 */
export function AppearanceTab() {
  const { resolvedTheme } = useTheme();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const {
    theme,
    isLoading,
    isSaving,
    error,
    hasFetched,
    fetchSettings,
    updateTheme,
  } = useUserSettings();

  // Fetch settings on mount if authenticated and not yet fetched
  useEffect(() => {
    if (isAuthenticated && !hasFetched && !isLoading) {
      fetchSettings();
    }
  }, [isAuthenticated, hasFetched, isLoading, fetchSettings]);

  const handleThemeChange = async (newTheme: ThemePreference) => {
    if (newTheme !== theme && !isSaving) {
      await updateTheme(newTheme);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h3 className="text-lg font-medium">Theme</h3>
        <p className="text-sm text-muted-foreground">
          Select your preferred color theme.
        </p>
      </div>

      {/* Loading state */}
      {isLoading && !hasFetched && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading preferences...</span>
        </div>
      )}

      {/* Theme options */}
      <div className="grid gap-3">
        {THEME_OPTIONS.map((option) => {
          const Icon = option.icon;
          const isSelected = theme === option.value;
          const isCurrentlyActive = resolvedTheme === option.value ||
            (option.value === SETTINGS_THEME.SYSTEM && !resolvedTheme);

          return (
            <button
              key={option.value}
              onClick={() => handleThemeChange(option.value)}
              disabled={isSaving}
              className={cn(
                'flex items-center gap-4 p-4 rounded-lg border transition-colors text-left',
                'hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isSelected
                  ? 'border-primary bg-primary/5'
                  : 'border-border bg-background',
                isSaving && 'opacity-50 cursor-wait'
              )}
            >
              <div
                className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-md',
                  isSelected
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
                )}
              >
                <Icon className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{option.label}</span>
                  {isCurrentlyActive && option.value !== SETTINGS_THEME.SYSTEM && (
                    <span className="text-xs text-muted-foreground">(active)</span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {option.description}
                </p>
              </div>
              {isSelected && isSaving && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </button>
          );
        })}
      </div>

      {/* Error display */}
      {error && (
        <p className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
