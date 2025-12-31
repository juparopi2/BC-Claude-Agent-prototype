/**
 * useAgentState Hook
 *
 * Provides access to agent execution state (busy, paused).
 *
 * @module domains/chat/hooks/useAgentState
 */

import { useAgentStateStore } from '../stores/agentStateStore';

/**
 * Hook to access agent state.
 *
 * @returns Agent state (isAgentBusy, isPaused, pauseReason)
 *
 * @example
 * ```tsx
 * const { isAgentBusy, isPaused, pauseReason } = useAgentState();
 *
 * if (isAgentBusy) {
 *   return <LoadingIndicator />;
 * }
 * ```
 */
export function useAgentState() {
  const isAgentBusy = useAgentStateStore((state) => state.isAgentBusy);
  const isPaused = useAgentStateStore((state) => state.isPaused);
  const pauseReason = useAgentStateStore((state) => state.pauseReason);

  return {
    isAgentBusy,
    isPaused,
    pauseReason,
  };
}
