import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User, AuthResponse } from '@/lib/types';
import { authApi, setAuthToken, clearAuthToken } from '@/lib/api';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshAuth: () => Promise<void>;
  fetchCurrentUser: () => Promise<void>;
  clearError: () => void;
  setUser: (user: User | null) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      // Initial state
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,

      // Login action
      login: async (email: string, password: string) => {
        set({ isLoading: true, error: null });
        try {
          const response: AuthResponse = await authApi.login(email, password);

          // Set token in API client
          setAuthToken(response.accessToken);

          set({
            user: response.user,
            accessToken: response.accessToken,
            refreshToken: response.refreshToken,
            isAuthenticated: true,
            isLoading: false,
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Login failed';
          set({
            error: errorMessage,
            isLoading: false,
            isAuthenticated: false,
          });
          throw error;
        }
      },

      // Register action
      register: async (name: string, email: string, password: string) => {
        set({ isLoading: true, error: null });
        try {
          const response: AuthResponse = await authApi.register(email, password, name);

          // Set token in API client
          setAuthToken(response.accessToken);

          set({
            user: response.user,
            accessToken: response.accessToken,
            refreshToken: response.refreshToken,
            isAuthenticated: true,
            isLoading: false,
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Registration failed';
          set({
            error: errorMessage,
            isLoading: false,
            isAuthenticated: false,
          });
          throw error;
        }
      },

      // Logout action
      logout: async () => {
        try {
          await authApi.logout();
        } catch (error) {
          console.error('Logout API call failed:', error);
        } finally {
          // Clear token in API client
          clearAuthToken();

          // Clear store state
          set({
            user: null,
            accessToken: null,
            refreshToken: null,
            isAuthenticated: false,
            error: null,
          });
        }
      },

      // Refresh authentication
      refreshAuth: async () => {
        const { refreshToken } = get();
        if (!refreshToken) {
          throw new Error('No refresh token available');
        }

        set({ isLoading: true, error: null });
        try {
          const response: AuthResponse = await authApi.refresh(refreshToken);

          // Set new token in API client
          setAuthToken(response.accessToken);

          set({
            user: response.user,
            accessToken: response.accessToken,
            refreshToken: response.refreshToken,
            isAuthenticated: true,
            isLoading: false,
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Token refresh failed';
          set({
            error: errorMessage,
            isLoading: false,
            isAuthenticated: false,
          });

          // Clear tokens on refresh failure
          clearAuthToken();
          set({
            user: null,
            accessToken: null,
            refreshToken: null,
          });

          throw error;
        }
      },

      // Fetch current user
      fetchCurrentUser: async () => {
        set({ isLoading: true, error: null });
        try {
          const response = await authApi.me();
          set({
            user: response.user,
            isAuthenticated: true,
            isLoading: false,
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to fetch user';
          set({
            error: errorMessage,
            isLoading: false,
            isAuthenticated: false,
          });
          throw error;
        }
      },

      // Clear error
      clearError: () => set({ error: null }),

      // Set user (for external updates)
      setUser: (user: User | null) => set({ user }),
    }),
    {
      name: 'auth-storage', // localStorage key
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        user: state.user,
      }), // Only persist these fields
    }
  )
);
