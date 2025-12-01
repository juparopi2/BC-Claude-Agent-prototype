/**
 * Approval System Types
 *
 * Types for the Human-in-the-Loop approval system.
 * Used to request user approval before executing critical operations.
 *
 * @module @bc-agent/shared/types/approval
 */

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';
export type ApprovalPriority = 'high' | 'medium' | 'low';

/**
 * Approval request stored in database
 */
export interface ApprovalRequest {
  id: string;
  session_id: string;
  message_id: string | null;
  decided_by_user_id: string | null;
  action_type: string;
  action_description: string;
  action_data: Record<string, unknown> | null;
  tool_name: string;
  tool_args: Record<string, unknown>;
  status: ApprovalStatus;
  priority: ApprovalPriority;
  rejection_reason: string | null;
  created_at: Date;
  expires_at: Date;
  decided_at: Date | null;
}

/**
 * Approval response from user
 */
export interface ApprovalResponse {
  approved: boolean;
  userId: string;
  reason?: string;
}

/**
 * Change summary for UI display
 */
export interface ChangeSummary {
  title: string;
  description: string;
  changes: Record<string, unknown>;
  impact: 'high' | 'medium' | 'low';
}

/**
 * Options for creating an approval request
 */
export interface CreateApprovalOptions {
  sessionId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  priority?: ApprovalPriority;
  expiresInMs?: number;
}

/**
 * Result of approval request
 */
export interface ApprovalResult {
  approved: boolean;
  reason?: string;
  timedOut: boolean;
}

/**
 * Error codes for approval ownership validation
 */
export type ApprovalOwnershipError =
  | 'APPROVAL_NOT_FOUND'
  | 'SESSION_NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'ALREADY_RESOLVED'
  | 'EXPIRED';
