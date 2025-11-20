/**
 * Session Queries
 *
 * React Query hooks for sessions and messages.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { queryKeys } from "./keys";
import type { Session, Message } from "@/types/api";

export function useSessions(): UseQueryResult<Session[], Error> {
  return useQuery({
    queryKey: queryKeys.sessions.list(),
    queryFn: async () => {
      const response = await apiClient.sessions.list();
      return response.sessions;
    },
    staleTime: 1000 * 30,
  });
}

export function useSession(
  sessionId: string
): UseQueryResult<Session, Error> {
  return useQuery({
    queryKey: queryKeys.sessions.detail(sessionId),
    queryFn: async () => {
      const response = await apiClient.sessions.get(sessionId);
      return response.session;
    },
    enabled: !!sessionId,
  });
}

export function useMessages(
  sessionId: string
): UseQueryResult<Message[], Error> {
  return useQuery({
    queryKey: queryKeys.messages.list(sessionId),
    queryFn: async () => {
      const response = await apiClient.messages.list(sessionId);
      return response.messages.sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
    },
    enabled: !!sessionId,
    refetchInterval: false,
  });
}
