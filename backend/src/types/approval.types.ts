/**
 * Approval System Types
 *
 * Types for the Human-in-the-Loop approval system.
 * Used to request user approval before executing critical operations.
 *
 * Shared types are imported from @bc-agent/shared.
 * Backend-specific types are defined here.
 */

// ============================================
// Re-export ALL shared Approval types
// ============================================
export type {
  ApprovalStatus,
  ApprovalPriority,
  ApprovalRequest,
  ApprovalResponse,
  ChangeSummary,
  CreateApprovalOptions,
  ApprovalResult,
  ApprovalOwnershipError,
} from '@bc-agent/shared';

// Import types for use in backend-specific types
import type { ApprovalStatus, ApprovalRequest, ApprovalPriority, ApprovalOwnershipError } from '@bc-agent/shared';

// ============================================
// Backend-Specific Types (not shared with frontend)
// ============================================

/**
 * Data sent to client when approval is requested
 *
 * @deprecated F4-002: Use ApprovalRequestedEvent from agent.types.ts instead.
 * This type was used with the legacy 'approval:requested' WebSocket event.
 * The server now emits via 'agent:event' with type 'approval_requested'.
 */
export interface ApprovalRequestEvent {
  approvalId: string;
  toolName: string;
  summary: {
    title: string;
    description: string;
    changes: Record<string, unknown>;
    impact: 'high' | 'medium' | 'low';
  };
  changes: Record<string, unknown>;
  priority: ApprovalPriority;
  expiresAt: Date;
}

/**
 * Data sent to client when approval is resolved
 *
 * @deprecated F4-002: Use ApprovalResolvedEvent from agent.types.ts instead.
 * This type was used with the legacy 'approval:resolved' WebSocket event.
 * The server now emits via 'agent:event' with type 'approval_resolved'.
 */
export interface ApprovalResolvedEvent {
  approvalId: string;
  decision: 'approved' | 'rejected';
  decidedBy: string;
  decidedAt: Date;
}

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
