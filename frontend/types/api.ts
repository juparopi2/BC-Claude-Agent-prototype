/**
 * REST API Types
 *
 * Type definitions for HTTP API responses matching the backend contract.
 */

import type { StopReason } from './sdk';

// Re-export StopReason from SDK for convenience
export type { StopReason };

export interface User {
  id: string;
  email: string;
  name: string;
  role: "admin" | "editor" | "viewer";
  created_at: string;
}

export interface BCStatus {
  hasConsent: boolean;
  tokenExpiry?: string;
  environment?: string;
}

export interface Session {
  id: string;
  user_id: string;
  title?: string;
  status: "active" | "completed" | "cancelled";
  goal?: string;
  last_activity_at: string;
  token_count?: number;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "system";
  /**
   * Simplified content representation for UI display.
   *
   * Note: The SDK uses ContentBlock[] for full structure, but the backend
   * API flattens this to a string for frontend consumption. If you need
   * to display tool_use blocks or other ContentBlock types, import them
   * from './sdk' and parse accordingly.
   */
  content: string;
  stop_reason?: StopReason | null;
  /**
   * Atomic sequence number for message ordering (from event sourcing).
   *
   * Generated via Redis INCR to guarantee correct ordering even in race
   * conditions. Always sort by sequence_number, NOT by created_at timestamp.
   */
  sequence_number?: number;
  thinking_tokens?: number;
  is_thinking?: boolean;
  created_at: string;
}

export interface Approval {
  id: string;
  session_id: string;
  user_id: string;
  action_type: string;
  action_data: Record<string, unknown>;
  status: "pending" | "approved" | "rejected";
  priority?: number;
  expires_at?: string;
  created_at: string;
}

export interface HealthStatus {
  status: "healthy" | "unhealthy" | "degraded";
  timestamp?: string;
  services: {
    database: "up" | "down";
    redis: "up" | "down";
  };
}

export interface ApiResponse<T> {
  data?: T;
  error?: string;
  message?: string;
}

export interface SessionsResponse {
  sessions: Session[];
}

export interface SessionResponse {
  session: Session;
}

export interface MessagesResponse {
  messages: Message[];
}

export interface ApprovalsResponse {
  approvals: Approval[];
}

export interface Todo {
  id: string;
  sessionId: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  created_at?: string;
  completed_at?: string;
}
