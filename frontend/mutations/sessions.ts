/**
 * Session Mutations
 *
 * React Query mutations for session management.
 */

import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/api-client";
import { queryKeys } from "@/queries/keys";
import type { Session } from "@/types/api";

export function useCreateSession(): UseMutationResult<
  Session,
  Error,
  { title?: string }
> {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: async ({ title }: { title?: string }) => {
      const response = await apiClient.sessions.create(title);
      return response.session;
    },
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
      router.push(`/chat/${session.id}`);
    },
  });
}

export function useUpdateSession(): UseMutationResult<
  Session,
  Error,
  { sessionId: string; title: string }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      sessionId,
      title,
    }: {
      sessionId: string;
      title: string;
    }) => {
      const response = await apiClient.sessions.update(sessionId, title);
      return response.session;
    },
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
      queryClient.invalidateQueries({
        queryKey: queryKeys.sessions.detail(session.id),
      });
    },
  });
}

export function useDeleteSession(): UseMutationResult<
  void,
  Error,
  { sessionId: string }
> {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: async ({ sessionId }: { sessionId: string }) => {
      await apiClient.sessions.delete(sessionId);
    },
    onSuccess: (_, { sessionId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
      queryClient.removeQueries({ queryKey: queryKeys.sessions.detail(sessionId) });
      router.push("/");
    },
  });
}
