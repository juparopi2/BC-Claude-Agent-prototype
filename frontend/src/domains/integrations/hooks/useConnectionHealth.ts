/**
 * useConnectionHealth Hook
 *
 * Proactive health monitoring for external connections (Layer 3).
 * Polls fetchConnections() periodically and on tab visibility changes.
 *
 * @module domains/integrations/hooks/useConnectionHealth
 */

import { useEffect } from 'react';
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

  useEffect(() => {
    if (!hasActiveConnections) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchConnections();
      }
    };

    const intervalId = setInterval(fetchConnections, DEFAULT_POLL_INTERVAL);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [hasActiveConnections, fetchConnections]);
}
