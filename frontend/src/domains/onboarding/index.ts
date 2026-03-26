/**
 * Onboarding Domain
 *
 * Tour and ProTips system for user onboarding.
 *
 * @module domains/onboarding
 */

export { useOnboardingStore, getOnboardingStore } from './stores/onboardingStore';
export { OnboardingProvider } from './components/OnboardingProvider';
export { TourTooltip } from './components/TourTooltip';
export { FloatingProTip } from './components/FloatingProTip';
export { useProTipScheduler } from './hooks/useProTipScheduler';
export { TIP_DEFINITIONS } from './constants/tipDefinitions';
export type { TipDefinition } from './constants/tipDefinitions';
export { WELCOME_TOUR_STEPS, CONNECTION_TOUR_STEPS } from './constants/tourSteps';
