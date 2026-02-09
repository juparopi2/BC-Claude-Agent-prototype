/**
 * UI Preferences Store
 *
 * Persists user preferences for chat options like Extended Thinking and My Files search.
 * These preferences are maintained across route changes to ensure consistent UX.
 *
 * @module domains/ui/stores/uiPreferencesStore
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface UIPreferencesState {
  /** Enable extended thinking mode for complex queries */
  enableThinking: boolean;
  /** @deprecated Use selectedAgentId === 'rag-agent' instead */
  useMyContext: boolean;
  /** Show/hide the file explorer sidebar */
  isFileSidebarVisible: boolean;
  /** Selected agent ID for explicit routing. 'auto' = supervisor decides */
  selectedAgentId: string;
}

export interface UIPreferencesActions {
  /** Set extended thinking mode */
  setEnableThinking: (enabled: boolean) => void;
  /** @deprecated Use setSelectedAgentId instead */
  setUseMyContext: (enabled: boolean) => void;
  /** Toggle extended thinking mode */
  toggleThinking: () => void;
  /** @deprecated Use setSelectedAgentId instead */
  toggleMyContext: () => void;
  /** Set file sidebar visibility */
  setFileSidebarVisible: (visible: boolean) => void;
  /** Toggle file sidebar visibility */
  toggleFileSidebar: () => void;
  /** Set selected agent ID */
  setSelectedAgentId: (agentId: string) => void;
  /** Reset agent selection to 'auto' */
  resetAgentSelection: () => void;
  /** Reset all preferences to defaults */
  resetPreferences: () => void;
}

export type UIPreferencesStore = UIPreferencesState & UIPreferencesActions;

const initialState: UIPreferencesState = {
  enableThinking: false,
  useMyContext: false,
  isFileSidebarVisible: true,
  selectedAgentId: 'auto',
};

/**
 * UI Preferences Store
 *
 * Persisted to localStorage to maintain preferences across sessions.
 *
 * @example
 * ```tsx
 * function ChatOptions() {
 *   const { enableThinking, toggleThinking } = useUIPreferencesStore();
 *   return (
 *     <Toggle pressed={enableThinking} onPressedChange={toggleThinking}>
 *       Thinking
 *     </Toggle>
 *   );
 * }
 * ```
 */
export const useUIPreferencesStore = create<UIPreferencesStore>()(
  persist(
    (set) => ({
      ...initialState,

      setEnableThinking: (enabled) => set({ enableThinking: enabled }),
      setUseMyContext: (enabled) => set({ useMyContext: enabled }),
      setFileSidebarVisible: (visible) => set({ isFileSidebarVisible: visible }),

      toggleThinking: () => set((state) => ({ enableThinking: !state.enableThinking })),
      toggleMyContext: () => set((state) => ({ useMyContext: !state.useMyContext })),
      toggleFileSidebar: () => set((state) => ({ isFileSidebarVisible: !state.isFileSidebarVisible })),

      setSelectedAgentId: (agentId) => set({
        selectedAgentId: agentId,
        useMyContext: agentId === 'rag-agent',
      }),
      resetAgentSelection: () => set({ selectedAgentId: 'auto', useMyContext: false }),

      resetPreferences: () => set(initialState),
    }),
    {
      name: 'bc-agent-ui-preferences',
      // Only persist the state, not the actions
      partialize: (state) => ({
        enableThinking: state.enableThinking,
        useMyContext: state.useMyContext,
        isFileSidebarVisible: state.isFileSidebarVisible,
        selectedAgentId: state.selectedAgentId,
      }),
    }
  )
);

/**
 * Reset UI preferences store for testing
 */
export function resetUIPreferencesStore(): void {
  useUIPreferencesStore.getState().resetPreferences();
}
