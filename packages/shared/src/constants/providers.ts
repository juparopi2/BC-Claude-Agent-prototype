/**
 * Provider Constants
 *
 * Centralized constants for external service provider identity, UI display,
 * and API paths. Single source of truth used by both backend and frontend.
 *
 * @module @bc-agent/shared/constants/providers
 */

// ============================================
// PROVIDER IDs (single source of truth)
// ============================================
export const PROVIDER_ID = {
  BUSINESS_CENTRAL: 'business_central',
  ONEDRIVE: 'onedrive',
  SHAREPOINT: 'sharepoint',
  POWER_BI: 'power_bi',
} as const;

export type ProviderId = (typeof PROVIDER_ID)[keyof typeof PROVIDER_ID];

// ============================================
// PROVIDER DISPLAY NAMES
// ============================================
export const PROVIDER_DISPLAY_NAME: Record<ProviderId, string> = {
  [PROVIDER_ID.BUSINESS_CENTRAL]: 'Business Central',
  [PROVIDER_ID.ONEDRIVE]: 'OneDrive',
  [PROVIDER_ID.SHAREPOINT]: 'SharePoint',
  [PROVIDER_ID.POWER_BI]: 'Power BI',
} as const;

// ============================================
// PROVIDER ACCENT COLORS (hex, for UI theming)
// ============================================
export const PROVIDER_ACCENT_COLOR: Record<ProviderId, string> = {
  [PROVIDER_ID.BUSINESS_CENTRAL]: '#0078D4',
  [PROVIDER_ID.ONEDRIVE]: '#0078D4',
  [PROVIDER_ID.SHAREPOINT]: '#038387',
  [PROVIDER_ID.POWER_BI]: '#F2C811',
} as const;

// ============================================
// PROVIDER ICONS (component names for ICON_MAP lookup)
// ============================================
export const PROVIDER_ICON: Record<ProviderId, string> = {
  [PROVIDER_ID.BUSINESS_CENTRAL]: 'Building2',
  [PROVIDER_ID.ONEDRIVE]: 'OneDriveLogo',
  [PROVIDER_ID.SHAREPOINT]: 'SharePointLogo',
  [PROVIDER_ID.POWER_BI]: 'BarChart3',
} as const;

// ============================================
// PROVIDER UI ORDER (for lists and cards)
// ============================================
export const PROVIDER_UI_ORDER: readonly ProviderId[] = [
  PROVIDER_ID.BUSINESS_CENTRAL,
  PROVIDER_ID.ONEDRIVE,
  PROVIDER_ID.SHAREPOINT,
  PROVIDER_ID.POWER_BI,
] as const;

// ============================================
// CONNECTIONS API
// ============================================
export const CONNECTIONS_API = {
  BASE: '/api/connections',
} as const;
