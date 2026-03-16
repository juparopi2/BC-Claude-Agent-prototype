/**
 * useAgentWorkflow Hook
 *
 * Provides access to agent workflow groups and actions.
 *
 * @module domains/chat/hooks/useAgentWorkflow
 */

import { useAgentExecutionStore } from '../stores/agentExecutionStore';
import type { AgentProcessingGroup } from '../stores/agentExecutionStore';

/**
 * Hook for accessing agent workflow state.
 */
export function useAgentWorkflow() {
  const groups = useAgentExecutionStore((s) => s.groups);
  const isTurnActive = useAgentExecutionStore((s) => s.isTurnActive);

  return {
    groups,
    isTurnActive,
    hasGroups: groups.length > 0,
  };
}

export type { AgentProcessingGroup };
