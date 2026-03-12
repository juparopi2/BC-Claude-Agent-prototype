/**
 * Connection & Sync Status Constants
 *
 * Status enums for connections, sync scopes, and file source types.
 *
 * @module @bc-agent/shared/constants/connection-status
 */

// ============================================
// CONNECTION STATUS
// ============================================
export const CONNECTION_STATUS = {
  DISCONNECTED: 'disconnected',
  CONNECTED: 'connected',
  EXPIRED: 'expired',
  ERROR: 'error',
} as const;

export type ConnectionStatus = (typeof CONNECTION_STATUS)[keyof typeof CONNECTION_STATUS];

// ============================================
// SYNC STATUS (for connection_scopes)
// ============================================
export const SYNC_STATUS = {
  IDLE: 'idle',
  SYNCING: 'syncing',
  ERROR: 'error',
} as const;

export type SyncStatus = (typeof SYNC_STATUS)[keyof typeof SYNC_STATUS];

// ============================================
// FILE SOURCE TYPE
// ============================================
export const FILE_SOURCE_TYPE = {
  LOCAL: 'local',
  ONEDRIVE: 'onedrive',
  SHAREPOINT: 'sharepoint',
} as const;

export type FileSourceType = (typeof FILE_SOURCE_TYPE)[keyof typeof FILE_SOURCE_TYPE];

// ============================================
// SCOPE MODE (for connection_scopes)
// ============================================
export const SCOPE_MODE = {
  INCLUDE: 'include',
  EXCLUDE: 'exclude',
} as const;

export type ScopeMode = (typeof SCOPE_MODE)[keyof typeof SCOPE_MODE];
