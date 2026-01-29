/**
 * useSessionHealth Hook
 *
 * Hook for monitoring session health with automatic polling.
 *
 * @module domains/auth/hooks/useSessionHealth
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuthStore } from '../stores/authStore';
import {
  AUTH_SESSION_STATUS,
  AUTH_TIME_MS,
  type AuthSessionStatus,
} from '../constants';
import type { SessionHealthResponse } from '@bc-agent/shared';
import { env } from '@/lib/config/env';
import { debounceCancellable } from '@/lib/utils';

/**
 * Hook to track tab visibility state with debouncing
 *
 * Debounces visibility changes to prevent rapid-fire state updates
 * when switching tabs quickly.
 */
function useTabVisibility(): boolean {
  const [isVisible, setIsVisible] = useState(() =>
    typeof document !== 'undefined' ? !document.hidden : true
  );

  useEffect(() => {
    if (typeof document === 'undefined') return;

    // Debounce visibility changes to prevent rapid-fire updates
    const { fn: debouncedSetVisible, cancel } = debounceCancellable(
      (visible: boolean) => setIsVisible(visible),
      AUTH_TIME_MS.VISIBILITY_DEBOUNCE
    );

    const handleVisibilityChange = () => {
      debouncedSetVisible(!document.hidden);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      cancel();
    };
  }, []);

  return isVisible;
}

/** Options for the useSessionHealth hook */
export interface UseSessionHealthOptions {
  /** Polling interval in ms (default: 60000) */
  pollInterval?: number;
  /** Enable polling (default: true) */
  enabled?: boolean;
  /** Callback when session is about to expire */
  onExpiring?: (health: SessionHealthResponse) => void;
  /** Callback when session has expired */
  onExpired?: (health: SessionHealthResponse) => void;
}

/** Return type for useSessionHealth */
export interface UseSessionHealthResult {
  /** Current session health status */
  health: SessionHealthResponse | null;
  /** Whether the health check is loading */
  isLoading: boolean;
  /** Error message if health check failed */
  error: string | null;
  /** Manually refresh health status */
  refresh: () => Promise<void>;
  /** Whether the session is about to expire */
  isExpiring: boolean;
  /** Whether the session has expired */
  isExpired: boolean;
  /** Time until expiration in ms */
  timeUntilExpiry: number | null;
}

/**
 * Hook for monitoring session health
 *
 * Polls the /api/auth/health endpoint to monitor session state
 * and triggers callbacks when session is expiring or expired.
 *
 * @example
 * ```tsx
 * const { health, isExpiring, refresh } = useSessionHealth({
 *   onExpiring: (h) => console.log('Session expiring:', h),
 *   onExpired: (h) => router.push('/login'),
 * });
 * ```
 */
export function useSessionHealth(
  options: UseSessionHealthOptions = {}
): UseSessionHealthResult {
  const {
    pollInterval = AUTH_TIME_MS.HEALTH_POLL_INTERVAL,
    enabled = true,
    onExpiring,
    onExpired,
  } = options;

  const [health, setHealth] = useState<SessionHealthResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track previous status to detect transitions
  const prevStatusRef = useRef<AuthSessionStatus | null>(null);
  // Track if we need to check immediately when tab becomes visible
  const shouldCheckOnVisibleRef = useRef(false);
  // Track previous visibility state to detect transitions
  const prevVisibleRef = useRef(true);

  // Get auth state
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // Use ref pattern for checkAuth to avoid dependency loops.
  // checkAuth is stable (from Zustand), but including it in useCallback deps
  // creates circular dependency: fetchHealth -> checkAuth -> re-render -> fetchHealth
  const checkAuthRef = useRef(useAuthStore.getState().checkAuth);
  useEffect(() => {
    // Subscribe to checkAuth changes (though it's stable, this is defensive)
    return useAuthStore.subscribe(
      (state) => state.checkAuth,
      (checkAuth) => {
        checkAuthRef.current = checkAuth;
      }
    );
  }, []);

  // Track tab visibility
  const isTabVisible = useTabVisibility();

  // Fetch health status
  // Note: checkAuth is accessed via ref to avoid circular dependency in useCallback deps
  const fetchHealth = useCallback(async () => {
    if (!isAuthenticated) {
      setHealth(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${env.apiUrl}/api/auth/health`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status}`);
      }

      const data = (await response.json()) as SessionHealthResponse;
      setHealth(data);

      // Check for status transitions
      const prevStatus = prevStatusRef.current;
      const currentStatus = data.status;

      if (prevStatus !== currentStatus) {
        // Transitioned to expiring
        if (currentStatus === AUTH_SESSION_STATUS.EXPIRING) {
          onExpiring?.(data);
        }
        // Transitioned to expired
        else if (currentStatus === AUTH_SESSION_STATUS.EXPIRED) {
          onExpired?.(data);
        }
      }

      prevStatusRef.current = currentStatus;

      // If needs refresh and authenticated, try to refresh token proactively
      // Call dedicated /refresh endpoint first, then update auth state
      if (data.needsRefresh && data.status !== AUTH_SESSION_STATUS.EXPIRED) {
        try {
          const refreshResponse = await fetch(`${env.apiUrl}/api/auth/refresh`, {
            method: 'POST',
            credentials: 'include',
          });

          if (refreshResponse.ok) {
            // Refresh successful, update auth state
            await checkAuthRef.current();
          } else {
            // Refresh failed, but token not expired yet - just log
            console.warn('[useSessionHealth] Proactive token refresh failed:', refreshResponse.status);
          }
        } catch (refreshError) {
          console.error('[useSessionHealth] Error during proactive refresh:', refreshError);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      console.error('[useSessionHealth] Error fetching health:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, onExpiring, onExpired]);

  // Set up polling with tab visibility optimization
  // Single useEffect handles both polling and visibility changes
  useEffect(() => {
    if (!enabled || !isAuthenticated) {
      return;
    }

    // Track visibility transitions
    const wasHidden = !prevVisibleRef.current;
    const isNowVisible = isTabVisible;
    prevVisibleRef.current = isTabVisible;

    // If tab is not visible, mark that we should check when it becomes visible
    if (!isTabVisible) {
      shouldCheckOnVisibleRef.current = true;
      return;
    }

    // If we're becoming visible again and we missed a check, do it now
    if (wasHidden && isNowVisible && shouldCheckOnVisibleRef.current) {
      shouldCheckOnVisibleRef.current = false;
      fetchHealth();
    }

    // Initial fetch (only if we haven't fetched yet)
    if (health === null) {
      fetchHealth();
    }

    // Set up interval (only when tab is visible)
    const intervalId = setInterval(fetchHealth, pollInterval);

    return () => {
      clearInterval(intervalId);
    };
  }, [enabled, isAuthenticated, pollInterval, fetchHealth, isTabVisible, health]);

  // Compute derived values
  const isExpiring = health?.status === AUTH_SESSION_STATUS.EXPIRING;
  const isExpired = health?.status === AUTH_SESSION_STATUS.EXPIRED;
  const timeUntilExpiry = health?.tokenExpiresIn ?? null;

  return {
    health,
    isLoading,
    error,
    refresh: fetchHealth,
    isExpiring,
    isExpired,
    timeUntilExpiry,
  };
}
