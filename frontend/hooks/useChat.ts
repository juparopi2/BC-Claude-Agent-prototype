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

    // Complete message received (backend emits agent:message_complete)
    const handleMessageComplete = (data: { content: string; role: string }) => {
      // Backend sends { content, role }, we need to construct full Message object
      const message: Message = {
        id: `msg-${Date.now()}-${Math.random()}`,
        session_id: sessionId || '',
        role: data.role as 'user' | 'assistant',
        content: data.content,
        created_at: new Date().toISOString(),
        thinking_tokens: 0,
        is_thinking: false,
      };
      // endStreaming also adds the message, so we pass it directly
      endStreaming(message);
    };

    // Thinking indicator (backend emits agent:thinking)
    const handleThinking = (data: { content?: string }) => {
      // When thinking starts, also start streaming
      const isThinkingNow = !!data.content || true; // Assume thinking if event is emitted
      setThinking(isThinkingNow);
      if (isThinkingNow) {
        startStreaming(); // Use thinking as signal to start streaming
      }
    };

    // Tool use (backend emits agent:tool_use)
    const handleToolUse = (data: ToolUseEventData) => {
      console.log('[useChat] Tool use:', data.toolName, data.args);
    };

    // Tool result (backend emits agent:tool_result)
    const handleToolResult = (data: { toolName: string; result: unknown; success: boolean }) => {
      console.log('[useChat] Tool result:', data.toolName, 'success:', data.success);
    };

    // Message chunk during streaming (backend emits agent:message_chunk)
    // Note: Backend sends { content: string }, NOT { chunk: string }
    const handleMessageChunk = (data: { content: string }) => {
      appendStreamChunk(data.content); // Append using backend's 'content' property
    };

    // Completion (backend emits agent:complete instead of stream_end)
    const handleComplete = (data: { reason: string }) => {
      console.log('[useChat] Agent completed, reason:', data.reason);
      setThinking(false);
      // Note: Don't call endStreaming() here, wait for agent:message_complete
    };

    // Error (backend emits agent:error)
    const handleError = (data: { error: string }) => {
      console.error('[useChat] WebSocket error:', data.error);
    };

    // Register listeners using updated API
    socketChatApi.onMessageComplete(handleMessageComplete);
    socketChatApi.onThinking(handleThinking);
    socketChatApi.onToolUse(handleToolUse);
    socketChatApi.onToolResult(handleToolResult);
    socketChatApi.onMessageChunk(handleMessageChunk);
    socketChatApi.onComplete(handleComplete);
    socket.on(SocketEvent.ERROR, handleError);

    // Cleanup listeners
    return () => {
      socket.off(SocketEvent.MESSAGE_COMPLETE, handleMessageComplete);
      socket.off(SocketEvent.THINKING, handleThinking);
      socket.off(SocketEvent.TOOL_USE, handleToolUse);
      socket.off(SocketEvent.TOOL_RESULT, handleToolResult);
      socket.off(SocketEvent.MESSAGE_CHUNK, handleMessageChunk);
      socket.off(SocketEvent.COMPLETE, handleComplete);
      socket.off(SocketEvent.ERROR, handleError);
    };
  }, [socket, isConnected, sessionId, addMessage, setThinking, startStreaming, appendStreamChunk, endStreaming]);

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

  // Create new session and return session object
  const handleCreateSession = useCallback(
    async (goal?: string) => {
      const session = await createSession(goal);
      return session; // Return full session object
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
