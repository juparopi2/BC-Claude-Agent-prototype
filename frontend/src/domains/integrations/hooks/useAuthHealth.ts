/**
 * useAuthHealth Hook
 *
 * Composes authStore, connectionStore, and integrationListStore
 * to provide unified derived state across all 3 authentication layers.
 *
 * @module domains/integrations/hooks/useAuthHealth
 */

import { useAuthStore } from '@/src/domains/auth';
import { useConnectionStore } from '@/src/domains/connection';
import { useIntegrationListStore } from '../stores/integrationListStore';
import { CONNECTION_STATUS } from '@bc-agent/shared';

export function useAuthHealth() {
  // Layer 1: Main session
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const authFailureReason = useAuthStore((s) => s.authFailureReason);

  // Layer 2: WebSocket
  const wsStatus = useConnectionStore((s) => s.status);
  const isWsConnected = useConnectionStore((s) => s.isConnected);

  // Layer 3: External connections
  const connections = useIntegrationListStore((s) => s.connections);
  const expiredConnections = connections.filter(
    (c) => c.status === CONNECTION_STATUS.EXPIRED
  );
  const hasExpiredConnections = expiredConnections.length > 0;
  const activeConnections = connections.filter(
    (c) => c.status === CONNECTION_STATUS.CONNECTED
  );

  // Computed derived state
  const isFullyOperational = isAuthenticated && isWsConnected && !hasExpiredConnections;
  const hasDegradedConnectivity = isAuthenticated && hasExpiredConnections;

  return {
    // Aggregate
    isFullyOperational,
    hasDegradedConnectivity,
    // Layer 1
    isAuthenticated,
    authFailureReason,
    // Layer 2
    wsStatus,
    isWsConnected,
    // Layer 3
    connections,
    activeConnections,
    expiredConnections,
    hasExpiredConnections,
  };
}
