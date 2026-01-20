/**
 * User Settings Types
 *
 * Shared types for the user settings domain.
 *
 * @module @bc-agent/shared/types/settings
 */

import type { SETTINGS_THEME, SETTINGS_TAB } from '../constants/settings.constants';

/** Theme preference derived from constants */
export type ThemePreference = (typeof SETTINGS_THEME)[keyof typeof SETTINGS_THEME];

/** Settings tab ID derived from constants */
export type SettingsTabId = (typeof SETTINGS_TAB)[keyof typeof SETTINGS_TAB];

/** Core user settings structure */
export interface UserSettings {
  theme: ThemePreference;
}

/** API response for GET /api/user/settings */
export interface UserSettingsResponse extends UserSettings {
  updatedAt: string | null; // null if using defaults
}

/** API request for PATCH /api/user/settings */
export interface UpdateUserSettingsRequest {
  theme?: ThemePreference;
}

/** Database row representation */
export interface UserSettingsRow {
  id: string;
  user_id: string;
  theme: string;
  preferences: string | null;
  created_at: Date;
  updated_at: Date;
}
