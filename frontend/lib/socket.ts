/**
 * Socket.IO Client
 *
 * WebSocket client for real-time communication with the backend.
 * Handles connection, authentication, and event management.
 *
 * @module lib/socket
 */

import { io, Socket } from 'socket.io-client';
import type {
  EventHandler,
  ConnectionHandler,
  MessageEventData,
  ThinkingEventData,
  ToolUseEventData,
  StreamChunkEventData,
  ApprovalEventData,
  TodoEventData,
  TodoCreatedEventData,
} from './types';

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
const eventListeners = new Map<string, Set<EventHandler<unknown>>>();

/**
 * Socket.IO events
 * Updated to match backend event names (with agent: prefix)
 */
export enum SocketEvent {
  // Connection events
  CONNECT = 'connect',
  DISCONNECT = 'disconnect',
  CONNECT_ERROR = 'connect_error',

  // Chat events (with agent: prefix to match backend)
  MESSAGE_COMPLETE = 'agent:message_complete',  // Backend emits this instead of 'message'
  THINKING = 'agent:thinking',                  // Backend uses agent: prefix
  TOOL_USE = 'agent:tool_use',                  // Backend uses agent: prefix
  TOOL_RESULT = 'agent:tool_result',            // Backend emits tool results
  MESSAGE_CHUNK = 'agent:message_chunk',        // Backend emits this instead of 'stream_chunk'
  COMPLETE = 'agent:complete',                  // Backend emits this instead of 'stream_end'

  // Note: Backend does NOT emit 'stream_start', we use 'agent:thinking' instead

  // Approval events
  APPROVAL_REQUIRED = 'approval:requested',  // Match backend event name
  APPROVAL_RESOLVED = 'approval:resolved',   // Match backend event name

  // Todo events
  TODO_CREATED = 'todo:created',             // Match backend event name
  TODO_UPDATED = 'todo:updated',             // Match backend event name
  TODO_COMPLETED = 'todo:completed',         // Match backend event name

  // Error events
  ERROR = 'agent:error',                     // Backend uses agent: prefix
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
 * NOTE: Uses session-based auth (cookies), not JWT tokens
 */
export function initSocket(): Socket {
  if (socket && socket.connected) {
    console.log('Socket already initialized and connected');
    return socket;
  }

  console.log('Initializing Socket.IO connection...');

  // Create socket connection
  // NOTE: No auth token needed - session is sent automatically via cookies
  // withCredentials: true ensures cookies are sent with Socket.IO handshake
  socket = io(SOCKET_URL, {
    withCredentials: true, // IMPORTANT: Send cookies for session-based auth
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
export function emit(event: string, data?: Record<string, unknown>): void {
  if (!socket || !socket.connected) {
    console.warn('Socket not connected, cannot emit event:', event);
    return;
  }

  socket.emit(event, data);
}

/**
 * Listen to an event from the server
 */
export function on<T = unknown>(event: string, callback: EventHandler<T>): void {
  if (!socket) {
    console.warn('Socket not initialized, call initSocket() first');
    return;
  }

  // Register listener
  if (!eventListeners.has(event)) {
    eventListeners.set(event, new Set());
  }
  eventListeners.get(event)?.add(callback as EventHandler<unknown>);

  // Add socket listener
  socket.on(event, callback);
}

/**
 * Remove an event listener
 */
export function off<T = unknown>(event: string, callback?: EventHandler<T>): void {
  if (!socket) return;

  if (callback) {
    // Remove specific callback
    socket.off(event, callback);
    eventListeners.get(event)?.delete(callback as EventHandler<unknown>);
  } else {
    // Remove all callbacks for this event
    socket.off(event);
    eventListeners.delete(event);
  }
}

/**
 * Listen to an event once
 */
export function once<T = unknown>(event: string, callback: EventHandler<T>): void {
  if (!socket) {
    console.warn('Socket not initialized, call initSocket() first');
    return;
  }

  socket.once(event, callback);
}

/**
 * Wait for room join confirmation with retry logic
 * Returns a Promise that resolves when the room join is confirmed
 * or rejects after all retries are exhausted
 */
export async function waitForRoomJoin(
  sessionId: string,
  maxRetries: number = 3,
  timeoutMs: number = 2000
): Promise<void> {
  if (!socket || !socket.connected) {
    throw new Error('Socket not connected');
  }

  let attempt = 0;

  while (attempt < maxRetries) {
    attempt++;
    console.log(`[Socket] Joining room (attempt ${attempt}/${maxRetries}):`, sessionId);

    try {
      // Wait for join confirmation with timeout
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          socket?.off('session:joined', handleJoined);
          reject(new Error(`Room join timeout after ${timeoutMs}ms`));
        }, timeoutMs);

        const handleJoined = (data: { sessionId: string }) => {
          if (data.sessionId === sessionId) {
            clearTimeout(timeout);
            console.log(`[Socket] ✅ Room joined successfully:`, sessionId);
            resolve();
          }
        };

        socket?.once('session:joined', handleJoined);
        emit('session:join', { sessionId });
      });

      // Success - exit retry loop
      return;
    } catch (error) {
      console.warn(`[Socket] Room join attempt ${attempt} failed:`, error);

      if (attempt >= maxRetries) {
        console.error(`[Socket] ❌ Failed to join room after ${maxRetries} attempts`);
        throw new Error(`Failed to join room ${sessionId} after ${maxRetries} attempts`);
      }

      // Wait a bit before retrying (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, 100 * attempt));
    }
  }
}

/**
 * Chat API via Socket.IO
 */
export const socketChatApi = {
  /**
   * Join a chat session
   */
  joinSession: (sessionId: string) => {
    emit('session:join', { sessionId });
  },

  /**
   * Join a chat session and wait for confirmation
   * Uses retry logic and throws if join fails
   */
  joinSessionAndWait: (sessionId: string) => waitForRoomJoin(sessionId),

  /**
   * Leave a chat session
   */
  leaveSession: (sessionId: string) => {
    emit('session:leave', { sessionId });
  },

  /**
   * Send a message
   * Backend expects: { message: string, sessionId: string, userId: string }
   */
  sendMessage: (sessionId: string, content: string) => {
    // TODO: Get userId from auth context/store
    const userId = 'default-user'; // Temporary until auth is fully implemented
    emit('chat:message', { message: content, sessionId, userId });
  },

  /**
   * Listen for complete messages (backend emits agent:message_complete)
   */
  onMessageComplete: (callback: EventHandler<MessageEventData>) => {
    on<MessageEventData>(SocketEvent.MESSAGE_COMPLETE, callback);
  },

  /**
   * Listen for thinking indicators (backend emits agent:thinking)
   */
  onThinking: (callback: EventHandler<ThinkingEventData>) => {
    on<ThinkingEventData>(SocketEvent.THINKING, callback);
  },

  /**
   * Listen for tool use (backend emits agent:tool_use)
   */
  onToolUse: (callback: EventHandler<ToolUseEventData>) => {
    on<ToolUseEventData>(SocketEvent.TOOL_USE, callback);
  },

  /**
   * Listen for tool results (backend emits agent:tool_result)
   */
  onToolResult: (callback: EventHandler<{ toolName: string; result: unknown; success: boolean }>) => {
    on<{ toolName: string; result: unknown; success: boolean }>(SocketEvent.TOOL_RESULT, callback);
  },

  /**
   * Listen for message chunks during streaming (backend emits agent:message_chunk)
   * Note: Backend sends { content: string }, not { chunk: string }
   */
  onMessageChunk: (callback: EventHandler<{ content: string }>) => {
    on<{ content: string }>(SocketEvent.MESSAGE_CHUNK, callback);
  },

  /**
   * Listen for completion (backend emits agent:complete instead of stream_end)
   */
  onComplete: (callback: EventHandler<{ reason: string }>) => {
    on<{ reason: string }>(SocketEvent.COMPLETE, callback);
  },
};

/**
 * Approval API via Socket.IO
 */
export const socketApprovalApi = {
  /**
   * Listen for approval requests
   */
  onApprovalRequired: (callback: EventHandler<ApprovalEventData>) => {
    on<ApprovalEventData>(SocketEvent.APPROVAL_REQUIRED, callback);
  },

  /**
   * Listen for approval resolutions
   */
  onApprovalResolved: (callback: EventHandler<ApprovalEventData>) => {
    on<ApprovalEventData>(SocketEvent.APPROVAL_RESOLVED, callback);
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
   * Listen for todo creation (when new todos are generated)
   */
  onTodoCreated: (callback: EventHandler<TodoCreatedEventData>) => {
    on<TodoCreatedEventData>(SocketEvent.TODO_CREATED, callback);
  },

  /**
   * Listen for todo updates
   */
  onTodoUpdated: (callback: EventHandler<TodoEventData>) => {
    on<TodoEventData>(SocketEvent.TODO_UPDATED, callback);
  },

  /**
   * Listen for todo completions
   */
  onTodoCompleted: (callback: EventHandler<TodoEventData>) => {
    on<TodoEventData>(SocketEvent.TODO_COMPLETED, callback);
  },
};

/**
 * Connection status hook helper
 */
export function onConnectionStatusChange(callback: (status: SocketStatus) => void): () => void {
  const handleConnect: ConnectionHandler = () => callback(SocketStatus.CONNECTED);
  const handleDisconnect: ConnectionHandler = () => callback(SocketStatus.DISCONNECTED);
  const handleConnecting: ConnectionHandler = () => callback(SocketStatus.CONNECTING);
  const handleError: ConnectionHandler = () => callback(SocketStatus.ERROR);

  on<void>(SocketEvent.CONNECT, handleConnect);
  on<void>(SocketEvent.DISCONNECT, handleDisconnect);
  on<void>('connecting', handleConnecting);
  on<void>(SocketEvent.CONNECT_ERROR, handleError);

  // Return cleanup function
  return () => {
    off<void>(SocketEvent.CONNECT, handleConnect);
    off<void>(SocketEvent.DISCONNECT, handleDisconnect);
    off<void>('connecting', handleConnecting);
    off<void>(SocketEvent.CONNECT_ERROR, handleError);
  };
}

// Re-export types from ./types for convenience
export type {
  MessageEventData,
  ThinkingEventData,
  ToolUseEventData,
  StreamChunkEventData,
  ApprovalEventData,
  TodoEventData,
  TodoCreatedEventData,
} from './types';
