import { useEffect, useCallback } from 'react';
import { useChatStore } from '@/store';
import { useSocket } from './useSocket';
import {
  socketChatApi,
  SocketEvent,
  type MessageEventData,
  type ThinkingEventData,
  type ToolUseEventData,
  type StreamChunkEventData,
} from '@/lib/socket';
import type { Message } from '@/lib/types';

/**
 * Hook for chat operations
 * Integrates with chatStore and WebSocket for real-time messaging
 */
export function useChat(sessionId?: string) {
  const { socket, isConnected } = useSocket();

  const {
    sessions,
    currentSession,
    messages,
    isStreaming,
    streamingMessage,
    isThinking,
    messagesLoading,
    sessionsLoading,
    messagesError,
    sessionsError,
    fetchSessions,
    createSession,
    selectSession,
    deleteSession,
    fetchMessages,
    addMessage,
    updateMessage,
    startStreaming,
    appendStreamChunk,
    endStreaming,
    setThinking,
    clearError,
  } = useChatStore();

  // Join session room when connected
  useEffect(() => {
    if (socket && isConnected && sessionId) {
      socketChatApi.joinSession(sessionId);

      return () => {
        socketChatApi.leaveSession(sessionId);
      };
    }
  }, [socket, isConnected, sessionId]);

  // Set up WebSocket event listeners
  useEffect(() => {
    if (!socket || !isConnected) return;

    // Message received
    const handleMessage = (data: MessageEventData) => {
      addMessage(data.message);
    };

    // Thinking indicator
    const handleThinking = (data: ThinkingEventData) => {
      setThinking(data.isThinking);
    };

    // Tool use (for logging/UI)
    const handleToolUse = (data: ToolUseEventData) => {
      console.log('[useChat] Tool use:', data.toolName, data.args);
    };

    // Stream start
    const handleStreamStart = () => {
      startStreaming();
    };

    // Stream chunk
    const handleStreamChunk = (data: StreamChunkEventData) => {
      appendStreamChunk(data.chunk);
    };

    // Stream end
    const handleStreamEnd = (data: { sessionId: string }) => {
      // Create a temporary message with the streamed content
      // The actual message will be added via the regular message event
      console.log('[useChat] Stream ended for session:', data.sessionId);
      // Just stop streaming, the message will be handled by onMessage
      setThinking(false);
    };

    // Error
    const handleError = (data: { error: string }) => {
      console.error('[useChat] WebSocket error:', data.error);
    };

    // Register listeners
    socketChatApi.onMessage(handleMessage);
    socketChatApi.onThinking(handleThinking);
    socketChatApi.onToolUse(handleToolUse);
    socketChatApi.onStreamStart(handleStreamStart);
    socketChatApi.onStreamChunk(handleStreamChunk);
    socketChatApi.onStreamEnd(handleStreamEnd);
    socket.on(SocketEvent.ERROR, handleError);

    // Cleanup listeners
    return () => {
      socket.off(SocketEvent.MESSAGE, handleMessage);
      socket.off(SocketEvent.THINKING, handleThinking);
      socket.off(SocketEvent.TOOL_USE, handleToolUse);
      socket.off(SocketEvent.STREAM_START, handleStreamStart);
      socket.off(SocketEvent.STREAM_CHUNK, handleStreamChunk);
      socket.off(SocketEvent.STREAM_END, handleStreamEnd);
      socket.off(SocketEvent.ERROR, handleError);
    };
  }, [socket, isConnected, addMessage, setThinking, startStreaming, appendStreamChunk, endStreaming]);

  // Send message
  const sendMessage = useCallback(
    async (content: string) => {
      if (!sessionId) {
        throw new Error('No active session');
      }

      if (!isConnected) {
        throw new Error('WebSocket not connected');
      }

      // Add optimistic message to store
      const tempMessage: Message = {
        id: `temp-${Date.now()}`,
        session_id: sessionId,
        role: 'user',
        content,
        created_at: new Date().toISOString(),
        thinking_tokens: 0,
        is_thinking: false,
      };

      addMessage(tempMessage);

      // Send via WebSocket
      socketChatApi.sendMessage(sessionId, content);
    },
    [sessionId, isConnected, addMessage]
  );

  // Create new session and return session ID
  const handleCreateSession = useCallback(
    async (goal?: string) => {
      const session = await createSession(goal);
      return session.id; // Return just the ID for convenience
    },
    [createSession]
  );

  // Select session and load messages
  const handleSelectSession = useCallback(
    async (id: string) => {
      await selectSession(id);
    },
    [selectSession]
  );

  // Delete session
  const handleDeleteSession = useCallback(
    async (id: string) => {
      await deleteSession(id);
    },
    [deleteSession]
  );

  return {
    // State
    sessions,
    currentSession,
    messages,
    isStreaming,
    streamingMessage,
    isThinking,
    messagesLoading,
    sessionsLoading,
    messagesError,
    sessionsError,
    isConnected,

    // Actions
    sendMessage,
    createSession: handleCreateSession,
    selectSession: handleSelectSession,
    deleteSession: handleDeleteSession,
    fetchSessions,
    fetchMessages,
    clearError,
  };
}
