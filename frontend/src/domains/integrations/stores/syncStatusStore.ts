/**
 * Sync Status Store (PRD-107, PRD-116)
 *
 * Tracks active OneDrive/SharePoint sync operations for UI indicators.
 * Updated by useSyncEvents hook when WebSocket events arrive.
 * Also tracks SyncOperations for the SyncProgressPanel (PRD-116).
 *
 * @module domains/integrations/stores/syncStatusStore
 */

import { create } from 'zustand';

interface SyncEntry {
  status: 'syncing' | 'processing' | 'idle' | 'error';
  percentage: number;
  processingTotal: number;
  processingCompleted: number;
  processingFailed: number;
  lastSyncedAt?: string;
  error?: string;
}

// ============================================
// PRD-116: Operation tracking
// ============================================

export interface SyncOperation {
  operationKey: string;       // `${connectionId}:${Date.now()}`
  connectionId: string;
  providerName: string;       // 'OneDrive' | 'SharePoint'
  scopeIds: string[];
  status: 'syncing' | 'complete' | 'error';
  createdAt: number;
  dismissed: boolean;
}

interface SyncStatusState {
  activeSyncs: Record<string, SyncEntry>;
  operations: Map<string, SyncOperation>;
}

interface SyncStatusActions {
  setSyncStatus(scopeId: string, status: SyncEntry['status'], percentage?: number): void;
  setLastSyncedAt(scopeId: string, date: string): void;
  setSyncError(scopeId: string, error: string): void;
  setProcessingProgress(scopeId: string, data: { total: number; completed: number; failed: number }): void;
  reset(): void;
  // PRD-116: Operation actions
  startOperation(op: Omit<SyncOperation, 'status' | 'createdAt' | 'dismissed'>): void;
  completeScope(scopeId: string): void;
  failScope(scopeId: string, error: string): void;
  dismissOperation(operationKey: string): void;
  removeOperation(operationKey: string): void;
}

export const useSyncStatusStore = create<SyncStatusState & SyncStatusActions>()((set) => ({
  activeSyncs: {},
  operations: new Map(),

  setSyncStatus: (scopeId, status, percentage = 0) =>
    set((state) => ({
      activeSyncs: {
        ...state.activeSyncs,
        [scopeId]: {
          ...state.activeSyncs[scopeId],
          status,
          percentage,
          processingTotal: state.activeSyncs[scopeId]?.processingTotal ?? 0,
          processingCompleted: state.activeSyncs[scopeId]?.processingCompleted ?? 0,
          processingFailed: state.activeSyncs[scopeId]?.processingFailed ?? 0,
        },
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

  setProcessingProgress: (scopeId, data) =>
    set((state) => {
      const totalDone = data.completed + data.failed;
      const percentage = data.total > 0 ? Math.round((totalDone / data.total) * 100) : 0;
      return {
        activeSyncs: {
          ...state.activeSyncs,
          [scopeId]: {
            ...state.activeSyncs[scopeId],
            status: 'processing' as const,
            percentage,
            processingTotal: data.total,
            processingCompleted: data.completed,
            processingFailed: data.failed,
          },
        },
      };
    }),

  reset: () => set({ activeSyncs: {}, operations: new Map() }),

  // PRD-116: Creates a new operation with status='syncing'
  startOperation: (op) =>
    set((state) => {
      const next = new Map(state.operations);
      next.set(op.operationKey, {
        ...op,
        status: 'syncing',
        createdAt: Date.now(),
        dismissed: false,
      });
      return { operations: next };
    }),

  // PRD-116: Finds the operation containing this scope.
  // If all scopes in the operation are complete (no longer syncing in activeSyncs),
  // sets operation status to 'complete'.
  completeScope: (scopeId) =>
    set((state) => {
      // Find which operation contains this scope
      let targetKey: string | null = null;
      for (const [key, op] of state.operations) {
        if (op.scopeIds.includes(scopeId)) {
          targetKey = key;
          break;
        }
      }

      if (!targetKey) return {};

      const op = state.operations.get(targetKey)!;

      // Check if all scopes in the operation are done (not syncing or processing)
      const allDone = op.scopeIds.every((id) => {
        const entry = state.activeSyncs[id];
        return !entry || (entry.status !== 'syncing' && entry.status !== 'processing');
      });

      if (!allDone) return {};

      const next = new Map(state.operations);
      next.set(targetKey, { ...op, status: 'complete' });
      return { operations: next };
    }),

  // PRD-116: Finds the operation containing this scope and sets status to 'error'
  failScope: (scopeId) =>
    set((state) => {
      let targetKey: string | null = null;
      for (const [key, op] of state.operations) {
        if (op.scopeIds.includes(scopeId)) {
          targetKey = key;
          break;
        }
      }

      if (!targetKey) return {};

      const op = state.operations.get(targetKey)!;
      const next = new Map(state.operations);
      next.set(targetKey, { ...op, status: 'error' });
      return { operations: next };
    }),

  // PRD-116: Marks operation as dismissed (hidden from panel)
  dismissOperation: (operationKey) =>
    set((state) => {
      const op = state.operations.get(operationKey);
      if (!op) return {};
      const next = new Map(state.operations);
      next.set(operationKey, { ...op, dismissed: true });
      return { operations: next };
    }),

  // PRD-116: Removes operation entirely
  removeOperation: (operationKey) =>
    set((state) => {
      const next = new Map(state.operations);
      next.delete(operationKey);
      return { operations: next };
    }),
}));

/**
 * Selector: whether any scope is currently syncing
 */
export function selectIsAnySyncing(state: SyncStatusState): boolean {
  return Object.values(state.activeSyncs).some((s) => s.status === 'syncing' || s.status === 'processing');
}

/**
 * PRD-116: Returns operations that are not dismissed
 */
export function selectVisibleOperations(state: SyncStatusState): SyncOperation[] {
  return Array.from(state.operations.values()).filter((op) => !op.dismissed);
}

/**
 * PRD-116: Returns true if any operation has status='syncing'
 */
export function selectHasActiveOperations(state: SyncStatusState): boolean {
  return Array.from(state.operations.values()).some((op) => op.status === 'syncing');
}
