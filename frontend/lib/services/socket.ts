/**
 * WebSocket Service
 *
 * Type-safe Socket.IO client for real-time communication with the backend.
 * Uses types from @bc-agent/shared for guaranteed frontend-backend contract.
 *
 * @module lib/services/socket
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
} from '@bc-agent/shared';
import { env } from '../config/env';
import { SocketLogMessages } from '../constants/logMessages';

/**
 * Socket event handlers
 */
export interface SocketEventHandlers {
  /** Handle agent events (messages, tools, approvals, etc.) */
  onAgentEvent?: (event: AgentEvent) => void;
  /** Handle agent errors */
  onAgentError?: (error: AgentErrorData) => void;
  /** Handle session ready confirmation */
  onSessionReady?: (data: SessionReadyEvent) => void;
  /** Handle connection state changes */
  onConnectionChange?: (connected: boolean) => void;
  /** Handle session joined confirmation */
  onSessionJoined?: (data: { sessionId: string }) => void;
  /** Handle session left confirmation */
  onSessionLeft?: (data: { sessionId: string }) => void;
  /** Handle session errors */
  onSessionError?: (error: { error: string; sessionId?: string }) => void;
  /** Handle session title update */
  onSessionTitleUpdated?: (data: { sessionId: string; title: string }) => void;
}

/**
 * Pending message queued when socket is not connected
 */
interface PendingMessage {
  data: Omit<ChatMessageData, 'thinking'> & { thinking?: ExtendedThinkingConfig; attachments?: string[] };
  resolve: () => void;
  reject: (err: Error) => void;
}

/**
 * Pending session join queued when socket is not connected
 */
interface PendingSessionJoin {
  sessionId: string;
}

/**
 * Socket Service Class
 *
 * Manages WebSocket connection and provides type-safe event handling.
 *
 * @example
 * ```typescript
 * const socket = new SocketService({
 *   onAgentEvent: (event) => {
 *     switch (event.type) {
 *       case 'message':
 *         console.log(event.content);
 *         break;
 *       case 'tool_use':
 *         console.log(event.toolName, event.args);
 *         break;
 *     }
 *   },
 *   onConnectionChange: (connected) => {
 *     console.log('Connected:', connected);
 *   },
 * });
 *
 * socket.connect();
 * socket.joinSession('session-uuid');
 * socket.sendMessage({
 *   message: 'Hello',
 *   sessionId: 'session-uuid',
 *   userId: 'user-uuid',
 * });
 * ```
 */
export class SocketService {
  private socket: Socket | null = null;
  private handlers: SocketEventHandlers;
  private currentSessionId: string | null = null;
  private pendingMessages: PendingMessage[] = [];
  private pendingSessionJoins: PendingSessionJoin[] = [];
  private onPendingChange?: (hasPending: boolean) => void;

  constructor(handlers: SocketEventHandlers = {}) {
    this.handlers = handlers;
  }

  /**
   * Connect to the WebSocket server
   */
  connect(): void {
    if (this.socket?.connected) {
      return;
    }

    this.socket = io(env.wsUrl, {
      transports: ['websocket', 'polling'],
      withCredentials: true,
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    this.setupEventListeners();
  }

  /**
   * Disconnect from the WebSocket server
   */
  disconnect(): void {
    if (this.currentSessionId) {
      this.leaveSession(this.currentSessionId);
    }
    this.socket?.disconnect();
    this.socket = null;
    this.currentSessionId = null;
  }

  /**
   * Check if connected
   */
  get isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  /**
   * Get current session ID
   */
  get sessionId(): string | null {
    return this.currentSessionId;
  }

  /**
   * Check if there are pending messages
   */
  get hasPendingMessages(): boolean {
    return this.pendingMessages.length > 0 || this.pendingSessionJoins.length > 0;
  }

  /**
   * Update event handlers
   */
  setHandlers(handlers: Partial<SocketEventHandlers>): void {
    this.handlers = { ...this.handlers, ...handlers };
  }

  /**
   * Set callback for pending state changes
   */
  setPendingChangeHandler(handler: (hasPending: boolean) => void): void {
    this.onPendingChange = handler;
  }

  /**
   * Join a session room
   */
  joinSession(sessionId: string): void {
    if (!this.socket?.connected) {
      console.warn(SocketLogMessages.JOIN_SESSION_NOT_CONNECTED);
      // Queue the session join
      this.pendingSessionJoins.push({ sessionId });
      this.onPendingChange?.(true);
      return;
    }

    // Leave current session if different
    if (this.currentSessionId && this.currentSessionId !== sessionId) {
      this.leaveSession(this.currentSessionId);
    }

    this.socket.emit('session:join', { sessionId });
    this.currentSessionId = sessionId;
  }

  /**
   * Leave a session room
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
   */
  sendMessage(data: Omit<ChatMessageData, 'thinking'> & { thinking?: ExtendedThinkingConfig; attachments?: string[] }): void {
    if (!this.socket?.connected) {
      console.warn(SocketLogMessages.SEND_MESSAGE_NOT_CONNECTED);
      // Queue the message with a promise
      const pendingMessage: PendingMessage = {
        data,
        resolve: () => {},
        reject: () => {},
      };
      this.pendingMessages.push(pendingMessage);
      this.onPendingChange?.(true);
      return;
    }

    this.socket.emit('chat:message', data);
  }

  /**
   * Stop agent execution
   */
  stopAgent(data: StopAgentData): void {
    if (!this.socket?.connected) {
      console.error(SocketLogMessages.STOP_AGENT_NOT_CONNECTED);
      return;
    }

    this.socket.emit('chat:stop', data);
  }

  /**
   * Respond to an approval request
   */
  respondToApproval(data: ApprovalResponseData): void {
    if (!this.socket?.connected) {
      console.error(SocketLogMessages.APPROVAL_RESPONSE_NOT_CONNECTED);
      return;
    }

    this.socket.emit('approval:response', data);
  }

  /**
   * Flush pending messages when socket connects
   */
  private flushPendingMessages(): void {
    if (!this.socket?.connected) {
      return;
    }

    // Flush pending session joins first
    while (this.pendingSessionJoins.length > 0) {
      const pendingJoin = this.pendingSessionJoins.shift();
      if (pendingJoin) {
        console.log('[SocketService] Flushing pending session join:', pendingJoin.sessionId);
        this.joinSession(pendingJoin.sessionId);
      }
    }

    // Flush pending messages
    while (this.pendingMessages.length > 0) {
      const pendingMessage = this.pendingMessages.shift();
      if (pendingMessage) {
        console.log('[SocketService] Flushing pending message');
        this.socket.emit('chat:message', pendingMessage.data);
        pendingMessage.resolve();
      }
    }

    // Clear arrays and notify
    this.pendingMessages = [];
    this.pendingSessionJoins = [];
    this.onPendingChange?.(false);
  }

  /**
   * Set up Socket.IO event listeners
   */
  private setupEventListeners(): void {
    if (!this.socket) return;

    // Connection events
    this.socket.on('connect', () => {
      if (env.debug) {
        console.log(SocketLogMessages.CONNECTED);
      }
      this.handlers.onConnectionChange?.(true);

      // Rejoin session if we had one
      if (this.currentSessionId) {
        this.joinSession(this.currentSessionId);
      }

      // Flush any pending messages/session joins
      this.flushPendingMessages();
    });

    this.socket.on('disconnect', (reason) => {
      if (env.debug) {
        console.log(SocketLogMessages.DISCONNECTED, reason);
      }
      this.handlers.onConnectionChange?.(false);
    });

    this.socket.on('connect_error', (error) => {
      console.error(SocketLogMessages.CONNECTION_ERROR, error.message);
      this.handlers.onConnectionChange?.(false);
    });

    // Agent events (single event type for all agent activities)
    this.socket.on('agent:event', (event: AgentEvent) => {
      if (env.debug) {
        console.log('[SocketService] Agent event:', event.type);
      }
      this.handlers.onAgentEvent?.(event);
    });

    // Agent errors
    this.socket.on('agent:error', (error: AgentErrorData) => {
      console.error('[SocketService] Agent error:', error);
      this.handlers.onAgentError?.(error);
    });

    // Session events
    this.socket.on('session:ready', (data: SessionReadyEvent) => {
      if (env.debug) {
        console.log('[SocketService] Session ready:', data.sessionId);
      }
      this.handlers.onSessionReady?.(data);
    });

    this.socket.on('session:joined', (data: { sessionId: string }) => {
      if (env.debug) {
        console.log('[SocketService] Session joined:', data.sessionId);
      }
      this.handlers.onSessionJoined?.(data);
    });

    this.socket.on('session:left', (data: { sessionId: string }) => {
      if (env.debug) {
        console.log('[SocketService] Session left:', data.sessionId);
      }
      this.handlers.onSessionLeft?.(data);
    });

    this.socket.on('session:error', (error: { error: string; sessionId?: string }) => {
      console.error('[SocketService] Session error:', error);
      this.handlers.onSessionError?.(error);
    });

    this.socket.on('session:title_updated', (data: { sessionId: string; title: string }) => {
      if (env.debug) {
        console.log('[SocketService] Session title updated:', data);
      }
      this.handlers.onSessionTitleUpdated?.(data);
    });
  }
}

/**
 * Singleton socket instance
 * Use this for global access across the app
 */
let socketInstance: SocketService | null = null;

/**
 * Get or create the singleton socket instance
 */
export function getSocketService(handlers?: SocketEventHandlers): SocketService {
  if (!socketInstance) {
    socketInstance = new SocketService(handlers);
  } else if (handlers) {
    socketInstance.setHandlers(handlers);
  }
  return socketInstance;
}

/**
 * Reset the singleton (for testing)
 */
export function resetSocketService(): void {
  socketInstance?.disconnect();
  socketInstance = null;
}
