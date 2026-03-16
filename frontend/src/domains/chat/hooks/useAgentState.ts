/**
 * useAgentState Hook
 *
 * Provides access to agent execution state (busy, paused).
 *
 * @module domains/chat/hooks/useAgentState
 */

import { useAgentExecutionStore } from '../stores/agentExecutionStore';

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
  const isAgentBusy = useAgentExecutionStore((state) => state.isAgentBusy);
  const isPaused = useAgentExecutionStore((state) => state.isPaused);
  const pauseReason = useAgentExecutionStore((state) => state.pauseReason);

  return {
    isAgentBusy,
    isPaused,
    pauseReason,
  };
}
