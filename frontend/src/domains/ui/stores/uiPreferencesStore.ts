/**
 * UI Preferences Store
 *
 * Persists user preferences for chat options like agent selection and sidebar visibility.
 * These preferences are maintained across route changes to ensure consistent UX.
 *
 * @module domains/ui/stores/uiPreferencesStore
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface UIPreferencesState {
  /** @deprecated Use selectedAgentId === 'rag-agent' instead */
  useMyContext: boolean;
  /** Show/hide the file explorer sidebar */
  isFileSidebarVisible: boolean;
  /** Selected agent ID for explicit routing. 'auto' = supervisor decides */
  selectedAgentId: string;
}

export interface UIPreferencesActions {
  /** @deprecated Use setSelectedAgentId instead */
  setUseMyContext: (enabled: boolean) => void;
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
  useMyContext: false,
  isFileSidebarVisible: true,
  selectedAgentId: 'auto',
};

/**
 * UI Preferences Store
 *
 * Persisted to localStorage to maintain preferences across sessions.
 */
export const useUIPreferencesStore = create<UIPreferencesStore>()(
  persist(
    (set) => ({
      ...initialState,

      setUseMyContext: (enabled) => set({ useMyContext: enabled }),
      setFileSidebarVisible: (visible) => set({ isFileSidebarVisible: visible }),

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
