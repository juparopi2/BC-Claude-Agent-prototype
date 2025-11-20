/**
 * Approval Store
 *
 * Manages approval state using React Query for data fetching and Zustand for local state.
 * Integrates with WebSocket events (approval:requested, approval:resolved).
 *
 * Migration note: Replaces store/approvalStore.ts with modern architecture using:
 * - types/api.ts for Approval type (not lib/types.ts)
 * - types/events.ts for ApprovalEventData type
 * - queries/approvals.ts for data fetching (to be created)
 * - WebSocket context for real-time events
 */

import { create } from "zustand";
import type { Approval } from "@/types/api";
import type { ApprovalEventData } from "@/types/events";

interface ApprovalState {
  /**
   * Current approval being reviewed (from WebSocket approval:requested event)
   * This drives the approval dialog UI
   */
  currentApproval: ApprovalEventData | null;

  /**
   * Actions
   */
  setCurrentApproval: (approval: ApprovalEventData | null) => void;
  clearCurrentApproval: () => void;
  reset: () => void;
}

/**
 * Approval store for managing current approval dialog state
 *
 * Note: Approval list data is managed by React Query (queries/approvals.ts),
 * this store only handles the current approval dialog state from WebSocket events.
 */
export const useApprovalStore = create<ApprovalState>((set) => ({
  // Initial state
  currentApproval: null,

  // Set current approval for review dialog (from WebSocket event)
  setCurrentApproval: (approval: ApprovalEventData | null) => {
    set({ currentApproval: approval });
  },

  // Clear current approval (after resolved or closed)
  clearCurrentApproval: () => {
    set({ currentApproval: null });
  },

  // Reset store (on logout or session end)
  reset: () => {
    set({ currentApproval: null });
  },
}));
