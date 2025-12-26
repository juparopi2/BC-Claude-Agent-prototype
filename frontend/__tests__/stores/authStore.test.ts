/**
 * Auth Store Tests
 *
 * Integration tests for the auth store with MSW mocks.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import {
  useAuthStore,
  selectUserDisplayName,
  selectUserInitials,
} from '@/src/domains/auth';
import { server } from '../../vitest.setup';
import { errorHandlers, mockUser } from '../mocks/handlers';

describe('AuthStore', () => {
  beforeEach(() => {
    // Reset store to initial state
    act(() => {
      useAuthStore.setState({
        user: null,
        isAuthenticated: false,
        isLoading: true,
        error: null,
        lastChecked: null,
      });
    });
  });

  describe('checkAuth', () => {
    it('should check auth status and set user', async () => {
      await act(async () => {
        const isAuth = await useAuthStore.getState().checkAuth();
        expect(isAuth).toBe(true);
      });

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(true);
      expect(state.user).toEqual(mockUser);
      expect(state.isLoading).toBe(false);
      expect(state.lastChecked).toBeDefined();
    });

    it('should handle unauthorized response gracefully', async () => {
      server.use(errorHandlers.unauthorized);

      await act(async () => {
        const isAuth = await useAuthStore.getState().checkAuth();
        expect(isAuth).toBe(false);
      });

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(false);
      expect(state.user).toBeNull();
      // Note: 401 is treated as "not authenticated" (not an error)
      // This is intentional - auth check doesn't "fail", it just returns not authenticated
      expect(state.error).toBeNull();
      expect(state.isLoading).toBe(false);
    });
  });

  describe('setUser', () => {
    it('should set user and mark as authenticated', () => {
      act(() => {
        useAuthStore.getState().setUser(mockUser);
      });

      const state = useAuthStore.getState();
      expect(state.user).toEqual(mockUser);
      expect(state.isAuthenticated).toBe(true);
    });

    it('should clear user and mark as not authenticated', () => {
      act(() => {
        useAuthStore.getState().setUser(mockUser);
        useAuthStore.getState().setUser(null);
      });

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
    });
  });

  describe('getLoginUrl and getLogoutUrl', () => {
    it('should return login URL', () => {
      const loginUrl = useAuthStore.getState().getLoginUrl();
      expect(loginUrl).toContain('/api/auth/login');
    });

    it('should return logout URL', () => {
      const logoutUrl = useAuthStore.getState().getLogoutUrl();
      expect(logoutUrl).toContain('/api/auth/logout');
    });
  });

  describe('Selectors', () => {
    it('selectUserDisplayName should return display name when available', () => {
      act(() => {
        useAuthStore.setState({ user: mockUser, isAuthenticated: true });
      });

      const displayName = selectUserDisplayName(useAuthStore.getState());
      expect(displayName).toBe('Test User');
    });

    it('selectUserDisplayName should fallback to email when no display name', () => {
      act(() => {
        useAuthStore.setState({
          user: { ...mockUser, fullName: null },
          isAuthenticated: true,
        });
      });

      const displayName = selectUserDisplayName(useAuthStore.getState());
      expect(displayName).toBe('test');
    });

    it('selectUserDisplayName should return "User" when no user', () => {
      const displayName = selectUserDisplayName(useAuthStore.getState());
      expect(displayName).toBe('User');
    });

    it('selectUserInitials should return initials from display name', () => {
      act(() => {
        useAuthStore.setState({ user: mockUser, isAuthenticated: true });
      });

      const initials = selectUserInitials(useAuthStore.getState());
      expect(initials).toBe('TU'); // Test User
    });

    it('selectUserInitials should return first 2 chars when single word', () => {
      act(() => {
        useAuthStore.setState({
          user: { ...mockUser, fullName: 'Admin' },
          isAuthenticated: true,
        });
      });

      const initials = selectUserInitials(useAuthStore.getState());
      expect(initials).toBe('AD');
    });
  });
});
