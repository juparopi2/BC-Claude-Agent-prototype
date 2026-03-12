/**
 * SharePoint Types (PRD-111)
 *
 * Type definitions for SharePoint site and document library browsing.
 * These types represent the data shapes returned by the SharePoint
 * browse API endpoints.
 *
 * @module @bc-agent/shared/types/sharepoint
 */

export interface SharePointSite {
  siteId: string;
  displayName: string;
  description: string | null;
  webUrl: string;
  isPersonalSite: boolean;
  lastModifiedAt: string;
}

export interface SharePointLibrary {
  driveId: string;
  displayName: string;
  description: string | null;
  webUrl: string;
  itemCount: number;
  sizeBytes: number;
  isSystemLibrary: boolean;
  siteId: string;
  siteName: string;
}

export interface SharePointSiteListResult {
  sites: SharePointSite[];
  nextPageToken: string | null;
}

export interface SharePointLibraryListResult {
  libraries: SharePointLibrary[];
}
