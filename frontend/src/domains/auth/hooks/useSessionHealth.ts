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

/**
 * Hook to track tab visibility state
 */
function useTabVisibility(): boolean {
  const [isVisible, setIsVisible] = useState(() =>
    typeof document !== 'undefined' ? !document.hidden : true
  );

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleVisibilityChange = () => {
      setIsVisible(!document.hidden);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
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

  // Get auth state
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const checkAuth = useAuthStore((s) => s.checkAuth);

  // Track tab visibility
  const isTabVisible = useTabVisibility();

  // Fetch health status
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

      // If needs refresh and authenticated, try to refresh token
      if (data.needsRefresh && data.status !== AUTH_SESSION_STATUS.EXPIRED) {
        await checkAuth(); // This will trigger token refresh if needed
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      console.error('[useSessionHealth] Error fetching health:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, checkAuth, onExpiring, onExpired]);

  // Set up polling with tab visibility optimization
  useEffect(() => {
    if (!enabled || !isAuthenticated) {
      return;
    }

    // If tab is not visible, mark that we should check when it becomes visible
    if (!isTabVisible) {
      shouldCheckOnVisibleRef.current = true;
      return;
    }

    // If we're becoming visible again and we missed a check, do it now
    if (shouldCheckOnVisibleRef.current) {
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

  // Immediate check when tab becomes visible after being hidden
  useEffect(() => {
    if (enabled && isAuthenticated && isTabVisible && shouldCheckOnVisibleRef.current) {
      shouldCheckOnVisibleRef.current = false;
      fetchHealth();
    }
  }, [enabled, isAuthenticated, isTabVisible, fetchHealth]);

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
