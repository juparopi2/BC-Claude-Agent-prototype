/**
 * Sync WebSocket Event Constants (PRD-101)
 *
 * Event names for real-time sync progress notifications.
 * Emitted to user-specific rooms `user:{userId}` during OneDrive/SharePoint sync.
 *
 * @module @bc-agent/shared/constants
 */

export const SYNC_WS_EVENTS = {
  SYNC_STARTED: 'sync:started',
  SYNC_PROGRESS: 'sync:progress',
  SYNC_COMPLETED: 'sync:completed',
  SYNC_ERROR: 'sync:error',
  SYNC_FILE_ADDED: 'sync:file_added',
  SYNC_FILE_UPDATED: 'sync:file_updated',
  SYNC_FILE_REMOVED: 'sync:file_removed',
  SUBSCRIPTION_RENEWED: 'connection:subscription_renewed',
  SUBSCRIPTION_ERROR: 'connection:subscription_error',
  CONNECTION_EXPIRED: 'connection:expired',
  CONNECTION_DISCONNECTED: 'connection:disconnected',
  PROCESSING_STARTED: 'processing:started',
  PROCESSING_PROGRESS: 'processing:progress',
  PROCESSING_COMPLETED: 'processing:completed',
  SYNC_HEALTH_REPORT: 'sync:health_report',
  SYNC_RECOVERY_COMPLETED: 'sync:recovery_completed',
  SYNC_RECONCILIATION_COMPLETED: 'sync:reconciliation_completed',
} as const;

export type SyncWsEventType = (typeof SYNC_WS_EVENTS)[keyof typeof SYNC_WS_EVENTS];
