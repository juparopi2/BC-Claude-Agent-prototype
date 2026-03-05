/**
 * useIntegrations Hook
 *
 * Fetches connections on mount and returns current state.
 *
 * @module domains/integrations/hooks/useIntegrations
 */

import { useEffect } from 'react';
import { useIntegrationListStore } from '../stores/integrationListStore';

export function useIntegrations() {
  const connections = useIntegrationListStore((s) => s.connections);
  const isLoading = useIntegrationListStore((s) => s.isLoading);
  const error = useIntegrationListStore((s) => s.error);
  const hasFetched = useIntegrationListStore((s) => s.hasFetched);
  const fetchConnections = useIntegrationListStore((s) => s.fetchConnections);

  useEffect(() => {
    if (!hasFetched) {
      fetchConnections();
    }
  }, [hasFetched, fetchConnections]);

  return { connections, isLoading, error };
}
