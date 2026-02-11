/**
 * useAgentWorkflow Hook
 *
 * Provides access to agent workflow groups and actions.
 *
 * @module domains/chat/hooks/useAgentWorkflow
 */

import { useAgentWorkflowStore } from '../stores/agentWorkflowStore';
import type { AgentProcessingGroup } from '../stores/agentWorkflowStore';

/**
 * Hook for accessing agent workflow state.
 */
export function useAgentWorkflow() {
  const groups = useAgentWorkflowStore((s) => s.groups);
  const isTurnActive = useAgentWorkflowStore((s) => s.isTurnActive);
  const toggleGroupCollapse = useAgentWorkflowStore((s) => s.toggleGroupCollapse);

  return {
    groups,
    isTurnActive,
    toggleGroupCollapse,
    hasGroups: groups.length > 0,
  };
}

export type { AgentProcessingGroup };
