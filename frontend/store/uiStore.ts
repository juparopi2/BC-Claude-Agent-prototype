/**
 * UI Store - Pure Client State
 *
 * This store manages ONLY local UI preferences and state.
 * Server state (auth, sessions, messages) is managed by React Query.
 *
 * Uses Zustand persist middleware to save preferences to localStorage.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'light' | 'dark' | 'system';

interface UIState {
  // Sidebar state
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;

  // Source panel state
  sourcePanelOpen: boolean;
  setSourcePanelOpen: (open: boolean) => void;
  toggleSourcePanel: () => void;

  // Theme preferences
  theme: Theme;
  setTheme: (theme: Theme) => void;

  // Modal states
  isApprovalModalOpen: boolean;
  isTodoModalOpen: boolean;
  setApprovalModalOpen: (open: boolean) => void;
  setTodoModalOpen: (open: boolean) => void;

  // Reset to defaults
  reset: () => void;
}

const defaultState = {
  sidebarOpen: true,
  sourcePanelOpen: false,
  theme: 'dark' as Theme,
  isApprovalModalOpen: false,
  isTodoModalOpen: false,
};

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      // Initial state
      ...defaultState,

      // Sidebar actions
      setSidebarOpen: (open: boolean) => set({ sidebarOpen: open }),
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

      // Source panel actions
      setSourcePanelOpen: (open: boolean) => set({ sourcePanelOpen: open }),
      toggleSourcePanel: () => set((state) => ({ sourcePanelOpen: !state.sourcePanelOpen })),

      // Theme actions
      setTheme: (theme: Theme) => set({ theme }),

      // Modal actions
      setApprovalModalOpen: (open: boolean) => set({ isApprovalModalOpen: open }),
      setTodoModalOpen: (open: boolean) => set({ isTodoModalOpen: open }),

      // Reset to defaults
      reset: () => set(defaultState),
    }),
    {
      name: 'bc-agent-ui-storage', // localStorage key
      partialize: (state) => ({
        // Only persist these fields
        sidebarOpen: state.sidebarOpen,
        sourcePanelOpen: state.sourcePanelOpen,
        theme: state.theme,
        // Don't persist modal states (they should reset on page refresh)
      }),
    }
  )
);
