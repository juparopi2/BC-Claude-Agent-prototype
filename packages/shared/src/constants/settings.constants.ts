/**
 * Settings Domain Constants
 *
 * Single source of truth for all settings-related values.
 *
 * @module @bc-agent/shared/constants/settings
 */

// ============================================
// THEME CONSTANTS
// ============================================

/** Available theme options */
export const SETTINGS_THEME = {
  LIGHT: 'light',
  DARK: 'dark',
  SYSTEM: 'system',
} as const;

/** Default theme when no preference is set */
export const SETTINGS_DEFAULT_THEME = SETTINGS_THEME.SYSTEM;

/** All valid theme values as array (for validation) */
export const SETTINGS_THEME_VALUES = Object.values(SETTINGS_THEME);

// ============================================
// STORAGE KEYS
// ============================================

/** localStorage key for next-themes */
export const SETTINGS_STORAGE_KEY = 'bc-agent-theme';

// ============================================
// API ENDPOINTS
// ============================================

export const SETTINGS_API = {
  BASE: '/api/user/settings',
} as const;

// ============================================
// SETTINGS TAB IDs
// ============================================

export const SETTINGS_TAB = {
  ACCOUNT: 'account',
  APPEARANCE: 'appearance',
  USAGE: 'usage',
  CAPABILITIES: 'capabilities',
} as const;
