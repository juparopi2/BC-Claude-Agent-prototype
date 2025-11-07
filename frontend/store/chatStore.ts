import { create } from 'zustand';
import type { Session, Message } from '@/lib/types';
import { chatApi } from '@/lib/api';

interface ChatState {
  // Sessions
  sessions: Session[];
  currentSession: Session | null;
  sessionsLoading: boolean;
  sessionsError: string | null;

  // Messages
  messages: Message[];
  messagesLoading: boolean;
  messagesError: string | null;

  // Streaming
  isStreaming: boolean;
  streamingMessage: string;
  isThinking: boolean;

  // Actions - Sessions
  fetchSessions: () => Promise<void>;
  createSession: (goal?: string) => Promise<Session>;
  selectSession: (sessionId: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  clearCurrentSession: () => void;

  // Actions - Messages
  fetchMessages: (sessionId: string) => Promise<void>;
  sendMessage: (sessionId: string, content: string) => Promise<void>;
  addMessage: (message: Message) => void;
  updateMessage: (messageId: string, updates: Partial<Message>) => void;

  // Actions - Streaming
  startStreaming: () => void;
  appendStreamChunk: (chunk: string) => void;
  endStreaming: (finalMessage: Message) => void;
  setThinking: (isThinking: boolean) => void;

  // Actions - Utility
  clearError: () => void;
  reset: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  // Initial state - Sessions
  sessions: [],
  currentSession: null,
  sessionsLoading: false,
  sessionsError: null,

  // Initial state - Messages
  messages: [],
  messagesLoading: false,
  messagesError: null,

  // Initial state - Streaming
  isStreaming: false,
  streamingMessage: '',
  isThinking: false,

  // Fetch all sessions
  fetchSessions: async () => {
    set({ sessionsLoading: true, sessionsError: null });
    try {
      const response = await chatApi.getSessions();
      const sessions = response.sessions || [];
      set({ sessions, sessionsLoading: false });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch sessions';
      set({ sessionsError: errorMessage, sessionsLoading: false });
      throw error;
    }
  },

  // Create new session
  createSession: async (goal?: string) => {
    set({ sessionsLoading: true, sessionsError: null });
    try {
      const response = await chatApi.createSession(goal);
      const session = response.session;
      set((state) => ({
        sessions: [session, ...state.sessions],
        currentSession: session,
        messages: [], // Clear messages when creating new session
        sessionsLoading: false,
      }));
      return session;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to create session';
      set({ sessionsError: errorMessage, sessionsLoading: false });
      throw error;
    }
  },

  // Select (and fetch) a session
  selectSession: async (sessionId: string) => {
    set({ sessionsLoading: true, sessionsError: null });
    try {
      const response = await chatApi.getSession(sessionId);
      set({
        currentSession: response.session,
        sessionsLoading: false,
      });

      // Fetch messages for this session
      await get().fetchMessages(sessionId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to select session';
      set({ sessionsError: errorMessage, sessionsLoading: false });
      throw error;
    }
  },

  // Delete session
  deleteSession: async (sessionId: string) => {
    try {
      await chatApi.deleteSession(sessionId);
      set((state) => ({
        sessions: state.sessions.filter((s) => s.id !== sessionId),
        currentSession: state.currentSession?.id === sessionId ? null : state.currentSession,
        messages: state.currentSession?.id === sessionId ? [] : state.messages,
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to delete session';
      set({ sessionsError: errorMessage });
      throw error;
    }
  },

  // Clear current session
  clearCurrentSession: () => {
    set({ currentSession: null, messages: [] });
  },

  // Fetch messages for a session
  fetchMessages: async (sessionId: string) => {
    set({ messagesLoading: true, messagesError: null });
    try {
      const response = await chatApi.getMessages(sessionId);
      const messages = response.messages || [];
      set({ messages, messagesLoading: false });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch messages';
      set({ messagesError: errorMessage, messagesLoading: false });
      throw error;
    }
  },

  // Send message (via WebSocket, actual message will be added via WebSocket event)
  sendMessage: async (sessionId: string, content: string) => {
    try {
      // Optimistically add user message to UI
      const userMessage: Message = {
        id: `temp-${Date.now()}`, // Temporary ID
        session_id: sessionId,
        role: 'user',
        content,
        created_at: new Date().toISOString(),
        thinking_tokens: 0,
        is_thinking: false,
      };

      set((state) => ({
        messages: [...state.messages, userMessage],
      }));

      // Actual send happens via WebSocket in useChat hook
      // The message will be replaced with server-confirmed message via WebSocket event
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to send message';
      set({ messagesError: errorMessage });
      throw error;
    }
  },

  // Add message (from WebSocket event)
  addMessage: (message: Message) => {
    set((state) => {
      // Remove any temporary message with same content
      const filteredMessages = state.messages.filter(
        (m) => !(m.id.startsWith('temp-') && m.content === message.content)
      );
      return { messages: [...filteredMessages, message] };
    });
  },

  // Update message (for partial updates)
  updateMessage: (messageId: string, updates: Partial<Message>) => {
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId ? { ...m, ...updates } : m
      ),
    }));
  },

  // Start streaming
  startStreaming: () => {
    set({ isStreaming: true, streamingMessage: '' });
  },

  // Append chunk to streaming message
  appendStreamChunk: (chunk: string) => {
    set((state) => ({
      streamingMessage: state.streamingMessage + chunk,
    }));
  },

  // End streaming and add final message
  endStreaming: (finalMessage: Message) => {
    set((state) => ({
      isStreaming: false,
      streamingMessage: '',
      messages: [...state.messages, finalMessage],
    }));
  },

  // Set thinking state
  setThinking: (isThinking: boolean) => {
    set({ isThinking });
  },

  // Clear error
  clearError: () => {
    set({ sessionsError: null, messagesError: null });
  },

  // Reset entire store
  reset: () => {
    set({
      sessions: [],
      currentSession: null,
      sessionsLoading: false,
      sessionsError: null,
      messages: [],
      messagesLoading: false,
      messagesError: null,
      isStreaming: false,
      streamingMessage: '',
      isThinking: false,
    });
  },
}));
