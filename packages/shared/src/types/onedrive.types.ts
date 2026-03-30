/**
 * OneDrive / Microsoft Graph API Types (PRD-101)
 *
 * DTOs for Graph API responses, mapped from raw API shapes
 * to strongly-typed application models.
 *
 * @module @bc-agent/shared/types
 */

import type { ProcessingStartedPayload, ProcessingProgressPayload, ProcessingCompletedPayload } from './sync-processing-events.types';

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
  // Shared item metadata (PRD-110)
  isShared?: boolean;
  /** remoteItem.shared.owner.user.displayName */
  sharedBy?: string;
  /** remoteItem.shared.sharedDateTime (ISO) */
  sharedDate?: string;
  /** remoteItem.parentReference.driveId */
  remoteDriveId?: string;
  /** remoteItem.id (actual ID on source drive) */
  remoteItemId?: string;
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
  processingTotal?: number;
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

export interface ConnectionExpiredPayload {
  connectionId: string;
}

export interface ConnectionDisconnectedPayload {
  connectionId: string;
}

export interface SyncHealthReportPayload {
  userId: string;
  report: {
    overallStatus: string;
    summary: {
      totalScopes: number;
      healthyScopes: number;
      degradedScopes: number;
      unhealthyScopes: number;
      totalConnections?: number;
      healthyConnections?: number;
      degradedConnections?: number;
      unhealthyConnections?: number;
    };
    scopes: Array<{
      scopeId: string;
      connectionId: string;
      scopeName: string;
      syncStatus: string;
      healthStatus: string;
      issues: Array<{ type: string; severity: string; message: string }>;
      lastSyncedAt: string | null;
    }>;
    /** Hierarchical connection-level health aggregated from scope reports (worst-of-children). Added in Phase 4 (sync-health-v2). */
    connections?: Array<{
      connectionId: string;
      userId: string;
      provider: string;
      connectionStatus: string;
      healthStatus: string;
      summary: {
        totalScopes: number;
        healthyScopes: number;
        degradedScopes: number;
        unhealthyScopes: number;
      };
      scopes: Array<{
        scopeId: string;
        connectionId: string;
        scopeName: string;
        syncStatus: string;
        healthStatus: string;
        issues: Array<{ type: string; severity: string; message: string }>;
        lastSyncedAt: string | null;
      }>;
    }>;
  };
}

export interface SyncRecoveryCompletedPayload {
  userId: string;
  action: string;
  result: {
    scopesReset: number;
    scopesRequeued: number;
    filesRequeued: number;
  };
}

export interface SyncReconciliationStartedPayload {
  userId: string;
  triggeredBy: 'login' | 'manual';
}

export interface SyncReconciliationCompletedPayload {
  userId: string;
  triggeredBy: 'login' | 'manual' | 'cron';
  report: null | {
    dryRun: boolean;
    dbReadyFiles: number;
    searchIndexedFiles: number;
    missingFromSearchCount: number;
    orphanedInSearchCount: number;
    failedRetriableCount: number;
    stuckFilesCount: number;
    imagesMissingEmbeddingsCount: number;
    disconnectedConnectionFilesCount?: number;
    folderHierarchy?: {
      orphanedChildrenCount: number;
      missingScopeRootsCount: number;
      scopesToResyncCount: number;
    };
    repairs: {
      missingRequeued: number;
      orphansDeleted: number;
      failedRequeued: number;
      stuckRequeued: number;
      imageRequeued: number;
      externalNotFoundCleaned?: number;
      disconnectedConnectionCleaned?: number;
      folderHierarchy?: {
        scopeRootsRecreated: number;
        scopesResynced: number;
        scopesSkippedDisconnected: number;
        localFilesReparented: number;
        errors: number;
      };
      scopeIntegrityResynced?: number;
      errors: number;
    };
  };
}

export type SyncWebSocketEvent =
  | { type: 'sync:progress' } & SyncProgress
  | { type: 'sync:completed' } & SyncCompletedPayload
  | { type: 'sync:error' } & SyncErrorPayload
  | { type: 'sync:file_added' } & SyncFileAddedPayload
  | { type: 'sync:file_updated' } & SyncFileUpdatedPayload
  | { type: 'sync:file_removed' } & SyncFileRemovedPayload
  | { type: 'connection:subscription_renewed' } & SubscriptionRenewedPayload
  | { type: 'connection:subscription_error' } & SubscriptionErrorPayload
  | { type: 'connection:expired' } & ConnectionExpiredPayload
  | { type: 'connection:disconnected' } & ConnectionDisconnectedPayload
  | { type: 'processing:started' } & ProcessingStartedPayload
  | { type: 'processing:progress' } & ProcessingProgressPayload
  | { type: 'processing:completed' } & ProcessingCompletedPayload
  | { type: 'sync:health_report' } & SyncHealthReportPayload
  | { type: 'sync:recovery_completed' } & SyncRecoveryCompletedPayload
  | { type: 'sync:reconciliation_started' } & SyncReconciliationStartedPayload
  | { type: 'sync:reconciliation_completed' } & SyncReconciliationCompletedPayload;
