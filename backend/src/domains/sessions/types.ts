/**
 * Session Domain Types
 *
 * Interfaces for session-related data structures.
 * Used by services and routes for type-safe operations.
 *
 * @module domains/sessions/types
 */

import type { StopReason, TextCitation } from '@anthropic-ai/sdk/resources/messages';
import type { AgentIdentity } from '@bc-agent/shared';

// ============================================
// Database Row Types
// ============================================

/**
 * Raw session row from database
 */
export interface DbSessionRow {
  id: string;
  user_id: string;
  title: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * Raw message row from database
 */
export interface DbMessageRow {
  id: string;
  session_id: string;
  role: string;
  message_type: string;
  content: string;
  metadata: string | null;
  token_count: number | null;
  stop_reason: StopReason | null;
  sequence_number: number | null;
  created_at: Date;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  event_id: string | null;
  tool_use_id: string | null;
  agent_id: string | null;
}

// ============================================
// API Response Types
// ============================================

/**
 * Transformed session for API response
 */
export interface SessionResponse {
  id: string;
  user_id: string;
  title: string;
  status: 'active' | 'completed' | 'cancelled';
  last_activity_at: string;
  created_at: string;
  updated_at: string;
}

/**
 * Pagination metadata for cursor-based pagination
 */
export interface PaginationInfo {
  hasMore: boolean;
  nextCursor: string | null;
}

/**
 * Paginated sessions response
 */
export interface PaginatedSessionsResponse {
  sessions: SessionResponse[];
  pagination: PaginationInfo;
}

// ============================================
// Message Response Types
// ============================================

/**
 * Token usage nested object
 */
export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
}

/**
 * Base message fields shared by all types
 */
export interface BaseMessage {
  id: string;
  session_id: string;
  sequence_number: number;
  created_at: string;
  event_id?: string;
  agent_identity?: AgentIdentity;
}

/**
 * Standard text message (user or assistant)
 */
export interface StandardMessageResponse extends BaseMessage {
  type: 'standard';
  role: 'user' | 'assistant';
  content: string;
  token_usage?: TokenUsage;
  stop_reason?: StopReason;
  model?: string;
  citations?: TextCitation[];
  citations_count?: number;
}

/**
 * Extended thinking message
 */
export interface ThinkingMessageResponse extends BaseMessage {
  type: 'thinking';
  role: 'assistant';
  content: string;
  duration_ms?: number;
  model?: string;
  token_usage?: TokenUsage;
}

/**
 * Tool use message
 */
export interface ToolUseMessageResponse extends BaseMessage {
  type: 'tool_use';
  role: 'assistant';
  tool_name: string;
  tool_args: unknown;
  status: 'pending' | 'success' | 'error';
  result?: unknown;
  error_message?: string;
  tool_use_id?: string;
}

/**
 * Tool result message
 */
export interface ToolResultMessageResponse extends BaseMessage {
  type: 'tool_result';
  role: 'assistant';
  tool_name: string;
  tool_args: unknown;
  success: boolean;
  result?: unknown;
  error_message?: string;
  tool_use_id?: string;
  duration_ms?: number;
}

/**
 * Union type of all message response types
 */
export type MessageResponse =
  | StandardMessageResponse
  | ThinkingMessageResponse
  | ToolUseMessageResponse
  | ToolResultMessageResponse;

// ============================================
// Service Options
// ============================================

/**
 * Options for fetching sessions with cursor pagination
 */
export interface GetSessionsOptions {
  limit: number;
  before?: string; // ISO 8601 datetime cursor
}

/**
 * Options for fetching messages with cursor pagination
 */
export interface GetMessagesOptions {
  limit: number;
  before?: number; // sequence_number cursor
}
