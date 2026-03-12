/**
 * SharePointService (PRD-111)
 *
 * Wraps Microsoft Graph API operations for SharePoint sites and document
 * libraries, providing strongly-typed methods for site discovery, library
 * listing, folder browsing, and delta queries.
 *
 * Design:
 *  - Each method accepts a connectionId for token acquisition.
 *  - Unlike OneDriveService, driveId is passed explicitly (SharePoint has
 *    multiple drives per site — there is no single "connection drive").
 *  - Token acquisition is delegated to GraphTokenManager.
 *  - HTTP calls are delegated to GraphHttpClient.
 *  - Singleton via getSharePointService() / __resetSharePointService().
 *
 * @module services/connectors/sharepoint
 */

import { createChildLogger } from '@/shared/utils/logger';
import { getGraphTokenManager } from '../GraphTokenManager';
import { getGraphHttpClient } from '../onedrive/GraphHttpClient';
import type {
  SharePointSite,
  SharePointLibrary,
  SharePointSiteListResult,
  SharePointLibraryListResult,
  ExternalFileItem,
  FolderListResult,
  DeltaQueryResult,
  DeltaChange,
} from '@bc-agent/shared';

const logger = createChildLogger({ service: 'SharePointService' });

// ============================================================================
// System library detection
// ============================================================================

const SYSTEM_LIBRARY_NAMES = new Set([
  'Site Assets', 'Style Library', 'appdata',
  'Preservation Hold Library', 'Form Templates',
  'Site Pages', 'SiteAssets',
]);

function isSystemLibrary(drive: Record<string, unknown>): boolean {
  return drive.system != null || SYSTEM_LIBRARY_NAMES.has(String(drive.name));
}

// ============================================================================
// Internal mapping helpers
// ============================================================================

/**
 * Map a raw Graph API driveItem to the strongly-typed ExternalFileItem DTO.
 * This duplicates OneDriveService.mapDriveItem — the identical Graph response
 * shape means the mapping is the same for both providers.
 */
function mapDriveItem(item: Record<string, unknown>): ExternalFileItem {
  return {
    id: String(item.id),
    name: item.name != null ? String(item.name) : '',
    isFolder: !!item.folder,
    mimeType: item.file
      ? ((item.file as Record<string, unknown>).mimeType != null
          ? String((item.file as Record<string, unknown>).mimeType)
          : null)
      : null,
    sizeBytes: Number(item.size ?? 0),
    lastModifiedAt: String(item.lastModifiedDateTime ?? ''),
    webUrl: String(item.webUrl ?? ''),
    eTag: item.eTag ? String(item.eTag) : null,
    parentId: item.parentReference
      ? ((item.parentReference as Record<string, unknown>).id != null
          ? String((item.parentReference as Record<string, unknown>).id)
          : null)
      : null,
    parentPath: item.parentReference
      ? ((item.parentReference as Record<string, unknown>).path != null
          ? String((item.parentReference as Record<string, unknown>).path)
          : null)
      : null,
    childCount: item.folder
      ? Number((item.folder as Record<string, unknown>).childCount ?? 0)
      : null,
  };
}

// ============================================================================
// SharePointService
// ============================================================================

export class SharePointService {
  /**
   * Discover SharePoint sites the user has access to.
   * Calls GET /sites?search={search} or GET /sites?search=* (returns all accessible sites).
   * Filters out personal OneDrive sites.
   */
  async discoverSites(
    connectionId: string,
    search?: string,
    pageToken?: string
  ): Promise<SharePointSiteListResult> {
    logger.info({ connectionId, search, hasPageToken: !!pageToken }, 'Discovering SharePoint sites');

    const token = await getGraphTokenManager().getValidToken(connectionId);

    let raw: Record<string, unknown>;

    if (pageToken) {
      // pageToken is a full @odata.nextLink URL — use absolute
      raw = await getGraphHttpClient().get<Record<string, unknown>>(pageToken, token, true);
    } else {
      const path = search
        ? `/sites?search=${encodeURIComponent(search)}&$top=50`
        : '/sites?search=*&$top=50';
      raw = await getGraphHttpClient().get<Record<string, unknown>>(path, token);
    }

    return this._parseSiteResponse(raw, connectionId);
  }

  /**
   * Get sites the user explicitly follows.
   * Calls GET /me/followedSites
   */
  async getFollowedSites(connectionId: string): Promise<SharePointSiteListResult> {
    logger.info({ connectionId }, 'Fetching followed sites');

    const token = await getGraphTokenManager().getValidToken(connectionId);
    const raw = await getGraphHttpClient().get<Record<string, unknown>>(
      '/me/followedSites',
      token
    );

    return this._parseSiteResponse(raw, connectionId);
  }

  /**
   * List document libraries for a SharePoint site.
   * Calls GET /sites/{siteId}/drives
   * Filters system libraries unless includeSystem is true.
   */
  async getLibraries(
    connectionId: string,
    siteId: string,
    includeSystem: boolean = false
  ): Promise<SharePointLibraryListResult> {
    logger.info({ connectionId, siteId, includeSystem }, 'Listing site libraries');

    const token = await getGraphTokenManager().getValidToken(connectionId);
    const raw = await getGraphHttpClient().get<Record<string, unknown>>(
      `/sites/${siteId}/drives`,
      token
    );

    const rawDrives = Array.isArray(raw.value) ? (raw.value as Record<string, unknown>[]) : [];

    // Fetch site display name from the first drive's owner or fall back to siteId
    const firstDrive = rawDrives[0];
    const siteName = firstDrive != null
      ? this._extractSiteName(firstDrive)
      : siteId;

    const libraries: SharePointLibrary[] = rawDrives
      .filter(drive => includeSystem || !isSystemLibrary(drive))
      .map((drive): SharePointLibrary => {
        const quota = drive.quota as Record<string, unknown> | undefined;
        return {
          driveId: String(drive.id),
          displayName: String(drive.name ?? ''),
          description: drive.description != null ? String(drive.description) : null,
          webUrl: String(drive.webUrl ?? ''),
          itemCount: 0,
          sizeBytes: Number(quota?.used ?? 0),
          isSystemLibrary: isSystemLibrary(drive),
          siteId,
          siteName,
        };
      });

    logger.info(
      { connectionId, siteId, totalDrives: rawDrives.length, filteredLibraries: libraries.length },
      'Libraries listed'
    );

    return { libraries };
  }

  /**
   * Browse files/folders within a SharePoint document library.
   * Calls GET /drives/{driveId}/root/children or /drives/{driveId}/items/{folderId}/children
   */
  async browseFolder(
    connectionId: string,
    driveId: string,
    folderId?: string,
    pageToken?: string
  ): Promise<FolderListResult> {
    logger.info({ connectionId, driveId, folderId, hasPageToken: !!pageToken }, 'Browsing SharePoint folder');

    const token = await getGraphTokenManager().getValidToken(connectionId);

    const folderSegment = folderId
      ? `/drives/${driveId}/items/${folderId}/children`
      : `/drives/${driveId}/root/children`;

    const path = pageToken
      ? `${folderSegment}?$skiptoken=${encodeURIComponent(pageToken)}`
      : folderSegment;

    const raw = await getGraphHttpClient().get<Record<string, unknown>>(path, token);

    const rawItems = Array.isArray(raw.value) ? (raw.value as Record<string, unknown>[]) : [];
    const items = rawItems.map(mapDriveItem);

    let nextPageToken: string | null = null;
    const nextLink = raw['@odata.nextLink'];
    if (typeof nextLink === 'string') {
      const url = new URL(nextLink);
      const skiptoken = url.searchParams.get('$skiptoken');
      nextPageToken = skiptoken ?? nextLink;
    }

    logger.info(
      { connectionId, driveId, folderId, itemCount: items.length, hasNextPage: nextPageToken !== null },
      'SharePoint folder listing complete'
    );

    return { items, nextPageToken };
  }

  /**
   * Execute a delta query for a SharePoint library (drive-level).
   *
   * If deltaLink is provided, it is used verbatim as the request URL (absolute).
   * Otherwise, calls GET /drives/{driveId}/root/delta.
   */
  async executeDeltaQuery(
    connectionId: string,
    driveId: string,
    deltaLink?: string
  ): Promise<DeltaQueryResult> {
    logger.info({ connectionId, driveId, hasDeltaLink: !!deltaLink }, 'Executing SharePoint delta query');

    const token = await getGraphTokenManager().getValidToken(connectionId);

    let raw: Record<string, unknown>;

    if (deltaLink) {
      raw = await getGraphHttpClient().get<Record<string, unknown>>(deltaLink, token, true);
    } else {
      raw = await getGraphHttpClient().get<Record<string, unknown>>(
        `/drives/${driveId}/root/delta`,
        token
      );
    }

    return this._parseDeltaResponse(raw, connectionId);
  }

  /**
   * Execute a folder-scoped delta query within a SharePoint library.
   *
   * If deltaLink is provided, it is used verbatim.
   * Otherwise, calls GET /drives/{driveId}/items/{folderId}/delta.
   */
  async executeFolderDeltaQuery(
    connectionId: string,
    driveId: string,
    folderId: string,
    deltaLink?: string
  ): Promise<DeltaQueryResult> {
    logger.info({ connectionId, driveId, folderId, hasDeltaLink: !!deltaLink }, 'Executing SharePoint folder-scoped delta query');

    const token = await getGraphTokenManager().getValidToken(connectionId);

    let raw: Record<string, unknown>;

    if (deltaLink) {
      raw = await getGraphHttpClient().get<Record<string, unknown>>(deltaLink, token, true);
    } else {
      raw = await getGraphHttpClient().get<Record<string, unknown>>(
        `/drives/${driveId}/items/${folderId}/delta`,
        token
      );
    }

    return this._parseDeltaResponse(raw, connectionId);
  }

  // ============================================================================
  // Private helpers
  // ============================================================================

  private _parseSiteResponse(
    raw: Record<string, unknown>,
    connectionId: string
  ): SharePointSiteListResult {
    const rawSites = Array.isArray(raw.value) ? (raw.value as Record<string, unknown>[]) : [];

    const sites: SharePointSite[] = rawSites
      .filter(site => {
        // Filter out personal OneDrive sites
        const webUrl = String(site.webUrl ?? '');
        return !webUrl.includes('-my.sharepoint.com/personal/');
      })
      .map((site): SharePointSite => ({
        siteId: String(site.id ?? ''),
        displayName: String(site.displayName ?? ''),
        description: site.description != null ? String(site.description) : null,
        webUrl: String(site.webUrl ?? ''),
        isPersonalSite: false,
        lastModifiedAt: String(site.lastModifiedDateTime ?? ''),
      }));

    let nextPageToken: string | null = null;
    const nextLink = raw['@odata.nextLink'];
    if (typeof nextLink === 'string') {
      nextPageToken = nextLink;
    }

    logger.info(
      { connectionId, siteCount: sites.length, hasNextPage: nextPageToken !== null },
      'Sites parsed'
    );

    return { sites, nextPageToken };
  }

  private _parseDeltaResponse(
    raw: Record<string, unknown>,
    connectionId: string
  ): DeltaQueryResult {
    const rawItems = Array.isArray(raw.value) ? (raw.value as Record<string, unknown>[]) : [];

    const changes: DeltaChange[] = rawItems.map((item): DeltaChange => {
      const externalItem = mapDriveItem(item);
      const isDeleted = typeof item.deleted === 'object' && item.deleted !== null;
      const changeType: DeltaChange['changeType'] = isDeleted ? 'deleted' : 'modified';

      if (isDeleted) {
        logger.debug({ externalId: externalItem.id, name: externalItem.name }, 'Delta item: DELETED (SharePoint)');
      }

      return { item: externalItem, changeType };
    });

    const nextLink = raw['@odata.nextLink'];
    const newDeltaLink = raw['@odata.deltaLink'];

    const result: DeltaQueryResult = {
      changes,
      deltaLink: typeof newDeltaLink === 'string' ? newDeltaLink : null,
      hasMore: typeof nextLink === 'string',
      nextPageLink: typeof nextLink === 'string' ? nextLink : null,
    };

    logger.info(
      { connectionId, changeCount: changes.length, hasMore: result.hasMore, hasDeltaLink: result.deltaLink !== null },
      'SharePoint delta query complete'
    );

    return result;
  }

  private _extractSiteName(drive: Record<string, unknown>): string {
    const owner = drive.owner as Record<string, unknown> | undefined;
    if (owner) {
      const group = owner.group as Record<string, unknown> | undefined;
      if (group?.displayName) return String(group.displayName);
      const user = owner.user as Record<string, unknown> | undefined;
      if (user?.displayName) return String(user.displayName);
    }
    return '';
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: SharePointService | undefined;

/**
 * Get the SharePointService singleton.
 */
export function getSharePointService(): SharePointService {
  if (!instance) {
    instance = new SharePointService();
  }
  return instance;
}

/**
 * Reset the singleton (for tests only).
 * @internal
 */
export function __resetSharePointService(): void {
  instance = undefined;
}
