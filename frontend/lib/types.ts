/**
 * Shared types for API responses and data structures
 */

export interface User {
  id: string;
  email: string;
  name: string; // Full name of the user
  role: 'admin' | 'editor' | 'viewer';
  created_at: string;
}

export interface Session {
  id: string;
  user_id: string;
  title?: string;
  status: 'active' | 'completed' | 'cancelled';
  goal?: string;
  last_activity_at: string;
  token_count?: number;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
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
  status: 'pending' | 'approved' | 'rejected';
  priority?: number;
  expires_at?: string;
  created_at: string;
}

export interface Todo {
  id: string;
  sessionId: string; // Use camelCase to match frontend conventions
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  created_at?: string;
  completed_at?: string;
}

export interface HealthStatus {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp?: string;
  services: {
    database: 'up' | 'down';
    redis: 'up' | 'down';
  };
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

export interface ApiResponse<T> {
  data?: T;
  error?: string;
  message?: string;
}

// Socket.IO event data types
export interface MessageEventData {
  message: Message;
  sessionId: string;
}

export interface ThinkingEventData {
  isThinking: boolean;
  sessionId: string;
}

export interface ToolUseEventData {
  toolName: string;
  args: Record<string, unknown>;
  sessionId: string;
}

export interface StreamChunkEventData {
  chunk: string;
  sessionId: string;
}

export interface ApprovalSummary {
  title: string;
  description: string;
  changes: Record<string, unknown>;
  impact: 'high' | 'medium' | 'low';
}

export interface ApprovalEventData {
  approvalId: string;
  toolName: string;
  summary: ApprovalSummary;
  changes: Record<string, unknown>;
  priority: 'high' | 'medium' | 'low';
  expiresAt: string; // ISO string from Date
}

export interface TodoEventData {
  todo: {
    id: string;
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
    sessionId: string;
  };
}

export interface TodoCreatedEventData {
  sessionId: string;
  todos: Todo[];  // Array of todos when generated from plan
}

// Event handler types
export type EventHandler<T = unknown> = (data: T) => void;
export type ConnectionHandler = () => void;
