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
 * @module services/approval/ApprovalManager
 */

import { Server as SocketServer } from 'socket.io';
import crypto from 'crypto';
import { getDatabase } from '../../config/database';
import {
  ApprovalRequest,
  ApprovalStatus,
  ApprovalPriority,
  ChangeSummary,
  ApprovalRequestEvent,
  ApprovalResolvedEvent,
  CreateApprovalOptions,
} from '../../types/approval.types';

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

      await db.request()
        .input('id', approvalId)
        .input('session_id', sessionId)
        .input('tool_name', toolName)
        .input('tool_args', JSON.stringify(toolArgs))
        .input('status', 'pending')
        .input('priority', priority)
        .input('created_at', now)
        .input('expires_at', expiresAt)
        .query(`
          INSERT INTO approvals (id, session_id, tool_name, tool_args, status, priority, created_at, expires_at)
          VALUES (@id, @session_id, @tool_name, @tool_args, @status, @priority, @created_at, @expires_at)
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

      console.log(`📋 Approval requested: ${approvalId} (${toolName})`);

      // Return Promise that resolves when user responds
      return new Promise<boolean>((resolve, reject) => {
        // Set timeout to auto-reject
        const timeout = setTimeout(async () => {
          console.log(`⏰ Approval timeout: ${approvalId}`);
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
      console.error('❌ Failed to create approval request:', error);
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
      console.warn(`⚠️  No pending approval found for ID: ${approvalId}`);
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
          .input('decided_by', userId)
          .query(`
            UPDATE approvals
            SET status = @status, decided_at = @decided_at, decided_by = @decided_by
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

      console.log(`${approved ? '✅' : '❌'} Approval ${approved ? 'approved' : 'rejected'}: ${approvalId}`);

      // Resolve the Promise
      pending.resolve(approved);
    } catch (error) {
      console.error('❌ Failed to process approval response:', error);
      pending.reject(error instanceof Error ? error : new Error('Unknown error'));
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
        SELECT id, session_id, tool_name, tool_args, status, priority, created_at, expires_at, decided_at, decided_by
        FROM approvals
        WHERE session_id = @session_id AND status = @status
        ORDER BY created_at DESC
      `);

    return result.recordset.map((row) => ({
      id: row.id,
      session_id: row.session_id,
      tool_name: row.tool_name,
      tool_args: JSON.parse(row.tool_args),
      status: row.status as ApprovalStatus,
      priority: row.priority as ApprovalPriority,
      created_at: row.created_at,
      expires_at: row.expires_at,
      decided_at: row.decided_at,
      decided_by: row.decided_by,
    }));
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
      console.error(`❌ Failed to expire approval ${approvalId}:`, error);
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
        console.log(`⏰ Expired ${rowsAffected} old approval(s)`);
      }
    } catch (error) {
      console.error('❌ Failed to expire old approvals:', error);
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
