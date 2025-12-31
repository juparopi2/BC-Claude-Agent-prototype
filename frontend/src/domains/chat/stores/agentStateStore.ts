/**
 * Agent State Store
 *
 * Manages agent execution state (busy, paused).
 * Simplified store for synchronous (non-streaming) agent execution.
 *
 * @module domains/chat/stores/agentStateStore
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

// ============================================================================
// Types
// ============================================================================

export interface AgentState {
  /** Whether the agent is busy processing */
  isAgentBusy: boolean;
  /** Whether the agent is paused */
  isPaused: boolean;
  /** Reason for pause if paused */
  pauseReason: string | null;
}

export interface AgentStateActions {
  /** Set agent busy state */
  setAgentBusy: (busy: boolean) => void;
  /** Set paused state with optional reason */
  setPaused: (paused: boolean, reason?: string) => void;
  /** Reset all state */
  reset: () => void;
}

export type AgentStateStore = AgentState & AgentStateActions;

// ============================================================================
// Initial State
// ============================================================================

const initialState: AgentState = {
  isAgentBusy: false,
  isPaused: false,
  pauseReason: null,
};

// ============================================================================
// Store Creation
// ============================================================================

export const useAgentStateStore = create<AgentStateStore>()(
  subscribeWithSelector((set) => ({
    ...initialState,

    setAgentBusy: (busy: boolean) => {
      set({ isAgentBusy: busy });
    },

    setPaused: (paused: boolean, reason?: string) => {
      set({
        isPaused: paused,
        pauseReason: paused ? (reason ?? null) : null,
      });
    },

    reset: () => {
      set(initialState);
    },
  }))
);

// ============================================================================
// Selector Hooks (for convenience)
// ============================================================================

/**
 * Get the agent state store instance.
 * Use for direct access outside of React components.
 */
export function getAgentStateStore() {
  return useAgentStateStore;
}
