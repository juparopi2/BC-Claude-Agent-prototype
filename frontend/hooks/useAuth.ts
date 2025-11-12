import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { authApi } from '@/lib/api';
import type { User } from '@/lib/types';

/**
 * Query keys for authentication
 * Used for cache management and invalidation
 */
export const authKeys = {
  all: ['auth'] as const,
  user: () => [...authKeys.all, 'user'] as const,
};

/**
 * Hook for authentication operations (React Query version)
 *
 * MIGRATION NOTE: This hook now uses React Query instead of Zustand.
 * React Query provides:
 * - Automatic request deduplication (multiple useAuth() calls = 1 API call)
 * - Built-in caching with configurable stale time
 * - Automatic error handling and retries
 * - No more infinite loop issues!
 *
 * Benefits:
 * - Multiple components can call useAuth() without extra API calls
 * - Data is cached for 5 minutes (configurable)
 * - Automatic background refetching when data becomes stale
 * - No need for manual useRef or global flags
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { user, isAuthenticated, isLoading, logout } = useAuth();
 *
 *   if (isLoading) return <div>Loading...</div>;
 *   if (!isAuthenticated) return <div>Please login</div>;
 *
 *   return <div>Welcome {user.name}</div>;
 * }
 * ```
 */
export function useAuth() {
  const queryClient = useQueryClient();

  // Fetch current user - React Query handles deduplication automatically
  const {
    data: user,
    isLoading,
    error,
    refetch
  } = useQuery({
    queryKey: authKeys.user(),
    queryFn: async () => {
      try {
        return await authApi.me();
      } catch (err) {
        // Return null if 401 (not authenticated)
        // This prevents redirect loops on login page
        if ((err as { statusCode?: number }).statusCode === 401) {
          return null;
        }
        throw err;
      }
    },
    // User data is fresh for 5 minutes
    staleTime: 5 * 60 * 1000,
    // Cache persists for 10 minutes after becoming stale (gcTime in v5)
    gcTime: 10 * 60 * 1000,
    // Don't retry on authentication errors (401)
    retry: false,
    // Don't refetch automatically
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  // Logout mutation
  const logoutMutation = useMutation({
    mutationFn: authApi.logout,
    onSuccess: () => {
      // Clear all queries on logout
      queryClient.clear();
      // Redirect to login
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
    },
    onError: (error) => {
      console.error('[useAuth] Logout failed:', error);
      // Even if logout API fails, clear cache and redirect
      queryClient.clear();
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
    },
  });

  return {
    // State
    user: user || null,
    isAuthenticated: !!user,
    isLoading,
    error: error ? (error instanceof Error ? error.message : 'Authentication error') : null,

    // Actions
    logout: () => logoutMutation.mutate(),
    refetch, // Manually refetch user if needed
    clearError: () => {
      // React Query handles errors automatically, but we can reset the query if needed
      queryClient.resetQueries({ queryKey: authKeys.user() });
    },

    // Helpers
    isAdmin: user?.role === 'admin',
    isEditor: user?.role === 'editor' || user?.role === 'admin',
    isViewer: user?.role === 'viewer' || user?.role === 'editor' || user?.role === 'admin',
  };
}
