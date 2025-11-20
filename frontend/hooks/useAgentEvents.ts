/**
 * useAgentEvents Hook
 *
 * Hook for handling agent:event WebSocket events with discriminated union.
 * Implements message accumulation and stop reason pattern.
 */

import { useEffect, useCallback } from "react";
import { useWebSocket } from "@/contexts/websocket";
import type { AgentEvent } from "@/types/events";

export interface AgentEventHandlers {
  onSessionStart?: (event: Extract<AgentEvent, { type: "session_start" }>) => void;
  onThinking?: (event: Extract<AgentEvent, { type: "thinking" }>) => void;
  onMessageChunk?: (event: Extract<AgentEvent, { type: "message_chunk" }>) => void;
  onMessage?: (event: Extract<AgentEvent, { type: "message" }>) => void;
  onToolUse?: (event: Extract<AgentEvent, { type: "tool_use" }>) => void;
  onToolResult?: (event: Extract<AgentEvent, { type: "tool_result" }>) => void;
  onComplete?: (event: Extract<AgentEvent, { type: "complete" }>) => void;
  onError?: (event: Extract<AgentEvent, { type: "error" }>) => void;
}

export function useAgentEvents(handlers: AgentEventHandlers) {
  const { onAgentEvent } = useWebSocket();

  const handleEvent = useCallback(
    (event: AgentEvent) => {
      switch (event.type) {
        case "session_start":
          handlers.onSessionStart?.(event);
          break;
        case "thinking":
          handlers.onThinking?.(event);
          break;
        case "message_chunk":
          handlers.onMessageChunk?.(event);
          break;
        case "message":
          handlers.onMessage?.(event);
          break;
        case "tool_use":
          handlers.onToolUse?.(event);
          break;
        case "tool_result":
          handlers.onToolResult?.(event);
          break;
        case "complete":
          handlers.onComplete?.(event);
          break;
        case "error":
          handlers.onError?.(event);
          break;
        default:
          console.warn("[useAgentEvents] Unknown event type:", (event as AgentEvent).type);
      }
    },
    [handlers]
  );

  useEffect(() => {
    const cleanup = onAgentEvent(handleEvent);
    return cleanup;
  }, [onAgentEvent, handleEvent]);
}
