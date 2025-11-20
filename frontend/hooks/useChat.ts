/**
 * useChat Hook
 *
 * Comprehensive chat management hook integrating React Query, WebSocket, and local state.
 *
 * Architecture:
 * - React Query: Handles sessions and messages fetching/caching with automatic deduplication
 * - Local State: Handles streaming UI state (isStreaming, streamingMessage, isThinking)
 * - WebSocket: Unified 'agent:event' listener with discriminated union for type-safe event handling
 * - Event Sourcing: Messages ordered by sequence_number (atomic Redis INCR) for correct ordering
 * - Stop Reason Pattern: 'tool_use' = intermediate, 'end_turn' = final (from Anthropic SDK)
 */

import { useEffect, useCallback, useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient, type UseQueryResult, type UseMutationResult } from '@tanstack/react-query';
import { useWebSocket } from '@/contexts/websocket';
import { useAuth } from '@/hooks/useAuth';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/queries/keys';
import type { Message, Session } from '@/types/api';
import type { AgentEvent } from '@/types/events';

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
  const { user } = useAuth();

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

  // Set up WebSocket event listeners using unified agent:event
  useEffect(() => {
    if (!socket || !isConnected) return;

    // Unified agent event handler - discriminated union pattern
    const handleAgentEvent = (event: AgentEvent) => {
      const currentSessionId = sessionIdRef.current;

      switch (event.type) {
        case 'message_chunk': {
          // Streaming chunk received
          setIsStreaming(true);
          setStreamingMessage((prev) => prev + event.content);
          break;
        }

        case 'message': {
          // Complete message received
          const message: Message = {
            id: crypto.randomUUID(),
            session_id: currentSessionId || '',
            role: 'assistant',
            content: event.content,
            stop_reason: event.stopReason || null,
            created_at: new Date().toISOString(),
            thinking_tokens: 0,
            is_thinking: false,
            sequence_number: event.sequenceNumber,
          };

          if (currentSessionId) {
            queryClient.setQueryData<ChatMessage[]>(
              queryKeys.messages.list(currentSessionId),
              (old) => {
                const updated = [...(old || []), message];
                // Sort by sequenceNumber to ensure correct ordering
                return updated.sort((a, b) => {
                  const seqA = 'sequence_number' in a ? a.sequence_number : 0;
                  const seqB = 'sequence_number' in b ? b.sequence_number : 0;
                  return (seqA ?? 0) - (seqB ?? 0);
                });
              }
            );
          }
          break;
        }

        case 'thinking': {
          // Thinking indicator
          setIsThinking(true);

          if (currentSessionId) {
            queryClient.setQueryData<ChatMessage[]>(
              queryKeys.messages.list(currentSessionId),
              (old) => {
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
                      content: event.content,
                    };
                  }
                  return updated;
                } else {
                  // Create new thinking message
                  const thinkingMessage: ThinkingMessage = {
                    id: crypto.randomUUID(),
                    type: 'thinking',
                    session_id: currentSessionId,
                    content: event.content,
                    created_at: new Date().toISOString(),
                  };
                  return [...(old || []), thinkingMessage];
                }
              }
            );
          }
          break;
        }

        case 'tool_use': {
          // Tool call detected
          if (currentSessionId) {
            const toolMessage: ToolUseMessage = {
              id: crypto.randomUUID(),
              type: 'tool_use',
              session_id: currentSessionId,
              tool_name: event.toolName,
              tool_args: event.toolArgs as Record<string, JSONValue>,
              status: 'pending',
              created_at: new Date().toISOString(),
            };

            queryClient.setQueryData<ChatMessage[]>(
              queryKeys.messages.list(currentSessionId),
              (old) => [...(old || []), toolMessage]
            );
          }
          break;
        }

        case 'tool_result': {
          // Tool result received
          if (currentSessionId) {
            queryClient.setQueryData<ChatMessage[]>(
              queryKeys.messages.list(currentSessionId),
              (old) => {
                return old?.map(msg => {
                  if (isToolUseMessage(msg) && msg.tool_name === event.toolName && msg.status === 'pending') {
                    return {
                      ...msg,
                      tool_result: event.result as JSONValue,
                      status: event.success ? ('success' as const) : ('error' as const),
                      error_message: event.error,
                    };
                  }
                  return msg;
                }) || [];
              }
            );
          }
          break;
        }

        case 'complete': {
          // Agent turn complete
          setIsStreaming(false);
          setStreamingMessage('');
          setIsThinking(false);

          if (currentSessionId) {
            // Remove thinking messages
            queryClient.setQueryData<ChatMessage[]>(
              queryKeys.messages.list(currentSessionId),
              (old) => (old || []).filter(msg => !isThinkingMessage(msg))
            );

            // Invalidate to fetch persisted messages
            setTimeout(() => {
              queryClient.invalidateQueries({ queryKey: queryKeys.messages.list(currentSessionId) });
            }, 300);
          }
          break;
        }

        case 'error': {
          // Agent error
          console.error('[useChat] Agent error:', event.error, event.code);
          setIsStreaming(false);
          setIsThinking(false);

          // Display error message to user
          if (currentSessionId) {
            const errorMessage: Message = {
              id: crypto.randomUUID(),
              session_id: currentSessionId,
              role: 'assistant',
              content: `Error: ${event.error}`,
              created_at: new Date().toISOString(),
              thinking_tokens: 0,
              is_thinking: false,
            };

            queryClient.setQueryData<ChatMessage[]>(
              queryKeys.messages.list(currentSessionId),
              (old) => [...(old || []), errorMessage]
            );
          }
          break;
        }
      }
    };

    // Session title updated (separate event, not part of agent:event union)
    const handleTitleUpdate = (data: { sessionId: string; title: string }) => {
      queryClient.setQueryData<Session[]>(
        queryKeys.sessions.lists(),
        (old) => old?.map(session =>
          session.id === data.sessionId
            ? { ...session, title: data.title }
            : session
        ) || []
      );

      if (currentSession?.id === data.sessionId) {
        setCurrentSession(prev => prev ? { ...prev, title: data.title } : null);
      }
    };

    // Register unified event listener
    socket.on('agent:event', handleAgentEvent);
    socket.on('session:title_updated', handleTitleUpdate);

    // Cleanup
    return () => {
      socket.off('agent:event', handleAgentEvent);
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

      // Get userId from auth context
      const userId = user?.id || 'guest';

      console.log('[useChat] Sending message:', {
        sessionId,
        userId,
        contentLength: content.length,
        contentPreview: content.substring(0, 100),
      });

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

      // Send via WebSocket with correct event name and payload structure
      socket?.emit('chat:message', {
        message: content,  // Backend expects 'message' not 'content'
        sessionId,
        userId,
      });
    },
    [sessionId, isConnected, socket, queryClient, user]
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
