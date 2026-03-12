/**
 * useConnectionHealth Hook
 *
 * Proactive health monitoring for external connections (Layer 3).
 * Polls fetchConnections() periodically and on tab visibility changes.
 * Automatically attempts silent token refresh for expired connections.
 *
 * @module domains/integrations/hooks/useConnectionHealth
 */

import { useEffect, useRef, useCallback } from 'react';
import { useIntegrationListStore } from '../stores/integrationListStore';
import { CONNECTION_STATUS } from '@bc-agent/shared';

const DEFAULT_POLL_INTERVAL = 5 * 60 * 1000; // 5 minutes

export function useConnectionHealth(): void {
  const hasActiveConnections = useIntegrationListStore((s) =>
    s.connections.some(
      (c) => c.status === CONNECTION_STATUS.CONNECTED || c.status === CONNECTION_STATUS.EXPIRED
    )
  );
  const fetchConnections = useIntegrationListStore((s) => s.fetchConnections);
  const isAutoRefreshingRef = useRef(false);

  const fetchAndAutoRefresh = useCallback(async () => {
    await fetchConnections();

    // Prevent concurrent auto-refresh attempts
    if (isAutoRefreshingRef.current) return;

    const { connections, refreshConnection } = useIntegrationListStore.getState();
    const expired = connections.filter((c) => c.status === CONNECTION_STATUS.EXPIRED);
    if (expired.length === 0) return;

    isAutoRefreshingRef.current = true;
    try {
      let refreshedAny = false;
      for (const conn of expired) {
        const result = await refreshConnection(conn.id);
        if (result === 'refreshed') refreshedAny = true;
      }
      // Re-fetch to update UI if any tokens were refreshed
      if (refreshedAny) {
        await fetchConnections();
      }
    } finally {
      isAutoRefreshingRef.current = false;
    }
  }, [fetchConnections]);

  useEffect(() => {
    if (!hasActiveConnections) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchAndAutoRefresh();
      }
    };

    const intervalId = setInterval(fetchAndAutoRefresh, DEFAULT_POLL_INTERVAL);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [hasActiveConnections, fetchAndAutoRefresh]);
}
