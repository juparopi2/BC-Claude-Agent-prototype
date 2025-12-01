/**
 * Auth Store
 *
 * Zustand store for authentication state.
 * Manages user session, login/logout, and auth status.
 *
 * @module lib/stores/authStore
 */

import { create } from 'zustand';
import { subscribeWithSelector, persist } from 'zustand/middleware';
import type { UserProfile } from '../services/api';
import { getApiClient } from '../services/api';

/**
 * Auth store state
 */
export interface AuthState {
  /** Current user profile */
  user: UserProfile | null;
  /** Authentication status */
  isAuthenticated: boolean;
  /** Loading state during auth check */
  isLoading: boolean;
  /** Auth error message */
  error: string | null;
  /** Last auth check timestamp */
  lastChecked: number | null;
}

/**
 * Auth store actions
 */
export interface AuthActions {
  /** Check current auth status */
  checkAuth: () => Promise<boolean>;
  /** Set user profile */
  setUser: (user: UserProfile | null) => void;
  /** Clear auth state (logout) */
  logout: () => void;
  /** Set loading state */
  setLoading: (loading: boolean) => void;
  /** Set error */
  setError: (error: string | null) => void;
  /** Get login URL */
  getLoginUrl: () => string;
  /** Get logout URL */
  getLogoutUrl: () => string;
}

export type AuthStore = AuthState & AuthActions;

/**
 * Initial state
 */
const initialState: AuthState = {
  user: null,
  isAuthenticated: false,
  isLoading: true, // Start loading to check auth on mount
  error: null,
  lastChecked: null,
};

/**
 * Create auth store with persistence
 */
export const useAuthStore = create<AuthStore>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        ...initialState,

        checkAuth: async () => {
          set({ isLoading: true, error: null });

          const api = getApiClient();
          const result = await api.checkAuth();

          if (result.success) {
            const { authenticated, user } = result.data;
            set({
              isAuthenticated: authenticated,
              user: user || null,
              isLoading: false,
              lastChecked: Date.now(),
            });
            return authenticated;
          } else {
            set({
              isAuthenticated: false,
              user: null,
              isLoading: false,
              error: result.error.message,
              lastChecked: Date.now(),
            });
            return false;
          }
        },

        setUser: (user) =>
          set({
            user,
            isAuthenticated: user !== null,
          }),

        logout: () => {
          // Navigate to logout URL (will clear session on server)
          const api = getApiClient();
          window.location.href = api.getLogoutUrl();
        },

        setLoading: (isLoading) => set({ isLoading }),

        setError: (error) => set({ error }),

        getLoginUrl: () => {
          const api = getApiClient();
          return api.getLoginUrl();
        },

        getLogoutUrl: () => {
          const api = getApiClient();
          return api.getLogoutUrl();
        },
      }),
      {
        name: 'bc-agent-auth',
        // Only persist user and isAuthenticated
        partialize: (state) => ({
          user: state.user,
          isAuthenticated: state.isAuthenticated,
        }),
      }
    )
  )
);

/**
 * Selector for user display name
 */
export const selectUserDisplayName = (state: AuthStore): string => {
  if (state.user?.display_name) {
    return state.user.display_name;
  }
  if (state.user?.email) {
    return state.user.email.split('@')[0] || 'User';
  }
  return 'User';
};

/**
 * Selector for user initials
 */
export const selectUserInitials = (state: AuthStore): string => {
  const name = selectUserDisplayName(state);
  const parts = name.split(' ');
  if (parts.length >= 2) {
    return `${parts[0]?.[0] || ''}${parts[1]?.[0] || ''}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
};
