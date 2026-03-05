/**
 * Integration List Store
 *
 * Zustand store for managing the list of external connections.
 *
 * @module domains/integrations/stores/integrationListStore
 */

import { create } from 'zustand';
import type { ConnectionSummary, ConnectionListResponse, ProviderId } from '@bc-agent/shared';
import { CONNECTIONS_API } from '@bc-agent/shared';
import { env } from '@/lib/config/env';

// ============================================
// State Interface
// ============================================

interface IntegrationListState {
  connections: ConnectionSummary[];
  isLoading: boolean;
  error: string | null;
  hasFetched: boolean;
  wizardOpen: boolean;
  wizardProviderId: ProviderId | null;
}

// ============================================
// Actions Interface
// ============================================

interface IntegrationListActions {
  fetchConnections: () => Promise<void>;
  reset: () => void;
  openWizard: (providerId: ProviderId) => void;
  closeWizard: () => void;
}

type IntegrationListStore = IntegrationListState & IntegrationListActions;

// ============================================
// Initial State
// ============================================

const initialState: IntegrationListState = {
  connections: [],
  isLoading: false,
  error: null,
  hasFetched: false,
  wizardOpen: false,
  wizardProviderId: null,
};

// ============================================
// Store
// ============================================

export const useIntegrationListStore = create<IntegrationListStore>((set, get) => ({
  ...initialState,

  fetchConnections: async () => {
    if (get().isLoading) return;

    set({ isLoading: true, error: null });

    try {
      const response = await fetch(`${env.apiUrl}${CONNECTIONS_API.BASE}`, {
        method: 'GET',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch connections: ${response.status}`);
      }

      const data: ConnectionListResponse = await response.json();

      set({
        connections: data.connections,
        isLoading: false,
        hasFetched: true,
      });
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to fetch connections',
        hasFetched: true,
      });
    }
  },

  reset: () => set(initialState),

  openWizard: (providerId) => set({ wizardOpen: true, wizardProviderId: providerId }),
  closeWizard: () => set({ wizardOpen: false, wizardProviderId: null }),
}));
