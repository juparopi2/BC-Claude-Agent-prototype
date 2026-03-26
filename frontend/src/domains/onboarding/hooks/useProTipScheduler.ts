'use client';

/**
 * useProTipScheduler Hook
 *
 * Periodically checks if a ProTip should be shown. Tips appear one at a time,
 * sporadically, with a cooldown between appearances. The next tip is picked
 * randomly from the eligible set whose target element is visible in the DOM.
 *
 * @module domains/onboarding/hooks/useProTipScheduler
 */

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '@/src/domains/auth/stores/authStore';
import { useOnboardingStore, getOnboardingStore } from '../stores/onboardingStore';
import { TOUR_ID, TIP_ID, type TipId } from '@bc-agent/shared';
import { TIP_DEFINITIONS } from '../constants/tipDefinitions';

const ALL_TIP_IDS = Object.values(TIP_ID) as TipId[];
const COOLDOWN_MS = 120_000;       // 2 minutes between tips
const INITIAL_DELAY_MS = 10_000;   // 10 seconds after page settles
const CHECK_INTERVAL_MS = 30_000;  // check every 30 seconds

export function useProTipScheduler() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const pathname = usePathname();
  const completedTours = useOnboardingStore((s) => s.completedTours);
  const activeTourId = useOnboardingStore((s) => s.activeTourId);

  const welcomeCompleted = completedTours.includes(TOUR_ID.WELCOME);
  const shouldSchedule = isAuthenticated && welcomeCompleted && activeTourId === null;

  useEffect(() => {
    if (!shouldSchedule) return;

    const check = () => {
      const state = getOnboardingStore();

      // Already showing a tip
      if (state.activeTipId) return;

      // Cooldown not passed
      if (Date.now() - state.lastTipShownAt < COOLDOWN_MS) return;

      // Find eligible tips whose target element exists in the DOM
      const eligible = ALL_TIP_IDS.filter((id) => {
        if (!state.canShowTip(id)) return false;
        const def = TIP_DEFINITIONS[id];
        return document.querySelector(def.targetSelector) !== null;
      });

      if (eligible.length === 0) return;

      // Random pick
      const tipId = eligible[Math.floor(Math.random() * eligible.length)];
      state.showTip(tipId);
    };

    const initialTimeout = setTimeout(check, INITIAL_DELAY_MS);
    const interval = setInterval(check, CHECK_INTERVAL_MS);

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, [shouldSchedule, pathname]);
}
