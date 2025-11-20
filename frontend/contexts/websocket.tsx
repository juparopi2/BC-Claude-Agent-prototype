"use client";

/**
 * WebSocket Context
 *
 * Socket.IO client context for real-time communication.
 * Uses single agent:event with discriminated union pattern.
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  useMemo,
  type ReactNode,
} from "react";
import { io, Socket } from "socket.io-client";
import type {
  AgentEvent,
  ApprovalRequestedEvent,
  ApprovalResolvedEvent,
  EventHandler,
} from "@/types/events";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "http://localhost:3002";

interface WebSocketContextValue {
  socket: Socket | null;
  isConnected: boolean;
  joinSession: (sessionId: string) => void;
  leaveSession: (sessionId: string) => void;
  joinSessionAndWait: (sessionId: string, timeoutMs?: number) => Promise<void>;
  sendMessage: (sessionId: string, content: string, userId: string) => void;
  respondToApproval: (
    approvalId: string,
    approved: boolean,
    userId: string
  ) => void;
  onAgentEvent: (handler: EventHandler<AgentEvent>) => () => void;
  onApprovalRequested: (
    handler: EventHandler<ApprovalRequestedEvent>
  ) => () => void;
  onApprovalResolved: (
    handler: EventHandler<ApprovalResolvedEvent>
  ) => () => void;
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

export function useWebSocket() {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error("useWebSocket must be used within WebSocketProvider");
  }
  return context;
}

interface WebSocketProviderProps {
  children: ReactNode;
}

export function WebSocketProvider({ children }: WebSocketProviderProps) {
  // Initialize socket immediately to avoid setState in useEffect
  const socketRef = useRef<Socket>(
    io(WS_URL, {
      withCredentials: true,
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      autoConnect: false, // Prevent auto-connect, we'll do it in useEffect
    })
  );
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const socket = socketRef.current;

    socket.on("connect", () => {
      console.log("[WebSocket] Connected:", socket.id);
      setIsConnected(true);
    });

    socket.on("disconnect", (reason) => {
      console.log("[WebSocket] Disconnected:", reason);
      setIsConnected(false);
    });

    socket.on("connect_error", (error) => {
      console.error("[WebSocket] Connection error:", error);
      setIsConnected(false);
    });

    socket.on("error", (error: { message: string }) => {
      console.error("[WebSocket] Error:", error);
      if (error.message === "Unauthorized") {
        window.location.href = "/login";
      }
    });

    // Now connect after listeners are set up
    socket.connect();

    return () => {
      socket.disconnect();
    };
  }, []);

  const joinSession = useCallback((sessionId: string) => {
    if (!socketRef.current) return;
    console.log("[WebSocket] Joining session:", sessionId);
    socketRef.current.emit("session:join", { sessionId });
  }, []);

  const leaveSession = useCallback((sessionId: string) => {
    if (!socketRef.current) return;
    console.log("[WebSocket] Leaving session:", sessionId);
    socketRef.current.emit("session:leave", { sessionId });
  }, []);

  /**
   * Join a session and wait for backend confirmation.
   *
   * Implements retry logic with exponential backoff (3 attempts max).
   * Backend emits 'session:joined' event when the room join is successful.
   *
   * @param sessionId - Session to join
   * @param timeoutMs - Timeout per attempt (default: 2000ms)
   * @returns Promise that resolves when joined, rejects on timeout/error
   *
   * @example
   * try {
   *   await joinSessionAndWait(sessionId);
   *   console.log('Successfully joined session');
   * } catch (error) {
   *   console.error('Failed to join session:', error);
   *   // Show retry UI to user
   * }
   */
  const joinSessionAndWait = useCallback(
    (sessionId: string, timeoutMs = 2000): Promise<void> => {
      return new Promise((resolve, reject) => {
        if (!socketRef.current) {
          reject(new Error("Socket not connected"));
          return;
        }

        const maxRetries = 3;
        let attemptCount = 0;

        const attemptJoin = () => {
          attemptCount++;
          console.log(
            `[WebSocket] Join attempt ${attemptCount}/${maxRetries} for session:`,
            sessionId
          );

          const timeout = setTimeout(() => {
            socketRef.current?.off("session:joined", handleJoined);

            if (attemptCount < maxRetries) {
              // Retry with exponential backoff
              const retryDelay = Math.pow(2, attemptCount - 1) * 1000; // 1s, 2s, 4s
              console.log(
                `[WebSocket] Join timeout, retrying in ${retryDelay}ms...`
              );
              setTimeout(attemptJoin, retryDelay);
            } else {
              reject(
                new Error(
                  `Room join timeout after ${maxRetries} attempts (${timeoutMs}ms each)`
                )
              );
            }
          }, timeoutMs);

          const handleJoined = (data: { sessionId: string }) => {
            if (data.sessionId === sessionId) {
              clearTimeout(timeout);
              socketRef.current?.off("session:joined", handleJoined);
              console.log("[WebSocket] Successfully joined session:", sessionId);
              resolve();
            }
          };

          socketRef.current?.once("session:joined", handleJoined);
          socketRef.current?.emit("session:join", { sessionId });
        };

        attemptJoin();
      });
    },
    []
  );

  const sendMessage = useCallback(
    (sessionId: string, content: string, userId: string) => {
      if (!socketRef.current) return;
      console.log("[WebSocket] Sending message:", { sessionId, userId });
      socketRef.current.emit("chat:message", {
        message: content,
        sessionId,
        userId,
      });
    },
    []
  );

  const respondToApproval = useCallback(
    (approvalId: string, approved: boolean, userId: string) => {
      if (!socketRef.current) return;
      console.log("[WebSocket] Responding to approval:", {
        approvalId,
        approved,
      });
      socketRef.current.emit("approval:respond", {
        approvalId,
        approved,
        userId,
      });
    },
    []
  );

  const onAgentEvent = useCallback((handler: EventHandler<AgentEvent>) => {
    if (!socketRef.current) return () => {};

    socketRef.current.on("agent:event", handler);

    return () => {
      socketRef.current?.off("agent:event", handler);
    };
  }, []);

  const onApprovalRequested = useCallback(
    (handler: EventHandler<ApprovalRequestedEvent>) => {
      if (!socketRef.current) return () => {};

      socketRef.current.on("approval:requested", handler);

      return () => {
        socketRef.current?.off("approval:requested", handler);
      };
    },
    []
  );

  const onApprovalResolved = useCallback(
    (handler: EventHandler<ApprovalResolvedEvent>) => {
      if (!socketRef.current) return () => {};

      socketRef.current.on("approval:resolved", handler);

      return () => {
        socketRef.current?.off("approval:resolved", handler);
      };
    },
    []
  );

  // Safe to access socketRef.current here as it's initialized once and never changes
  const value: WebSocketContextValue = useMemo(
    () => ({
      socket: socketRef.current,
      isConnected,
      joinSession,
      leaveSession,
      joinSessionAndWait,
      sendMessage,
      respondToApproval,
      onAgentEvent,
      onApprovalRequested,
      onApprovalResolved,
    }),
    [
      isConnected,
      joinSession,
      leaveSession,
      joinSessionAndWait,
      sendMessage,
      respondToApproval,
      onAgentEvent,
      onApprovalRequested,
      onApprovalResolved,
    ]
  );

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
}
