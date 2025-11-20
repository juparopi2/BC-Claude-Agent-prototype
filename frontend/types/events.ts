/**
 * WebSocket Event Types
 *
 * Discriminated union types for agent:event WebSocket emissions.
 * Based on backend websocket-contract.md
 */

import type { StopReason } from "./api";

export interface BaseAgentEvent {
  eventId: string;
  sequenceNumber: number;
  persistenceState: "queued" | "persisted" | "failed";
  timestamp: Date;
  correlationId?: string;
  parentEventId?: string;
}

export interface SessionStartEvent extends BaseAgentEvent {
  type: "session_start";
  sessionId: string;
  userId: string;
}

export interface ThinkingEvent extends BaseAgentEvent {
  type: "thinking";
  content?: string;
}

export interface MessageChunkEvent extends BaseAgentEvent {
  type: "message_chunk";
  content: string;
}

export interface MessageEvent extends BaseAgentEvent {
  type: "message";
  content: string;
  stopReason?: StopReason;
  tokenCount?: number;
}

export interface ToolUseEvent extends BaseAgentEvent {
  type: "tool_use";
  toolName: string;
  toolArgs: Record<string, unknown>;
  requiresApproval: boolean;
}

export interface ToolResultEvent extends BaseAgentEvent {
  type: "tool_result";
  toolName: string;
  result: unknown;
  success: boolean;
  error?: string;
}

export interface CompleteEvent extends BaseAgentEvent {
  type: "complete";
  reason: string;
}

export interface ErrorEvent extends BaseAgentEvent {
  type: "error";
  error: string;
  code?: string;
  recoverable: boolean;
}

export type AgentEvent =
  | SessionStartEvent
  | ThinkingEvent
  | MessageChunkEvent
  | MessageEvent
  | ToolUseEvent
  | ToolResultEvent
  | CompleteEvent
  | ErrorEvent;

export interface ApprovalRequestedEvent {
  approvalId: string;
  toolName: string;
  summary: {
    title: string;
    description: string;
    changes: Record<string, unknown>;
    impact: "high" | "medium" | "low";
  };
  changes: Record<string, unknown>;
  priority: "high" | "medium" | "low";
  expiresAt: string;
}

export interface ApprovalResolvedEvent {
  approvalId: string;
  approved: boolean;
  reason?: string;
}

export type EventHandler<T = unknown> = (data: T) => void;
