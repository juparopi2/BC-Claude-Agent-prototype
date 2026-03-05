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
} as const;

export type SyncWsEventType = (typeof SYNC_WS_EVENTS)[keyof typeof SYNC_WS_EVENTS];
