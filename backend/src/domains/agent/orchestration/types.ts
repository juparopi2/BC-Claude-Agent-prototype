/**
 * @module domains/agent/orchestration/types
 *
 * Types for agent orchestration, extending @bc-agent/shared types.
 */
// Types from @bc-agent/shared will be imported when AgentOrchestrator is implemented
// import type { AgentEvent, BaseAgentEvent } from '@bc-agent/shared';

// TODO: Add orchestration-specific types when implementing AgentOrchestrator
export interface ExecuteStreamingOptions {
  attachments?: string[];
  enableAutoSemanticSearch?: boolean;
  semanticThreshold?: number;
  maxSemanticFiles?: number;
}

export interface AgentExecutionResult {
  success: boolean;
  messageId?: string;
  stopReason?: string;
  error?: string;
}
