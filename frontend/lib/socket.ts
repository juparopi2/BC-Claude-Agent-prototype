/**
 * Socket.IO Client
 *
 * WebSocket client for real-time communication with the backend.
 * Handles connection, authentication, and event management.
 *
 * @module lib/socket
 */

import { io, Socket } from 'socket.io-client';
import { getAuthToken } from './api';

/**
 * Socket.IO configuration
 */
const SOCKET_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001';

/**
 * Socket.IO client instance
 */
let socket: Socket | null = null;

/**
 * Event listeners registry
 */
const eventListeners = new Map<string, Set<Function>>();

/**
 * Socket.IO events
 */
export enum SocketEvent {
  // Connection events
  CONNECT = 'connect',
  DISCONNECT = 'disconnect',
  CONNECT_ERROR = 'connect_error',

  // Chat events
  MESSAGE = 'message',
  THINKING = 'thinking',
  TOOL_USE = 'tool_use',
  STREAM_START = 'stream_start',
  STREAM_CHUNK = 'stream_chunk',
  STREAM_END = 'stream_end',

  // Approval events
  APPROVAL_REQUIRED = 'approval_required',
  APPROVAL_RESOLVED = 'approval_resolved',

  // Todo events
  TODO_UPDATED = 'todo_updated',
  TODO_COMPLETED = 'todo_completed',

  // Error events
  ERROR = 'error',
}

/**
 * Socket connection status
 */
export enum SocketStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  ERROR = 'error',
}

/**
 * Get current socket status
 */
export function getSocketStatus(): SocketStatus {
  if (!socket) return SocketStatus.DISCONNECTED;
  if (socket.connected) return SocketStatus.CONNECTED;
  // Note: socket.io v4.8+ doesn't expose connecting property reliably
  return SocketStatus.DISCONNECTED;
}

/**
 * Initialize Socket.IO connection
 */
export function initSocket(): Socket {
  if (socket && socket.connected) {
    console.log('Socket already initialized and connected');
    return socket;
  }

  console.log('Initializing Socket.IO connection...');

  // Get authentication token
  const token = getAuthToken();

  // Create socket connection
  socket = io(SOCKET_URL, {
    auth: {
      token,
    },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 5,
  });

  // Connection event handlers
  socket.on('connect', () => {
    console.log('✅ Socket connected:', socket?.id);
  });

  socket.on('disconnect', (reason) => {
    console.log('❌ Socket disconnected:', reason);
  });

  socket.on('connect_error', (error) => {
    console.error('❌ Socket connection error:', error);
  });

  socket.on('reconnect', (attemptNumber) => {
    console.log(`🔄 Socket reconnected after ${attemptNumber} attempts`);
  });

  socket.on('reconnect_attempt', (attemptNumber) => {
    console.log(`🔄 Socket reconnection attempt ${attemptNumber}...`);
  });

  socket.on('reconnect_error', (error) => {
    console.error('❌ Socket reconnection error:', error);
  });

  socket.on('reconnect_failed', () => {
    console.error('❌ Socket reconnection failed');
  });

  return socket;
}

/**
 * Disconnect socket
 */
export function disconnectSocket(): void {
  if (socket) {
    console.log('Disconnecting socket...');
    socket.disconnect();
    socket = null;
    eventListeners.clear();
  }
}

/**
 * Get socket instance
 */
export function getSocket(): Socket | null {
  return socket;
}

/**
 * Emit an event to the server
 */
export function emit(event: string, data?: any): void {
  if (!socket || !socket.connected) {
    console.warn('Socket not connected, cannot emit event:', event);
    return;
  }

  socket.emit(event, data);
}

/**
 * Listen to an event from the server
 */
export function on(event: string, callback: Function): void {
  if (!socket) {
    console.warn('Socket not initialized, call initSocket() first');
    return;
  }

  // Register listener
  if (!eventListeners.has(event)) {
    eventListeners.set(event, new Set());
  }
  eventListeners.get(event)?.add(callback);

  // Add socket listener
  socket.on(event, callback as any);
}

/**
 * Remove an event listener
 */
export function off(event: string, callback?: Function): void {
  if (!socket) return;

  if (callback) {
    // Remove specific callback
    socket.off(event, callback as any);
    eventListeners.get(event)?.delete(callback);
  } else {
    // Remove all callbacks for this event
    socket.off(event);
    eventListeners.delete(event);
  }
}

/**
 * Listen to an event once
 */
export function once(event: string, callback: Function): void {
  if (!socket) {
    console.warn('Socket not initialized, call initSocket() first');
    return;
  }

  socket.once(event, callback as any);
}

/**
 * Chat API via Socket.IO
 */
export const socketChatApi = {
  /**
   * Join a chat session
   */
  joinSession: (sessionId: string) => {
    emit('join_session', { sessionId });
  },

  /**
   * Leave a chat session
   */
  leaveSession: (sessionId: string) => {
    emit('leave_session', { sessionId });
  },

  /**
   * Send a message
   */
  sendMessage: (sessionId: string, content: string) => {
    emit('message', { sessionId, content });
  },

  /**
   * Listen for messages
   */
  onMessage: (callback: (data: any) => void) => {
    on(SocketEvent.MESSAGE, callback);
  },

  /**
   * Listen for thinking indicators
   */
  onThinking: (callback: (data: any) => void) => {
    on(SocketEvent.THINKING, callback);
  },

  /**
   * Listen for tool use
   */
  onToolUse: (callback: (data: any) => void) => {
    on(SocketEvent.TOOL_USE, callback);
  },

  /**
   * Listen for stream start
   */
  onStreamStart: (callback: (data: any) => void) => {
    on(SocketEvent.STREAM_START, callback);
  },

  /**
   * Listen for stream chunks
   */
  onStreamChunk: (callback: (data: any) => void) => {
    on(SocketEvent.STREAM_CHUNK, callback);
  },

  /**
   * Listen for stream end
   */
  onStreamEnd: (callback: (data: any) => void) => {
    on(SocketEvent.STREAM_END, callback);
  },
};

/**
 * Approval API via Socket.IO
 */
export const socketApprovalApi = {
  /**
   * Listen for approval requests
   */
  onApprovalRequired: (callback: (data: any) => void) => {
    on(SocketEvent.APPROVAL_REQUIRED, callback);
  },

  /**
   * Listen for approval resolutions
   */
  onApprovalResolved: (callback: (data: any) => void) => {
    on(SocketEvent.APPROVAL_RESOLVED, callback);
  },

  /**
   * Send approval decision
   */
  sendApprovalDecision: (approvalId: string, decision: 'approved' | 'rejected', reason?: string) => {
    emit('approval_decision', { approvalId, decision, reason });
  },
};

/**
 * Todo API via Socket.IO
 */
export const socketTodoApi = {
  /**
   * Listen for todo updates
   */
  onTodoUpdated: (callback: (data: any) => void) => {
    on(SocketEvent.TODO_UPDATED, callback);
  },

  /**
   * Listen for todo completions
   */
  onTodoCompleted: (callback: (data: any) => void) => {
    on(SocketEvent.TODO_COMPLETED, callback);
  },
};

/**
 * Connection status hook helper
 */
export function onConnectionStatusChange(callback: (status: SocketStatus) => void): () => void {
  const handleConnect = () => callback(SocketStatus.CONNECTED);
  const handleDisconnect = () => callback(SocketStatus.DISCONNECTED);
  const handleConnecting = () => callback(SocketStatus.CONNECTING);
  const handleError = () => callback(SocketStatus.ERROR);

  on(SocketEvent.CONNECT, handleConnect);
  on(SocketEvent.DISCONNECT, handleDisconnect);
  on('connecting', handleConnecting);
  on(SocketEvent.CONNECT_ERROR, handleError);

  // Return cleanup function
  return () => {
    off(SocketEvent.CONNECT, handleConnect);
    off(SocketEvent.DISCONNECT, handleDisconnect);
    off('connecting', handleConnecting);
    off(SocketEvent.CONNECT_ERROR, handleError);
  };
}
