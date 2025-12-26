/**
 * Approval Store
 *
 * Manages Human-in-the-Loop (HITL) approval requests.
 *
 * @module domains/chat/stores/approvalStore
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { ApprovalPriority } from '@bc-agent/shared';

// ============================================================================
// Types
// ============================================================================

export interface PendingApproval {
  /** Unique approval ID */
  id: string;
  /** Name of the tool requiring approval */
  toolName: string;
  /** Tool arguments */
  args: Record<string, unknown>;
  /** User-friendly description of the change */
  changeSummary: string;
  /** Priority level - uses shared type for consistency */
  priority: ApprovalPriority;
  /** ISO 8601 timestamp when approval expires */
  expiresAt?: string;
  /** When the approval was created */
  createdAt: Date;
}

export interface ApprovalState {
  /** Map of pending approval requests */
  pendingApprovals: Map<string, PendingApproval>;
}

export interface ApprovalActions {
  /** Add a pending approval request */
  addPendingApproval: (approval: PendingApproval) => void;
  /** Remove a pending approval (on resolution or expiry) */
  removePendingApproval: (approvalId: string) => void;
  /** Clear all pending approvals */
  clearPendingApprovals: () => void;
  /** Reset to initial state */
  reset: () => void;
}

export type ApprovalStore = ApprovalState & ApprovalActions;

// ============================================================================
// Initial State
// ============================================================================

const initialState: ApprovalState = {
  pendingApprovals: new Map(),
};

// ============================================================================
// Store Factory
// ============================================================================

const createApprovalStore = () =>
  create<ApprovalStore>()(
    subscribeWithSelector((set) => ({
      ...initialState,

      addPendingApproval: (approval) =>
        set((state) => {
          const newMap = new Map(state.pendingApprovals);
          newMap.set(approval.id, approval);
          return { pendingApprovals: newMap };
        }),

      removePendingApproval: (approvalId) =>
        set((state) => {
          const newMap = new Map(state.pendingApprovals);
          newMap.delete(approvalId);
          return { pendingApprovals: newMap };
        }),

      clearPendingApprovals: () => set({ pendingApprovals: new Map() }),

      reset: () => set(initialState),
    }))
  );

// ============================================================================
// Singleton Instance
// ============================================================================

let store: ReturnType<typeof createApprovalStore> | null = null;

/**
 * Get the singleton approval store instance.
 */
export function getApprovalStore() {
  if (!store) {
    store = createApprovalStore();
  }
  return store;
}

/**
 * Hook for components to access approval store.
 */
export function useApprovalStore<T>(selector: (state: ApprovalStore) => T): T {
  return getApprovalStore()(selector);
}

/**
 * Reset store for testing.
 */
export function resetApprovalStore(): void {
  if (store) {
    store.getState().reset();
  }
  store = null;
}

// ============================================================================
// Selectors
// ============================================================================

/**
 * Get pending approvals as an array, sorted by createdAt (oldest first).
 */
export function getPendingApprovalsArray(state: ApprovalState): PendingApproval[] {
  return Array.from(state.pendingApprovals.values()).sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
  );
}
