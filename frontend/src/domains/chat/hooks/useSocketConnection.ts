/**
 * useSocketConnection Hook
 *
 * Connects WebSocket events to domain stores using the new infrastructure.
 * Provides real-time communication with the backend agent.
 *
 * @module domains/chat/hooks/useSocketConnection
 */

import { useEffect, useRef, useCallback, useState, useMemo, startTransition } from 'react';
import { getSocketClient } from '@/src/infrastructure/socket';
import { useAuthStore } from '@/src/domains/auth';
import { env } from '@/lib/config/env';
import type { AgentEvent, AgentErrorData, SessionReadyEvent } from '@bc-agent/shared';
import { processAgentEvent, getMessageStore, getStreamingStore, getCitationStore } from '@/src/domains/chat';

/**
 * Socket connection options
 */
export interface UseSocketConnectionOptions {
  /** Auto-connect on mount */
  autoConnect?: boolean;
  /** Session ID to join on connect */
  sessionId?: string;
  /** Additional event handlers */
  onAgentEvent?: (event: AgentEvent) => void;
  onError?: (error: AgentErrorData) => void;
  onSessionReady?: (data: SessionReadyEvent) => void;
  onConnectionChange?: (connected: boolean) => void;
  /** Callbacks for UI state updates */
  onAgentBusyChange?: (busy: boolean) => void;
  onCitationsReceived?: (citations: Map<string, string>) => void;
}

/**
 * Socket hook return type
 */
export interface UseSocketConnectionReturn {
  /** Connect to WebSocket */
  connect: () => Promise<void>;
  /** Disconnect from WebSocket */
  disconnect: () => void;
  /** Join a session */
  joinSession: (sessionId: string) => Promise<void>;
  /** Leave a session */
  leaveSession: (sessionId: string) => void;
  /** Send a message */
  sendMessage: (
    message: string,
    options?: {
      enableThinking?: boolean;
      thinkingBudget?: number;
      attachments?: string[];
      enableAutoSemanticSearch?: boolean;
    }
  ) => void;
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
 * Hook for WebSocket connection using new infrastructure.
 *
 * @example
 * ```tsx
 * function ChatPage({ sessionId }) {
 *   const {
 *     sendMessage,
 *     isConnected,
 *     isSessionReady,
 *   } = useSocketConnection({
 *     sessionId,
 *     autoConnect: true,
 *     onAgentBusyChange: (busy) => setAgentBusy(busy),
 *   });
 *
 *   return (
 *     <button
 *       onClick={() => sendMessage('Hello!')}
 *       disabled={!isSessionReady}
 *     >
 *       Send
 *     </button>
 *   );
 * }
 * ```
 */
export function useSocketConnection(
  options: UseSocketConnectionOptions = {}
): UseSocketConnectionReturn {
  const {
    autoConnect = true,
    sessionId,
    onAgentEvent,
    onError,
    onSessionReady,
    onConnectionChange,
    onAgentBusyChange,
    onCitationsReceived,
  } = options;

  const user = useAuthStore((state) => state.user);

  // Track connection state
  const [isConnected, setIsConnected] = useState(() => getSocketClient().isConnected);
  const [isSessionReady, setIsSessionReady] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);

  const currentSessionRef = useRef<string | null>(sessionId || null);
  const prevSessionRef = useRef<string | undefined>(undefined);

  // Memoize callbacks for processAgentEvent
  const processCallbacks = useMemo(
    () => ({
      onAgentBusyChange,
      onError: (error: string) => {
        onError?.({ error });
      },
      onCitationsReceived: (citations: Map<string, string>) => {
        // Update citation store
        getCitationStore().getState().setCitationMap(citations);
        // Also call external handler if provided
        onCitationsReceived?.(citations);
      },
    }),
    [onAgentBusyChange, onError, onCitationsReceived]
  );

  // Connect to socket server
  const connect = useCallback(async () => {
    const client = getSocketClient();

    if (client.isConnected) {
      return;
    }

    try {
      await client.connect({ url: env.wsUrl });
    } catch (error) {
      console.error('[useSocketConnection] Connect failed:', error);
      throw error;
    }
  }, []);

  // Disconnect from socket server
  const disconnect = useCallback(() => {
    const client = getSocketClient();
    client.disconnect();
    setIsConnected(false);
    setIsSessionReady(false);
  }, []);

  // Join a session
  const joinSession = useCallback(async (id: string) => {
    const client = getSocketClient();

    if (!client.isConnected) {
      throw new Error('Not connected');
    }

    currentSessionRef.current = id;
    await client.joinSession(id);
    setIsSessionReady(true);
  }, []);

  // Leave a session
  const leaveSession = useCallback((id: string) => {
    const client = getSocketClient();
    client.leaveSession(id);

    if (currentSessionRef.current === id) {
      currentSessionRef.current = null;
      setIsSessionReady(false);
    }
  }, []);

  // Send a message
  const sendMessage = useCallback(
    (
      message: string,
      opts?: {
        enableThinking?: boolean;
        thinkingBudget?: number;
        attachments?: string[];
        enableAutoSemanticSearch?: boolean;
      }
    ) => {
      if (!user?.id || !currentSessionRef.current) {
        console.warn('[useSocketConnection] Cannot send: no user or session');
        return;
      }

      // Validate thinkingBudget
      if (opts?.enableThinking && opts?.thinkingBudget !== undefined) {
        if (opts.thinkingBudget < 1024 || opts.thinkingBudget > 100000) {
          throw new Error('thinkingBudget must be between 1024 and 100000');
        }
      }

      const client = getSocketClient();

      // Add optimistic message
      const tempId = `optimistic-${Date.now()}`;
      getMessageStore().getState().addOptimisticMessage(tempId, {
        type: 'standard',
        id: tempId,
        session_id: currentSessionRef.current,
        role: 'user',
        content: message,
        sequence_number: Date.now(),
        created_at: new Date().toISOString(),
      });

      // Send to server
      client.sendMessage({
        message,
        sessionId: currentSessionRef.current,
        userId: user.id,
        thinking: opts?.enableThinking !== undefined
          ? {
              enableThinking: opts.enableThinking,
              thinkingBudget: opts.thinkingBudget,
            }
          : undefined,
        attachments: opts?.attachments,
        enableAutoSemanticSearch: opts?.enableAutoSemanticSearch,
      });

      // Update reconnecting state based on pending messages
      setIsReconnecting(client.hasPendingMessages);
    },
    [user]
  );

  // Stop agent execution
  const stopAgent = useCallback(() => {
    if (!user?.id || !currentSessionRef.current) {
      return;
    }

    const client = getSocketClient();
    client.stopAgent({
      sessionId: currentSessionRef.current,
      userId: user.id,
    });
  }, [user]);

  // Respond to approval request
  const respondToApproval = useCallback(
    (approvalId: string, approved: boolean, reason?: string) => {
      if (!user?.id) {
        return;
      }

      const client = getSocketClient();
      client.respondToApproval({
        approvalId,
        decision: approved ? 'approved' : 'rejected',
        userId: user.id,
        reason,
      });
    },
    [user]
  );

  // Setup event listeners on mount
  useEffect(() => {
    const client = getSocketClient();

    // Subscribe to agent events
    const unsubscribeAgentEvent = client.onAgentEvent((event) => {
      // Filter events for current session only
      if (event.sessionId && event.sessionId !== currentSessionRef.current) {
        return;
      }

      // Process through domain stores
      processAgentEvent(event, processCallbacks);

      // Call custom handler
      onAgentEvent?.(event);
    });

    // Subscribe to connection changes
    const unsubscribeConnection = client.onConnectionChange((connected) => {
      setIsConnected(connected);

      if (!connected) {
        // Reset states on disconnect
        onAgentBusyChange?.(false);
        setIsSessionReady(false);
      }

      onConnectionChange?.(connected);
    });

    // Subscribe to errors
    const unsubscribeError = client.onAgentError((error) => {
      onAgentBusyChange?.(false);
      onError?.(error);
    });

    // Subscribe to session ready
    const unsubscribeSessionReady = client.onSessionReady((data) => {
      if (data.sessionId === currentSessionRef.current) {
        setIsSessionReady(true);
      }
      onSessionReady?.(data);
    });

    // Auto-connect if enabled
    if (autoConnect) {
      connect().catch((error) => {
        console.error('[useSocketConnection] Auto-connect failed:', error);
      });
    }

    return () => {
      unsubscribeAgentEvent();
      unsubscribeConnection();
      unsubscribeError();
      unsubscribeSessionReady();
    };
  }, [
    autoConnect,
    connect,
    processCallbacks,
    onAgentEvent,
    onAgentBusyChange,
    onConnectionChange,
    onError,
    onSessionReady,
  ]);

  // Handle session changes
  useEffect(() => {
    const sessionChanged = prevSessionRef.current !== sessionId;

    if (sessionChanged && prevSessionRef.current !== undefined) {
      startTransition(() => {
        setIsSessionReady(false);
      });

      // Leave previous session
      if (prevSessionRef.current) {
        leaveSession(prevSessionRef.current);
      }
    }

    if (sessionId && isConnected) {
      currentSessionRef.current = sessionId;

      // Join new session
      joinSession(sessionId).catch((error) => {
        console.error('[useSocketConnection] Join session failed:', error);
      });
    }

    prevSessionRef.current = sessionId;
  }, [sessionId, isConnected, joinSession, leaveSession]);

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
