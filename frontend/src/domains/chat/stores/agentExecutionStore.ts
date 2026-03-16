/**
 * Agent Execution Store
 *
 * Merged store combining agentStateStore and agentWorkflowStore.
 * Manages both agent execution state (busy, paused) and workflow
 * processing groups for multi-agent turn tracking.
 *
 * Previously split across two stores:
 * - agentStateStore: isAgentBusy, isPaused, pauseReason, currentAgentIdentity
 * - agentWorkflowStore: groups, activeGroupIndex, isTurnActive
 *
 * @module domains/chat/stores/agentExecutionStore
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { AgentIdentity, HandoffType, Message } from '@bc-agent/shared';
import { AGENT_ID, AGENT_DISPLAY_NAME, AGENT_ICON, AGENT_COLOR } from '@bc-agent/shared';

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
  /** Whether this is the final agent that produces the user-facing response */
  isFinal: boolean;
  /** Transition info (how we got to this agent) */
  transition?: {
    fromAgent: AgentIdentity;
    handoffType: HandoffType;
    reason?: string;
  };
}

export interface AgentExecutionState {
  // --- From agentStateStore ---
  /** Whether the agent is busy processing */
  isAgentBusy: boolean;
  /** Whether the agent is paused */
  isPaused: boolean;
  /** Reason for pause if paused */
  pauseReason: string | null;
  /** Current active agent identity (from agent_changed events) */
  currentAgentIdentity: AgentIdentity | null;

  // --- From agentWorkflowStore ---
  /** Current turn's processing groups (ordered) */
  groups: AgentProcessingGroup[];
  /** Current turn's active group index */
  activeGroupIndex: number;
  /** Whether a turn is currently in progress */
  isTurnActive: boolean;
}

export interface AgentExecutionActions {
  // --- From agentStateStore ---
  /** Set agent busy state */
  setAgentBusy: (busy: boolean) => void;
  /** Set paused state with optional reason */
  setPaused: (paused: boolean, reason?: string) => void;
  /** Set current agent identity */
  setCurrentAgentIdentity: (identity: AgentIdentity | null) => void;

  // --- From agentWorkflowStore ---
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
  /** Reconstruct groups from persisted messages (session reload) */
  reconstructFromMessages: (messages: Message[]) => void;
  /** End the current turn */
  endTurn: () => void;

  // --- Combined ---
  /** Reset all state (both agent state and workflow state) */
  reset: () => void;
}

export type AgentExecutionStore = AgentExecutionState & AgentExecutionActions;

// Backward-compatible type aliases
export type AgentState = AgentExecutionState;
export type AgentStateActions = AgentExecutionActions;
export type AgentStateStore = AgentExecutionStore;
export type AgentWorkflowState = AgentExecutionState;
export type AgentWorkflowActions = AgentExecutionActions;
export type AgentWorkflowStore = AgentExecutionStore;

// ============================================================================
// Initial State
// ============================================================================

const initialState: AgentExecutionState = {
  // Agent state fields
  isAgentBusy: false,
  isPaused: false,
  pauseReason: null,
  currentAgentIdentity: null,

  // Workflow fields
  groups: [],
  activeGroupIndex: -1,
  isTurnActive: false,
};

// ============================================================================
// Helpers
// ============================================================================

function createGroupId(): string {
  return `grp-${crypto.randomUUID().toUpperCase()}`;
}

const FALLBACK_AGENT_IDENTITY: AgentIdentity = {
  agentId: AGENT_ID.SUPERVISOR,
  agentName: AGENT_DISPLAY_NAME[AGENT_ID.SUPERVISOR],
  agentIcon: AGENT_ICON[AGENT_ID.SUPERVISOR],
  agentColor: AGENT_COLOR[AGENT_ID.SUPERVISOR],
};

// ============================================================================
// Store Creation
// ============================================================================

export const useAgentExecutionStore = create<AgentExecutionStore>()(
  subscribeWithSelector((set) => ({
    ...initialState,

    // --- Agent State Actions ---

    setAgentBusy: (busy: boolean) => {
      set({ isAgentBusy: busy });
    },

    setPaused: (paused: boolean, reason?: string) => {
      set({
        isPaused: paused,
        pauseReason: paused ? (reason ?? null) : null,
      });
    },

    setCurrentAgentIdentity: (identity: AgentIdentity | null) => {
      set({ currentAgentIdentity: identity });
    },

    // --- Workflow Actions ---

    startTurn: () => {
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
        };
        return { groups };
      });
    },

    reconstructFromMessages: (messages) => {
      // Reconstruct groups from agent_identity field on persisted messages.
      // Messages without agent_identity are assigned to the current group
      // (handles missing agent_id on thinking/tool events from DB).
      const groups: AgentProcessingGroup[] = [];
      let currentAgentId: string | undefined;

      for (const msg of messages) {
        if (msg.role !== 'assistant' && (msg as { role: string }).role !== 'assistant') continue;

        const agentIdentity = msg.agent_identity;

        // If no agent_identity, assign to current group or create fallback
        if (!agentIdentity) {
          if (groups.length > 0) {
            groups[groups.length - 1].messageIds.push(msg.id);
          } else {
            // Create fallback group for orphaned messages without agent_identity
            groups.push({
              id: createGroupId(),
              agent: FALLBACK_AGENT_IDENTITY,
              messageIds: [msg.id],
              isFinal: false,
              transition: undefined,
            });
            currentAgentId = FALLBACK_AGENT_IDENTITY.agentId;
          }
          continue;
        }

        if (agentIdentity.agentId !== currentAgentId) {
          // New agent group
          const previousGroup = groups.length > 0 ? groups[groups.length - 1] : undefined;
          groups.push({
            id: createGroupId(),
            agent: agentIdentity,
            messageIds: [msg.id],
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

    // --- Combined Reset ---

    reset: () => {
      set(initialState);
    },
  }))
);

// ============================================================================
// Singleton Getters
// ============================================================================

/**
 * Get the agent execution store instance.
 * Use for direct access outside of React components.
 */
export function getAgentExecutionStore() {
  return useAgentExecutionStore;
}
