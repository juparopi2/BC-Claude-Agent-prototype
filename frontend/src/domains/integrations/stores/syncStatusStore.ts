/**
 * Sync Status Store (PRD-107)
 *
 * Tracks active OneDrive/SharePoint sync operations for UI indicators.
 * Updated by useSyncEvents hook when WebSocket events arrive.
 *
 * @module domains/integrations/stores/syncStatusStore
 */

import { create } from 'zustand';

interface SyncEntry {
  status: 'syncing' | 'idle' | 'error';
  percentage: number;
}

interface SyncStatusState {
  activeSyncs: Record<string, SyncEntry>;
}

interface SyncStatusActions {
  setSyncStatus(scopeId: string, status: SyncEntry['status'], percentage?: number): void;
  reset(): void;
}

export const useSyncStatusStore = create<SyncStatusState & SyncStatusActions>()((set) => ({
  activeSyncs: {},

  setSyncStatus: (scopeId, status, percentage = 0) =>
    set((state) => ({
      activeSyncs: {
        ...state.activeSyncs,
        [scopeId]: { status, percentage },
      },
    })),

  reset: () => set({ activeSyncs: {} }),
}));

/**
 * Selector: whether any scope is currently syncing
 */
export function selectIsAnySyncing(state: SyncStatusState): boolean {
  return Object.values(state.activeSyncs).some((s) => s.status === 'syncing');
}
