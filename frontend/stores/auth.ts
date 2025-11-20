/**
 * Auth Store
 *
 * Zustand store for authentication state.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AuthState } from "@/types/ui";

interface AuthStore extends AuthState {
  setUser: (user: AuthState["user"]) => void;
  setBCStatus: (bcStatus: AuthState["bcStatus"]) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      user: null,
      bcStatus: null,
      setUser: (user) => set({ user }),
      setBCStatus: (bcStatus) => set({ bcStatus }),
      clearAuth: () => set({ user: null, bcStatus: null }),
    }),
    {
      name: "auth-storage",
    }
  )
);
