import { create } from 'zustand';
import type { Approval, ApprovalEventData } from '@/lib/types';
import { approvalApi } from '@/lib/api';

interface ApprovalState {
  // Approvals
  approvals: Approval[];
  pendingApprovals: Approval[];
  isLoading: boolean;
  error: string | null;

  // Current approval being reviewed (from WebSocket event)
  currentApproval: ApprovalEventData | null;

  // Actions
  fetchPendingApprovals: () => Promise<void>;
  addApproval: (approval: Approval) => void;
  approveApproval: (approvalId: string) => Promise<void>;
  rejectApproval: (approvalId: string, reason?: string) => Promise<void>;
  setCurrentApproval: (approval: ApprovalEventData | null) => void;
  removeApproval: (approvalId: string) => void;
  clearError: () => void;
  reset: () => void;
}

export const useApprovalStore = create<ApprovalState>((set, get) => ({
  // Initial state
  approvals: [],
  pendingApprovals: [],
  isLoading: false,
  error: null,
  currentApproval: null,

  // Fetch pending approvals
  fetchPendingApprovals: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await approvalApi.getPendingApprovals();
      const approvals = response.approvals || [];
      const pendingApprovals = approvals.filter((a) => a.status === 'pending');
      set({ approvals, pendingApprovals, isLoading: false });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch approvals';
      set({ error: errorMessage, isLoading: false });
      throw error;
    }
  },

  // Add approval (from WebSocket event)
  addApproval: (approval: Approval) => {
    set((state) => {
      const exists = state.approvals.find((a) => a.id === approval.id);
      if (exists) {
        // Update existing approval
        return {
          approvals: state.approvals.map((a) => (a.id === approval.id ? approval : a)),
          pendingApprovals:
            approval.status === 'pending'
              ? state.pendingApprovals.map((a) => (a.id === approval.id ? approval : a))
              : state.pendingApprovals.filter((a) => a.id !== approval.id),
        };
      }
      // Add new approval
      return {
        approvals: [...state.approvals, approval],
        pendingApprovals:
          approval.status === 'pending'
            ? [...state.pendingApprovals, approval]
            : state.pendingApprovals,
      };
    });
  },

  // Approve approval
  approveApproval: async (approvalId: string) => {
    set({ isLoading: true, error: null });
    try {
      await approvalApi.approve(approvalId);

      // Update local state
      set((state) => ({
        approvals: state.approvals.map((a) =>
          a.id === approvalId ? { ...a, status: 'approved' as const } : a
        ),
        pendingApprovals: state.pendingApprovals.filter((a) => a.id !== approvalId),
        currentApproval: state.currentApproval?.approvalId === approvalId ? null : state.currentApproval,
        isLoading: false,
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to approve';
      set({ error: errorMessage, isLoading: false });
      throw error;
    }
  },

  // Reject approval
  rejectApproval: async (approvalId: string, reason?: string) => {
    set({ isLoading: true, error: null });
    try {
      await approvalApi.reject(approvalId, reason);

      // Update local state
      set((state) => ({
        approvals: state.approvals.map((a) =>
          a.id === approvalId ? { ...a, status: 'rejected' as const } : a
        ),
        pendingApprovals: state.pendingApprovals.filter((a) => a.id !== approvalId),
        currentApproval: state.currentApproval?.approvalId === approvalId ? null : state.currentApproval,
        isLoading: false,
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to reject';
      set({ error: errorMessage, isLoading: false });
      throw error;
    }
  },

  // Set current approval for review dialog
  setCurrentApproval: (approval: ApprovalEventData | null) => {
    set({ currentApproval: approval });
  },

  // Remove approval (after resolved)
  removeApproval: (approvalId: string) => {
    set((state) => ({
      approvals: state.approvals.filter((a) => a.id !== approvalId),
      pendingApprovals: state.pendingApprovals.filter((a) => a.id !== approvalId),
      currentApproval:
        state.currentApproval?.approvalId === approvalId ? null : state.currentApproval,
    }));
  },

  // Clear error
  clearError: () => set({ error: null }),

  // Reset store
  reset: () => {
    set({
      approvals: [],
      pendingApprovals: [],
      isLoading: false,
      error: null,
      currentApproval: null,
    });
  },
}));
