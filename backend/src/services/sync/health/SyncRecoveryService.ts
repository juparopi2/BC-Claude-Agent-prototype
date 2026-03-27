/**
 * SyncRecoveryService (PRD-300)
 *
 * Provides recovery operations for scopes and files stuck in broken sync states.
 * Handles three failure modes:
 *   1. Scopes stuck in 'syncing' (process crashed mid-sync)
 *   2. Scopes in 'error' state that should be retried
 *   3. Individual files whose pipeline processing failed
 *
 * Uses prisma directly (not through repositories) because recovery crosses
 * domain boundaries and requires direct access to multiple models.
 *
 * @module services/sync/health
 */

import { createChildLogger } from '@/shared/utils/logger';
import { prisma } from '@/infrastructure/database/prisma';
import { getMessageQueue } from '@/infrastructure/queue';
import type { RecoveryResult } from './types';

const DEFAULT_STUCK_THRESHOLD_MS = 600_000; // 10 minutes

export class SyncRecoveryService {
  private readonly logger = createChildLogger({ service: 'SyncRecoveryService' });

  // ──────────────────────────────────────────────────────────────────────────
  // 1. resetStuckScopes
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Reset scopes stuck in 'syncing' state back to 'idle'.
   *
   * If `scopeIds` is provided, only those scopes are considered.
   * Otherwise, all scopes with `sync_status = 'syncing'` and
   * `updated_at < NOW() - thresholdMs` are targeted.
   *
   * Each scope's parent connection must have `status = 'connected'`.
   * Scopes belonging to expired/disconnected connections are skipped.
   */
  async resetStuckScopes(
    scopeIds?: string[],
    thresholdMs: number = DEFAULT_STUCK_THRESHOLD_MS,
  ): Promise<RecoveryResult> {
    const result: RecoveryResult = {
      scopesReset: 0,
      scopesRequeued: 0,
      filesRequeued: 0,
      errors: [],
    };

    this.logger.info(
      { scopeIds, thresholdMs },
      'resetStuckScopes: starting',
    );

    let candidateIds: string[];

    if (scopeIds && scopeIds.length > 0) {
      candidateIds = scopeIds.map((id) => id.toUpperCase());
    } else {
      const cutoff = new Date(Date.now() - thresholdMs);
      const stuckScopes = await prisma.connection_scopes.findMany({
        where: {
          sync_status: 'syncing',
          updated_at: { lt: cutoff },
        },
        select: { id: true },
      });
      candidateIds = stuckScopes.map((s) => s.id.toUpperCase());

      this.logger.info(
        { count: candidateIds.length, cutoff },
        'resetStuckScopes: found stuck scopes via query',
      );
    }

    for (const scopeId of candidateIds) {
      try {
        // Verify the parent connection is still active
        const scope = await prisma.connection_scopes.findUnique({
          where: { id: scopeId },
          include: { connections: { select: { status: true } } },
        });

        if (!scope) {
          this.logger.warn({ scopeId }, 'resetStuckScopes: scope not found, skipping');
          continue;
        }

        if (scope.connections.status !== 'connected') {
          this.logger.warn(
            { scopeId, connectionStatus: scope.connections.status },
            'resetStuckScopes: connection not connected, skipping',
          );
          continue;
        }

        await prisma.connection_scopes.update({
          where: { id: scopeId },
          data: {
            sync_status: 'idle',
            updated_at: new Date(),
          },
        });

        result.scopesReset++;
        this.logger.info({ scopeId }, 'resetStuckScopes: scope reset to idle');
      } catch (err) {
        const errorInfo =
          err instanceof Error
            ? { message: err.message, name: err.name }
            : { value: String(err) };
        this.logger.error({ scopeId, error: errorInfo }, 'resetStuckScopes: failed to reset scope');
        result.errors.push(`resetStuckScopes[${scopeId}]: ${errorInfo.message ?? errorInfo.value}`);
      }
    }

    this.logger.info(
      { scopesReset: result.scopesReset, errors: result.errors.length },
      'resetStuckScopes: complete',
    );

    return result;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 2. retryErrorScopes
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Re-enqueue sync jobs for scopes currently in 'error' state.
   *
   * If `scopeIds` is provided, only those scopes are processed.
   * Otherwise, all scopes with `sync_status = 'error'` are targeted.
   * If `userId` is provided, only scopes belonging to that user are included.
   *
   * Scopes with a `last_sync_cursor` receive a delta sync ('manual' triggerType).
   * Scopes without a cursor receive an initial sync.
   */
  async retryErrorScopes(
    scopeIds?: string[],
    userId?: string,
  ): Promise<RecoveryResult> {
    const result: RecoveryResult = {
      scopesReset: 0,
      scopesRequeued: 0,
      filesRequeued: 0,
      errors: [],
    };

    this.logger.info({ scopeIds, userId }, 'retryErrorScopes: starting');

    let candidateIds: string[];

    if (scopeIds && scopeIds.length > 0) {
      candidateIds = scopeIds.map((id) => id.toUpperCase());
    } else {
      const errorScopes = await prisma.connection_scopes.findMany({
        where: {
          sync_status: 'error',
          ...(userId
            ? { connections: { user_id: userId.toUpperCase() } }
            : {}),
        },
        select: { id: true },
      });
      candidateIds = errorScopes.map((s) => s.id.toUpperCase());

      this.logger.info(
        { count: candidateIds.length, userId },
        'retryErrorScopes: found error scopes via query',
      );
    }

    for (const scopeId of candidateIds) {
      try {
        const scope = await prisma.connection_scopes.findUnique({
          where: { id: scopeId },
          include: {
            connections: { select: { id: true, user_id: true, status: true } },
          },
        });

        if (!scope) {
          this.logger.warn({ scopeId }, 'retryErrorScopes: scope not found, skipping');
          continue;
        }

        if (scope.connections.status !== 'connected') {
          this.logger.warn(
            { scopeId, connectionStatus: scope.connections.status },
            'retryErrorScopes: connection not connected, skipping',
          );
          continue;
        }

        const connectionId = scope.connections.id.toUpperCase();
        const scopeUserId = scope.connections.user_id.toUpperCase();
        const hasCursor = !!scope.last_sync_cursor;

        // Mark the scope as queued
        await prisma.connection_scopes.update({
          where: { id: scopeId },
          data: {
            sync_status: 'sync_queued',
            updated_at: new Date(),
          },
        });

        const queue = getMessageQueue();

        if (hasCursor) {
          await queue.addExternalFileSyncJob({
            scopeId,
            connectionId,
            userId: scopeUserId,
            triggerType: 'manual',
          });
        } else {
          await queue.addInitialSyncJob({
            scopeId,
            connectionId,
            userId: scopeUserId,
          });
        }

        result.scopesRequeued++;
        this.logger.info(
          { scopeId, hasCursor, syncType: hasCursor ? 'delta' : 'initial' },
          'retryErrorScopes: scope re-enqueued',
        );
      } catch (err) {
        const errorInfo =
          err instanceof Error
            ? { message: err.message, name: err.name }
            : { value: String(err) };
        this.logger.error(
          { scopeId, error: errorInfo },
          'retryErrorScopes: failed to retry scope',
        );
        result.errors.push(`retryErrorScopes[${scopeId}]: ${errorInfo.message ?? errorInfo.value}`);
      }
    }

    this.logger.info(
      { scopesRequeued: result.scopesRequeued, errors: result.errors.length },
      'retryErrorScopes: complete',
    );

    return result;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 3. retryFailedFiles
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Re-enqueue pipeline processing for failed files in a specific scope.
   *
   * Only files with `pipeline_status = 'failed'` and
   * `pipeline_retry_count < 3` are eligible. Files that have already
   * exhausted their retry budget are silently skipped.
   */
  async retryFailedFiles(scopeId: string, userId: string): Promise<RecoveryResult> {
    const result: RecoveryResult = {
      scopesReset: 0,
      scopesRequeued: 0,
      filesRequeued: 0,
      errors: [],
    };

    const normalizedScopeId = scopeId.toUpperCase();
    const normalizedUserId = userId.toUpperCase();

    this.logger.info(
      { scopeId: normalizedScopeId, userId: normalizedUserId },
      'retryFailedFiles: starting',
    );

    const failedFiles = await prisma.files.findMany({
      where: {
        connection_scope_id: normalizedScopeId,
        user_id: normalizedUserId,
        pipeline_status: 'failed',
        pipeline_retry_count: { lt: 3 },
      },
      select: {
        id: true,
        name: true,
        mime_type: true,
        pipeline_retry_count: true,
      },
    });

    this.logger.info(
      { count: failedFiles.length, scopeId: normalizedScopeId },
      'retryFailedFiles: found eligible files',
    );

    for (const file of failedFiles) {
      const fileId = file.id.toUpperCase();
      try {
        // Increment retry count and mark as queued
        await prisma.files.update({
          where: { id: fileId },
          data: {
            pipeline_status: 'queued',
            pipeline_retry_count: { increment: 1 },
          },
        });

        const queue = getMessageQueue();
        await queue.addFileProcessingFlow({
          fileId,
          batchId: normalizedScopeId,
          userId: normalizedUserId,
          mimeType: file.mime_type,
          fileName: file.name,
        });

        result.filesRequeued++;
        this.logger.info(
          {
            fileId,
            retryCount: (file.pipeline_retry_count ?? 0) + 1,
          },
          'retryFailedFiles: file re-enqueued',
        );
      } catch (err) {
        const errorInfo =
          err instanceof Error
            ? { message: err.message, name: err.name }
            : { value: String(err) };
        this.logger.error(
          { fileId, error: errorInfo },
          'retryFailedFiles: failed to retry file',
        );
        result.errors.push(`retryFailedFiles[${fileId}]: ${errorInfo.message ?? errorInfo.value}`);
      }
    }

    this.logger.info(
      { filesRequeued: result.filesRequeued, errors: result.errors.length },
      'retryFailedFiles: complete',
    );

    return result;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 4. runFullRecovery
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Orchestrate all three recovery operations in sequence.
   *
   * Aggregates the results of resetStuckScopes, retryErrorScopes, and
   * (for each recovered error scope) retryFailedFiles into a single
   * RecoveryResult. If `userId` is provided, retryErrorScopes is scoped
   * to that user.
   *
   * Note: retryFailedFiles is not called here because it requires a
   * specific scopeId and userId pair. Callers needing per-scope file
   * recovery should call retryFailedFiles directly for each relevant scope.
   */
  async runFullRecovery(userId?: string): Promise<RecoveryResult> {
    const aggregated: RecoveryResult = {
      scopesReset: 0,
      scopesRequeued: 0,
      filesRequeued: 0,
      errors: [],
    };

    this.logger.info({ userId }, 'runFullRecovery: starting');

    // Step 1: Reset stuck scopes (all users unless caller filters afterward)
    const resetResult = await this.resetStuckScopes();
    aggregated.scopesReset += resetResult.scopesReset;
    aggregated.filesRequeued += resetResult.filesRequeued;
    aggregated.errors.push(...resetResult.errors);

    // Step 2: Retry error scopes, optionally scoped to a user
    const retryResult = await this.retryErrorScopes(undefined, userId);
    aggregated.scopesReset += retryResult.scopesReset;
    aggregated.scopesRequeued += retryResult.scopesRequeued;
    aggregated.filesRequeued += retryResult.filesRequeued;
    aggregated.errors.push(...retryResult.errors);

    this.logger.info(
      {
        scopesReset: aggregated.scopesReset,
        scopesRequeued: aggregated.scopesRequeued,
        filesRequeued: aggregated.filesRequeued,
        errors: aggregated.errors.length,
      },
      'runFullRecovery: complete',
    );

    return aggregated;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Singleton
// ──────────────────────────────────────────────────────────────────────────────

let instance: SyncRecoveryService | undefined;

/**
 * Get the SyncRecoveryService singleton.
 */
export function getSyncRecoveryService(): SyncRecoveryService {
  if (!instance) {
    instance = new SyncRecoveryService();
  }
  return instance;
}
