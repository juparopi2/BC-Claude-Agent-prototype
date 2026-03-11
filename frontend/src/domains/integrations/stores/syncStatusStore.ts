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
  lastSyncedAt?: string;
  error?: string;
}

interface SyncStatusState {
  activeSyncs: Record<string, SyncEntry>;
}

interface SyncStatusActions {
  setSyncStatus(scopeId: string, status: SyncEntry['status'], percentage?: number): void;
  setLastSyncedAt(scopeId: string, date: string): void;
  setSyncError(scopeId: string, error: string): void;
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

  setLastSyncedAt: (scopeId, date) =>
    set((state) => ({
      activeSyncs: {
        ...state.activeSyncs,
        [scopeId]: {
          ...(state.activeSyncs[scopeId] ?? { status: 'idle', percentage: 0 }),
          lastSyncedAt: date,
        },
      },
    })),

  setSyncError: (scopeId, error) =>
    set((state) => ({
      activeSyncs: {
        ...state.activeSyncs,
        [scopeId]: {
          ...(state.activeSyncs[scopeId] ?? { status: 'error', percentage: 0 }),
          status: 'error',
          error,
        },
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
