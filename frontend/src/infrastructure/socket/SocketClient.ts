/**
 * SocketClient
 *
 * Type-safe Socket.IO client for real-time communication with the backend.
 * Provides Promise-based session joining and event subscription pattern.
 *
 * @module infrastructure/socket/SocketClient
 */

import { io, Socket } from 'socket.io-client';
import type {
  AgentEvent,
  ChatMessageData,
  StopAgentData,
  ApprovalResponseData,
  AgentErrorData,
  SessionReadyEvent,
  ExtendedThinkingConfig,
  FileWebSocketEvent,
  JobFailedPayload,
} from '@bc-agent/shared';
import { FILE_WS_CHANNELS, JOB_WS_CHANNELS } from '@bc-agent/shared';
import type { SocketConnectOptions, JoinSessionOptions, PendingMessage } from './types';
import { useAuthStore } from '@/src/domains/auth/stores/authStore';

type EventCallback<T = unknown> = (data: T) => void;

/**
 * Session title update event data
 */
export interface SessionTitleUpdatedEvent {
  sessionId: string;
  title: string;
}

/**
 * WebSocket client for real-time communication.
 *
 * @example
 * ```typescript
 * const client = new SocketClient();
 * await client.connect({ url: 'http://localhost:3002' });
 * await client.joinSession('session-123');
 *
 * const unsubscribe = client.onAgentEvent((event) => {
 *   console.log('Event:', event.type);
 * });
 *
 * client.sendMessage({ message: 'Hello', sessionId: 'session-123', userId: 'user-1' });
 * ```
 */
export class SocketClient {
  private socket: Socket | null = null;
  private currentSessionId: string | null = null;
  private pendingMessages: PendingMessage[] = [];
  private agentEventListeners = new Set<EventCallback<AgentEvent>>();
  private connectionChangeListeners = new Set<EventCallback<boolean>>();
  private sessionReadyListeners = new Set<EventCallback<SessionReadyEvent>>();
  private errorListeners = new Set<EventCallback<AgentErrorData>>();
  private sessionTitleListeners = new Set<EventCallback<SessionTitleUpdatedEvent>>();
  // File processing event listeners (D25)
  private fileStatusListeners = new Set<EventCallback<FileWebSocketEvent>>();
  private fileProcessingListeners = new Set<EventCallback<FileWebSocketEvent>>();
  // Job failure event listeners (Phase 3, Task 3.3)
  private jobFailureListeners = new Set<EventCallback<JobFailedPayload>>();
  // Pending user room join (D25 race condition fix)
  private pendingUserRoomJoin: string | null = null;

  /**
   * Whether the socket is currently connected
   */
  get isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  /**
   * Current session ID
   */
  get sessionId(): string | null {
    return this.currentSessionId;
  }

  /**
   * Whether there are pending messages to send
   */
  get hasPendingMessages(): boolean {
    return this.pendingMessages.length > 0;
  }

  /**
   * Connect to the WebSocket server
   *
   * @param options Connection options
   * @returns Promise that resolves when connected
   */
  connect(options: SocketConnectOptions): Promise<void> {

    return new Promise((resolve, reject) => {
      if (this.socket?.connected) {
        this.flushPendingUserRoomJoin();
        resolve();
        return;
      }

      this.socket = io(options.url, {
        transports: options.transports ?? ['websocket', 'polling'],
        withCredentials: true,
        autoConnect: true,
        reconnection: options.reconnection ?? true,
        reconnectionAttempts: options.reconnectionAttempts ?? 5,
        reconnectionDelay: options.reconnectionDelay ?? 1000,
        reconnectionDelayMax: options.reconnectionDelayMax ?? 5000,
      });

      const onConnect = () => {
        this.notifyConnectionChange(true);
        this.flushPendingMessages();
        this.flushPendingUserRoomJoin();
        resolve();
      };

      const onConnectError = (error: Error) => {
        console.error('[SocketClient] Socket.IO connect error:', error.message);
        this.notifyConnectionChange(false);
        reject(error);
      };

      this.socket.once('connect', onConnect);
      this.socket.once('connect_error', onConnectError);

      this.setupEventListeners();
    });
  }

  /**
   * Disconnect from the WebSocket server
   */
  disconnect(): void {
    if (this.currentSessionId) {
      this.socket?.emit('session:leave', { sessionId: this.currentSessionId });
      this.currentSessionId = null;
    }

    this.socket?.disconnect();
    this.socket = null;
    this.pendingMessages = [];
    this.pendingUserRoomJoin = null;
    this.notifyConnectionChange(false);
  }

  /**
   * Join a session room.
   *
   * Resolves when the server confirms the session is ready.
   * This fixes Gap #11 by ensuring session:ready before sending messages.
   *
   * @param sessionId Session to join
   * @param options Join options including timeout
   * @returns Promise that resolves when session is ready
   */
  joinSession(sessionId: string, options: JoinSessionOptions = {}): Promise<void> {
    const timeout = options.timeout ?? 5000;

    return new Promise((resolve, reject) => {
      const doJoin = () => {
        if (!this.socket) {
          reject(new Error('No socket instance'));
          return;
        }

        // Leave current session if different
        if (this.currentSessionId && this.currentSessionId !== sessionId) {
          this.socket.emit('session:leave', { sessionId: this.currentSessionId });
        }

        const timeoutId = setTimeout(() => {
          reject(new Error('Join timeout'));
        }, timeout);

        // Listen for session:ready once
        this.socket.once('session:ready', (data: SessionReadyEvent) => {
          clearTimeout(timeoutId);
          this.currentSessionId = sessionId;
          this.notifySessionReady(data);
          resolve();
        });

        this.socket.emit('session:join', { sessionId });
      };

      // If already connected, join immediately
      if (this.socket?.connected) {
        doJoin();
        return;
      }

      // If socket exists but not connected, wait for connection
      if (this.socket) {
        const connectTimeout = setTimeout(() => {
          reject(new Error('Connection timeout while joining'));
        }, timeout);

        this.socket.once('connect', () => {
          clearTimeout(connectTimeout);
          doJoin();
        });

        this.socket.once('connect_error', (error) => {
          clearTimeout(connectTimeout);
          reject(new Error(`Connection failed: ${error.message}`));
        });
        return;
      }

      // No socket at all
      reject(new Error('Not connected - no socket instance'));
    });
  }

  /**
   * Leave the current session
   *
   * @param sessionId Session to leave
   */
  leaveSession(sessionId: string): void {
    if (!this.socket?.connected) {
      return;
    }

    this.socket.emit('session:leave', { sessionId });

    if (this.currentSessionId === sessionId) {
      this.currentSessionId = null;
    }
  }

  /**
   * Send a chat message
   *
   * If not connected, the message is queued and sent on reconnect.
   *
   * @param data Message data
   */
  sendMessage(
    data: Omit<ChatMessageData, 'thinking'> & {
      thinking?: ExtendedThinkingConfig;
      attachments?: string[];
    }
  ): void {
    if (!this.socket?.connected) {
      // Queue message for later
      const pendingMessage: PendingMessage = {
        data: data as ChatMessageData,
        resolve: () => {},
        reject: () => {},
        timestamp: Date.now(),
      };
      this.pendingMessages.push(pendingMessage);
      return;
    }

    this.socket.emit('chat:message', data);
  }

  /**
   * Stop agent execution
   *
   * @param data Stop data
   */
  stopAgent(data: StopAgentData): void {
    if (!this.socket?.connected) {
      return;
    }

    this.socket.emit('chat:stop', data);
  }

  /**
   * Respond to an approval request
   *
   * @param data Approval response data
   */
  respondToApproval(data: ApprovalResponseData): void {
    if (!this.socket?.connected) {
      return;
    }

    this.socket.emit('approval:response', data);
  }

  /**
   * Subscribe to agent events
   *
   * @param callback Event handler
   * @returns Unsubscribe function
   */
  onAgentEvent(callback: EventCallback<AgentEvent>): () => void {
    this.agentEventListeners.add(callback);
    return () => {
      this.agentEventListeners.delete(callback);
    };
  }

  /**
   * Subscribe to connection state changes
   *
   * @param callback Connection state handler
   * @returns Unsubscribe function
   */
  onConnectionChange(callback: EventCallback<boolean>): () => void {
    this.connectionChangeListeners.add(callback);
    return () => {
      this.connectionChangeListeners.delete(callback);
    };
  }

  /**
   * Subscribe to agent errors
   *
   * @param callback Error handler
   * @returns Unsubscribe function
   */
  onAgentError(callback: EventCallback<AgentErrorData>): () => void {
    this.errorListeners.add(callback);
    return () => {
      this.errorListeners.delete(callback);
    };
  }

  /**
   * Subscribe to session ready events
   *
   * @param callback Session ready handler
   * @returns Unsubscribe function
   */
  onSessionReady(callback: EventCallback<SessionReadyEvent>): () => void {
    this.sessionReadyListeners.add(callback);
    return () => {
      this.sessionReadyListeners.delete(callback);
    };
  }

  /**
   * Subscribe to session title update events
   *
   * @param callback Session title handler
   * @returns Unsubscribe function
   */
  onSessionTitleUpdated(callback: EventCallback<SessionTitleUpdatedEvent>): () => void {
    this.sessionTitleListeners.add(callback);
    return () => {
      this.sessionTitleListeners.delete(callback);
    };
  }

  /**
   * Subscribe to file status events (D25)
   *
   * Receives events on the file:status channel:
   * - file:readiness_changed - File transitioned between readiness states
   * - file:permanently_failed - File exhausted all retries
   *
   * @param callback Event handler
   * @returns Unsubscribe function
   */
  onFileStatusEvent(callback: EventCallback<FileWebSocketEvent>): () => void {
    this.fileStatusListeners.add(callback);
    return () => {
      this.fileStatusListeners.delete(callback);
    };
  }

  /**
   * Subscribe to file processing events (D25)
   *
   * Receives events on the file:processing channel:
   * - file:processing_progress - Progress update (0-100%)
   * - file:processing_completed - Processing finished successfully
   * - file:processing_failed - Processing failed (may retry)
   *
   * @param callback Event handler
   * @returns Unsubscribe function
   */
  onFileProcessingEvent(callback: EventCallback<FileWebSocketEvent>): () => void {
    this.fileProcessingListeners.add(callback);
    return () => {
      this.fileProcessingListeners.delete(callback);
    };
  }

  /**
   * Subscribe to job failure events (Phase 3, Task 3.3)
   *
   * Receives events on the job:failed channel when background jobs
   * fail permanently after exhausting all retries.
   *
   * @param callback Event handler
   * @returns Unsubscribe function
   */
  onJobFailureEvent(callback: EventCallback<JobFailedPayload>): () => void {
    this.jobFailureListeners.add(callback);
    return () => {
      this.jobFailureListeners.delete(callback);
    };
  }

  /**
   * Join the user room for file events (D25)
   *
   * Call this after user authentication completes to ensure
   * file processing events are received. This is necessary because
   * socket may connect before authentication completes.
   *
   * @param userId User ID to join room for
   */
  joinUserRoom(userId: string): void {
    if (!this.socket?.connected) {
      this.pendingUserRoomJoin = userId;
      return;
    }

    this.socket.emit('user:join', { userId });
  }

  // Private methods

  private setupEventListeners(): void {
    if (!this.socket) return;

    // Remove ONLY listeners that use .on() in THIS method to prevent accumulation
    // DO NOT remove 'connect', 'connect_error', 'session:ready' - they use .once() in
    // connect() and joinSession() methods and would break if removed here
    this.socket.removeAllListeners('disconnect');
    this.socket.removeAllListeners('agent:event');
    this.socket.removeAllListeners('agent:error');
    this.socket.removeAllListeners('session:title_updated');
    // File processing channels (D25)
    this.socket.removeAllListeners(FILE_WS_CHANNELS.STATUS);
    this.socket.removeAllListeners(FILE_WS_CHANNELS.PROCESSING);
    // Job failure channel (Phase 3, Task 3.3)
    this.socket.removeAllListeners(JOB_WS_CHANNELS.FAILURE);

    // Connection events
    this.socket.on('connect', () => {
      this.notifyConnectionChange(true);
      this.flushPendingMessages();
      this.flushPendingUserRoomJoin();

      // Join user room for file events (fallback if no pending join was queued)
      // This ensures file processing events are received even without an active chat session
      const userId = useAuthStore.getState().user?.id;
      if (userId && this.socket && !this.pendingUserRoomJoin) {
        this.socket.emit('user:join', { userId });
      }
    });

    this.socket.on('disconnect', () => {
      this.notifyConnectionChange(false);
    });

    this.socket.on('connect_error', () => {
      this.notifyConnectionChange(false);
    });

    // Agent events
    this.socket.on('agent:event', (event: AgentEvent) => {
      this.agentEventListeners.forEach((callback) => {
        try {
          callback(event);
        } catch (error) {
          console.error('[SocketClient] Error in agent event handler:', error);
        }
      });
    });

    // Agent errors
    this.socket.on('agent:error', (error: AgentErrorData) => {
      this.errorListeners.forEach((callback) => {
        try {
          callback(error);
        } catch (err) {
          console.error('[SocketClient] Error in error handler:', err);
        }
      });
    });

    // Session title updates
    this.socket.on('session:title_updated', (data: SessionTitleUpdatedEvent) => {
      this.sessionTitleListeners.forEach((callback) => {
        try {
          callback(data);
        } catch (err) {
          console.error('[SocketClient] Error in session title handler:', err);
        }
      });
    });

    // File status events (D25)
    this.socket.on(FILE_WS_CHANNELS.STATUS, (event: FileWebSocketEvent) => {
      this.fileStatusListeners.forEach((callback) => {
        try {
          callback(event);
        } catch (err) {
          console.error('[SocketClient] Error in file status handler:', err);
        }
      });
    });

    // File processing events (D25)
    this.socket.on(FILE_WS_CHANNELS.PROCESSING, (event: FileWebSocketEvent) => {
      this.fileProcessingListeners.forEach((callback) => {
        try {
          callback(event);
        } catch (err) {
          console.error('[SocketClient] Error in file processing handler:', err);
        }
      });
    });

    // Job failure events (Phase 3, Task 3.3)
    this.socket.on(JOB_WS_CHANNELS.FAILURE, (event: JobFailedPayload) => {
      this.jobFailureListeners.forEach((callback) => {
        try {
          callback(event);
        } catch (err) {
          console.error('[SocketClient] Error in job failure handler:', err);
        }
      });
    });
  }

  private notifyConnectionChange(connected: boolean): void {
    this.connectionChangeListeners.forEach((callback) => {
      try {
        callback(connected);
      } catch (error) {
        console.error('[SocketClient] Error in connection change handler:', error);
      }
    });
  }

  private notifySessionReady(data: SessionReadyEvent): void {
    this.sessionReadyListeners.forEach((callback) => {
      try {
        callback(data);
      } catch (error) {
        console.error('[SocketClient] Error in session ready handler:', error);
      }
    });
  }

  private flushPendingMessages(): void {
    if (!this.socket?.connected) {
      return;
    }

    while (this.pendingMessages.length > 0) {
      const pending = this.pendingMessages.shift();
      if (pending) {
        this.socket.emit('chat:message', pending.data);
        pending.resolve();
      }
    }
  }

  private flushPendingUserRoomJoin(): void {
    if (this.pendingUserRoomJoin && this.socket?.connected) {
      this.socket.emit('user:join', { userId: this.pendingUserRoomJoin });
      this.pendingUserRoomJoin = null;
    }
  }
}

// Singleton instance
let socketClientInstance: SocketClient | null = null;

/**
 * Get or create the singleton SocketClient instance
 */
export function getSocketClient(): SocketClient {
  if (!socketClientInstance) {
    socketClientInstance = new SocketClient();
  }
  return socketClientInstance;
}

/**
 * Reset the singleton (for testing)
 */
export function resetSocketClient(): void {
  socketClientInstance?.disconnect();
  socketClientInstance = null;
}
