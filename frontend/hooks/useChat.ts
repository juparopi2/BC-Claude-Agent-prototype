/**
 * useChat Hook
 *
 * Comprehensive chat management hook integrating React Query, WebSocket, and local state.
 *
 * Migration note: Replaces deprecated imports with:
 * - useWebSocket from contexts/websocket.tsx (not hooks/useSocket.ts)
 * - apiClient from lib/api-client.ts (not lib/api.ts)
 * - Types from types/api.ts and types/events.ts (not lib/types.ts)
 * - queryKeys from queries/keys.ts (not local chatKeys)
 *
 * Architecture:
 * - React Query: Handles sessions and messages fetching/caching
 * - Local State: Handles streaming UI state (isStreaming, streamingMessage, etc.)
 * - WebSocket: Handles real-time events (message chunks, thinking, tool use)
 */

import { useEffect, useCallback, useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient, type UseQueryResult, type UseMutationResult } from '@tanstack/react-query';
import { useWebSocket } from '@/contexts/websocket';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/queries/keys';
import type { Message, Session, StopReason } from '@/types/api';

/**
 * JSON-serializable value type for tool arguments and results
 */
export type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONValue[]
  | { [key: string]: JSONValue };

/**
 * Tool use message (client-side only, for UI)
 */
export interface ToolUseMessage {
  id: string;
  type: 'tool_use';
  session_id: string;
  tool_name: string;
  tool_args: Record<string, JSONValue>;
  tool_result?: JSONValue;
  status: 'pending' | 'success' | 'error';
  error_message?: string;
  created_at: string;
}

/**
 * Thinking message (client-side only, for UI)
 */
export interface ThinkingMessage {
  id: string;
  type: 'thinking';
  session_id: string;
  content?: string;
  duration_ms?: number;
  created_at: string;
}

/**
 * Union type for all message types
 */
export type ChatMessage = Message | ToolUseMessage | ThinkingMessage;

/**
 * Type guard for tool use messages
 */
export function isToolUseMessage(message: ChatMessage): message is ToolUseMessage {
  return 'type' in message && message.type === 'tool_use';
}

/**
 * Type guard for thinking messages
 */
export function isThinkingMessage(message: ChatMessage): message is ThinkingMessage {
  return 'type' in message && message.type === 'thinking';
}

/**
 * Hook for chat operations (React Query + WebSocket)
 *
 * Provides complete chat functionality including sessions, messages, streaming,
 * and real-time WebSocket events.
 *
 * @param sessionId - Optional session ID to load messages for
 * @returns Chat state and actions
 */
export function useChat(sessionId?: string) {
  const queryClient = useQueryClient();
  const { socket, isConnected } = useWebSocket();

  // Use ref to avoid stale closure issues with sessionId
  const sessionIdRef = useRef<string | undefined>(sessionId);

  // Update ref whenever sessionId changes
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // Local UI state for streaming (not server state)
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [currentSession, setCurrentSession] = useState<Session | null>(null);

  // Fetch all sessions - React Query handles deduplication automatically
  const {
    data: sessions = [],
    isLoading: sessionsLoading,
    error: sessionsError,
  }: UseQueryResult<Session[], Error> = useQuery({
    queryKey: queryKeys.sessions.lists(),
    queryFn: async () => {
      const response = await apiClient.sessions.list();
      return response.sessions || [];
    },
    staleTime: 30 * 1000, // Sessions fresh for 30 seconds
    gcTime: 5 * 60 * 1000, // Cache for 5 minutes
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  // Fetch messages for current session
  const {
    data: messages = [],
    isLoading: messagesLoading,
    error: messagesError,
  }: UseQueryResult<ChatMessage[], Error> = useQuery({
    queryKey: queryKeys.messages.list(sessionId || ''),
    queryFn: async () => {
      if (!sessionId) return [];
      const response = await apiClient.messages.list(sessionId);
      return response.messages || [];
    },
    enabled: !!sessionId, // Only fetch if sessionId exists
    staleTime: 10 * 1000, // Messages fresh for 10 seconds
    gcTime: 3 * 60 * 1000, // Cache for 3 minutes
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  // Create session mutation
  const createSessionMutation: UseMutationResult<{ session: Session }, Error, { goal?: string } | undefined> = useMutation({
    mutationFn: async (params?: { goal?: string }) => {
      const response = await apiClient.sessions.create(params?.goal);
      return { session: response.session };
    },
    onSuccess: (response) => {
      // Invalidate sessions to refetch
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions.lists() });
      // Set as current session
      setCurrentSession(response.session);
    },
  });

  // Delete session mutation
  const deleteSessionMutation: UseMutationResult<void, Error, string> = useMutation({
    mutationFn: async (id: string) => {
      await apiClient.sessions.delete(id);
    },
    onSuccess: () => {
      // Invalidate sessions to refetch
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions.lists() });
    },
  });

  // Select session (fetch and set as current)
  const selectSession = useCallback(
    async (id: string) => {
      try {
        const response = await apiClient.sessions.get(id);
        setCurrentSession(response.session);
        // Prefetch messages for this session
        await queryClient.prefetchQuery({
          queryKey: queryKeys.messages.list(id),
          queryFn: async () => {
            const messagesResponse = await apiClient.messages.list(id);
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
          console.log('[useChat] Successfully joined session room:', sessionId);
        }
      };

      // Register listener (use once to avoid duplicates)
      socket.once('session:joined', handleJoined);

      // Emit join request
      socket.emit('session:join', { sessionId });

      return () => {
        // Clean up listener if component unmounts before confirmation
        socket.off('session:joined', handleJoined);
        socket.emit('session:leave', { sessionId });
      };
    }
  }, [socket, isConnected, sessionId]);

  // Set up WebSocket event listeners
  useEffect(() => {
    if (!socket || !isConnected) return;

    // Streaming state helper
    const appendStreamChunk = (chunk: string) => {
      setStreamingMessage((prev) => prev + chunk);
    };

    // Complete message received (backend emits agent:message_complete)
    const handleMessageComplete = (data: { id?: string; content: string; role: string; stopReason?: string }) => {
      const currentSessionId = sessionIdRef.current;

      // Add message directly to cache
      const messageId = data.id || crypto.randomUUID();

      const message: Message = {
        id: messageId,
        session_id: currentSessionId || '',
        role: data.role as 'user' | 'assistant',
        content: data.content,
        stop_reason: (data.stopReason as StopReason | undefined) || null,
        created_at: new Date().toISOString(),
        thinking_tokens: 0,
        is_thinking: false,
      };

      // Add message directly to cache
      if (currentSessionId) {
        queryClient.setQueryData<ChatMessage[]>(
          queryKeys.messages.list(currentSessionId),
          (old) => [...(old || []), message]
        );
      }
    };

    // Thinking indicator (backend emits agent:thinking)
    const handleThinking = (data: { content?: string }) => {
      const isThinkingNow = !!data.content || true;
      setIsThinking(isThinkingNow);

      const currentSessionId = sessionIdRef.current;

      // Persist thinking as a message (for UI display)
      if (currentSessionId && isThinkingNow) {
        queryClient.setQueryData<ChatMessage[]>(
          queryKeys.messages.list(currentSessionId),
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
    };

    // Tool use (backend emits agent:tool_use)
    const handleToolUse = (data: { toolName: string; args: Record<string, JSONValue>; toolUseId?: string }) => {
      const currentSessionId = sessionIdRef.current;

      // Add tool use message to UI
      if (currentSessionId) {
        const toolMessage: ToolUseMessage = {
          id: data.toolUseId || crypto.randomUUID(),
          type: 'tool_use',
          session_id: currentSessionId,
          tool_name: data.toolName,
          tool_args: data.args,
          status: 'pending',
          created_at: new Date().toISOString(),
        };

        // Add tool message to messages cache
        queryClient.setQueryData<ChatMessage[]>(
          queryKeys.messages.list(currentSessionId),
          (old) => [...(old || []), toolMessage]
        );
      }
    };

    // Tool result (backend emits agent:tool_result)
    const handleToolResult = (data: { toolName: string; result: JSONValue; success: boolean; toolUseId?: string }) => {
      const currentSessionId = sessionIdRef.current;

      // Update tool use message with result
      if (currentSessionId && data.toolUseId) {
        queryClient.setQueryData<ChatMessage[]>(
          queryKeys.messages.list(currentSessionId),
          (old) => {
            const updated = old?.map(msg => {
              // Find pending tool message with matching toolUseId
              if (isToolUseMessage(msg) && msg.id === data.toolUseId && msg.status === 'pending') {
                return {
                  ...msg,
                  tool_result: data.result,
                  status: data.success ? ('success' as const) : ('error' as const),
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
      // Always append chunk (startStreaming is idempotent via setIsStreaming)
      setIsStreaming(true);
      appendStreamChunk(data.content);
    };

    // Completion (backend emits agent:complete)
    const handleComplete = () => {
      // End streaming state
      setIsStreaming(false);
      setStreamingMessage('');
      setIsThinking(false);

      const currentSessionId = sessionIdRef.current;

      // Remove thinking message from cache when agent completes
      if (currentSessionId) {
        queryClient.setQueryData<ChatMessage[]>(
          queryKeys.messages.list(currentSessionId),
          (old) => {
            // Filter out any thinking messages
            return (old || []).filter(msg => !isThinkingMessage(msg));
          }
        );
      }

      // Delay invalidation to allow database writes to complete
      if (currentSessionId) {
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: queryKeys.messages.list(currentSessionId) });
        }, 300);
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
        queryKeys.sessions.lists(),
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
    socket.on('agent:message_complete', handleMessageComplete);
    socket.on('agent:thinking', handleThinking);
    socket.on('agent:tool_use', handleToolUse);
    socket.on('agent:tool_result', handleToolResult);
    socket.on('agent:message_chunk', handleMessageChunk);
    socket.on('agent:complete', handleComplete);
    socket.on('agent:error', handleError);
    socket.on('session:title_updated', handleTitleUpdate);

    // Cleanup listeners
    return () => {
      socket.off('agent:message_complete', handleMessageComplete);
      socket.off('agent:thinking', handleThinking);
      socket.off('agent:tool_use', handleToolUse);
      socket.off('agent:tool_result', handleToolResult);
      socket.off('agent:message_chunk', handleMessageChunk);
      socket.off('agent:complete', handleComplete);
      socket.off('agent:error', handleError);
      socket.off('session:title_updated', handleTitleUpdate);
    };
  }, [socket, isConnected, queryClient, currentSession]);

  // Send message
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
      queryClient.setQueryData<ChatMessage[]>(
        queryKeys.messages.list(sessionId),
        (old) => [...(old || []), tempMessage]
      );

      // Send via WebSocket
      socket?.emit('message:send', { sessionId, content });
    },
    [sessionId, isConnected, socket, queryClient]
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
    fetchSessions: () => queryClient.invalidateQueries({ queryKey: queryKeys.sessions.lists() }),
    fetchMessages: () => sessionId ? queryClient.invalidateQueries({ queryKey: queryKeys.messages.list(sessionId) }) : Promise.resolve(),
    clearError: () => {
      queryClient.resetQueries({ queryKey: queryKeys.sessions.lists() });
      if (sessionId) {
        queryClient.resetQueries({ queryKey: queryKeys.messages.list(sessionId) });
      }
    },
  };
}
