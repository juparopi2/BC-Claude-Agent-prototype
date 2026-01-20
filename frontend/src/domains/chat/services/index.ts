/**
 * Chat Services
 *
 * Exports service layer for chat domain.
 *
 * NOTE: streamProcessor has been removed.
 * Use processAgentEventSync for all event processing.
 *
 * @module domains/chat/services
 */

export {
  processAgentEventSync,
  type EventProcessorCallbacks,
} from './processAgentEventSync';

// Pending File Manager
export { pendingFileManager } from './pendingFileManager';
