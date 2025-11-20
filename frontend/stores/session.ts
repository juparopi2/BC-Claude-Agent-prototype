/**
 * Session Store
 *
 * Zustand store for active session state.
 */

import { create } from "zustand";
import type { SessionState } from "@/types/ui";

interface SessionStore extends SessionState {
  setActiveSessionId: (sessionId: string | null) => void;
}

export const useSessionStore = create<SessionStore>((set) => ({
  activeSessionId: null,
  setActiveSessionId: (activeSessionId) => set({ activeSessionId }),
}));
