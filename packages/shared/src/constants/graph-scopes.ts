/**
 * Microsoft Graph API Scope Constants (PRD-101)
 *
 * Scope strings used for Graph API token acquisition.
 * Each connector requests only the scopes it needs.
 *
 * @module @bc-agent/shared/constants
 */

export const GRAPH_API_SCOPES = {
  FILES_READ_ALL: 'Files.Read.All',
  SITES_READ_ALL: 'Sites.Read.All',
} as const;

export type GraphApiScope = (typeof GRAPH_API_SCOPES)[keyof typeof GRAPH_API_SCOPES];
