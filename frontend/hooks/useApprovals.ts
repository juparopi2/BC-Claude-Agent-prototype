/**
 * useApprovals Hook
 *
 * Integrates approval queries, mutations, store, and WebSocket events.
 * Provides a unified interface for approval management.
 *
 * Migration note: Replaces deprecated store and socket imports with:
 * - stores/approval.ts for dialog state
 * - queries/approvals.ts for data fetching
 * - mutations/approvals.ts for actions
 * - contexts/websocket.tsx for WebSocket events
 */

import { useEffect, useCallback } from "react";
import { useApprovalStore } from "@/stores/approval";
import { usePendingApprovals } from "@/queries/approvals";
import { useApproveApproval, useRejectApproval } from "@/mutations/approvals";
import { useWebSocket } from "@/contexts/websocket";
import type { ApprovalEventData, ApprovalResolvedEvent } from "@/types/events";

/**
 * Approval management hook
 *
 * Combines React Query (server state), Zustand (dialog state), and WebSocket (real-time events).
 *
 * @param sessionId - Optional session ID to filter approvals (not implemented yet)
 * @returns Approval state and actions
 */
export function useApprovals(sessionId?: string) {
  const { socket, isConnected } = useWebSocket();

  // Store: Current approval dialog state
  const { currentApproval, setCurrentApproval, clearCurrentApproval } =
    useApprovalStore();

  // Query: Pending approvals list
  const {
    data: pendingApprovals = [],
    isLoading,
    error,
    refetch: fetchPendingApprovals,
  } = usePendingApprovals();

  // Mutations: Approve/reject actions
  const approveMutation = useApproveApproval();
  const rejectMutation = useRejectApproval();

  // WebSocket: Listen to approval events
  useEffect(() => {
    if (!socket || !isConnected) return;

    // Handler: Approval requested (open dialog)
    const handleApprovalRequested = (data: ApprovalEventData) => {
      console.log("[useApprovals] Approval requested:", data.approvalId);
      setCurrentApproval(data);
    };

    // Handler: Approval resolved (close dialog if matches)
    const handleApprovalResolved = (data: ApprovalResolvedEvent) => {
      console.log("[useApprovals] Approval resolved:", data.approvalId);
      if (currentApproval?.approvalId === data.approvalId) {
        clearCurrentApproval();
      }
    };

    // Register listeners
    socket.on("approval:requested", handleApprovalRequested);
    socket.on("approval:resolved", handleApprovalResolved);

    // Cleanup
    return () => {
      socket.off("approval:requested", handleApprovalRequested);
      socket.off("approval:resolved", handleApprovalResolved);
    };
  }, [socket, isConnected, sessionId, currentApproval, setCurrentApproval, clearCurrentApproval]);

  // Action: Approve approval
  const handleApprove = useCallback(
    async (approvalId: string) => {
      if (!isConnected) {
        throw new Error("WebSocket not connected");
      }

      try {
        // Send approval via REST API (mutation handles invalidation)
        await approveMutation.mutateAsync(approvalId);

        // Emit WebSocket event (backend may expect this)
        socket?.emit("approval:respond", {
          approvalId,
          decision: "approved",
        });

        // Close dialog
        clearCurrentApproval();
      } catch (err) {
        console.error("[useApprovals] Failed to approve:", err);
        throw err;
      }
    },
    [isConnected, socket, approveMutation, clearCurrentApproval]
  );

  // Action: Reject approval
  const handleReject = useCallback(
    async (approvalId: string, reason?: string) => {
      if (!isConnected) {
        throw new Error("WebSocket not connected");
      }

      try {
        // Send rejection via REST API (mutation handles invalidation)
        await rejectMutation.mutateAsync({ approvalId, reason });

        // Emit WebSocket event (backend may expect this)
        socket?.emit("approval:respond", {
          approvalId,
          decision: "rejected",
          reason,
        });

        // Close dialog
        clearCurrentApproval();
      } catch (err) {
        console.error("[useApprovals] Failed to reject:", err);
        throw err;
      }
    },
    [isConnected, socket, rejectMutation, clearCurrentApproval]
  );

  // Action: Close approval dialog
  const closeApproval = useCallback(() => {
    clearCurrentApproval();
  }, [clearCurrentApproval]);

  return {
    // State
    approvals: pendingApprovals, // All pending approvals
    pendingApprovals, // Alias for consistency
    currentApproval, // Current approval dialog state
    isLoading: isLoading || approveMutation.isPending || rejectMutation.isPending,
    error: error || approveMutation.error || rejectMutation.error,
    isConnected,

    // Actions
    approve: handleApprove,
    reject: handleReject,
    closeApproval,
    fetchPendingApprovals,
    clearError: () => {}, // No-op for now (React Query handles errors)

    // Computed
    hasPendingApprovals: pendingApprovals.length > 0,
    pendingCount: pendingApprovals.length,
  };
}
