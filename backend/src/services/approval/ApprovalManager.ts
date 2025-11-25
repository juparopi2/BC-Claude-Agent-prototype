/**
 * Approval Manager Service
 *
 * Handles Human-in-the-Loop approvals for critical operations.
 * Uses Promise-based pattern with WebSocket events for real-time approval requests.
 *
 * Pattern based on Claude Agent SDK documentation:
 * - Emit approval:requested event to client
 * - Wait for user response via Promise
 * - Resume agent execution after approval/rejection
 *
 * Security Features (F4-001):
 * - Atomic ownership validation to prevent TOCTOU race conditions
 * - Structured audit logging via Pino
 * - State validation (pending/expired/already-resolved)
 *
 * @module services/approval/ApprovalManager
 */

import { Server as SocketServer } from 'socket.io';
import crypto from 'crypto';
import { getDatabase } from '../../config/database';
import { createChildLogger } from '../../utils/logger';
import {
  ApprovalRequest,
  ApprovalStatus,
  ApprovalPriority,
  ChangeSummary,
  ApprovalRequestEvent,
  ApprovalResolvedEvent,
  CreateApprovalOptions,
  ApprovalOwnershipResult,
  AtomicApprovalResponseResult,
} from '../../types/approval.types';

// Structured logger for approval operations
const logger = createChildLogger({ service: 'ApprovalManager' });

/**
 * Pending approval promise handlers
 */
interface PendingApproval {
  resolve: (approved: boolean) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

/**
 * ApprovalManager class
 *
 * Manages approval workflows for agent operations
 * Uses a Map of pending Promises instead of EventEmitter for simpler, more explicit flow
 */
export class ApprovalManager {
  private io: SocketServer;
  private pendingApprovals: Map<string, PendingApproval>;
  private static instance: ApprovalManager | null = null;

  private constructor(io: SocketServer) {
    this.io = io;
    this.pendingApprovals = new Map();

    // Start background job to expire old approvals
    this.startExpirationJob();
  }

  /**
   * Get singleton instance of ApprovalManager
   *
   * @param io - Socket.IO server instance
   * @returns ApprovalManager instance
   */
  public static getInstance(io?: SocketServer): ApprovalManager {
    if (!ApprovalManager.instance) {
      if (!io) {
        throw new Error('Socket.IO server is required to initialize ApprovalManager');
      }
      ApprovalManager.instance = new ApprovalManager(io);
    }
    return ApprovalManager.instance;
  }

  /**
   * Request approval from user
   *
   * This method creates an approval request in the database, emits a WebSocket event,
   * and returns a Promise that resolves when the user responds.
   *
   * @param options - Approval request options
   * @returns Promise that resolves to true if approved, false if rejected
   *
   * @example
   * const approved = await approvalManager.request({
   *   sessionId: 'session-123',
   *   toolName: 'bc_create_customer',
   *   toolArgs: { name: 'Acme Corp', email: 'acme@example.com' }
   * });
   *
   * if (approved) {
   *   // Continue with operation
   * } else {
   *   // Cancel operation
   * }
   */
  public async request(options: CreateApprovalOptions): Promise<boolean> {
    const {
      sessionId,
      toolName,
      toolArgs,
      priority = this.calculatePriority(toolName),
      expiresInMs = 5 * 60 * 1000, // Default: 5 minutes
    } = options;

    const db = getDatabase();
    if (!db) {
      throw new Error('Database connection not available');
    }

    try {
      // Generate change summary
      const summary = this.generateChangeSummary(toolName, toolArgs);

      // Create approval request in database
      const approvalId = this.generateApprovalId();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + expiresInMs);
      const actionType = this.getActionType(toolName);

      await db.request()
        .input('id', approvalId)
        .input('session_id', sessionId)
        .input('message_id', null)  // Can be set later if needed
        .input('decided_by_user_id', null)
        .input('action_type', actionType)
        .input('action_description', summary.description)
        .input('action_data', JSON.stringify(toolArgs))
        .input('tool_name', toolName)
        .input('tool_args', JSON.stringify(toolArgs))
        .input('status', 'pending')
        .input('priority', priority)
        .input('rejection_reason', null)
        .input('created_at', now)
        .input('expires_at', expiresAt)
        .query(`
          INSERT INTO approvals (id, session_id, message_id, decided_by_user_id, action_type, action_description, action_data, tool_name, tool_args, status, priority, rejection_reason, created_at, expires_at)
          VALUES (@id, @session_id, @message_id, @decided_by_user_id, @action_type, @action_description, @action_data, @tool_name, @tool_args, @status, @priority, @rejection_reason, @created_at, @expires_at)
        `);

      // Emit WebSocket event to client
      const requestEvent: ApprovalRequestEvent = {
        approvalId,
        toolName,
        summary,
        changes: toolArgs,
        priority,
        expiresAt,
      };

      this.io.to(sessionId).emit('approval:requested', requestEvent);

      logger.info({ approvalId, toolName, sessionId, priority }, 'Approval requested');

      // Return Promise that resolves when user responds
      return new Promise<boolean>((resolve, reject) => {
        // Set timeout to auto-reject
        const timeout = setTimeout(async () => {
          logger.info({ approvalId, sessionId }, 'Approval timeout - auto-expiring');
          this.pendingApprovals.delete(approvalId);
          await this.expireApproval(approvalId);
          resolve(false);
        }, expiresInMs);

        // Store pending approval with resolve/reject handlers
        this.pendingApprovals.set(approvalId, {
          resolve,
          reject,
          timeout,
        });
      });
    } catch (error) {
      logger.error({ err: error, sessionId, toolName }, 'Failed to create approval request');
      throw error;
    }
  }

  /**
   * Respond to an approval request
   *
   * Called when user approves or rejects an approval request.
   * This resolves the Promise returned by request().
   *
   * @param approvalId - ID of the approval request
   * @param decision - 'approved' or 'rejected'
   * @param userId - ID of the user making the decision
   * @param reason - Optional reason for decision
   */
  public async respondToApproval(
    approvalId: string,
    decision: 'approved' | 'rejected',
    userId: string,
    _reason?: string
  ): Promise<void> {
    const pending = this.pendingApprovals.get(approvalId);

    if (!pending) {
      logger.warn({ approvalId, userId }, 'No pending approval promise found - may have been processed already');
      return;
    }

    // Clear timeout
    clearTimeout(pending.timeout);

    // Remove from pending map
    this.pendingApprovals.delete(approvalId);

    const approved = decision === 'approved';

    try {
      // Update database
      const db = getDatabase();
      if (db) {
        await db.request()
          .input('id', approvalId)
          .input('status', approved ? 'approved' : 'rejected')
          .input('decided_at', new Date())
          .input('decided_by_user_id', userId)
          .query(`
            UPDATE approvals
            SET status = @status, decided_at = @decided_at, decided_by_user_id = @decided_by_user_id
            WHERE id = @id
          `);
      }

      // Emit resolved event (get sessionId from database)
      const result = await db?.request()
        .input('id', approvalId)
        .query('SELECT session_id FROM approvals WHERE id = @id');

      if (result && result.recordset[0]) {
        const sessionId = result.recordset[0].session_id;
        const resolvedEvent: ApprovalResolvedEvent = {
          approvalId,
          decision: approved ? 'approved' : 'rejected',
          decidedBy: userId,
          decidedAt: new Date(),
        };

        this.io.to(sessionId).emit('approval:resolved', resolvedEvent);
      }

      logger.info({ approvalId, decision, userId }, `Approval ${approved ? 'approved' : 'rejected'}`);

      // Resolve the Promise
      pending.resolve(approved);
    } catch (error) {
      logger.error({ err: error, approvalId, userId }, 'Failed to process approval response');
      pending.reject(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Atomically respond to an approval request with ownership validation
   *
   * This method combines ownership check + state validation + response in a single
   * atomic operation to prevent TOCTOU (Time Of Check To Time Of Use) race conditions.
   *
   * Security: Uses database transaction to ensure no race condition between
   * validation and response.
   *
   * @param approvalId - ID of the approval request
   * @param decision - 'approved' or 'rejected'
   * @param userId - ID of the user making the decision
   * @param reason - Optional reason for decision
   * @returns Result indicating success or specific error
   */
  public async respondToApprovalAtomic(
    approvalId: string,
    decision: 'approved' | 'rejected',
    userId: string,
    reason?: string
  ): Promise<AtomicApprovalResponseResult> {
    const db = getDatabase();
    if (!db) {
      throw new Error('Database connection not available');
    }

    const transaction = db.transaction();

    try {
      await transaction.begin();

      // Step 1: Atomic query with row lock to prevent concurrent modifications
      // Uses LEFT JOIN to differentiate between "approval not found" and "session not found"
      const validationResult = await transaction.request()
        .input('approvalId', approvalId)
        .input('userId', userId)
        .query<{
          approval_id: string | null;
          session_id: string | null;
          status: string | null;
          session_user_id: string | null;
          session_exists: number;
        }>(`
          SELECT
            a.id AS approval_id,
            a.session_id,
            a.status,
            s.user_id AS session_user_id,
            CASE WHEN s.id IS NOT NULL THEN 1 ELSE 0 END AS session_exists
          FROM approvals a WITH (UPDLOCK, ROWLOCK)
          LEFT JOIN sessions s ON a.session_id = s.id
          WHERE a.id = @approvalId
        `);

      const row = validationResult.recordset[0];

      // Case 1: Approval not found
      if (!row || !row.approval_id) {
        await transaction.rollback();
        logger.warn({ approvalId, userId }, 'Approval not found during atomic response');
        return {
          success: false,
          error: 'APPROVAL_NOT_FOUND',
        };
      }

      // Case 2: Session was deleted (orphaned approval)
      if (!row.session_exists) {
        await transaction.rollback();
        logger.warn({ approvalId, userId, sessionId: row.session_id }, 'Session not found for approval');
        return {
          success: false,
          error: 'SESSION_NOT_FOUND',
          sessionId: row.session_id ?? undefined,
        };
      }

      // Case 3: User doesn't own the session
      if (row.session_user_id !== userId) {
        await transaction.rollback();
        logger.warn(
          {
            approvalId,
            attemptedByUserId: userId,
            actualOwnerId: row.session_user_id,
            sessionId: row.session_id,
          },
          'Unauthorized approval access attempt'
        );
        return {
          success: false,
          error: 'UNAUTHORIZED',
          sessionId: row.session_id ?? undefined,
          sessionUserId: row.session_user_id ?? undefined,
        };
      }

      // Case 4: Approval already resolved
      if (row.status !== 'pending') {
        await transaction.rollback();
        logger.warn(
          { approvalId, userId, currentStatus: row.status },
          'Approval already resolved'
        );
        return {
          success: false,
          error: row.status === 'expired' ? 'EXPIRED' : 'ALREADY_RESOLVED',
          previousStatus: row.status as 'approved' | 'rejected' | 'expired',
          sessionId: row.session_id ?? undefined,
        };
      }

      // Step 2: Check if we have a pending promise (in-memory)
      const pending = this.pendingApprovals.get(approvalId);
      if (!pending) {
        await transaction.rollback();
        logger.warn(
          { approvalId, userId },
          'No pending promise for approval - server may have restarted'
        );
        return {
          success: false,
          error: 'NO_PENDING_PROMISE',
          sessionId: row.session_id ?? undefined,
        };
      }

      // Step 3: All validations passed - update the approval atomically
      const approved = decision === 'approved';
      await transaction.request()
        .input('id', approvalId)
        .input('status', approved ? 'approved' : 'rejected')
        .input('decided_at', new Date())
        .input('decided_by_user_id', userId)
        .input('rejection_reason', reason ?? null)
        .query(`
          UPDATE approvals
          SET status = @status,
              decided_at = @decided_at,
              decided_by_user_id = @decided_by_user_id,
              rejection_reason = @rejection_reason
          WHERE id = @id AND status = 'pending'
        `);

      await transaction.commit();

      // Step 4: Clear timeout and resolve promise (outside transaction)
      clearTimeout(pending.timeout);
      this.pendingApprovals.delete(approvalId);

      // Emit WebSocket event
      const resolvedEvent: ApprovalResolvedEvent = {
        approvalId,
        decision: approved ? 'approved' : 'rejected',
        decidedBy: userId,
        decidedAt: new Date(),
      };
      this.io.to(row.session_id!).emit('approval:resolved', resolvedEvent);

      logger.info(
        { approvalId, decision, userId, sessionId: row.session_id },
        `Approval ${decision} atomically`
      );

      // Resolve the Promise
      pending.resolve(approved);

      return {
        success: true,
        sessionId: row.session_id ?? undefined,
        sessionUserId: row.session_user_id ?? undefined,
      };
    } catch (error) {
      await transaction.rollback();
      logger.error({ err: error, approvalId, userId }, 'Failed to process atomic approval response');
      throw error;
    }
  }

  /**
   * Get pending approvals for a session
   *
   * @param sessionId - Session ID
   * @returns Array of pending approval requests
   */
  public async getPendingApprovals(sessionId: string): Promise<ApprovalRequest[]> {
    const db = getDatabase();
    if (!db) {
      throw new Error('Database connection not available');
    }

    const result = await db.request()
      .input('session_id', sessionId)
      .input('status', 'pending')
      .query(`
        SELECT id, session_id, message_id, decided_by_user_id, action_type, action_description, action_data,
               tool_name, tool_args, status, priority, rejection_reason, created_at, expires_at, decided_at
        FROM approvals
        WHERE session_id = @session_id AND status = @status
        ORDER BY created_at DESC
      `);

    return result.recordset.map((row) => ({
      id: row.id,
      session_id: row.session_id,
      message_id: row.message_id,
      decided_by_user_id: row.decided_by_user_id,
      action_type: row.action_type,
      action_description: row.action_description,
      action_data: row.action_data ? JSON.parse(row.action_data) : null,
      tool_name: row.tool_name,
      tool_args: JSON.parse(row.tool_args),
      status: row.status as ApprovalStatus,
      priority: row.priority as ApprovalPriority,
      rejection_reason: row.rejection_reason,
      created_at: row.created_at,
      expires_at: row.expires_at,
      decided_at: row.decided_at,
    }));
  }

  /**
   * Validate that a user owns the session associated with an approval request
   *
   * This is a security check to prevent users from approving/rejecting
   * approval requests for sessions they do not own.
   *
   * Note: For atomic operations (preventing TOCTOU race conditions), use
   * respondToApprovalAtomic() instead which combines validation and response.
   *
   * @param approvalId - ID of the approval request
   * @param userId - ID of the user attempting to respond
   * @returns Validation result with ownership status and error details
   *
   * @example
   * const result = await approvalManager.validateApprovalOwnership(approvalId, userId);
   * if (!result.isOwner) {
   *   // Return 403 Forbidden
   *   logger.warn({ userId, approvalId }, 'Unauthorized access attempt');
   * }
   */
  public async validateApprovalOwnership(
    approvalId: string,
    userId: string
  ): Promise<ApprovalOwnershipResult> {
    const db = getDatabase();
    if (!db) {
      throw new Error('Database connection not available');
    }

    try {
      // Query approval with session ownership information
      // Uses LEFT JOIN to differentiate "approval not found" vs "session not found"
      const result = await db.request()
        .input('approvalId', approvalId)
        .query<{
          approval_id: string | null;
          session_id: string | null;
          tool_name: string | null;
          tool_args: string | null;
          status: string | null;
          priority: string | null;
          created_at: Date | null;
          expires_at: Date | null;
          session_user_id: string | null;
          session_exists: number;
        }>(`
          SELECT
            a.id AS approval_id,
            a.session_id,
            a.tool_name,
            a.tool_args,
            a.status,
            a.priority,
            a.created_at,
            a.expires_at,
            s.user_id AS session_user_id,
            CASE WHEN s.id IS NOT NULL THEN 1 ELSE 0 END AS session_exists
          FROM approvals a
          LEFT JOIN sessions s ON a.session_id = s.id
          WHERE a.id = @approvalId
        `);

      // Check if approval exists
      if (result.recordset.length === 0) {
        logger.warn({ approvalId, userId }, 'Approval not found');
        return {
          isOwner: false,
          approval: null,
          sessionUserId: null,
          error: 'APPROVAL_NOT_FOUND',
        };
      }

      const row = result.recordset[0];
      if (!row || !row.approval_id) {
        return {
          isOwner: false,
          approval: null,
          sessionUserId: null,
          error: 'APPROVAL_NOT_FOUND',
        };
      }

      // Check if session exists (approval exists but session was deleted)
      if (!row.session_exists) {
        logger.warn(
          { approvalId, userId, sessionId: row.session_id },
          'Session not found for approval (orphaned approval)'
        );
        return {
          isOwner: false,
          approval: null,
          sessionUserId: null,
          error: 'SESSION_NOT_FOUND',
        };
      }

      // Check if user owns the session
      const isOwner = row.session_user_id === userId;

      if (!isOwner) {
        logger.warn(
          {
            approvalId,
            attemptedByUserId: userId,
            actualOwnerId: row.session_user_id,
            sessionId: row.session_id,
          },
          'Unauthorized approval access attempt'
        );
      }

      // Parse tool_args safely
      let parsedToolArgs: Record<string, unknown> = {};
      if (row.tool_args) {
        try {
          parsedToolArgs = JSON.parse(row.tool_args) as Record<string, unknown>;
        } catch (parseError) {
          logger.error(
            { err: parseError, approvalId, rawToolArgs: row.tool_args },
            'Failed to parse tool_args JSON'
          );
          parsedToolArgs = { _parseError: 'Invalid JSON in tool_args' };
        }
      }

      // Build partial approval object for response
      const approval: ApprovalRequest = {
        id: row.approval_id,
        session_id: row.session_id!,
        message_id: null,
        decided_by_user_id: null,
        action_type: this.getActionType(row.tool_name ?? ''),
        action_description: '',
        action_data: null,
        tool_name: row.tool_name ?? '',
        tool_args: parsedToolArgs,
        status: row.status as ApprovalStatus,
        priority: row.priority as ApprovalPriority,
        rejection_reason: null,
        created_at: row.created_at!,
        expires_at: row.expires_at!,
        decided_at: null,
      };

      return {
        isOwner,
        approval,
        sessionUserId: row.session_user_id,
        error: isOwner ? undefined : 'UNAUTHORIZED',
      };
    } catch (error) {
      logger.error({ err: error, approvalId, userId }, 'Error validating approval ownership');
      throw error;
    }
  }

  /**
   * Generate change summary for UI display
   *
   * @param toolName - Name of the tool to execute
   * @param args - Tool arguments
   * @returns Human-readable change summary
   */
  private generateChangeSummary(toolName: string, args: Record<string, unknown>): ChangeSummary {
    // BC Create Customer
    if (toolName === 'bc_create_customer' || toolName.includes('create_customer')) {
      return {
        title: 'Create New Customer',
        description: `Create a new customer record in Business Central`,
        changes: {
          'Customer Name': args.name || args.displayName || 'Unknown',
          'Email': args.email || 'Not provided',
          'Phone': args.phoneNumber || 'Not provided',
          'Address': args.address || 'Not provided',
        },
        impact: 'medium',
      };
    }

    // BC Update Customer
    if (toolName === 'bc_update_customer' || toolName.includes('update_customer')) {
      return {
        title: 'Update Customer',
        description: `Update customer record: ${args.id || args.customerId || 'Unknown'}`,
        changes: args,
        impact: 'medium',
      };
    }

    // BC Create Item
    if (toolName === 'bc_create_item' || toolName.includes('create_item')) {
      return {
        title: 'Create New Item',
        description: `Create a new item in Business Central`,
        changes: {
          'Item Number': args.no || args.itemNo || 'Auto-generated',
          'Description': args.description || 'Not provided',
          'Unit Price': args.unitPrice || 0,
          'Type': args.type || 'Inventory',
        },
        impact: 'medium',
      };
    }

    // BC Update Item
    if (toolName === 'bc_update_item' || toolName.includes('update_item')) {
      return {
        title: 'Update Item',
        description: `Update item: ${args.no || args.itemNo || 'Unknown'}`,
        changes: args,
        impact: 'medium',
      };
    }

    // BC Create Vendor
    if (toolName === 'bc_create_vendor' || toolName.includes('create_vendor')) {
      return {
        title: 'Create New Vendor',
        description: `Create a new vendor record in Business Central`,
        changes: {
          'Vendor Name': args.name || args.displayName || 'Unknown',
          'Email': args.email || 'Not provided',
          'Phone': args.phoneNumber || 'Not provided',
        },
        impact: 'medium',
      };
    }

    // BC Delete operations
    if (toolName.includes('delete')) {
      return {
        title: 'Delete Record',
        description: `Delete ${toolName.replace('bc_delete_', '')} record`,
        changes: args,
        impact: 'high',
      };
    }

    // BC Batch operations
    if (toolName.includes('batch')) {
      return {
        title: 'Batch Operation',
        description: `Execute batch operation: ${toolName}`,
        changes: args,
        impact: 'high',
      };
    }

    // Generic fallback
    return {
      title: toolName.replace('bc_', '').replace(/_/g, ' ').toUpperCase(),
      description: `Execute operation: ${toolName}`,
      changes: args,
      impact: 'medium',
    };
  }

  /**
   * Calculate priority level for a tool
   *
   * @param toolName - Name of the tool
   * @returns Priority level
   */
  private calculatePriority(toolName: string): ApprovalPriority {
    if (toolName.includes('delete') || toolName.includes('batch')) {
      return 'high';
    }

    if (toolName.includes('create') || toolName.includes('update')) {
      return 'medium';
    }

    return 'low';
  }

  /**
   * Get action type for a tool
   *
   * @param toolName - Name of the tool
   * @returns Action type
   */
  private getActionType(toolName: string): string {
    if (toolName.includes('create')) {
      return 'bc_create';
    }
    if (toolName.includes('update')) {
      return 'bc_update';
    }
    if (toolName.includes('delete')) {
      return 'bc_delete';
    }
    return 'bc_query';
  }

  /**
   * Expire an approval request
   *
   * @param approvalId - ID of the approval to expire
   */
  private async expireApproval(approvalId: string): Promise<void> {
    const db = getDatabase();
    if (!db) {
      return;
    }

    try {
      await db.request()
        .input('id', approvalId)
        .input('status', 'expired')
        .query(`
          UPDATE approvals
          SET status = @status
          WHERE id = @id AND status = 'pending'
        `);
    } catch (error) {
      logger.error({ err: error, approvalId }, 'Failed to expire approval');
    }
  }

  /**
   * Start background job to expire old approvals
   */
  private startExpirationJob(): void {
    // Run every minute
    setInterval(() => {
      this.expireOldApprovals();
    }, 60 * 1000);
  }

  /**
   * Expire old pending approvals that have passed their expiration time
   */
  public async expireOldApprovals(): Promise<void> {
    const db = getDatabase();
    if (!db) {
      return;
    }

    try {
      const result = await db.request()
        .input('now', new Date())
        .query(`
          UPDATE approvals
          SET status = 'expired'
          WHERE status = 'pending' AND expires_at < @now
        `);

      const rowsAffected = result.rowsAffected?.[0] ?? 0;
      if (rowsAffected > 0) {
        logger.info({ expiredCount: rowsAffected }, 'Expired old approvals');
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to expire old approvals');
    }
  }

  /**
   * Generate unique approval ID (GUID)
   *
   * @returns UUID v4 GUID for approval ID
   */
  private generateApprovalId(): string {
    return crypto.randomUUID();
  }
}

/**
 * Get singleton instance of ApprovalManager
 *
 * @param io - Socket.IO server instance (required on first call)
 * @returns ApprovalManager instance
 */
export function getApprovalManager(io?: SocketServer): ApprovalManager {
  return ApprovalManager.getInstance(io);
}
