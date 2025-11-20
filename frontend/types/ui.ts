/**
 * UI State Types
 *
 * Type definitions for client-side UI state.
 */

export interface StreamingMessage {
  content: string;
  isStreaming: boolean;
}

export interface ChatState {
  accumulatedText: string;
  isThinking: boolean;
  isStreaming: boolean;
  activeTool?: string;
}

export interface ApprovalDialogState {
  isOpen: boolean;
  approvalId?: string;
  toolName?: string;
  summary?: {
    title: string;
    description: string;
    changes: Record<string, unknown>;
    impact: "high" | "medium" | "low";
  };
  expiresAt?: string;
  timeRemaining?: number;
}

export interface SidebarState {
  isOpen: boolean;
  activeSessionId?: string;
}

export type Theme = "light" | "dark" | "system";

export interface UIState {
  sidebarOpen: boolean;
  theme: Theme;
}

export interface AuthState {
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
  } | null;
  bcStatus: {
    hasConsent: boolean;
    tokenExpiry?: string;
    environment?: string;
  } | null;
}

export interface SessionState {
  activeSessionId: string | null;
}
