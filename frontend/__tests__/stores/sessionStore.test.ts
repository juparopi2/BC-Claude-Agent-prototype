/**
 * Session Store Tests
 *
 * Integration tests for the session store with MSW mocks.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import {
  useSessionStore,
  selectSortedSessions,
  selectActiveSessions,
} from '@/src/domains/session';
import { server } from '../../vitest.setup';
import { errorHandlers, mockSessions } from '../mocks/handlers';

describe('SessionStore', () => {
  beforeEach(() => {
    // Reset store to initial state
    act(() => {
      useSessionStore.setState({
        sessions: [],
        currentSession: null,
        isLoading: false,
        error: null,
        lastFetched: null,
      });
    });
  });

  describe('fetchSessions', () => {
    it('should fetch and store sessions', async () => {
      await act(async () => {
        await useSessionStore.getState().fetchSessions();
      });

      const state = useSessionStore.getState();
      expect(state.sessions).toHaveLength(2);
      expect(state.isLoading).toBe(false);
      expect(state.lastFetched).toBeDefined();
    });

    it('should handle fetch errors', async () => {
      server.use(errorHandlers.serverError);

      await act(async () => {
        await useSessionStore.getState().fetchSessions();
      });

      const state = useSessionStore.getState();
      expect(state.error).toBeTruthy();
      expect(state.isLoading).toBe(false);
    });
  });

  describe('fetchSession', () => {
    it('should fetch a single session and update the list', async () => {
      // First populate sessions
      act(() => {
        useSessionStore.setState({ sessions: [...mockSessions] });
      });

      await act(async () => {
        const session = await useSessionStore.getState().fetchSession('session-1');
        expect(session).toBeDefined();
        expect(session?.id).toBe('session-1');
      });
    });

    it('should handle session not found', async () => {
      await act(async () => {
        const session = await useSessionStore.getState().fetchSession('non-existent');
        expect(session).toBeNull();
      });

      const state = useSessionStore.getState();
      expect(state.error).toBeTruthy();
    });
  });

  describe('createSession', () => {
    it('should create a new session and add it to the list', async () => {
      await act(async () => {
        const session = await useSessionStore.getState().createSession('New Chat');
        expect(session).toBeDefined();
        expect(session?.title).toBe('New Chat');
      });

      const state = useSessionStore.getState();
      expect(state.sessions).toHaveLength(1);
      expect(state.currentSession).toBeDefined();
    });
  });

  describe('updateSession', () => {
    it('should update session title', async () => {
      act(() => {
        useSessionStore.setState({
          sessions: [...mockSessions],
          currentSession: mockSessions[0],
        });
      });

      await act(async () => {
        await useSessionStore.getState().updateSession('session-1', 'Updated Title');
      });

      const state = useSessionStore.getState();
      const updatedSession = state.sessions.find((s) => s.id === 'session-1');
      expect(updatedSession?.title).toBe('Updated Title');
      expect(state.currentSession?.title).toBe('Updated Title');
    });
  });

  describe('deleteSession', () => {
    it('should delete session and remove from list', async () => {
      act(() => {
        useSessionStore.setState({
          sessions: [...mockSessions],
          currentSession: mockSessions[0],
        });
      });

      await act(async () => {
        await useSessionStore.getState().deleteSession('session-1');
      });

      const state = useSessionStore.getState();
      expect(state.sessions).toHaveLength(1);
      expect(state.sessions.find((s) => s.id === 'session-1')).toBeUndefined();
      expect(state.currentSession).toBeNull();
    });

    it('should not clear currentSession if different session is deleted', async () => {
      act(() => {
        useSessionStore.setState({
          sessions: [...mockSessions],
          currentSession: mockSessions[0],
        });
      });

      await act(async () => {
        await useSessionStore.getState().deleteSession('session-2');
      });

      const state = useSessionStore.getState();
      expect(state.currentSession).toBeDefined();
      expect(state.currentSession?.id).toBe('session-1');
    });
  });

  describe('selectSession', () => {
    it('should select session from cache', async () => {
      act(() => {
        useSessionStore.setState({ sessions: [...mockSessions] });
      });

      await act(async () => {
        await useSessionStore.getState().selectSession('session-1');
      });

      const state = useSessionStore.getState();
      expect(state.currentSession?.id).toBe('session-1');
    });

    it('should fetch session if not in cache', async () => {
      await act(async () => {
        await useSessionStore.getState().selectSession('session-1');
      });

      const state = useSessionStore.getState();
      expect(state.currentSession?.id).toBe('session-1');
    });
  });

  describe('Selectors', () => {
    it('selectSortedSessions should sort by updated_at descending', () => {
      act(() => {
        useSessionStore.setState({ sessions: [...mockSessions] });
      });

      const sorted = selectSortedSessions(useSessionStore.getState());
      // session-2 was updated more recently
      expect(sorted[0]?.id).toBe('session-2');
      expect(sorted[1]?.id).toBe('session-1');
    });

    it('selectActiveSessions should filter active sessions only', () => {
      const sessionsWithInactive = [
        ...mockSessions,
        {
          id: 'session-3',
          user_id: 'user-123',
          title: 'Inactive Chat',
          created_at: '2024-01-03T00:00:00Z',
          updated_at: '2024-01-03T00:00:00Z',
          is_active: false,
        },
      ];

      act(() => {
        useSessionStore.setState({ sessions: sessionsWithInactive });
      });

      const active = selectActiveSessions(useSessionStore.getState());
      expect(active).toHaveLength(2);
      expect(active.every((s) => s.is_active)).toBe(true);
    });
  });
});
