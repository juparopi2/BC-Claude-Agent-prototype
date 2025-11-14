/**
 * Shared types for API responses and data structures
 */

import type { JSONValue, JSONObject } from './json-utils';

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

// Base message interface (for database messages)
export interface BaseMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thinking_tokens?: number;
  is_thinking?: boolean;
  created_at: string;
}

// Tool use message (client-side only, for UI)
export interface ToolUseMessage {
  id: string;
  type: 'tool_use';
  session_id: string;
  tool_name: string;
  tool_args: JSONObject;
  tool_result?: JSONValue;
  status: 'pending' | 'success' | 'error';
  error_message?: string;
  created_at: string;
}

// Thinking message (client-side only, for UI - displays agent's thinking process)
export interface ThinkingMessage {
  id: string;
  type: 'thinking';
  session_id: string;
  content?: string;          // Thinking content (optional, may be empty while thinking)
  duration_ms?: number;      // Duration of thinking in milliseconds
  created_at: string;
}

// Union type for all message types
export type Message = BaseMessage | ToolUseMessage | ThinkingMessage;

// Type guard for tool use messages
export function isToolUseMessage(message: Message): message is ToolUseMessage {
  return 'type' in message && message.type === 'tool_use';
}

// Type guard for thinking messages
export function isThinkingMessage(message: Message): message is ThinkingMessage {
  return 'type' in message && message.type === 'thinking';
}

export interface Approval {
  id: string;
  session_id: string;
  user_id: string;
  action_type: string;
  action_data: JSONObject;
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
// Updated to match actual backend emission format
export interface MessageEventData {
  content: string;    // Backend emits { content, role } not full Message object
  role: string;
}

export interface ThinkingEventData {
  content?: string;   // Backend emits { content?: string }
}

export interface ToolUseEventData {
  toolName: string;
  args: JSONObject;
  toolUseId?: string; // Backend may include toolUseId
}

export interface StreamChunkEventData {
  content: string;    // Backend emits { content: string }, NOT { chunk: string }
}

export interface ApprovalSummary {
  title: string;
  description: string;
  changes: JSONObject;
  impact: 'high' | 'medium' | 'low';
}

export interface ApprovalEventData {
  approvalId: string;
  toolName: string;
  summary: ApprovalSummary;
  changes: JSONObject;
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
