/**
 * Authentication Queries
 *
 * React Query hooks for authentication and BC status.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { queryKeys } from "./keys";
import type { User, BCStatus } from "@/types/api";

export function useAuth(): UseQueryResult<User, Error> {
  return useQuery({
    queryKey: queryKeys.auth.me(),
    queryFn: apiClient.auth.me,
    staleTime: 1000 * 60 * 5,
    retry: false,
  });
}

export function useBCStatus(): UseQueryResult<BCStatus, Error> {
  return useQuery({
    queryKey: queryKeys.auth.bcStatus(),
    queryFn: apiClient.auth.bcStatus,
    staleTime: 1000 * 60 * 5,
  });
}
