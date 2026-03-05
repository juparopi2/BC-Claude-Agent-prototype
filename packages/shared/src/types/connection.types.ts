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
}

/**
 * Response shape for GET /api/connections
 */
export interface ConnectionListResponse {
  connections: ConnectionSummary[];
  count: number;
}
