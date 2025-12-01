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
   * Update event handlers
   */
  setHandlers(handlers: Partial<SocketEventHandlers>): void {
    this.handlers = { ...this.handlers, ...handlers };
  }

  /**
   * Join a session room
   */
  joinSession(sessionId: string): void {
    if (!this.socket?.connected) {
      console.warn('[SocketService] Cannot join session: not connected');
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
  sendMessage(data: Omit<ChatMessageData, 'thinking'> & { thinking?: ExtendedThinkingConfig }): void {
    if (!this.socket?.connected) {
      console.error('[SocketService] Cannot send message: not connected');
      return;
    }

    this.socket.emit('chat:message', data);
  }

  /**
   * Stop agent execution
   */
  stopAgent(data: StopAgentData): void {
    if (!this.socket?.connected) {
      console.error('[SocketService] Cannot stop agent: not connected');
      return;
    }

    this.socket.emit('chat:stop', data);
  }

  /**
   * Respond to an approval request
   */
  respondToApproval(data: Omit<ApprovalResponseData, 'approved'> & { approved: boolean }): void {
    if (!this.socket?.connected) {
      console.error('[SocketService] Cannot respond to approval: not connected');
      return;
    }

    this.socket.emit('approval:respond', data);
  }

  /**
   * Set up Socket.IO event listeners
   */
  private setupEventListeners(): void {
    if (!this.socket) return;

    // Connection events
    this.socket.on('connect', () => {
      if (env.debug) {
        console.log('[SocketService] Connected');
      }
      this.handlers.onConnectionChange?.(true);

      // Rejoin session if we had one
      if (this.currentSessionId) {
        this.joinSession(this.currentSessionId);
      }
    });

    this.socket.on('disconnect', (reason) => {
      if (env.debug) {
        console.log('[SocketService] Disconnected:', reason);
      }
      this.handlers.onConnectionChange?.(false);
    });

    this.socket.on('connect_error', (error) => {
      console.error('[SocketService] Connection error:', error.message);
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
