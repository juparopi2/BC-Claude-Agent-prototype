/**
 * Onboarding Types
 *
 * Shared types for the onboarding tour and ProTips system.
 *
 * @module @bc-agent/shared/types/onboarding
 */

import type { TourId, TipId } from '../constants/onboarding.constants';

/** Persisted onboarding state (stored in user_settings.preferences) */
export interface OnboardingPreferences {
  completedTours: TourId[];
  dismissedTips: TipId[];
  tipShowCounts: Partial<Record<TipId, number>>;
  completedAt: string | null;
}

/** Default onboarding preferences for new users */
export const DEFAULT_ONBOARDING_PREFERENCES: OnboardingPreferences = {
  completedTours: [],
  dismissedTips: [],
  tipShowCounts: {},
  completedAt: null,
};
