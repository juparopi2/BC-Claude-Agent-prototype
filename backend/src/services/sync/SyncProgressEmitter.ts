/**
 * SyncProgressEmitter (PRD-117)
 *
 * Centralizes WebSocket emission for sync operations.
 * Guards all emissions with isSocketServiceInitialized() for safety.
 *
 * @module services/sync
 */

import { createChildLogger } from '@/shared/utils/logger';
import { SYNC_WS_EVENTS } from '@bc-agent/shared';
import type { ProcessingStartedPayload, ProcessingProgressPayload, ProcessingCompletedPayload } from '@bc-agent/shared';
import { getSocketIO, isSocketServiceInitialized } from '@/services/websocket/SocketService';

const logger = createChildLogger({ service: 'SyncProgressEmitter' });

export class SyncProgressEmitter {
  private emit(userId: string, eventName: string, data: unknown): void {
    if (!isSocketServiceInitialized()) return;
    try {
      getSocketIO().to(`user:${userId}`).emit(eventName, data);
    } catch (err) {
      const errorInfo = err instanceof Error ? { message: err.message } : { value: String(err) };
      logger.warn({ error: errorInfo, userId, eventName }, 'Failed to emit sync event');
    }
  }

  emitDiscoveryProgress(
    userId: string,
    data: { connectionId: string; scopeId: string; processedFiles: number; totalFiles: number; percentage: number }
  ): void {
    this.emit(userId, SYNC_WS_EVENTS.SYNC_PROGRESS, data);
  }

  emitDiscoveryCompleted(
    userId: string,
    data: { connectionId: string; scopeId: string; totalFiles: number; processingTotal?: number }
  ): void {
    this.emit(userId, SYNC_WS_EVENTS.SYNC_COMPLETED, data);
  }

  emitProcessingStarted(userId: string, payload: ProcessingStartedPayload): void {
    this.emit(userId, SYNC_WS_EVENTS.PROCESSING_STARTED, payload);
  }

  emitProcessingProgress(userId: string, payload: ProcessingProgressPayload): void {
    this.emit(userId, SYNC_WS_EVENTS.PROCESSING_PROGRESS, payload);
  }

  emitProcessingCompleted(userId: string, payload: ProcessingCompletedPayload): void {
    this.emit(userId, SYNC_WS_EVENTS.PROCESSING_COMPLETED, payload);
  }

  emitSyncError(
    userId: string,
    data: { connectionId: string; scopeId: string; error: string }
  ): void {
    this.emit(userId, SYNC_WS_EVENTS.SYNC_ERROR, data);
  }

  emitFileAdded(
    userId: string,
    data: { connectionId: string; scopeId: string; fileId: string; fileName: string; sourceType: string }
  ): void {
    this.emit(userId, SYNC_WS_EVENTS.SYNC_FILE_ADDED, data);
  }

  emitFileUpdated(
    userId: string,
    data: { connectionId: string; scopeId: string; fileId: string; fileName: string; sourceType?: string }
  ): void {
    this.emit(userId, SYNC_WS_EVENTS.SYNC_FILE_UPDATED, data);
  }

  emitFileRemoved(
    userId: string,
    data: { connectionId: string; scopeId: string; fileId: string; fileName: string }
  ): void {
    this.emit(userId, SYNC_WS_EVENTS.SYNC_FILE_REMOVED, data);
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: SyncProgressEmitter | undefined;

export function getSyncProgressEmitter(): SyncProgressEmitter {
  if (!instance) {
    instance = new SyncProgressEmitter();
  }
  return instance;
}
