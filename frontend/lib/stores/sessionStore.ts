/**
 * Session Store
 *
 * Zustand store for session management.
 * Handles session list, creation, updates, and deletion.
 *
 * @module lib/stores/sessionStore
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { Session } from '../services/api';
import { getApiClient } from '../services/api';

/**
 * Session store state
 */
export interface SessionState {
  /** List of user's sessions */
  sessions: Session[];
  /** Currently active session */
  currentSession: Session | null;
  /** Loading state */
  isLoading: boolean;
  /** Error message */
  error: string | null;
  /** Last fetch timestamp */
  lastFetched: number | null;
}

/**
 * Session store actions
 */
export interface SessionActions {
  // Fetch sessions
  fetchSessions: () => Promise<void>;
  fetchSession: (sessionId: string) => Promise<Session | null>;

  // Session management
  createSession: (title?: string, initialMessage?: string) => Promise<Session | null>;
  updateSession: (sessionId: string, title: string) => Promise<void>;
  setSessionTitle: (sessionId: string, title: string) => void;
  deleteSession: (sessionId: string) => Promise<void>;

  // Current session
  setCurrentSession: (session: Session | null) => void;
  selectSession: (sessionId: string) => Promise<void>;

  // State management
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearSessions: () => void;
}

export type SessionStore = SessionState & SessionActions;

/**
 * Initial state
 */
const initialState: SessionState = {
  sessions: [],
  currentSession: null,
  isLoading: false,
  error: null,
  lastFetched: null,
};

/**
 * Create session store
 */
export const useSessionStore = create<SessionStore>()(
  subscribeWithSelector((set, get) => ({
    ...initialState,

    // ========================================
    // Fetch sessions
    // ========================================
    fetchSessions: async () => {
      set({ isLoading: true, error: null });

      const api = getApiClient();
      const result = await api.getSessions();

      if (result.success) {
        set({
          sessions: result.data,
          isLoading: false,
          lastFetched: Date.now(),
        });
      } else {
        set({
          error: result.error.message,
          isLoading: false,
        });
      }
    },

    fetchSession: async (sessionId) => {
      const api = getApiClient();
      const result = await api.getSession(sessionId);

      if (result.success) {
        // Update session in list if it exists
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === sessionId ? result.data : s
          ),
        }));
        return result.data;
      } else {
        set({ error: result.error.message });
        return null;
      }
    },

    // ========================================
    // Session management
    // ========================================
    createSession: async (title, initialMessage) => {
      set({ isLoading: true, error: null });

      const api = getApiClient();
      const result = await api.createSession({ title, initialMessage });

      if (result.success) {
        set((state) => ({
          sessions: [result.data, ...state.sessions],
          currentSession: result.data,
          isLoading: false,
        }));
        return result.data;
      } else {
        set({
          error: result.error.message,
          isLoading: false,
        });
        return null;
      }
    },

    updateSession: async (sessionId, title) => {
      const api = getApiClient();
      const result = await api.updateSession(sessionId, { title });

      if (result.success) {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === sessionId ? { ...s, title } : s
          ),
          currentSession:
            state.currentSession?.id === sessionId
              ? { ...state.currentSession, title }
              : state.currentSession,
        }));
      } else {
        set({ error: result.error.message });
      }
    },

    setSessionTitle: (sessionId, title) => {
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === sessionId ? { ...s, title } : s
        ),
        currentSession:
          state.currentSession?.id === sessionId
            ? { ...state.currentSession, title }
            : state.currentSession,
      }));
    },

    deleteSession: async (sessionId) => {
      const api = getApiClient();
      const result = await api.deleteSession(sessionId);

      if (result.success) {
        set((state) => ({
          sessions: state.sessions.filter((s) => s.id !== sessionId),
          currentSession:
            state.currentSession?.id === sessionId
              ? null
              : state.currentSession,
        }));
      } else {
        set({ error: result.error.message });
      }
    },

    // ========================================
    // Current session
    // ========================================
    setCurrentSession: (session) => set({ currentSession: session }),

    selectSession: async (sessionId) => {
      const { sessions, fetchSession } = get();

      // Check if session is in cache
      let session = sessions.find((s) => s.id === sessionId);

      if (!session) {
        // Fetch from server
        session = await fetchSession(sessionId) || undefined;
      }

      if (session) {
        set({ currentSession: session });
      }
    },

    // ========================================
    // State management
    // ========================================
    setLoading: (isLoading) => set({ isLoading }),
    setError: (error) => set({ error }),
    clearSessions: () => set(initialState),
  }))
);

/**
 * Selector for sorted sessions (newest first)
 */
export const selectSortedSessions = (state: SessionStore): Session[] => {
  return [...state.sessions].sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  );
};

/**
 * Selector for active sessions
 */
export const selectActiveSessions = (state: SessionStore): Session[] => {
  return state.sessions.filter((s) => s.is_active);
};
