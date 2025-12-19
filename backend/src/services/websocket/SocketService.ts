/**
 * SocketService - Singleton holder for Socket.IO server instance
 *
 * This service provides global access to the Socket.IO server instance for background workers
 * that need to emit events (e.g., file processing jobs, document OCR status updates).
 *
 * Pattern:
 * - Singleton initialization in server.ts during startup
 * - Background workers can access Socket.IO via getSocketIO()
 * - Same pattern as ApprovalManager and TodoManager
 *
 * Usage:
 * ```typescript
 * // In server.ts (initialization)
 * import { initSocketService } from './services/websocket/SocketService';
 * initSocketService(io);
 *
 * // In background workers
 * import { getSocketIO, isSocketServiceInitialized } from '@services/websocket/SocketService';
 * if (isSocketServiceInitialized()) {
 *   const io = getSocketIO();
 *   io.to(sessionId).emit('file:processing', { status: 'completed' });
 * }
 * ```
 *
 * @module services/websocket/SocketService
 */

import { Server as SocketServer } from 'socket.io';
import { createChildLogger } from '@/shared/utils/logger';

// Structured logger for socket service operations
const logger = createChildLogger({ service: 'SocketService' });

/**
 * Singleton Socket.IO server instance
 * Initialized once during server startup via initSocketService()
 */
let socketIOInstance: SocketServer | null = null;

/**
 * Initialize the SocketService with a Socket.IO server instance
 *
 * This should be called once during server startup in server.ts,
 * after the Socket.IO server is created and configured.
 *
 * @param io - Socket.IO server instance
 * @throws Error if SocketService is already initialized
 *
 * @example
 * ```typescript
 * const io = new SocketIOServer(httpServer, { ... });
 * // ... configure Socket.IO middleware, handlers, etc.
 * initSocketService(io);
 * ```
 */
export function initSocketService(io: SocketServer): void {
  if (socketIOInstance !== null) {
    logger.warn('SocketService already initialized - skipping re-initialization');
    return;
  }

  socketIOInstance = io;
  logger.info('SocketService initialized - Socket.IO available for background workers');
}

/**
 * Get the Socket.IO server instance
 *
 * This provides access to the Socket.IO server for background workers that need
 * to emit events to connected clients (e.g., file processing status updates).
 *
 * @returns Socket.IO server instance
 * @throws Error if SocketService has not been initialized
 *
 * @example
 * ```typescript
 * const io = getSocketIO();
 * io.to(sessionId).emit('file:processing', {
 *   fileId: 'abc123',
 *   status: 'completed',
 *   result: { ... }
 * });
 * ```
 */
export function getSocketIO(): SocketServer {
  if (socketIOInstance === null) {
    const error = new Error(
      'SocketService not initialized. Call initSocketService(io) during server startup.'
    );
    logger.error({ err: error }, 'Attempted to access Socket.IO before initialization');
    throw error;
  }

  return socketIOInstance;
}

/**
 * Check if SocketService has been initialized
 *
 * Use this to safely check if Socket.IO is available before attempting to emit events.
 * This is useful for graceful degradation in background workers.
 *
 * @returns true if SocketService is initialized, false otherwise
 *
 * @example
 * ```typescript
 * if (isSocketServiceInitialized()) {
 *   const io = getSocketIO();
 *   io.to(sessionId).emit('file:status', { ... });
 * } else {
 *   logger.warn('SocketService not available - skipping event emission');
 * }
 * ```
 */
export function isSocketServiceInitialized(): boolean {
  return socketIOInstance !== null;
}

/**
 * Reset the SocketService singleton
 *
 * **FOR TESTING ONLY** - Resets the singleton state to allow clean test initialization.
 * This should NEVER be called in production code.
 *
 * @internal
 *
 * @example
 * ```typescript
 * // In test setup
 * import { __resetSocketService } from '@services/websocket/SocketService';
 * afterEach(() => {
 *   __resetSocketService();
 * });
 * ```
 */
export function __resetSocketService(): void {
  socketIOInstance = null;
  logger.debug('SocketService reset (testing only)');
}
