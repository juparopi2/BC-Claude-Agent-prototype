/**
 * Agent Workflow Store
 *
 * Tracks agent processing groups during multi-agent execution.
 * Each group represents one agent's processing phase within a turn.
 * Used by PRD-061 to render collapsible agent sections in the chat UI.
 *
 * @module domains/chat/stores/agentWorkflowStore
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { AgentIdentity, HandoffType, Message } from '@bc-agent/shared';

// ============================================================================
// Types
// ============================================================================

/**
 * Represents one agent's processing section within a turn.
 * Contains the agent identity, messages produced, and transition info.
 */
export interface AgentProcessingGroup {
  /** Unique group ID */
  id: string;
  /** Agent that produced this group's content */
  agent: AgentIdentity;
  /** Message IDs belonging to this group (thinking, tool_use, messages) */
  messageIds: string[];
  /** Whether this group is collapsed in the UI */
  isCollapsed: boolean;
  /** Whether this is the final agent that produces the user-facing response */
  isFinal: boolean;
  /** Transition info (how we got to this agent) */
  transition?: {
    fromAgent: AgentIdentity;
    handoffType: HandoffType;
    reason?: string;
  };
}

export interface AgentWorkflowState {
  /** Current turn's processing groups (ordered) */
  groups: AgentProcessingGroup[];
  /** Current turn's active group index */
  activeGroupIndex: number;
  /** Whether a turn is currently in progress */
  isTurnActive: boolean;
}

export interface AgentWorkflowActions {
  /** Start a new turn (reset groups) */
  startTurn: () => void;
  /** Add a new agent group (on agent_changed event) */
  addGroup: (
    agent: AgentIdentity,
    transition?: {
      fromAgent: AgentIdentity;
      handoffType: HandoffType;
      reason?: string;
    }
  ) => void;
  /** Add a message ID to the current (last) group */
  addMessageToCurrentGroup: (messageId: string) => void;
  /** Mark the last group as final (on complete event) */
  markLastGroupFinal: () => void;
  /** Toggle collapse state of a group */
  toggleGroupCollapse: (groupId: string) => void;
  /** Set collapse state of a group */
  setGroupCollapsed: (groupId: string, collapsed: boolean) => void;
  /** Reconstruct groups from persisted messages (session reload) */
  reconstructFromMessages: (messages: Message[]) => void;
  /** End the current turn */
  endTurn: () => void;
  /** Reset all state */
  reset: () => void;
}

export type AgentWorkflowStore = AgentWorkflowState & AgentWorkflowActions;

// ============================================================================
// Initial State
// ============================================================================

const initialState: AgentWorkflowState = {
  groups: [],
  activeGroupIndex: -1,
  isTurnActive: false,
};

// ============================================================================
// Helpers
// ============================================================================

let groupCounter = 0;

function createGroupId(): string {
  return `grp-${++groupCounter}-${Date.now()}`;
}

// ============================================================================
// Store Creation
// ============================================================================

export const useAgentWorkflowStore = create<AgentWorkflowStore>()(
  subscribeWithSelector((set) => ({
    ...initialState,

    startTurn: () => {
      groupCounter = 0;
      set({
        groups: [],
        activeGroupIndex: -1,
        isTurnActive: true,
      });
    },

    addGroup: (agent, transition) => {
      set((state) => {
        const newGroup: AgentProcessingGroup = {
          id: createGroupId(),
          agent,
          messageIds: [],
          isCollapsed: true, // Default: collapsed (non-final groups)
          isFinal: false,
          transition,
        };
        const newGroups = [...state.groups, newGroup];
        return {
          groups: newGroups,
          activeGroupIndex: newGroups.length - 1,
        };
      });
    },

    addMessageToCurrentGroup: (messageId) => {
      set((state) => {
        if (state.activeGroupIndex < 0 || state.groups.length === 0) return state;
        const groups = [...state.groups];
        const current = { ...groups[state.activeGroupIndex] };
        // Avoid duplicate message IDs
        if (!current.messageIds.includes(messageId)) {
          current.messageIds = [...current.messageIds, messageId];
          groups[state.activeGroupIndex] = current;
        }
        return { groups };
      });
    },

    markLastGroupFinal: () => {
      set((state) => {
        if (state.groups.length === 0) return state;
        const groups = [...state.groups];
        const lastIdx = groups.length - 1;
        groups[lastIdx] = {
          ...groups[lastIdx],
          isFinal: true,
          isCollapsed: false, // Final group is expanded by default
        };
        return { groups };
      });
    },

    toggleGroupCollapse: (groupId) => {
      set((state) => {
        const groups = state.groups.map((g) =>
          g.id === groupId ? { ...g, isCollapsed: !g.isCollapsed } : g
        );
        return { groups };
      });
    },

    setGroupCollapsed: (groupId, collapsed) => {
      set((state) => {
        const groups = state.groups.map((g) =>
          g.id === groupId ? { ...g, isCollapsed: collapsed } : g
        );
        return { groups };
      });
    },

    reconstructFromMessages: (messages) => {
      // Reconstruct groups from agent_identity field on persisted messages
      const groups: AgentProcessingGroup[] = [];
      let currentAgentId: string | undefined;
      groupCounter = 0;

      for (const msg of messages) {
        if (msg.role !== 'assistant' && (msg as { role: string }).role !== 'assistant') continue;

        const agentIdentity = msg.agent_identity;
        if (!agentIdentity) continue;

        if (agentIdentity.agentId !== currentAgentId) {
          // New agent group
          const previousGroup = groups.length > 0 ? groups[groups.length - 1] : undefined;
          groups.push({
            id: createGroupId(),
            agent: agentIdentity,
            messageIds: [msg.id],
            isCollapsed: true,
            isFinal: false,
            transition: previousGroup
              ? {
                  fromAgent: previousGroup.agent,
                  handoffType: 'supervisor_routing',
                }
              : undefined,
          });
          currentAgentId = agentIdentity.agentId;
        } else {
          // Same agent, add to current group
          groups[groups.length - 1].messageIds.push(msg.id);
        }
      }

      // Mark last group as final
      if (groups.length > 0) {
        groups[groups.length - 1].isFinal = true;
        groups[groups.length - 1].isCollapsed = false;
      }

      set({
        groups,
        activeGroupIndex: groups.length - 1,
        isTurnActive: false,
      });
    },

    endTurn: () => {
      set({ isTurnActive: false });
    },

    reset: () => {
      groupCounter = 0;
      set(initialState);
    },
  }))
);

// ============================================================================
// Singleton Getter
// ============================================================================

/**
 * Get the agent workflow store instance.
 * Use for direct access outside of React components.
 */
export function getAgentWorkflowStore() {
  return useAgentWorkflowStore;
}
