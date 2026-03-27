'use client';

/**
 * OnboardingProvider Component
 *
 * Orchestrates all React Joyride v3 tours using the useJoyride hook.
 * Reads active tour state from onboardingStore, subscribes to Joyride
 * events for step navigation and panel/tab CustomEvent dispatching.
 *
 * Auto-starts the welcome tour once user settings have been fetched.
 *
 * @module domains/onboarding/components/OnboardingProvider
 */

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useJoyride, ACTIONS, EVENTS, STATUS, type Step } from 'react-joyride';
import { useOnboardingStore } from '../stores/onboardingStore';
import { useUserSettingsStore } from '@/src/domains/settings/stores/userSettingsStore';
import { useAuthStore } from '@/src/domains/auth/stores/authStore';
import { TOUR_ID } from '@bc-agent/shared';
import { WELCOME_TOUR_STEPS, CONNECTION_TOUR_STEPS } from '../constants/tourSteps';
import { TourTooltip } from './TourTooltip';
import { FloatingProTip } from './FloatingProTip';
import { useProTipScheduler } from '../hooks/useProTipScheduler';
import type { TourId } from '@bc-agent/shared';

// Map each tour ID to its step array
const TOUR_STEPS: Record<TourId, Step[]> = {
  [TOUR_ID.WELCOME]: WELCOME_TOUR_STEPS,
  [TOUR_ID.CONNECTION]: CONNECTION_TOUR_STEPS,
};

// Empty steps placeholder when no tour is active
const EMPTY_STEPS: Step[] = [];

/** Routes where onboarding is allowed (app routes, not public/login) */
const ONBOARDING_ROUTES = ['/new', '/chat'];

function isOnboardingRoute(pathname: string): boolean {
  return ONBOARDING_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}

export function OnboardingProvider() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const pathname = usePathname();
  const onAppRoute = isOnboardingRoute(pathname);

  const activeTourId = useOnboardingStore((s) => s.activeTourId);
  const tourStepIndex = useOnboardingStore((s) => s.tourStepIndex);
  const completedTours = useOnboardingStore((s) => s.completedTours);
  const startTour = useOnboardingStore((s) => s.startTour);
  const completeTour = useOnboardingStore((s) => s.completeTour);
  const setTourStepIndex = useOnboardingStore((s) => s.setTourStepIndex);

  // Ensure settings are fetched (triggers hydration of onboarding state from backend).
  const settingsHasFetched = useUserSettingsStore((s) => s.hasFetched);
  const settingsIsLoading = useUserSettingsStore((s) => s.isLoading);
  const fetchSettings = useUserSettingsStore((s) => s.fetchSettings);

  useEffect(() => {
    if (!isAuthenticated) return;
    if (!settingsHasFetched && !settingsIsLoading) {
      fetchSettings();
    }
  }, [isAuthenticated, settingsHasFetched, settingsIsLoading, fetchSettings]);

  // Auto-start welcome tour only when authenticated, on an app route, and settings hydrated.
  useEffect(() => {
    if (!isAuthenticated || !onAppRoute || !settingsHasFetched) return;
    if (completedTours.length === 0 && activeTourId === null) {
      startTour(TOUR_ID.WELCOME);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, onAppRoute, settingsHasFetched]);

  // Stable ref for activeTourId to avoid stale closures in event handlers
  const activeTourIdRef = useRef(activeTourId);
  activeTourIdRef.current = activeTourId;

  const steps = activeTourId ? (TOUR_STEPS[activeTourId] ?? EMPTY_STEPS) : EMPTY_STEPS;

  const { on, Tour } = useJoyride({
    steps,
    run: activeTourId !== null && isAuthenticated && onAppRoute,
    continuous: true,
    stepIndex: tourStepIndex,
    tooltipComponent: TourTooltip,
    options: {
      buttons: ['back', 'close', 'primary', 'skip'],
      overlayColor: 'rgba(0, 0, 0, 0.5)',
      overlayClickAction: false,
      zIndex: 9998,
    },
  });

  // Stable ref for steps length to detect last step in event handlers
  const stepsLengthRef = useRef(steps.length);
  stepsLengthRef.current = steps.length;

  // Subscribe to Joyride events
  useEffect(() => {
    const unsubBefore = on(EVENTS.STEP_BEFORE, (data) => {
      const stepData = data.step.data as Record<string, unknown> | undefined;
      const ensurePanel = stepData?.ensurePanel as string | undefined;
      const ensureTab = stepData?.ensureTab as string | undefined;

      if (ensurePanel) {
        window.dispatchEvent(
          new CustomEvent('tour:ensure-panel', { detail: { panel: ensurePanel } })
        );
      }

      if (ensureTab) {
        setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent('tour:switch-tab', { detail: { tab: ensureTab } })
          );
        }, 100);
      }
    });

    const unsubAfter = on(EVENTS.STEP_AFTER, (data) => {
      const { action, index } = data;
      const tourId = activeTourIdRef.current;
      const isLastStep = index === stepsLengthRef.current - 1;

      // Last step + Next (Get Started) → complete the tour
      if (isLastStep && action === ACTIONS.NEXT && tourId) {
        completeTour(tourId);
        return;
      }

      // Skip action from any step — use completeTour (same as Get Started)
      if (action === ACTIONS.SKIP && tourId) {
        completeTour(tourId);
        return;
      }

      // Normal navigation
      setTourStepIndex(index + (action === ACTIONS.PREV ? -1 : 1));
    });

    const unsubNotFound = on(EVENTS.TARGET_NOT_FOUND, (data) => {
      setTourStepIndex(data.index + 1);
    });

    const unsubStatus = on(EVENTS.TOUR_STATUS, (data) => {
      const tourId = activeTourIdRef.current;
      if (!tourId) return;
      if (data.status === STATUS.SKIPPED) {
        completeTour(tourId);
      }
    });

    return () => {
      unsubBefore();
      unsubAfter();
      unsubNotFound();
      unsubStatus();
    };
  }, [on, setTourStepIndex, completeTour]);

  // Schedule sporadic ProTips (after welcome tour is complete)
  useProTipScheduler();

  return (
    <>
      {Tour}
      <FloatingProTip />
    </>
  );
}
