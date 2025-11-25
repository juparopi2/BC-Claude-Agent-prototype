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

/**
 * Error codes for approval ownership validation
 */
export type ApprovalOwnershipError =
  | 'APPROVAL_NOT_FOUND'
  | 'SESSION_NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'ALREADY_RESOLVED'
  | 'EXPIRED';

/**
 * Result of approval ownership validation
 * Used to verify that a user owns the session associated with an approval request
 */
export interface ApprovalOwnershipResult {
  /** Whether the user is the owner of the session */
  isOwner: boolean;
  /** The approval request if found */
  approval: ApprovalRequest | null;
  /** The user ID that owns the session (for audit logging) */
  sessionUserId: string | null;
  /** Error code if validation failed */
  error?: ApprovalOwnershipError;
}

/**
 * Result of atomic approval response with ownership validation
 * Combines ownership check + state validation + response in single transaction
 */
export interface AtomicApprovalResponseResult {
  /** Whether the response was successfully processed */
  success: boolean;
  /** Error code if operation failed */
  error?: ApprovalOwnershipError | 'NO_PENDING_PROMISE';
  /** The approval status before this operation */
  previousStatus?: ApprovalStatus;
  /** Session ID for WebSocket notification */
  sessionId?: string;
  /** Session owner user ID for audit */
  sessionUserId?: string;
}
