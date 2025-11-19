import { useEffect, useCallback, useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSocket } from './useSocket';
import { chatApi } from '@/lib/api';
import {
  socketChatApi,
  SocketEvent,
  type ToolUseEventData,
} from '@/lib/socket';
import type { Message, Session, ToolUseMessage, ThinkingMessage, StopReason } from '@/lib/types';
import { isToolUseMessage, isThinkingMessage } from '@/lib/types';

/**
 * Query keys for chat data
 * Used for cache management and invalidation
 */
export const chatKeys = {
  all: ['chat'] as const,
  sessions: () => [...chatKeys.all, 'sessions'] as const,
  session: (id: string) => [...chatKeys.all, 'session', id] as const,
  messages: (sessionId: string) => [...chatKeys.all, 'messages', sessionId] as const,
};

/**
 * Hook for chat operations (React Query version)
 *
 * MIGRATION NOTE: This hook now uses React Query for server state (sessions, messages)
 * while keeping WebSocket logic for real-time features (streaming, thinking, tool use).
 *
 * Architecture:
 * - React Query: Handles sessions and messages fetching/caching
 * - Local State: Handles streaming UI state (isStreaming, streamingMessage, etc.)
 * - WebSocket: Handles real-time events (message chunks, thinking, tool use)
 *
 * Benefits:
 * - Automatic deduplication of session/message fetches
 * - Built-in caching (30s for sessions, 10s for messages)
 * - No more infinite loops from fetchSessions()
 * - WebSocket events still work exactly the same
 */
export function useChat(sessionId?: string) {
  const queryClient = useQueryClient();
  const { socket, isConnected } = useSocket();

  // ✅ FIX: Use ref to avoid stale closure issues with sessionId
  const sessionIdRef = useRef<string | undefined>(sessionId);

  // Update ref whenever sessionId changes
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // Local UI state for streaming (not server state, so not in React Query)
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [currentSession, setCurrentSession] = useState<Session | null>(null);

  // Fetch all sessions - React Query handles deduplication automatically
  const {
    data: sessions = [],
    isLoading: sessionsLoading,
    error: sessionsError,
  } = useQuery({
    queryKey: chatKeys.sessions(),
    queryFn: async () => {
      const response = await chatApi.getSessions();
      return response.sessions || [];
    },
    staleTime: 30 * 1000, // Sessions fresh for 30 seconds
    gcTime: 5 * 60 * 1000, // Cache for 5 minutes (gcTime in v5)
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  // Fetch messages for current session
  const {
    data: messages = [],
    isLoading: messagesLoading,
    error: messagesError,
  } = useQuery({
    queryKey: chatKeys.messages(sessionId || ''),
    queryFn: async () => {
      if (!sessionId) return [];
      const response = await chatApi.getMessages(sessionId);
      return response.messages || [];
    },
    enabled: !!sessionId, // Only fetch if sessionId exists
    staleTime: 10 * 1000, // Messages fresh for 10 seconds
    gcTime: 3 * 60 * 1000, // Cache for 3 minutes (gcTime in v5)
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  // Create session mutation
  const createSessionMutation = useMutation({
    mutationFn: (params?: { goal?: string }) =>
      chatApi.createSession(params?.goal),
    onSuccess: (response) => {
      // Invalidate sessions to refetch
      queryClient.invalidateQueries({ queryKey: chatKeys.sessions() });
      // Set as current session
      setCurrentSession(response.session);
      return response.session;
    },
  });

  // Delete session mutation
  const deleteSessionMutation = useMutation({
    mutationFn: (id: string) => chatApi.deleteSession(id),
    onSuccess: () => {
      // Invalidate sessions to refetch
      queryClient.invalidateQueries({ queryKey: chatKeys.sessions() });
    },
  });

  // Select session (just fetch and set as current)
  const selectSession = useCallback(
    async (id: string) => {
      try {
        const response = await chatApi.getSession(id);
        setCurrentSession(response.session);
        // Prefetch messages for this session
        await queryClient.prefetchQuery({
          queryKey: chatKeys.messages(id),
          queryFn: async () => {
            const messagesResponse = await chatApi.getMessages(id);
            return messagesResponse.messages || [];
          },
        });
      } catch (error) {
        console.error('[useChat] Failed to select session:', error);
        throw error;
      }
    },
    [queryClient]
  );

  // Join session room when connected
  useEffect(() => {
    if (socket && isConnected && sessionId) {
      // Listen for join confirmation
      const handleJoined = (data: { sessionId: string }) => {
        if (data.sessionId === sessionId) {
          // Successfully joined room
        }
      };

      // Register listener (use once to avoid duplicates)
      socket.once('session:joined', handleJoined);

      // Emit join request
      socketChatApi.joinSession(sessionId);

      return () => {
        // Clean up listener if component unmounts before confirmation
        socket.off('session:joined', handleJoined);
        socketChatApi.leaveSession(sessionId);
      };
    }
  }, [socket, isConnected, sessionId]);

  // Set up WebSocket event listeners (UNCHANGED - keep all WebSocket logic)
  useEffect(() => {
    if (!socket || !isConnected) return;

    // Streaming state helpers
    const startStreaming = () => {
      setIsStreaming(true);
      setStreamingMessage('');
    };

    const appendStreamChunk = (chunk: string) => {
      setStreamingMessage((prev) => prev + chunk);
    };

    const endStreaming = (message: Message) => {
      setIsStreaming(false);
      setStreamingMessage('');
      // ✅ FIX: Use ref to get current sessionId (avoids stale closure)
      const currentSessionId = sessionIdRef.current;
      // Manually add message to cache instead of invalidating (prevents flashing)
      if (currentSessionId) {
        queryClient.setQueryData<Message[]>(
          chatKeys.messages(currentSessionId),
          (old) => [...(old || []), message]
        );
      }
    };

    const addMessage = (message: Message) => {
      // ✅ FIX: Use ref to get current sessionId (avoids stale closure)
      const currentSessionId = sessionIdRef.current;
      // Optimistically update messages cache
      if (currentSessionId) {
        queryClient.setQueryData<Message[]>(
          chatKeys.messages(currentSessionId),
          (old) => [...(old || []), message]
        );
      }
    };

    // Complete message received (backend emits agent:message_complete)
    // NOTE: Backend now emits MULTIPLE message_complete events (one per reasoning step)
    // We should NOT end streaming here - only when agent:complete is received
    const handleMessageComplete = (data: { id?: string; content: string; role: string; stopReason?: string }) => {

      // ✅ FIX: Use ref to get current sessionId (avoids stale closure)
      const currentSessionId = sessionIdRef.current;

      // ✅ REFACTOR: Simply add message without ending streaming
      // Streaming ends only when agent:complete event is received
      const messageId = data.id || crypto.randomUUID();

      const message: Message = {
        id: messageId,
        session_id: currentSessionId || '',
        role: data.role as 'user' | 'assistant',
        content: data.content,
        stop_reason: (data.stopReason as StopReason | undefined) || null, // ⭐ Native SDK stop_reason (validated by DB constraint)
        created_at: new Date().toISOString(),
        thinking_tokens: 0,
        is_thinking: false,
      };

      // Add message directly to cache (don't call endStreaming)
      if (currentSessionId) {
        queryClient.setQueryData<Message[]>(
          chatKeys.messages(currentSessionId),
          (old) => [...(old || []), message]
        );
      }
    };

    // Thinking indicator (backend emits agent:thinking)
    const handleThinking = (data: { content?: string }) => {
      const isThinkingNow = !!data.content || true;
      setIsThinking(isThinkingNow);

      // ✅ FIX: Use ref to get current sessionId (avoids stale closure)
      const currentSessionId = sessionIdRef.current;

      // Persist thinking as a message (for UI cascade display)
      if (currentSessionId && isThinkingNow) {
        queryClient.setQueryData<Message[]>(
          chatKeys.messages(currentSessionId),
          (old) => {
            // Check if there's already a thinking message (deduplicate)
            const existingThinkingIndex = (old || []).findIndex(
              msg => isThinkingMessage(msg) && msg.session_id === currentSessionId
            );

            if (existingThinkingIndex >= 0) {
              // Update existing thinking message
              const updated = [...(old || [])];
              const existingMsg = updated[existingThinkingIndex];
              if (isThinkingMessage(existingMsg)) {
                updated[existingThinkingIndex] = {
                  ...existingMsg,
                  content: data.content,
                };
              }
              return updated;
            } else {
              // Create new thinking message
              const thinkingMessage: ThinkingMessage = {
                id: crypto.randomUUID(),
                type: 'thinking',
                session_id: currentSessionId,
                content: data.content,
                created_at: new Date().toISOString(),
              };
              return [...(old || []), thinkingMessage];
            }
          }
        );
      }

      // Don't start streaming here - let handleMessageChunk do it
      // This allows ThinkingIndicator to show briefly before streaming begins
    };

    // Tool use (backend emits agent:tool_use)
    const handleToolUse = (data: ToolUseEventData) => {
      // ✅ FIX: Use ref to get current sessionId (avoids stale closure)
      const currentSessionId = sessionIdRef.current;

      // FIX BUG #4: Add tool use message to UI
      if (currentSessionId) {
        const toolMessage: ToolUseMessage = {
          id: data.toolUseId || crypto.randomUUID(),  // Use backend-provided DB GUID (should always be provided)
          type: 'tool_use',
          session_id: currentSessionId,
          tool_name: data.toolName,
          tool_args: data.args,
          status: 'pending',
          created_at: new Date().toISOString(),
        };

        // Add tool message to messages cache
        queryClient.setQueryData<Message[]>(
          chatKeys.messages(currentSessionId),
          (old) => [...(old || []), toolMessage]
        );
      }
    };

    // Tool result (backend emits agent:tool_result)
    const handleToolResult = (data: { toolName: string; result: unknown; success: boolean; toolUseId?: string }) => {
      // ✅ FIX: Use ref to get current sessionId (avoids stale closure)
      const currentSessionId = sessionIdRef.current;

      // FIX BUG #4: Update tool use message with result
      if (currentSessionId && data.toolUseId) {
        queryClient.setQueryData<Message[]>(
          chatKeys.messages(currentSessionId),
          (old) => {
            const updated = old?.map(msg => {
              // Find pending tool message with matching toolUseId (NOT toolName)
              if (isToolUseMessage(msg) && msg.id === data.toolUseId && msg.status === 'pending') {
                return {
                  ...msg,
                  // Type assertion: backend always sends valid JSON from MCP tools
                  tool_result: data.result as import('@/lib/json-utils').JSONValue,
                  status: data.success ? 'success' as const : 'error' as const,
                  error_message: data.success ? undefined : 'Tool execution failed',
                };
              }
              return msg;
            }) || [];

            return updated;
          }
        );
      }
    };

    // Message chunk during streaming (backend emits agent:message_chunk)
    const handleMessageChunk = (data: { content: string }) => {
      // Start streaming on first chunk (this allows ThinkingIndicator to show first)
      if (!isStreaming) {
        startStreaming();
      }
      appendStreamChunk(data.content);
    };

    // Completion (backend emits agent:complete)
    const handleComplete = (data: { reason: string }) => {

      // ✅ REFACTOR: End streaming state here (not in handleMessageComplete)
      setIsStreaming(false);
      setStreamingMessage('');
      setIsThinking(false);

      // ✅ FIX: Use ref to get current sessionId (avoids stale closure)
      const currentSessionId = sessionIdRef.current;

      // ✅ FIX #3: Remove thinking message from cache when agent completes
      // Thinking messages are temporary UI state, not persisted to database
      if (currentSessionId) {
        queryClient.setQueryData<Message[]>(
          chatKeys.messages(currentSessionId),
          (old) => {
            // Filter out any thinking messages
            return (old || []).filter(msg => !isThinkingMessage(msg));
          }
        );
      }

      // ✅ FIX: Delay invalidation to allow database writes to complete
      // This prevents race condition where refetch happens before DB INSERT completes
      // With server-sent IDs (Fix #2), optimistic updates now match DB records exactly
      if (currentSessionId) {
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: chatKeys.messages(currentSessionId) });
        }, 300);  // 300ms delay ensures DB writes complete
      }
    };

    // Error (backend emits agent:error)
    const handleError = (data: { error: string }) => {
      console.error('[useChat] WebSocket error:', data.error);
    };

    // Session title updated (backend emits session:title_updated)
    const handleTitleUpdate = (data: { sessionId: string; title: string }) => {

      // Update sessions cache
      queryClient.setQueryData<Session[]>(
        chatKeys.sessions(),
        (old) => old?.map(session =>
          session.id === data.sessionId
            ? { ...session, title: data.title }
            : session
        ) || []
      );

      // Update current session if it matches
      if (currentSession?.id === data.sessionId) {
        setCurrentSession(prev => prev ? { ...prev, title: data.title } : null);
      }
    };

    // Register listeners
    socketChatApi.onMessageComplete(handleMessageComplete);
    socketChatApi.onThinking(handleThinking);
    socketChatApi.onToolUse(handleToolUse);
    socketChatApi.onToolResult(handleToolResult);
    socketChatApi.onMessageChunk(handleMessageChunk);
    socketChatApi.onComplete(handleComplete);
    socket.on(SocketEvent.ERROR, handleError);
    socket.on('session:title_updated', handleTitleUpdate);

    // Cleanup listeners
    return () => {
      socket.off(SocketEvent.MESSAGE_COMPLETE, handleMessageComplete);
      socket.off(SocketEvent.THINKING, handleThinking);
      socket.off(SocketEvent.TOOL_USE, handleToolUse);
      socket.off(SocketEvent.TOOL_RESULT, handleToolResult);
      socket.off(SocketEvent.MESSAGE_CHUNK, handleMessageChunk);
      socket.off(SocketEvent.COMPLETE, handleComplete);
      socket.off(SocketEvent.ERROR, handleError);
      socket.off('session:title_updated', handleTitleUpdate);
    };
  }, [socket, isConnected]); // ✅ FIX #4: Remove sessionId and queryClient from deps to prevent re-registration

  // Send message (UNCHANGED)
  const sendMessage = useCallback(
    async (content: string) => {
      if (!sessionId) {
        throw new Error('No active session');
      }

      if (!isConnected) {
        throw new Error('WebSocket not connected');
      }

      // Add optimistic message to cache
      const tempMessage: Message = {
        id: crypto.randomUUID(),
        session_id: sessionId,
        role: 'user',
        content,
        created_at: new Date().toISOString(),
        thinking_tokens: 0,
        is_thinking: false,
      };

      // Optimistically update cache
      queryClient.setQueryData<Message[]>(
        chatKeys.messages(sessionId),
        (old) => [...(old || []), tempMessage]
      );

      // Send via WebSocket
      socketChatApi.sendMessage(sessionId, content);
    },
    [sessionId, isConnected, queryClient]
  );

  // Wrapper functions for mutations
  const handleCreateSession = useCallback(
    async (goal?: string) => {
      const result = await createSessionMutation.mutateAsync({ goal });
      return result.session;
    },
    [createSessionMutation]
  );

  const handleDeleteSession = useCallback(
    async (id: string) => {
      await deleteSessionMutation.mutateAsync(id);
    },
    [deleteSessionMutation]
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
    messagesError: messagesError ? (messagesError instanceof Error ? messagesError.message : 'Failed to load messages') : null,
    sessionsError: sessionsError ? (sessionsError instanceof Error ? sessionsError.message : 'Failed to load sessions') : null,
    isConnected,

    // Actions
    sendMessage,
    createSession: handleCreateSession,
    selectSession,
    deleteSession: handleDeleteSession,
    fetchSessions: () => queryClient.invalidateQueries({ queryKey: chatKeys.sessions() }),
    fetchMessages: () => sessionId ? queryClient.invalidateQueries({ queryKey: chatKeys.messages(sessionId) }) : Promise.resolve(),
    clearError: () => {
      queryClient.resetQueries({ queryKey: chatKeys.sessions() });
      if (sessionId) {
        queryClient.resetQueries({ queryKey: chatKeys.messages(sessionId) });
      }
    },
  };
}
