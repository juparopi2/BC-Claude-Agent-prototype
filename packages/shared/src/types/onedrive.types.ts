/**
 * OneDrive / Microsoft Graph API Types (PRD-101)
 *
 * DTOs for Graph API responses, mapped from raw API shapes
 * to strongly-typed application models.
 *
 * @module @bc-agent/shared/types
 */

/**
 * Information about a OneDrive drive (personal or business).
 */
export interface DriveInfo {
  driveId: string;
  driveName: string;
  driveType: 'personal' | 'business' | 'documentLibrary';
  ownerDisplayName: string;
  totalBytes: number;
  usedBytes: number;
}

/**
 * A file or folder item from an external OneDrive/SharePoint source.
 */
export interface ExternalFileItem {
  id: string;
  name: string;
  isFolder: boolean;
  mimeType: string | null;
  sizeBytes: number;
  lastModifiedAt: string;
  webUrl: string;
  eTag: string | null;
  parentId: string | null;
  parentPath: string | null;
  childCount: number | null;
}

/**
 * Result of listing folder contents with optional pagination.
 */
export interface FolderListResult {
  items: ExternalFileItem[];
  nextPageToken: string | null;
}

/**
 * A single change from a delta query.
 */
export interface DeltaChange {
  item: ExternalFileItem;
  changeType: 'created' | 'modified' | 'deleted';
}

/**
 * Result of executing a delta query against a drive.
 */
export interface DeltaQueryResult {
  changes: DeltaChange[];
  deltaLink: string | null;
  hasMore: boolean;
  nextPageLink: string | null;
}

/**
 * Progress payload for sync WebSocket events.
 */
export interface SyncProgress {
  connectionId: string;
  scopeId: string;
  processedFiles: number;
  totalFiles: number;
  percentage: number;
}
