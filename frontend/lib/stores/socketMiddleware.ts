/**
 * Socket Middleware
 *
 * Connects WebSocket events to Zustand stores.
 * Provides a hook for initializing socket with store synchronization.
 *
 * @module lib/stores/socketMiddleware
 */

import { useEffect, useRef, useCallback, useState, useMemo, startTransition } from 'react';
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
  sendMessage: (message: string, options?: { enableThinking?: boolean; thinkingBudget?: number; attachments?: string[] }) => void;
  /** Stop the agent */
  stopAgent: () => void;
  /** Respond to approval */
  respondToApproval: (approvalId: string, approved: boolean, reason?: string) => void;
  /** Connection status */
  isConnected: boolean;
  /** Session ready status (connected + joined room) */
  isSessionReady: boolean;
  /** Reconnecting status (pending messages waiting) */
  isReconnecting: boolean;
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

  const user = useAuthStore((state) => state.user);

  // Track connection state - initialize from actual socket state (singleton may already be connected)
  const [isConnected, setIsConnected] = useState(() => getSocketService().isConnected);
  const [isSessionReady, setIsSessionReady] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const currentSessionRef = useRef<string | null>(sessionId || null);
  const prevSessionRef = useRef<string | undefined>(undefined);

  // Create handlers that integrate with stores (memoized to prevent re-creation)
  const handlers: SocketEventHandlers = useMemo(
    () => ({
      onAgentEvent: (event) => {
        const shouldFilter = event.sessionId && event.sessionId !== currentSessionRef.current;

        // CRITICAL: Only process events for current session (prevents cross-session leakage)
        if (shouldFilter) {
          return;
        }
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
        // Only set ready if this is the current session
        if (data.sessionId === currentSessionRef.current) {
          setIsSessionReady(true);
        }
        setCurrentSession(data.sessionId);
        onSessionReady?.(data);
      },
      onConnectionChange: (connected) => {
        setIsConnected(connected);
        // FIX #6: Si se desconecta, limpiar estado de busy para evitar bloqueo permanente
        // El usuario puede volver a enviar mensajes cuando reconecte
        if (!connected) {
          setAgentBusy(false);
          setIsSessionReady(false);
        }
        onConnectionChange?.(connected);
      },
    }),
    [handleAgentEvent, setAgentBusy, setError, setCurrentSession, onAgentEvent, onError, onSessionReady, onConnectionChange]
  );

  // Initialize socket
  useEffect(() => {
    const socket = getSocketService(handlers);
    socket.setPendingChangeHandler(setIsReconnecting);

    if (autoConnect) {
      socket.connect();
    }

    return () => {
      // Don't disconnect on unmount - let the singleton persist
      // socket.disconnect();
    };
  }, [autoConnect, handlers]);

  // Handle session changes - reset ready state when session changes
  useEffect(() => {
    const socket = getSocketService();
    const sessionChanged = prevSessionRef.current !== sessionId;

    // Reset ready state when switching sessions - use startTransition to avoid cascading renders
    if (sessionChanged && prevSessionRef.current !== undefined) {
      startTransition(() => {
        setIsSessionReady(false);
      });
      // CRITICAL: Explicitly leave previous session before joining new one (prevents cross-session events)
      if (prevSessionRef.current) {
        socket.leaveSession(prevSessionRef.current);
      }
    }

    if (sessionId && isConnected) {
      // CRITICAL: Update ref BEFORE join to prevent race condition
      // The session:ready event handler checks currentSessionRef.current
      currentSessionRef.current = sessionId;
      socket.joinSession(sessionId);
    }

    // Update ref for next render
    prevSessionRef.current = sessionId;
  }, [sessionId, isConnected]);

  // Connect function
  const connect = useCallback(() => {
    const socket = getSocketService(handlers);
    socket.connect();
  }, [handlers]);

  // Disconnect function
  const disconnect = useCallback(() => {
    const socket = getSocketService();
    socket.disconnect();
    setIsConnected(false);
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
    (message: string, opts?: { enableThinking?: boolean; thinkingBudget?: number; attachments?: string[] }) => {
      if (!user?.id || !currentSessionRef.current) {
        return;
      }

      // NEW: Validate thinkingBudget before emission
      if (opts?.enableThinking && opts?.thinkingBudget !== undefined) {
        if (opts.thinkingBudget < 1024 || opts.thinkingBudget > 100000) {
          const error = new Error(
            'thinkingBudget must be between 1024 and 100000'
          );
          console.error('[useSocket] Invalid thinking budget:', opts.thinkingBudget);
          throw error;
        }
      }

      const socket = getSocketService();

      // Add optimistic message
      const tempId = `optimistic-${Date.now()}`;
      addOptimisticMessage(tempId, {
        type: 'standard',
        id: tempId,
        session_id: currentSessionRef.current,
        role: 'user',
        content: message,
        sequence_number: Date.now(), // Temporary, will be updated
        created_at: new Date().toISOString(),
        // Note: attachments are not optimistically displayed in the message thread yet,
        // but would be handled here if needed in future
      });

      // Send to server
      socket.sendMessage({
        message,
        sessionId: currentSessionRef.current,
        userId: user.id,
        thinking: opts?.enableThinking !== undefined ? {
          enableThinking: opts.enableThinking,
          thinkingBudget: opts.thinkingBudget,
        } : undefined,
        attachments: opts?.attachments, // Pass attachments to server
      });
    },
    [user, addOptimisticMessage]
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
  }, [user]);

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
    [user]
  );

  return {
    connect,
    disconnect,
    joinSession,
    leaveSession,
    sendMessage,
    stopAgent,
    respondToApproval,
    isConnected,
    isSessionReady,
    isReconnecting,
  };
}
