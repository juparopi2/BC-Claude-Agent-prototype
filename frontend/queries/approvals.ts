/**
 * Approval Queries
 *
 * React Query hooks for fetching approval data from the REST API.
 * Uses apiClient for HTTP requests and query keys from queries/keys.ts.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { queryKeys } from "./keys";
import type { Approval } from "@/types/api";

/**
 * Fetch all pending approvals for the current user
 *
 * Returns a React Query result with pending approvals list.
 * Automatically refetches on window focus and every 30 seconds.
 */
export function usePendingApprovals(): UseQueryResult<Approval[], Error> {
  return useQuery({
    queryKey: queryKeys.approvals.pending,
    queryFn: async () => {
      const response = await apiClient.approvals.list();
      return response.approvals || [];
    },
    refetchInterval: 30000, // Refetch every 30 seconds
    refetchOnWindowFocus: true,
  });
}
