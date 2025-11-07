import { useEffect, useCallback } from 'react';
import { useApprovalStore } from '@/store';
import { useSocket } from './useSocket';
import { socketApprovalApi, SocketEvent, type ApprovalEventData } from '@/lib/socket';

/**
 * Hook for approval management
 * Integrates with approvalStore and WebSocket for real-time approval events
 */
export function useApprovals(sessionId?: string) {
  const { socket, isConnected } = useSocket();

  const {
    approvals,
    pendingApprovals,
    currentApproval,
    isLoading,
    error,
    fetchPendingApprovals,
    addApproval,
    approveApproval,
    rejectApproval,
    setCurrentApproval,
    removeApproval,
    clearError,
  } = useApprovalStore();

  // Set up WebSocket event listeners
  useEffect(() => {
    if (!socket || !isConnected) return;

    // Approval required
    const handleApprovalRequired = (data: ApprovalEventData) => {
      console.log('[useApprovals] Approval required:', data.approval.id);

      // Only add approvals for current session if sessionId is specified
      if (!sessionId || data.approval.session_id === sessionId) {
        addApproval(data.approval);

        // Auto-open approval dialog (set as current approval)
        setCurrentApproval(data.approval);
      }
    };

    // Approval resolved
    const handleApprovalResolved = (data: ApprovalEventData) => {
      console.log('[useApprovals] Approval resolved:', data.approval.id, data.approval.status);

      // Update approval in store
      addApproval(data.approval);

      // Remove from current if it was open
      if (currentApproval?.id === data.approval.id) {
        setCurrentApproval(null);
      }
    };

    // Register listeners
    socketApprovalApi.onApprovalRequired(handleApprovalRequired);
    socketApprovalApi.onApprovalResolved(handleApprovalResolved);

    // Cleanup listeners
    return () => {
      socket.off(SocketEvent.APPROVAL_REQUIRED, handleApprovalRequired);
      socket.off(SocketEvent.APPROVAL_RESOLVED, handleApprovalResolved);
    };
  }, [socket, isConnected, sessionId, currentApproval, addApproval, setCurrentApproval]);

  // Fetch pending approvals on mount
  useEffect(() => {
    if (isConnected) {
      fetchPendingApprovals().catch((err) => {
        console.error('[useApprovals] Failed to fetch pending approvals:', err);
      });
    }
  }, [isConnected, fetchPendingApprovals]);

  // Approve handler
  const handleApprove = useCallback(
    async (approvalId: string) => {
      if (!isConnected) {
        throw new Error('WebSocket not connected');
      }

      try {
        // Send approval via WebSocket
        socketApprovalApi.sendApprovalDecision(approvalId, 'approved');

        // Update store
        await approveApproval(approvalId);
      } catch (err) {
        console.error('[useApprovals] Failed to approve:', err);
        throw err;
      }
    },
    [isConnected, approveApproval]
  );

  // Reject handler
  const handleReject = useCallback(
    async (approvalId: string, reason?: string) => {
      if (!isConnected) {
        throw new Error('WebSocket not connected');
      }

      try {
        // Send rejection via WebSocket
        socketApprovalApi.sendApprovalDecision(approvalId, 'rejected', reason);

        // Update store
        await rejectApproval(approvalId, reason);
      } catch (err) {
        console.error('[useApprovals] Failed to reject:', err);
        throw err;
      }
    },
    [isConnected, rejectApproval]
  );

  // Open approval dialog
  const openApproval = useCallback(
    (approvalId: string) => {
      const approval = approvals.find((a) => a.id === approvalId);
      if (approval) {
        setCurrentApproval(approval);
      }
    },
    [approvals, setCurrentApproval]
  );

  // Close approval dialog
  const closeApproval = useCallback(() => {
    setCurrentApproval(null);
  }, [setCurrentApproval]);

  return {
    // State
    approvals,
    pendingApprovals,
    currentApproval,
    isLoading,
    error,
    isConnected,

    // Actions
    approve: handleApprove,
    reject: handleReject,
    openApproval,
    closeApproval,
    fetchPendingApprovals,
    clearError,

    // Computed
    hasPendingApprovals: pendingApprovals.length > 0,
    pendingCount: pendingApprovals.length,
  };
}
