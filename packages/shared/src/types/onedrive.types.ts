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
  /** Set by browse API; absent in delta/internal paths */
  isSupported?: boolean;
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

export interface SyncCompletedPayload {
  connectionId: string;
  scopeId: string;
  totalFiles: number;
}

export interface SyncErrorPayload {
  connectionId: string;
  scopeId: string;
  error: string;
}

export interface SyncFileAddedPayload {
  connectionId: string;
  scopeId: string;
  fileId: string;
  fileName: string;
  sourceType: string;
}

export interface SyncFileUpdatedPayload {
  connectionId: string;
  scopeId: string;
  fileId: string;
  fileName: string;
}

export interface SyncFileRemovedPayload {
  connectionId: string;
  scopeId: string;
  fileId: string;
  fileName: string;
}

export interface SubscriptionRenewedPayload {
  connectionId: string;
  scopeId: string;
  expiresAt: string;
}

export interface SubscriptionErrorPayload {
  connectionId: string;
  scopeId: string;
  error: string;
}

export type SyncWebSocketEvent =
  | { type: 'sync:progress' } & SyncProgress
  | { type: 'sync:completed' } & SyncCompletedPayload
  | { type: 'sync:error' } & SyncErrorPayload
  | { type: 'sync:file_added' } & SyncFileAddedPayload
  | { type: 'sync:file_updated' } & SyncFileUpdatedPayload
  | { type: 'sync:file_removed' } & SyncFileRemovedPayload
  | { type: 'connection:subscription_renewed' } & SubscriptionRenewedPayload
  | { type: 'connection:subscription_error' } & SubscriptionErrorPayload;
