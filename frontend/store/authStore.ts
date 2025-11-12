/**
 * Auth Store (Microsoft OAuth Session-Based)
 *
 * Simplified authentication store for Microsoft OAuth 2.0 flow.
 * Authentication state is managed server-side via express-session.
 * Frontend only checks session validity by calling /api/auth/me.
 */

import { create } from 'zustand';
import type { User } from '@/lib/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchCurrentUser: () => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
  setUser: (user: User | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  // Initial state
  user: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,

  // Fetch current user from session (server-side check)
  fetchCurrentUser: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await fetch(`${API_URL}/api/auth/me`, {
        method: 'GET',
        credentials: 'include', // Send cookies (session)
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          // Not authenticated - clear state
          set({
            user: null,
            isAuthenticated: false,
            isLoading: false,
          });
          return;
        }
        throw new Error('Failed to fetch user');
      }

      const data = await response.json();

      // Transform backend user to frontend User type
      const user: User = {
        id: data.id,
        email: data.email || data.microsoftEmail,
        name: data.fullName || data.name || data.email,
        role: data.role,
        created_at: data.created_at || new Date().toISOString(),
      };

      set({
        user,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch user';
      set({
        error: errorMessage,
        isLoading: false,
        isAuthenticated: false,
        user: null,
      });
    }
  },

  // Logout action
  logout: async () => {
    set({ isLoading: true });
    try {
      await fetch(`${API_URL}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include', // Send cookies (session)
        headers: {
          'Content-Type': 'application/json',
        },
      });
    } catch (error) {
      console.error('Logout API call failed:', error);
    } finally {
      // Clear store state
      set({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: null,
      });
    }
  },

  // Clear error
  clearError: () => {
    set({ error: null });
  },

  // Set user (for manual override if needed)
  setUser: (user: User | null) => {
    set({
      user,
      isAuthenticated: !!user,
    });
  },
}));
