/**
 * Auth Store
 *
 * Zustand store for authentication state.
 * Manages user session, login/logout, and auth status.
 *
 * @module domains/auth/stores/authStore
 */

import { create } from 'zustand';
import { subscribeWithSelector, persist } from 'zustand/middleware';
import { ErrorCode } from '@bc-agent/shared';
import type { UserProfile } from '@/src/infrastructure/api';
import { getApiClient } from '@/src/infrastructure/api';
import { getSocketClient } from '@/src/infrastructure/socket/SocketClient';
import { env } from '@/lib/config/env';

/**
 * Auth failure reasons to distinguish between different authentication failures
 */
export type AuthFailureReason = 'session_expired' | 'not_authenticated' | 'network_error' | null;

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
  /** Silent refresh in progress (does not unmount children) */
  isRefreshing: boolean;
  /** Auth error message */
  error: string | null;
  /** Last auth check timestamp */
  lastChecked: number | null;
  /** Reason for authentication failure (session_expired, not_authenticated, network_error) */
  authFailureReason: AuthFailureReason;
}

/**
 * Auth store actions
 */
export interface AuthActions {
  /** Check current auth status (deduplicated - concurrent calls share the same promise) */
  checkAuth: (options?: { silent?: boolean }) => Promise<boolean>;
  /** Connect socket and join user room (idempotent - safe to call multiple times) */
  connectSocket: () => Promise<void>;
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
  /** Reset store to initial state (for testing) */
  reset: () => void;
}

export type AuthStore = AuthState & AuthActions;

/**
 * Initial state
 */
const initialState: AuthState = {
  user: null,
  isAuthenticated: false,
  isLoading: true, // Start loading to check auth on mount
  isRefreshing: false,
  error: null,
  lastChecked: null,
  authFailureReason: null,
};

/**
 * Module-level promise for deduplicating concurrent checkAuth calls.
 * This ensures that if checkAuth is called multiple times concurrently
 * (e.g., from tab visibility + health check), they share the same promise.
 */
let checkAuthPromise: Promise<boolean> | null = null;

/**
 * Create auth store with persistence
 */
export const useAuthStore = create<AuthStore>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        ...initialState,

        checkAuth: async (options) => {
          // Deduplicate concurrent calls - share the same promise
          if (checkAuthPromise !== null) {
            return checkAuthPromise;
          }

          const silent = options?.silent ?? false;

          checkAuthPromise = (async (): Promise<boolean> => {
            // Silent mode: set isRefreshing (no UI unmount). Normal mode: set isLoading.
            if (silent) {
              set({ isRefreshing: true, error: null, authFailureReason: null });
            } else {
              set({ isLoading: true, error: null, authFailureReason: null });
            }

            const api = getApiClient();
            const result = await api.checkAuth();

            if (result.success) {
              const { authenticated, user } = result.data;
              set({
                isAuthenticated: authenticated,
                user: user || null,
                isLoading: false,
                isRefreshing: false,
                lastChecked: Date.now(),
                authFailureReason: null,
              });

              // Fire-and-forget: trigger file health reconciliation once per tab session.
              // sessionStorage clears on tab close → new login = new trigger.
              // Backend cooldown (5 min) is the safety net for concurrent tabs.
              if (authenticated && !sessionStorage.getItem('bc:reconciliation-triggered')) {
                sessionStorage.setItem('bc:reconciliation-triggered', '1');
                api.triggerReconciliation('login').catch(() => { /* silent — best effort */ });
              }

              return authenticated;
            } else {
              // Determine the failure reason based on the error code
              let authFailureReason: AuthFailureReason = 'not_authenticated';
              if (result.error.code === ErrorCode.SESSION_EXPIRED) {
                authFailureReason = 'session_expired';
              } else if (result.error.code === ErrorCode.SERVICE_UNAVAILABLE) {
                authFailureReason = 'network_error';
              }

              set({
                isAuthenticated: false,
                user: null,
                isLoading: false,
                isRefreshing: false,
                error: result.error.message,
                lastChecked: Date.now(),
                authFailureReason,
              });
              return false;
            }
          })().finally(() => {
            checkAuthPromise = null;
          });

          return checkAuthPromise;
        },

        connectSocket: async () => {
          const { isAuthenticated, user } = get();

          // Only connect if authenticated with a valid user
          if (!isAuthenticated || !user?.id) {
            return;
          }

          const socketClient = getSocketClient();

          if (socketClient.isConnected) {
            // Already connected (e.g., page refresh with active socket)
            // Still join user room to trigger login reconciliation
            socketClient.joinUserRoom(user.id);
            return;
          }

          try {
            await socketClient.connect({ url: env.wsUrl });
            socketClient.joinUserRoom(user.id);
          } catch (err) {
            console.error('[AuthStore] Socket connect failed:', err);
          }
        },

        setUser: (user) =>
          set({
            user,
            isAuthenticated: user !== null,
          }),

        logout: async () => {
          // Call logout endpoint via POST (not GET navigation)
          const api = getApiClient();
          try {
            await fetch(api.getLogoutUrl(), {
              method: 'POST',
              credentials: 'include',
            });
          } catch (error) {
            // Even if logout fails, clear local state and redirect
            console.warn('[AuthStore] Logout request failed:', error);
          }
          // Clear local state
          set({
            user: null,
            isAuthenticated: false,
            error: null,
            authFailureReason: null,
          });
          // Redirect to login page
          window.location.href = '/login';
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

        reset: () => set({ ...initialState, isLoading: false, isRefreshing: false }),
      }),
      {
        name: 'bc-agent-auth',
        // Persist user and authFailureReason (isAuthenticated is derived from checkAuth on mount)
        partialize: (state) => ({
          user: state.user,
          authFailureReason: state.authFailureReason,
        }),
      }
    )
  )
);

/**
 * Selector for user display name
 */
export const selectUserDisplayName = (state: AuthStore): string => {
  if (state.user?.fullName) {
    return state.user.fullName;
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

/**
 * Reset auth store for testing
 */
export function resetAuthStore(): void {
  useAuthStore.getState().reset();
}
