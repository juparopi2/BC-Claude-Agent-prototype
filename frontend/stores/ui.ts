/**
 * UI Store
 *
 * Zustand store for UI state (sidebar, theme, etc.).
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { UIState, Theme } from "@/types/ui";

interface UIStore extends UIState {
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setTheme: (theme: Theme) => void;
}

export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      theme: "system",
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: "ui-storage",
    }
  )
);
