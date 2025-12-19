/**
 * Deletion Audit Service
 *
 * GDPR-compliant audit logging for data deletion operations.
 * Tracks cascade deletion across all storage locations:
 * - Database (files, file_chunks)
 * - Azure Blob Storage
 * - Azure AI Search (vector embeddings)
 * - Redis Cache
 *
 * Supports:
 * - GDPR Article 17: Right to Erasure
 * - GDPR Article 30: Records of Processing Activities
 *
 * @module services/files/DeletionAuditService
 */

import { v4 as uuidv4 } from 'uuid';
import { executeQuery, SqlParams } from '@/infrastructure/database/database';
import { createChildLogger } from '@/shared/utils/logger';

const logger = createChildLogger({ service: 'DeletionAuditService' });

/**
 * Resource types that can be deleted
 */
export type DeletionResourceType = 'file' | 'folder' | 'user_account' | 'session';

/**
 * Deletion reasons for audit trail
 */
export type DeletionReason = 'user_request' | 'gdpr_erasure' | 'retention_policy' | 'admin_action';

/**
 * Deletion status tracking
 */
export type DeletionStatus = 'pending' | 'in_progress' | 'completed' | 'partial' | 'failed';

/**
 * Input for creating a deletion audit record
 */
export interface CreateDeletionAuditInput {
  userId: string;
  resourceType: DeletionResourceType;
  resourceId: string;
  resourceName?: string;
  deletionReason?: DeletionReason;
  requestedBy?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Storage location deletion status update
 */
export interface StorageStatusUpdate {
  deletedFromDb?: boolean;
  deletedFromBlob?: boolean;
  deletedFromSearch?: boolean;
  deletedFromCache?: boolean;
  childFilesDeleted?: number;
  childChunksDeleted?: number;
  errorDetails?: string;
}

/**
 * Deletion audit record (database row)
 */
export interface DeletionAuditRecord {
  id: string;
  userId: string;
  resourceType: DeletionResourceType;
  resourceId: string;
  resourceName: string | null;
  deletionReason: DeletionReason | null;
  requestedBy: string | null;
  deletedFromDb: boolean;
  deletedFromBlob: boolean;
  deletedFromSearch: boolean;
  deletedFromCache: boolean;
  childFilesDeleted: number;
  childChunksDeleted: number;
  requestedAt: Date;
  completedAt: Date | null;
  status: DeletionStatus;
  errorDetails: string | null;
  metadata: Record<string, unknown> | null;
}

/**
 * Database record shape
 */
interface DeletionAuditDbRecord {
  id: string;
  user_id: string;
  resource_type: string;
  resource_id: string;
  resource_name: string | null;
  deletion_reason: string | null;
  requested_by: string | null;
  deleted_from_db: boolean;
  deleted_from_blob: boolean;
  deleted_from_search: boolean;
  deleted_from_cache: boolean;
  child_files_deleted: number;
  child_chunks_deleted: number;
  requested_at: Date;
  completed_at: Date | null;
  status: string;
  error_details: string | null;
  metadata: string | null;
}

/**
 * Parse database record to typed object
 */
function parseRecord(record: DeletionAuditDbRecord): DeletionAuditRecord {
  return {
    id: record.id,
    userId: record.user_id,
    resourceType: record.resource_type as DeletionResourceType,
    resourceId: record.resource_id,
    resourceName: record.resource_name,
    deletionReason: record.deletion_reason as DeletionReason | null,
    requestedBy: record.requested_by,
    deletedFromDb: record.deleted_from_db,
    deletedFromBlob: record.deleted_from_blob,
    deletedFromSearch: record.deleted_from_search,
    deletedFromCache: record.deleted_from_cache,
    childFilesDeleted: record.child_files_deleted,
    childChunksDeleted: record.child_chunks_deleted,
    requestedAt: record.requested_at,
    completedAt: record.completed_at,
    status: record.status as DeletionStatus,
    errorDetails: record.error_details,
    metadata: record.metadata ? JSON.parse(record.metadata) : null,
  };
}

/**
 * Deletion Audit Service
 *
 * Singleton service for GDPR-compliant deletion audit logging.
 */
export class DeletionAuditService {
  private static instance: DeletionAuditService | null = null;

  private constructor() {
    logger.info('DeletionAuditService initialized');
  }

  public static getInstance(): DeletionAuditService {
    if (!DeletionAuditService.instance) {
      DeletionAuditService.instance = new DeletionAuditService();
    }
    return DeletionAuditService.instance;
  }

  /**
   * Reset singleton (for testing)
   */
  public static resetInstance(): void {
    DeletionAuditService.instance = null;
  }

  /**
   * Log a deletion request
   *
   * Call this at the START of a deletion operation.
   * Returns audit ID to track the deletion through completion.
   *
   * @param input - Deletion request details
   * @returns Audit record ID
   */
  public async logDeletionRequest(input: CreateDeletionAuditInput): Promise<string> {
    const auditId = uuidv4();

    logger.info(
      { auditId, userId: input.userId, resourceType: input.resourceType, resourceId: input.resourceId },
      'Logging deletion request'
    );

    const params: SqlParams = {
      id: auditId,
      user_id: input.userId,
      resource_type: input.resourceType,
      resource_id: input.resourceId,
      resource_name: input.resourceName || null,
      deletion_reason: input.deletionReason || 'user_request',
      requested_by: input.requestedBy || input.userId,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      status: 'in_progress',
    };

    await executeQuery(
      `INSERT INTO deletion_audit_log (
        id, user_id, resource_type, resource_id, resource_name,
        deletion_reason, requested_by, metadata, status, requested_at
      )
      VALUES (
        @id, @user_id, @resource_type, @resource_id, @resource_name,
        @deletion_reason, @requested_by, @metadata, @status, GETUTCDATE()
      )`,
      params
    );

    logger.info({ auditId }, 'Deletion request logged');
    return auditId;
  }

  /**
   * Update storage deletion status
   *
   * Call this as each storage location is cleaned.
   *
   * @param auditId - Audit record ID
   * @param update - Storage status updates
   */
  public async updateStorageStatus(auditId: string, update: StorageStatusUpdate): Promise<void> {
    logger.debug({ auditId, update }, 'Updating storage status');

    const setClauses: string[] = [];
    const params: SqlParams = { id: auditId };

    if (update.deletedFromDb !== undefined) {
      setClauses.push('deleted_from_db = @deleted_from_db');
      params.deleted_from_db = update.deletedFromDb;
    }

    if (update.deletedFromBlob !== undefined) {
      setClauses.push('deleted_from_blob = @deleted_from_blob');
      params.deleted_from_blob = update.deletedFromBlob;
    }

    if (update.deletedFromSearch !== undefined) {
      setClauses.push('deleted_from_search = @deleted_from_search');
      params.deleted_from_search = update.deletedFromSearch;
    }

    if (update.deletedFromCache !== undefined) {
      setClauses.push('deleted_from_cache = @deleted_from_cache');
      params.deleted_from_cache = update.deletedFromCache;
    }

    if (update.childFilesDeleted !== undefined) {
      setClauses.push('child_files_deleted = @child_files_deleted');
      params.child_files_deleted = update.childFilesDeleted;
    }

    if (update.childChunksDeleted !== undefined) {
      setClauses.push('child_chunks_deleted = @child_chunks_deleted');
      params.child_chunks_deleted = update.childChunksDeleted;
    }

    if (update.errorDetails !== undefined) {
      setClauses.push('error_details = @error_details');
      params.error_details = update.errorDetails;
    }

    if (setClauses.length === 0) {
      return;
    }

    await executeQuery(
      `UPDATE deletion_audit_log SET ${setClauses.join(', ')} WHERE id = @id`,
      params
    );

    logger.debug({ auditId }, 'Storage status updated');
  }

  /**
   * Mark deletion as completed
   *
   * Call this when ALL storage locations have been cleaned.
   *
   * @param auditId - Audit record ID
   * @param status - Final status (completed, partial, or failed)
   * @param errorDetails - Optional error details if failed
   */
  public async markCompleted(
    auditId: string,
    status: 'completed' | 'partial' | 'failed' = 'completed',
    errorDetails?: string
  ): Promise<void> {
    logger.info({ auditId, status }, 'Marking deletion as completed');

    // Use conditional SQL to handle NULL error_details properly
    // T-SQL: "column = NULL" always returns FALSE, must use "column IS NULL" or explicit NULL assignment
    if (errorDetails) {
      await executeQuery(
        `UPDATE deletion_audit_log
         SET status = @status, completed_at = GETUTCDATE(), error_details = @error_details
         WHERE id = @id`,
        { id: auditId, status, error_details: errorDetails }
      );
    } else {
      await executeQuery(
        `UPDATE deletion_audit_log
         SET status = @status, completed_at = GETUTCDATE(), error_details = NULL
         WHERE id = @id`,
        { id: auditId, status }
      );
    }

    logger.info({ auditId, status }, 'Deletion marked as completed');
  }

  /**
   * Get deletion history for a user (GDPR data subject request)
   *
   * @param userId - User ID
   * @param limit - Max records to return
   * @param offset - Pagination offset
   * @returns Array of deletion audit records
   */
  public async getDeletionHistory(
    userId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<DeletionAuditRecord[]> {
    logger.info({ userId, limit, offset }, 'Getting deletion history');

    const result = await executeQuery<DeletionAuditDbRecord>(
      `SELECT *
       FROM deletion_audit_log
       WHERE user_id = @user_id
       ORDER BY requested_at DESC
       OFFSET @offset ROWS
       FETCH NEXT @limit ROWS ONLY`,
      { user_id: userId, limit, offset }
    );

    return result.recordset.map(parseRecord);
  }

  /**
   * Get single audit record by ID
   *
   * @param auditId - Audit record ID
   * @returns Audit record or null
   */
  public async getAuditRecord(auditId: string): Promise<DeletionAuditRecord | null> {
    const result = await executeQuery<DeletionAuditDbRecord>(
      `SELECT * FROM deletion_audit_log WHERE id = @id`,
      { id: auditId }
    );

    const record = result.recordset[0];
    return record ? parseRecord(record) : null;
  }

  /**
   * Get pending/failed deletions for retry
   *
   * @param limit - Max records to return
   * @returns Array of incomplete deletion records
   */
  public async getIncompleteDeletions(limit: number = 100): Promise<DeletionAuditRecord[]> {
    const result = await executeQuery<DeletionAuditDbRecord>(
      `SELECT *
       FROM deletion_audit_log
       WHERE status IN ('pending', 'in_progress', 'partial', 'failed')
       ORDER BY requested_at ASC
       OFFSET 0 ROWS
       FETCH NEXT @limit ROWS ONLY`,
      { limit }
    );

    return result.recordset.map(parseRecord);
  }

  /**
   * Get deletion statistics for compliance reporting
   *
   * @param userId - Optional user ID filter
   * @param startDate - Optional start date filter
   * @param endDate - Optional end date filter
   * @returns Deletion statistics
   */
  public async getDeletionStats(
    userId?: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<{
    totalDeletions: number;
    completedDeletions: number;
    failedDeletions: number;
    byResourceType: Record<string, number>;
  }> {
    let whereClause = 'WHERE 1=1';
    const params: SqlParams = {};

    if (userId) {
      whereClause += ' AND user_id = @user_id';
      params.user_id = userId;
    }

    if (startDate) {
      whereClause += ' AND requested_at >= @start_date';
      params.start_date = startDate;
    }

    if (endDate) {
      whereClause += ' AND requested_at <= @end_date';
      params.end_date = endDate;
    }

    const totalResult = await executeQuery<{ count: number }>(
      `SELECT COUNT(*) as count FROM deletion_audit_log ${whereClause}`,
      params
    );

    const completedResult = await executeQuery<{ count: number }>(
      `SELECT COUNT(*) as count FROM deletion_audit_log ${whereClause} AND status = 'completed'`,
      params
    );

    const failedResult = await executeQuery<{ count: number }>(
      `SELECT COUNT(*) as count FROM deletion_audit_log ${whereClause} AND status = 'failed'`,
      params
    );

    const byTypeResult = await executeQuery<{ resource_type: string; count: number }>(
      `SELECT resource_type, COUNT(*) as count
       FROM deletion_audit_log
       ${whereClause}
       GROUP BY resource_type`,
      params
    );

    const byResourceType: Record<string, number> = {};
    for (const row of byTypeResult.recordset) {
      byResourceType[row.resource_type] = row.count;
    }

    return {
      totalDeletions: totalResult.recordset[0]?.count ?? 0,
      completedDeletions: completedResult.recordset[0]?.count ?? 0,
      failedDeletions: failedResult.recordset[0]?.count ?? 0,
      byResourceType,
    };
  }
}

/**
 * Get DeletionAuditService singleton
 */
export function getDeletionAuditService(): DeletionAuditService {
  return DeletionAuditService.getInstance();
}
