/**
 * Socket Middleware
 *
 * Connects WebSocket events to Zustand stores.
 * Provides a hook for initializing socket with store synchronization.
 *
 * @module lib/stores/socketMiddleware
 */

import { useEffect, useRef, useCallback } from 'react';
import { getSocketService, type SocketEventHandlers } from '../services/socket';
import { useChatStore } from './chatStore';
import { useAuthStore } from './authStore';
import type { AgentEvent, AgentErrorData, SessionReadyEvent } from '@bc-agent/shared';

/**
 * Socket connection options
 */
export interface UseSocketOptions {
  /** Auto-connect on mount */
  autoConnect?: boolean;
  /** Session ID to join on connect */
  sessionId?: string;
  /** Additional event handlers */
  onAgentEvent?: (event: AgentEvent) => void;
  onError?: (error: AgentErrorData) => void;
  onSessionReady?: (data: SessionReadyEvent) => void;
  onConnectionChange?: (connected: boolean) => void;
}

/**
 * Socket hook return type
 */
export interface UseSocketReturn {
  /** Connect to WebSocket */
  connect: () => void;
  /** Disconnect from WebSocket */
  disconnect: () => void;
  /** Join a session */
  joinSession: (sessionId: string) => void;
  /** Leave a session */
  leaveSession: (sessionId: string) => void;
  /** Send a message */
  sendMessage: (message: string, options?: { enableThinking?: boolean; thinkingBudget?: number }) => void;
  /** Stop the agent */
  stopAgent: () => void;
  /** Respond to approval */
  respondToApproval: (approvalId: string, approved: boolean, reason?: string) => void;
  /** Connection status */
  isConnected: boolean;
}

/**
 * Hook to connect WebSocket with Zustand stores
 *
 * @example
 * ```tsx
 * function ChatPage() {
 *   const { sendMessage, isConnected } = useSocket({
 *     sessionId: 'my-session-id',
 *     autoConnect: true,
 *   });
 *
 *   return (
 *     <button
 *       onClick={() => sendMessage('Hello!')}
 *       disabled={!isConnected}
 *     >
 *       Send
 *     </button>
 *   );
 * }
 * ```
 */
export function useSocket(options: UseSocketOptions = {}): UseSocketReturn {
  const {
    autoConnect = true,
    sessionId,
    onAgentEvent,
    onError,
    onSessionReady,
    onConnectionChange,
  } = options;

  // Get store actions
  const handleAgentEvent = useChatStore((state) => state.handleAgentEvent);
  const setAgentBusy = useChatStore((state) => state.setAgentBusy);
  const setError = useChatStore((state) => state.setError);
  const setCurrentSession = useChatStore((state) => state.setCurrentSession);
  const addOptimisticMessage = useChatStore((state) => state.addOptimisticMessage);
  const streaming = useChatStore((state) => state.streaming);

  const user = useAuthStore((state) => state.user);

  // Track connection state
  const isConnectedRef = useRef(false);
  const currentSessionRef = useRef<string | null>(sessionId || null);

  // Create handlers that integrate with stores
  const handlers: SocketEventHandlers = {
    onAgentEvent: (event) => {
      // Update store
      handleAgentEvent(event);
      // Call custom handler
      onAgentEvent?.(event);
    },
    onAgentError: (error) => {
      setError(error.error);
      setAgentBusy(false);
      onError?.(error);
    },
    onSessionReady: (data) => {
      setCurrentSession(data.sessionId);
      onSessionReady?.(data);
    },
    onConnectionChange: (connected) => {
      isConnectedRef.current = connected;
      onConnectionChange?.(connected);
    },
  };

  // Initialize socket
  useEffect(() => {
    const socket = getSocketService(handlers);

    if (autoConnect) {
      socket.connect();
    }

    return () => {
      // Don't disconnect on unmount - let the singleton persist
      // socket.disconnect();
    };
  }, []);

  // Handle session changes
  useEffect(() => {
    const socket = getSocketService();

    if (sessionId && isConnectedRef.current) {
      socket.joinSession(sessionId);
      currentSessionRef.current = sessionId;
    }
  }, [sessionId]);

  // Connect function
  const connect = useCallback(() => {
    const socket = getSocketService(handlers);
    socket.connect();
  }, []);

  // Disconnect function
  const disconnect = useCallback(() => {
    const socket = getSocketService();
    socket.disconnect();
    isConnectedRef.current = false;
  }, []);

  // Join session function
  const joinSession = useCallback((id: string) => {
    const socket = getSocketService();
    socket.joinSession(id);
    currentSessionRef.current = id;
  }, []);

  // Leave session function
  const leaveSession = useCallback((id: string) => {
    const socket = getSocketService();
    socket.leaveSession(id);
    if (currentSessionRef.current === id) {
      currentSessionRef.current = null;
    }
  }, []);

  // Send message function
  const sendMessage = useCallback(
    (message: string, opts?: { enableThinking?: boolean; thinkingBudget?: number }) => {
      if (!user?.id || !currentSessionRef.current) {
        console.error('[useSocket] Cannot send message: no user or session');
        return;
      }

      const socket = getSocketService();

      // Add optimistic message
      const tempId = `optimistic-${Date.now()}`;
      addOptimisticMessage(tempId, {
        id: tempId,
        session_id: currentSessionRef.current,
        role: 'user',
        content: message,
        sequence_number: Date.now(), // Temporary, will be updated
        created_at: new Date().toISOString(),
      });

      // Send to server
      socket.sendMessage({
        message,
        sessionId: currentSessionRef.current,
        userId: user.id,
        thinking: opts ? {
          enableThinking: opts.enableThinking,
          thinkingBudget: opts.thinkingBudget,
        } : undefined,
      });
    },
    [user?.id, addOptimisticMessage]
  );

  // Stop agent function
  const stopAgent = useCallback(() => {
    if (!user?.id || !currentSessionRef.current) {
      return;
    }

    const socket = getSocketService();
    socket.stopAgent({
      sessionId: currentSessionRef.current,
      userId: user.id,
    });
  }, [user?.id]);

  // Respond to approval function
  const respondToApproval = useCallback(
    (approvalId: string, approved: boolean, reason?: string) => {
      if (!user?.id) {
        return;
      }

      const socket = getSocketService();
      socket.respondToApproval({
        approvalId,
        decision: approved ? 'approved' : 'rejected',
        userId: user.id,
        reason,
      });
    },
    [user?.id]
  );

  return {
    connect,
    disconnect,
    joinSession,
    leaveSession,
    sendMessage,
    stopAgent,
    respondToApproval,
    isConnected: isConnectedRef.current,
  };
}
