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
  /** Enable automatic semantic search in user's files */
  useMyContext: boolean;
  /** Show/hide the file explorer sidebar */
  isFileSidebarVisible: boolean;
}

export interface UIPreferencesActions {
  /** Set extended thinking mode */
  setEnableThinking: (enabled: boolean) => void;
  /** Set My Files context search */
  setUseMyContext: (enabled: boolean) => void;
  /** Toggle extended thinking mode */
  toggleThinking: () => void;
  /** Toggle My Files context search */
  toggleMyContext: () => void;
  /** Set file sidebar visibility */
  setFileSidebarVisible: (visible: boolean) => void;
  /** Toggle file sidebar visibility */
  toggleFileSidebar: () => void;
  /** Reset all preferences to defaults */
  resetPreferences: () => void;
}

export type UIPreferencesStore = UIPreferencesState & UIPreferencesActions;

const initialState: UIPreferencesState = {
  enableThinking: false,
  useMyContext: false,
  isFileSidebarVisible: true,
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

      resetPreferences: () => set(initialState),
    }),
    {
      name: 'bc-agent-ui-preferences',
      // Only persist the state, not the actions
      partialize: (state) => ({
        enableThinking: state.enableThinking,
        useMyContext: state.useMyContext,
        isFileSidebarVisible: state.isFileSidebarVisible,
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
