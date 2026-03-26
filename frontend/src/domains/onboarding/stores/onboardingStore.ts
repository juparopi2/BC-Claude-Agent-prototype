/**
 * Onboarding Store
 *
 * Zustand store for managing onboarding tours and ProTips state.
 * Persists completed tours and tip show counts to localStorage,
 * with async sync to backend via user settings preferences.
 *
 * @module domains/onboarding/stores/onboardingStore
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TourId, TipId, OnboardingPreferences } from '@bc-agent/shared';
import { TIP_MAX_SHOW_COUNTS, DEFAULT_ONBOARDING_PREFERENCES } from '@bc-agent/shared';
import { env } from '@/lib/config/env';

// ============================================
// State Interface
// ============================================

interface OnboardingState {
  // Tour state (persisted)
  completedTours: TourId[];
  // Tour state (transient)
  activeTourId: TourId | null;
  tourStepIndex: number;

  // ProTip state (persisted)
  dismissedTips: TipId[];
  tipShowCounts: Partial<Record<TipId, number>>;
  // ProTip state (transient)
  activeTipId: TipId | null;

  // Behavioral counters (transient, session-scoped)
  currentSessionMessageCount: number;
  lastTipShownAt: number;  // timestamp of last tip shown
}

// ============================================
// Actions Interface
// ============================================

interface OnboardingActions {
  // Tour actions
  startTour: (tourId: TourId) => void;
  completeTour: (tourId: TourId) => void;
  cancelTour: () => void;
  setTourStepIndex: (index: number) => void;
  isTourCompleted: (tourId: TourId) => boolean;

  // ProTip actions
  showTip: (tipId: TipId) => void;
  dismissTip: (tipId: TipId) => void;
  dismissTipPermanently: (tipId: TipId) => void;
  canShowTip: (tipId: TipId) => boolean;

  // Behavioral tracking
  incrementSessionMessageCount: () => void;
  resetSessionMessageCount: () => void;

  // Backend sync
  hydrateFromBackend: (preferences: OnboardingPreferences) => void;
  syncToBackend: () => Promise<void>;

  // Restart tour (for "Replay Tour" in settings)
  restartTour: (tourId: TourId) => void;

  // Reset
  reset: () => void;
}

// ============================================
// Initial State
// ============================================

const initialState: OnboardingState = {
  completedTours: DEFAULT_ONBOARDING_PREFERENCES.completedTours as TourId[],
  activeTourId: null,
  tourStepIndex: 0,
  dismissedTips: DEFAULT_ONBOARDING_PREFERENCES.dismissedTips as TipId[],
  tipShowCounts: DEFAULT_ONBOARDING_PREFERENCES.tipShowCounts,
  activeTipId: null,
  currentSessionMessageCount: 0,
  lastTipShownAt: 0,
};

// ============================================
// Debounced Sync
// ============================================

let syncTimeout: ReturnType<typeof setTimeout> | null = null;

function debouncedSync(syncFn: () => Promise<void>): void {
  if (syncTimeout) clearTimeout(syncTimeout);
  syncTimeout = setTimeout(() => {
    syncFn().catch(() => {
      // Silently fail — localStorage is the primary store
    });
  }, 2000);
}

// ============================================
// Store
// ============================================

export const useOnboardingStore = create<OnboardingState & OnboardingActions>()(
  persist(
    (set, get) => ({
      ...initialState,

      // --- Tour Actions ---

      startTour: (tourId) => {
        if (get().completedTours.includes(tourId)) return;
        set({ activeTourId: tourId, tourStepIndex: 0 });
      },

      completeTour: (tourId) => {
        const state = get();
        if (state.completedTours.includes(tourId)) return;
        set({
          completedTours: [...state.completedTours, tourId],
          activeTourId: null,
          tourStepIndex: 0,
        });
        debouncedSync(() => get().syncToBackend());
      },

      cancelTour: () => {
        // Skipping a tour counts as completing it — don't show again
        const state = get();
        const tourId = state.activeTourId;
        const updates: Partial<OnboardingState> = {
          activeTourId: null,
          tourStepIndex: 0,
        };
        if (tourId && !state.completedTours.includes(tourId)) {
          updates.completedTours = [...state.completedTours, tourId];
        }
        set(updates);
        debouncedSync(() => get().syncToBackend());
      },

      setTourStepIndex: (index) => {
        set({ tourStepIndex: index });
      },

      isTourCompleted: (tourId) => {
        return get().completedTours.includes(tourId);
      },

      // --- ProTip Actions ---

      showTip: (tipId) => {
        if (!get().canShowTip(tipId)) return;
        set({ activeTipId: tipId, lastTipShownAt: Date.now() });
      },

      dismissTip: (tipId) => {
        const state = get();
        const currentCount = state.tipShowCounts[tipId] ?? 0;
        const newCount = currentCount + 1;
        const maxCount = TIP_MAX_SHOW_COUNTS[tipId];

        const updates: Partial<OnboardingState> = {
          activeTipId: state.activeTipId === tipId ? null : state.activeTipId,
          tipShowCounts: { ...state.tipShowCounts, [tipId]: newCount },
          lastTipShownAt: Date.now(),
        };

        // Permanently dismiss if max count reached
        if (newCount >= maxCount && !state.dismissedTips.includes(tipId)) {
          updates.dismissedTips = [...state.dismissedTips, tipId];
        }

        set(updates);
        debouncedSync(() => get().syncToBackend());
      },

      dismissTipPermanently: (tipId) => {
        const state = get();
        const maxCount = TIP_MAX_SHOW_COUNTS[tipId];
        const updates: Partial<OnboardingState> = {
          activeTipId: state.activeTipId === tipId ? null : state.activeTipId,
          tipShowCounts: { ...state.tipShowCounts, [tipId]: maxCount },
          lastTipShownAt: Date.now(),
        };
        if (!state.dismissedTips.includes(tipId)) {
          updates.dismissedTips = [...state.dismissedTips, tipId];
        }
        set(updates);
        debouncedSync(() => get().syncToBackend());
      },

      canShowTip: (tipId) => {
        const state = get();
        if (state.dismissedTips.includes(tipId)) return false;
        if (state.activeTourId !== null) return false;
        const currentCount = state.tipShowCounts[tipId] ?? 0;
        const maxCount = TIP_MAX_SHOW_COUNTS[tipId];
        return currentCount < maxCount;
      },

      // --- Behavioral Tracking ---

      incrementSessionMessageCount: () => {
        set((state) => ({
          currentSessionMessageCount: state.currentSessionMessageCount + 1,
        }));
      },

      resetSessionMessageCount: () => {
        set({ currentSessionMessageCount: 0 });
      },

      // --- Backend Sync ---

      hydrateFromBackend: (preferences) => {
        const state = get();

        // Merge: union of completed tours
        const mergedTours = Array.from(
          new Set([...state.completedTours, ...preferences.completedTours])
        ) as TourId[];

        // Merge: union of dismissed tips
        const mergedDismissed = Array.from(
          new Set([...state.dismissedTips, ...preferences.dismissedTips])
        ) as TipId[];

        // Merge: max of tip show counts
        const mergedCounts: Partial<Record<TipId, number>> = { ...state.tipShowCounts };
        for (const [tipId, count] of Object.entries(preferences.tipShowCounts)) {
          const current = mergedCounts[tipId as TipId] ?? 0;
          mergedCounts[tipId as TipId] = Math.max(current, count ?? 0);
        }

        set({
          completedTours: mergedTours,
          dismissedTips: mergedDismissed,
          tipShowCounts: mergedCounts,
        });
      },

      syncToBackend: async () => {
        const state = get();
        const preferences: OnboardingPreferences = {
          completedTours: state.completedTours,
          dismissedTips: state.dismissedTips,
          tipShowCounts: state.tipShowCounts,
          completedAt:
            state.completedTours.length > 0 ? new Date().toISOString() : null,
        };

        await fetch(`${env.apiUrl}/api/user/settings`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ preferences }),
        });
      },

      // --- Restart Tour (ignores completedTours check) ---

      restartTour: (tourId) => {
        set({ activeTourId: tourId, tourStepIndex: 0 });
      },

      // --- Reset ---

      reset: () => {
        set(initialState);
      },
    }),
    {
      name: 'bc-agent-onboarding',
      partialize: (state) => ({
        completedTours: state.completedTours,
        dismissedTips: state.dismissedTips,
        tipShowCounts: state.tipShowCounts,
        lastTipShownAt: state.lastTipShownAt,
      }),
    }
  )
);

// ============================================
// Non-React Accessor
// ============================================

/** Get onboarding store state outside React components */
export function getOnboardingStore() {
  return useOnboardingStore.getState();
}
