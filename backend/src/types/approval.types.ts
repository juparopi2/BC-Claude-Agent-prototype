/**
 * Approval System Types
 *
 * Types for the Human-in-the-Loop approval system.
 * Used to request user approval before executing critical operations.
 */

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';
export type ApprovalPriority = 'high' | 'medium' | 'low';

/**
 * Approval request stored in database
 */
export interface ApprovalRequest {
  id: string;
  session_id: string;
  tool_name: string;
  tool_args: Record<string, unknown>;
  status: ApprovalStatus;
  priority: ApprovalPriority;
  created_at: Date;
  expires_at: Date;
  decided_at?: Date;
  decided_by?: string;
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
 * Data sent to client when approval is requested
 */
export interface ApprovalRequestEvent {
  approvalId: string;
  toolName: string;
  summary: ChangeSummary;
  changes: Record<string, unknown>;
  priority: ApprovalPriority;
  expiresAt: Date;
}

/**
 * Data sent to client when approval is resolved
 */
export interface ApprovalResolvedEvent {
  approvalId: string;
  decision: 'approved' | 'rejected';
  decidedBy: string;
  decidedAt: Date;
}

/**
 * Options for creating an approval request
 */
export interface CreateApprovalOptions {
  sessionId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  priority?: ApprovalPriority;
  expiresInMs?: number; // Default: 5 minutes
}

/**
 * Result of approval request
 */
export interface ApprovalResult {
  approved: boolean;
  reason?: string;
  timedOut: boolean;
}
