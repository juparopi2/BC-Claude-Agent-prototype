/**
 * Query Key Factory
 *
 * Centralized query keys for React Query.
 * Follows best practices for hierarchical key structure.
 */

export const queryKeys = {
  auth: {
    all: ["auth"] as const,
    me: () => [...queryKeys.auth.all, "me"] as const,
    bcStatus: () => [...queryKeys.auth.all, "bc-status"] as const,
  },
  sessions: {
    all: ["sessions"] as const,
    lists: () => [...queryKeys.sessions.all, "list"] as const,
    list: (filters?: { limit?: number; offset?: number }) =>
      [...queryKeys.sessions.lists(), filters] as const,
    details: () => [...queryKeys.sessions.all, "detail"] as const,
    detail: (sessionId: string) =>
      [...queryKeys.sessions.details(), sessionId] as const,
  },
  messages: {
    all: ["messages"] as const,
    lists: () => [...queryKeys.messages.all, "list"] as const,
    list: (sessionId: string) =>
      [...queryKeys.messages.lists(), sessionId] as const,
  },
  approvals: {
    all: ["approvals"] as const,
    lists: () => [...queryKeys.approvals.all, "list"] as const,
    list: (filters?: { status?: string }) =>
      [...queryKeys.approvals.lists(), filters] as const,
  },
  health: {
    all: ["health"] as const,
    check: () => [...queryKeys.health.all, "check"] as const,
  },
};
