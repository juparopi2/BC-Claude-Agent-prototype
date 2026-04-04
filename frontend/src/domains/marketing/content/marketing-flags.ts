/**
 * Non-string constants for marketing sections.
 * Booleans, arrays, and config that don't belong in i18n JSON.
 */

/** Roadmap item status values */
export type RoadmapStatus = 'live' | 'beta' | 'development' | 'planned';

/** Security items that show a "Coming Soon" badge */
export const COMING_SOON_FEATURES = {} as const;

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

// --- LP-005: Roadmap ---

export interface RoadmapItemConfig {
  readonly i18nKey: string;
  readonly status: RoadmapStatus;
}

export const ROADMAP_STATUS_COLORS: Record<RoadmapStatus, string> = {
  live: '#10B981',
  beta: '#F59E0B',
  development: '#3B82F6',
  planned: '#6b7280',
} as const;

export const ROADMAP_ITEMS: readonly RoadmapItemConfig[] = [
  // Live
  { i18nKey: 'multiAgent', status: 'live' },
  { i18nKey: 'bcIntegration', status: 'live' },
  { i18nKey: 'knowledgeBase', status: 'live' },
  { i18nKey: 'dataViz', status: 'live' },
  { i18nKey: 'cloudSync', status: 'live' },
  { i18nKey: 'webResearch', status: 'live' },
  // In Development
  { i18nKey: 'granularPermissions', status: 'development' },
  { i18nKey: 'agentMemory', status: 'development' },
  // Planned
  { i18nKey: 'mobileApp', status: 'planned' },
  { i18nKey: 'parallelAgents', status: 'planned' },
  { i18nKey: 'workflows', status: 'planned' },
  { i18nKey: 'customAgents', status: 'planned' },
  { i18nKey: 'environments', status: 'planned' },
  { i18nKey: 'deepResearch', status: 'planned' },
] as const;

// --- LP-005: Waitlist ---

export const WAITLIST_ENABLED = false;
export const WAITLIST_MOCK_COUNT = 247;
