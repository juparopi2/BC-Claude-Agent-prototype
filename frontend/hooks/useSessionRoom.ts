/**
 * useSessionRoom Hook
 *
 * Hook for managing WebSocket session room lifecycle (join/leave).
 */

import { useEffect } from "react";
import { useWebSocket } from "@/contexts/websocket";

export function useSessionRoom(sessionId: string | null) {
  const { joinSession, leaveSession } = useWebSocket();

  useEffect(() => {
    if (!sessionId) return;

    console.log("[useSessionRoom] Joining session:", sessionId);
    joinSession(sessionId);

    return () => {
      console.log("[useSessionRoom] Leaving session:", sessionId);
      leaveSession(sessionId);
    };
  }, [sessionId, joinSession, leaveSession]);
}
