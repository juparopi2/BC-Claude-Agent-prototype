/**
 * Socket Infrastructure
 *
 * WebSocket client and event routing for real-time communication.
 *
 * @module infrastructure/socket
 */

export { SocketClient, getSocketClient, resetSocketClient, type SessionTitleUpdatedEvent } from './SocketClient';
export { EventRouter } from './eventRouter';
export * from './types';
