import { useEffect, useCallback } from 'react';
import { useAuthStore } from '@/store';

/**
 * Hook for authentication operations (Session-Based Auth)
 * Integrates with authStore for Microsoft OAuth session management
 */
export function useAuth() {
  const {
    user,
    isAuthenticated,
    isLoading,
    error,
    logout,
    fetchCurrentUser,
    clearError,
  } = useAuthStore();

  // Check session on mount
  useEffect(() => {
    const initAuth = async () => {
      try {
        await fetchCurrentUser();
      } catch (error) {
        console.error('Failed to fetch current user:', error);
      }
    };

    initAuth();
  }, [fetchCurrentUser]);

  // Logout handler
  const handleLogout = useCallback(async () => {
    try {
      await logout();
    } catch (error) {
      console.error('Logout failed:', error);
      throw error;
    }
  }, [logout]);

  return {
    // State
    user,
    isAuthenticated,
    isLoading,
    error,

    // Actions
    logout: handleLogout,
    clearError,

    // Helpers
    isAdmin: user?.role === 'admin',
    isEditor: user?.role === 'editor' || user?.role === 'admin',
    isViewer: user?.role === 'viewer' || user?.role === 'editor' || user?.role === 'admin',
  };
}
