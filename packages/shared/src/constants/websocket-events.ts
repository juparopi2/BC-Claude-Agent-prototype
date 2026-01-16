/**
 * WebSocket Event Constants
 *
 * Centralized constants for WebSocket event names to avoid magic strings.
 * Following Screaming Architecture - the structure reveals the domain.
 *
 * Usage:
 * ```typescript
 * import { FILE_WS_CHANNELS, FILE_WS_EVENTS } from '@bc-agent/shared';
 *
 * io.to(sessionId).emit(FILE_WS_CHANNELS.STATUS, {
 *   type: FILE_WS_EVENTS.READINESS_CHANGED,
 *   ...
 * });
 * ```
 *
 * @module @bc-agent/shared/constants/websocket-events
 */

// ============================================================================
// FILE PROCESSING EVENTS (D25 Sprint 3)
// ============================================================================

/**
 * WebSocket channels for file-related events.
 * Channels are the Socket.IO event names used with `io.emit(channel, payload)`.
 */
export const FILE_WS_CHANNELS = {
  /** Channel for file readiness state changes and permanent failures */
  STATUS: 'file:status',
  /** Channel for processing progress, completion, and error events */
  PROCESSING: 'file:processing',
} as const;

/**
 * Type for file WebSocket channel names.
 */
export type FileWsChannel = (typeof FILE_WS_CHANNELS)[keyof typeof FILE_WS_CHANNELS];

/**
 * Event type values for file WebSocket events.
 * These are the `type` field values in the event payload.
 */
export const FILE_WS_EVENTS = {
  /** File readiness state has changed (uploading → processing → ready/failed) */
  READINESS_CHANGED: 'file:readiness_changed',
  /** File has permanently failed after exhausting all retries */
  PERMANENTLY_FAILED: 'file:permanently_failed',
  /** Processing progress update (0-100%) */
  PROCESSING_PROGRESS: 'file:processing_progress',
  /** Processing completed successfully */
  PROCESSING_COMPLETED: 'file:processing_completed',
  /** Processing failed (before retry decision) */
  PROCESSING_FAILED: 'file:processing_failed',
  /** File deletion completed (success or failure) - used by bulk delete */
  DELETED: 'file:deleted',
} as const;

/**
 * Type for file WebSocket event type values.
 */
export type FileWsEventType = (typeof FILE_WS_EVENTS)[keyof typeof FILE_WS_EVENTS];

// ============================================================================
// FUTURE: Other WebSocket events should be added here
// See D28 in docs/plans/99-FUTURE-DEVELOPMENT.md for centralization plan
// ============================================================================
