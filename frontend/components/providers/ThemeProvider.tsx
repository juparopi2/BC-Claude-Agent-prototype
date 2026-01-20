'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import { SETTINGS_STORAGE_KEY, SETTINGS_DEFAULT_THEME } from '@bc-agent/shared';

interface ThemeProviderProps {
  children: React.ReactNode;
}

/**
 * Theme Provider
 *
 * Wraps the application with next-themes for dark/light mode support.
 * Uses the same storage key as the settings system for consistency.
 *
 * @example
 * ```tsx
 * <ThemeProvider>
 *   <App />
 * </ThemeProvider>
 * ```
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme={SETTINGS_DEFAULT_THEME}
      enableSystem
      disableTransitionOnChange
      storageKey={SETTINGS_STORAGE_KEY}
    >
      {children}
    </NextThemesProvider>
  );
}
