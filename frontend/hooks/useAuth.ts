import { useEffect, useCallback } from 'react';
import { useAuthStore } from '@/store';
import { setAuthToken } from '@/lib/api';

/**
 * Hook for authentication operations
 * Integrates with authStore and provides auth actions
 */
export function useAuth() {
  const {
    user,
    isAuthenticated,
    isLoading,
    error,
    accessToken,
    login,
    register,
    logout,
    refreshAuth,
    fetchCurrentUser,
    clearError,
  } = useAuthStore();

  // Initialize auth token on mount
  useEffect(() => {
    if (accessToken) {
      setAuthToken(accessToken);
    }
  }, [accessToken]);

  // Auto-refresh token on mount if we have a refresh token
  useEffect(() => {
    const initAuth = async () => {
      if (accessToken && !user) {
        try {
          await fetchCurrentUser();
        } catch (error) {
          console.error('Failed to fetch current user:', error);
          // Token might be expired, try refresh
          try {
            await refreshAuth();
          } catch (refreshError) {
            console.error('Failed to refresh token:', refreshError);
            // Logout on refresh failure
            await logout();
          }
        }
      }
    };

    initAuth();
  }, []); // Only run once on mount

  // Login handler
  const handleLogin = useCallback(
    async (email: string, password: string) => {
      try {
        await login(email, password);
      } catch (error) {
        console.error('Login failed:', error);
        throw error;
      }
    },
    [login]
  );

  // Register handler
  const handleRegister = useCallback(
    async (name: string, email: string, password: string) => {
      try {
        await register(name, email, password);
      } catch (error) {
        console.error('Registration failed:', error);
        throw error;
      }
    },
    [register]
  );

  // Logout handler
  const handleLogout = useCallback(async () => {
    try {
      await logout();
    } catch (error) {
      console.error('Logout failed:', error);
      throw error;
    }
  }, [logout]);

  // Refresh handler
  const handleRefresh = useCallback(async () => {
    try {
      await refreshAuth();
    } catch (error) {
      console.error('Token refresh failed:', error);
      throw error;
    }
  }, [refreshAuth]);

  return {
    // State
    user,
    isAuthenticated,
    isLoading,
    error,

    // Actions
    login: handleLogin,
    register: handleRegister,
    logout: handleLogout,
    refreshAuth: handleRefresh,
    clearError,

    // Helpers
    isAdmin: user?.role === 'admin',
    isEditor: user?.role === 'editor' || user?.role === 'admin',
    isViewer: user?.role === 'viewer' || user?.role === 'editor' || user?.role === 'admin',
  };
}
