/**
 * OneDriveService (PRD-101)
 *
 * Wraps Microsoft Graph API operations for OneDrive, providing strongly-typed
 * methods for drive info, folder listing, file downloads, and delta queries.
 *
 * Design:
 *  - Each method fetches connection details (driveId, tenantId) from DB via prisma.
 *  - Token acquisition is delegated to GraphTokenManager.
 *  - HTTP calls are delegated to GraphHttpClient.
 *  - All Graph API responses are mapped to typed DTOs from @bc-agent/shared.
 *  - Singleton via getOneDriveService() / __resetOneDriveService().
 *
 * @module services/connectors/onedrive
 */

import { createChildLogger } from '@/shared/utils/logger';
import { prisma } from '@/infrastructure/database/prisma';
import { getGraphTokenManager } from '../GraphTokenManager';
import { getGraphHttpClient } from './GraphHttpClient';
import type {
  DriveInfo,
  ExternalFileItem,
  FolderListResult,
  DeltaQueryResult,
  DeltaChange,
} from '@bc-agent/shared';

const logger = createChildLogger({ service: 'OneDriveService' });

// ============================================================================
// Internal mapping helpers
// ============================================================================

/**
 * Map a raw Graph API driveItem to the strongly-typed ExternalFileItem DTO.
 */
function mapDriveItem(item: Record<string, unknown>): ExternalFileItem {
  return {
    id: String(item.id),
    name: String(item.name),
    isFolder: !!item.folder,
    mimeType: item.file
      ? String((item.file as Record<string, unknown>).mimeType ?? null)
      : null,
    sizeBytes: Number(item.size ?? 0),
    lastModifiedAt: String(item.lastModifiedDateTime ?? ''),
    webUrl: String(item.webUrl ?? ''),
    eTag: item.eTag ? String(item.eTag) : null,
    parentId: item.parentReference
      ? String((item.parentReference as Record<string, unknown>).id ?? null)
      : null,
    parentPath: item.parentReference
      ? String((item.parentReference as Record<string, unknown>).path ?? null)
      : null,
    childCount: item.folder
      ? Number((item.folder as Record<string, unknown>).childCount ?? 0)
      : null,
  };
}

// ============================================================================
// Internal DB helper
// ============================================================================

interface ConnectionDriveInfo {
  driveId: string;
  tenantId: string | null;
}

/**
 * Fetch the microsoft_drive_id and microsoft_tenant_id for a connection.
 * Throws if the connection is not found or has no driveId.
 */
async function getConnectionDriveInfo(connectionId: string): Promise<ConnectionDriveInfo> {
  const connection = await prisma.connections.findUnique({
    where: { id: connectionId },
    select: {
      microsoft_drive_id: true,
      microsoft_tenant_id: true,
    },
  });

  if (!connection) {
    throw new Error(`Connection not found: ${connectionId}`);
  }

  if (!connection.microsoft_drive_id) {
    throw new Error(`Connection has no drive ID: ${connectionId}`);
  }

  return {
    driveId: connection.microsoft_drive_id,
    tenantId: connection.microsoft_tenant_id,
  };
}

// ============================================================================
// OneDriveService
// ============================================================================

export class OneDriveService {
  /**
   * Retrieve metadata about the OneDrive associated with the given connection.
   * Calls GET /me/drive (user's personal drive bound to the token).
   */
  async getDriveInfo(connectionId: string): Promise<DriveInfo> {
    logger.info({ connectionId }, 'Fetching drive info');

    const token = await getGraphTokenManager().getValidToken(connectionId);

    const raw = await getGraphHttpClient().get<Record<string, unknown>>(
      '/me/drive',
      token
    );

    const owner = raw.owner as Record<string, unknown> | undefined;
    const userOwner = owner?.user as Record<string, unknown> | undefined;
    const quota = raw.quota as Record<string, unknown> | undefined;

    const driveInfo: DriveInfo = {
      driveId: String(raw.id ?? ''),
      driveName: String(raw.name ?? ''),
      driveType: (raw.driveType as DriveInfo['driveType']) ?? 'personal',
      ownerDisplayName: String(userOwner?.displayName ?? ''),
      totalBytes: Number(quota?.total ?? 0),
      usedBytes: Number(quota?.used ?? 0),
    };

    logger.info({ connectionId, driveId: driveInfo.driveId }, 'Drive info fetched');
    return driveInfo;
  }

  /**
   * List the children of a folder in the drive.
   * If folderId is omitted, lists the root folder.
   * Supports pagination via pageToken ($skiptoken query param).
   *
   * Calls:
   *   GET /drives/{driveId}/items/{folderId}/children?$skiptoken=...
   *   or
   *   GET /drives/{driveId}/root/children?$skiptoken=...
   */
  async listFolder(
    connectionId: string,
    folderId?: string,
    pageToken?: string
  ): Promise<FolderListResult> {
    logger.info({ connectionId, folderId, hasPageToken: !!pageToken }, 'Listing folder contents');

    const { driveId } = await getConnectionDriveInfo(connectionId);
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

    // Extract nextPageToken from @odata.nextLink if present
    let nextPageToken: string | null = null;
    const nextLink = raw['@odata.nextLink'];
    if (typeof nextLink === 'string') {
      const url = new URL(nextLink);
      const skiptoken = url.searchParams.get('$skiptoken');
      nextPageToken = skiptoken ?? nextLink;
    }

    logger.info(
      { connectionId, folderId, itemCount: items.length, hasNextPage: nextPageToken !== null },
      'Folder listing complete'
    );

    return { items, nextPageToken };
  }

  /**
   * Download the binary content of a file.
   * Calls GET /drives/{driveId}/items/{itemId}/content and follows the 302 redirect.
   *
   * @returns Buffer with file bytes and the Content-Type header value.
   */
  async downloadFileContent(
    connectionId: string,
    itemId: string
  ): Promise<{ buffer: Buffer; contentType: string }> {
    logger.info({ connectionId, itemId }, 'Downloading file content');

    const { driveId } = await getConnectionDriveInfo(connectionId);
    const token = await getGraphTokenManager().getValidToken(connectionId);

    const path = `/drives/${driveId}/items/${itemId}/content`;
    const buffer = await getGraphHttpClient().getBuffer(path, token);

    logger.info({ connectionId, itemId, sizeBytes: buffer.length }, 'File content downloaded');

    // GraphHttpClient.getBuffer follows redirects; content-type is not returned
    // by getBuffer, so we default to octet-stream and let callers override via DB mime_type.
    return { buffer, contentType: 'application/octet-stream' };
  }

  /**
   * Get a pre-authenticated download URL for a file (short-lived).
   * Calls GET /drives/{driveId}/items/{itemId}?$select=@microsoft.graph.downloadUrl
   */
  async getDownloadUrl(connectionId: string, itemId: string): Promise<string> {
    logger.info({ connectionId, itemId }, 'Fetching download URL');

    const { driveId } = await getConnectionDriveInfo(connectionId);
    const token = await getGraphTokenManager().getValidToken(connectionId);

    const path = `/drives/${driveId}/items/${itemId}?$select=${encodeURIComponent('@microsoft.graph.downloadUrl')}`;
    const raw = await getGraphHttpClient().get<Record<string, unknown>>(path, token);

    const downloadUrl = raw['@microsoft.graph.downloadUrl'];
    if (typeof downloadUrl !== 'string' || !downloadUrl) {
      throw new Error(`No download URL returned for item ${itemId}`);
    }

    logger.info({ connectionId, itemId }, 'Download URL fetched');
    return downloadUrl;
  }

  /**
   * Fetch metadata for a single item (file or folder) by its ID.
   * Calls GET /drives/{driveId}/items/{itemId}
   */
  async getItemMetadata(connectionId: string, itemId: string): Promise<ExternalFileItem> {
    logger.info({ connectionId, itemId }, 'Fetching item metadata');

    const { driveId } = await getConnectionDriveInfo(connectionId);
    const token = await getGraphTokenManager().getValidToken(connectionId);

    const raw = await getGraphHttpClient().get<Record<string, unknown>>(
      `/drives/${driveId}/items/${itemId}`,
      token
    );

    const result = mapDriveItem(raw);
    logger.info({ connectionId, itemId, name: result.name }, 'Item metadata fetched');
    return result;
  }

  /**
   * Execute a delta query to detect changes since the last sync.
   *
   * If deltaLink is provided, it is used verbatim as the request URL (absolute).
   * Otherwise, calls GET /drives/{driveId}/root/delta to start a new delta session.
   *
   * Deleted items carry a `deleted` facet in the Graph response.
   */
  async executeDeltaQuery(
    connectionId: string,
    deltaLink?: string
  ): Promise<DeltaQueryResult> {
    logger.info({ connectionId, hasDeltaLink: !!deltaLink }, 'Executing delta query');

    const token = await getGraphTokenManager().getValidToken(connectionId);

    let raw: Record<string, unknown>;

    if (deltaLink) {
      // deltaLink is an absolute URL — use it directly
      raw = await getGraphHttpClient().get<Record<string, unknown>>(deltaLink, token);
    } else {
      const { driveId } = await getConnectionDriveInfo(connectionId);
      raw = await getGraphHttpClient().get<Record<string, unknown>>(
        `/drives/${driveId}/root/delta`,
        token
      );
    }

    const rawItems = Array.isArray(raw.value) ? (raw.value as Record<string, unknown>[]) : [];

    const changes: DeltaChange[] = rawItems.map((item): DeltaChange => {
      const externalItem = mapDriveItem(item);

      // Deleted items have a `deleted` facet set
      const isDeleted = typeof item.deleted === 'object' && item.deleted !== null;
      const changeType: DeltaChange['changeType'] = isDeleted ? 'deleted' : 'modified';

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
      {
        connectionId,
        changeCount: changes.length,
        hasMore: result.hasMore,
        hasDeltaLink: result.deltaLink !== null,
      },
      'Delta query complete'
    );

    return result;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: OneDriveService | undefined;

/**
 * Get the OneDriveService singleton.
 */
export function getOneDriveService(): OneDriveService {
  if (!instance) {
    instance = new OneDriveService();
  }
  return instance;
}

/**
 * Reset the singleton (for tests only).
 * @internal
 */
export function __resetOneDriveService(): void {
  instance = undefined;
}
