/**
 * Approval Mutations
 *
 * React Query mutations for approval actions (approve, reject).
 * Uses apiClient for HTTP requests and invalidates approval queries on success.
 */

import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { queryKeys } from "@/queries/keys";

interface ApproveApprovalOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

interface RejectApprovalVariables {
  approvalId: string;
  reason?: string;
}

/**
 * Approve an approval request
 *
 * Sends approval decision via REST API and invalidates pending approvals query.
 * Note: WebSocket integration (approval:resolved event) handled by useApprovals hook.
 */
export function useApproveApproval(
  options?: ApproveApprovalOptions
): UseMutationResult<void, Error, string, unknown> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (approvalId: string) => {
      await apiClient.approvals.approve(approvalId);
    },
    onSuccess: () => {
      // Invalidate pending approvals query to refetch updated list
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals.pending });
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      console.error("[useApproveApproval] Error approving approval:", error);
      options?.onError?.(error);
    },
  });
}

/**
 * Reject an approval request
 *
 * Sends rejection decision via REST API with optional reason.
 * Invalidates pending approvals query on success.
 */
export function useRejectApproval(
  options?: ApproveApprovalOptions
): UseMutationResult<void, Error, RejectApprovalVariables, unknown> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ approvalId, reason }: RejectApprovalVariables) => {
      await apiClient.approvals.reject(approvalId, reason);
    },
    onSuccess: () => {
      // Invalidate pending approvals query to refetch updated list
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals.pending });
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      console.error("[useRejectApproval] Error rejecting approval:", error);
      options?.onError?.(error);
    },
  });
}
