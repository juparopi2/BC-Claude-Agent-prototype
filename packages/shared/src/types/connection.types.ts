/**
 * Connection Types
 *
 * TypeScript interfaces for the connections API contract
 * between backend and frontend.
 *
 * @module @bc-agent/shared/types/connection
 */

import type { ProviderId } from '../constants/providers';
import type { ConnectionStatus, SyncStatus } from '../constants/connection-status';

/**
 * Summary of a connection returned by the list API.
 * Excludes sensitive fields (tokens, MSAL state).
 */
export interface ConnectionSummary {
  id: string;
  provider: ProviderId;
  status: ConnectionStatus;
  displayName: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  createdAt: string;
  updatedAt: string;
  scopeCount: number;
  fileCount: number;
}

/**
 * Detail of a single sync scope within a connection.
 */
export interface ConnectionScopeDetail {
  id: string;
  connectionId: string;
  scopeType: string;
  scopeResourceId: string | null;
  scopeDisplayName: string | null;
  syncStatus: SyncStatus;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  itemCount: number;
  createdAt: string;
  scopeMode: 'include' | 'exclude';
  scopeSiteId?: string | null;
  scopePath: string | null;
  remoteDriveId: string | null;
  processingTotal: number;
  processingCompleted: number;
  processingFailed: number;
  processingStatus: string | null;
}

/**
 * Scope detail with actual file count from DB (PRD-105).
 */
export interface ConnectionScopeWithStats extends ConnectionScopeDetail {
  fileCount: number;
}

/**
 * Input for batch scope add/remove operations (PRD-105).
 */
export interface ScopeBatchInput {
  add: Array<{
    scopeType: string;
    scopeResourceId: string;
    scopeDisplayName: string;
    scopePath?: string;
    remoteDriveId?: string;
    scopeMode?: 'include' | 'exclude';
    scopeSiteId?: string;
  }>;
  remove: string[];
}

/**
 * Result of a batch scope operation (PRD-105).
 */
export interface ScopeBatchResult {
  added: Array<ConnectionScopeDetail & { syncJobId?: string }>;
  removed: Array<{ scopeId: string; filesDeleted: number }>;
}

/**
 * Response shape for GET /api/connections
 */
export interface ConnectionListResponse {
  connections: ConnectionSummary[];
  count: number;
}

/**
 * Summary of what a full disconnect will remove.
 * Returned by GET /api/connections/:id/disconnect-summary.
 */
export interface DisconnectSummary {
  connectionId: string;
  provider: string;
  displayName: string | null;
  scopeCount: number;
  fileCount: number;
  chunkCount: number;
}

/**
 * Result of a full disconnect operation.
 * Returned by DELETE /api/connections/:id/full-disconnect.
 */
export interface FullDisconnectResult {
  connectionId: string;
  scopesRemoved: number;
  filesDeleted: number;
  searchCleanupFailures: number;
  tokenRevoked: boolean;
  msalCacheDeleted: boolean;
}
