/**
 * Non-string constants for marketing sections.
 * Booleans, arrays, and config that don't belong in i18n JSON.
 */

/** Roadmap item status values */
export type RoadmapStatus = 'live' | 'beta' | 'development' | 'planned';

/** Security items that show a "Coming Soon" badge */
export const COMING_SOON_FEATURES = {
  permissions: true,
  gdpr: true,
} as const;

/** Whether the pricing section is visible (hidden until prices are confirmed) */
export const PRICING_VISIBLE = false;

/** Which pricing plan is highlighted/recommended */
export const HIGHLIGHTED_PLAN = 'starter' as const;

/** Feature lists per pricing plan — not in i18n because they're structural, not translatable */
export const PLAN_FEATURES = {
  free: [
    'Basic agent access',
    'Limited queries per day',
    '1 GB Knowledge Base storage',
    'Community support',
  ],
  starter: [
    'All 5 specialized agents',
    'Unlimited queries',
    '10 GB Knowledge Base storage',
    'OneDrive & SharePoint sync',
    'Email support',
    'Data visualization',
  ],
  professional: [
    'Everything in Starter',
    'Custom agent builder',
    'Automated workflows',
    'Priority support',
    'Advanced analytics',
    'API access',
    'Organization environments',
    'Granular permissions',
  ],
} as const;
