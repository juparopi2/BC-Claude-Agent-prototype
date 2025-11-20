/**
 * Authentication Mutations
 *
 * React Query mutations for authentication actions.
 */

import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/api-client";
import { queryKeys } from "@/queries/keys";

export function useLogout(): UseMutationResult<void, Error, void> {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: apiClient.auth.logout,
    onSuccess: () => {
      queryClient.clear();
      router.push("/login");
    },
  });
}
