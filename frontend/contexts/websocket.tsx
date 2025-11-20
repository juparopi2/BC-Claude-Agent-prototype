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
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const socketInstance = io(WS_URL, {
      withCredentials: true,
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    socketInstance.on("connect", () => {
      console.log("[WebSocket] Connected:", socketInstance.id);
      setIsConnected(true);
    });

    socketInstance.on("disconnect", (reason) => {
      console.log("[WebSocket] Disconnected:", reason);
      setIsConnected(false);
    });

    socketInstance.on("connect_error", (error) => {
      console.error("[WebSocket] Connection error:", error);
      setIsConnected(false);
    });

    socketInstance.on("error", (error: { message: string }) => {
      console.error("[WebSocket] Error:", error);
      if (error.message === "Unauthorized") {
        window.location.href = "/login";
      }
    });

    setSocket(socketInstance);

    return () => {
      socketInstance.disconnect();
    };
  }, []);

  const joinSession = useCallback(
    (sessionId: string) => {
      if (!socket) return;
      console.log("[WebSocket] Joining session:", sessionId);
      socket.emit("session:join", { sessionId });
    },
    [socket]
  );

  const leaveSession = useCallback(
    (sessionId: string) => {
      if (!socket) return;
      console.log("[WebSocket] Leaving session:", sessionId);
      socket.emit("session:leave", { sessionId });
    },
    [socket]
  );

  const sendMessage = useCallback(
    (sessionId: string, content: string, userId: string) => {
      if (!socket) return;
      console.log("[WebSocket] Sending message:", { sessionId, userId });
      socket.emit("chat:message", { message: content, sessionId, userId });
    },
    [socket]
  );

  const respondToApproval = useCallback(
    (approvalId: string, approved: boolean, userId: string) => {
      if (!socket) return;
      console.log("[WebSocket] Responding to approval:", {
        approvalId,
        approved,
      });
      socket.emit("approval:respond", { approvalId, approved, userId });
    },
    [socket]
  );

  const onAgentEvent = useCallback(
    (handler: EventHandler<AgentEvent>) => {
      if (!socket) return () => {};

      socket.on("agent:event", handler);

      return () => {
        socket.off("agent:event", handler);
      };
    },
    [socket]
  );

  const onApprovalRequested = useCallback(
    (handler: EventHandler<ApprovalRequestedEvent>) => {
      if (!socket) return () => {};

      socket.on("approval:requested", handler);

      return () => {
        socket.off("approval:requested", handler);
      };
    },
    [socket]
  );

  const onApprovalResolved = useCallback(
    (handler: EventHandler<ApprovalResolvedEvent>) => {
      if (!socket) return () => {};

      socket.on("approval:resolved", handler);

      return () => {
        socket.off("approval:resolved", handler);
      };
    },
    [socket]
  );

  const value: WebSocketContextValue = {
    socket,
    isConnected,
    joinSession,
    leaveSession,
    sendMessage,
    respondToApproval,
    onAgentEvent,
    onApprovalRequested,
    onApprovalResolved,
  };

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
}
