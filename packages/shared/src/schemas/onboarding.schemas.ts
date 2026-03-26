/**
 * Onboarding Schemas
 *
 * Zod validation schemas for onboarding preferences.
 *
 * @module @bc-agent/shared/schemas/onboarding
 */

import { z } from 'zod';
import { TOUR_ID, TIP_ID } from '../constants/onboarding.constants';

const tourIdValues = Object.values(TOUR_ID) as [string, ...string[]];
const tipIdValues = Object.values(TIP_ID) as [string, ...string[]];

/** Schema for validating OnboardingPreferences JSON from the database */
export const onboardingPreferencesSchema = z.object({
  completedTours: z.array(z.enum(tourIdValues)),
  dismissedTips: z.array(z.enum(tipIdValues)),
  tipShowCounts: z.record(z.enum(tipIdValues), z.number().int().min(0)).default({}),
  completedAt: z.string().nullable(),
});

export type OnboardingPreferencesInput = z.infer<typeof onboardingPreferencesSchema>;
