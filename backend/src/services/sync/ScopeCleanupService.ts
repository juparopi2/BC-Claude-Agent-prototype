/**
 * ScopeCleanupService (PRD-105)
 *
 * Handles scope removal with cascading cleanup:
 * 1. NULL out message_citations.file_id for affected files
 * 2. Best-effort AI Search cleanup
 * 3. Delete all files (FK cascades handle chunks, embeddings, attachments)
 * 4. Delete scope record
 *
 * Pattern follows cleanup-user-onedrive-files.sql cascade strategy.
 *
 * @module services/sync
 */

import { createChildLogger } from '@/shared/utils/logger';
import { getConnectionRepository } from '@/domains/connections';
import { prisma } from '@/infrastructure/database/prisma';
import { VectorSearchService } from '@/services/search/VectorSearchService';

const logger = createChildLogger({ service: 'ScopeCleanupService' });

export interface ScopeRemovalResult {
  scopeId: string;
  filesDeleted: number;
}

export class ScopeCurrentlySyncingError extends Error {
  readonly code = 'SCOPE_CURRENTLY_SYNCING';
  constructor(scopeId: string) {
    super(`Scope ${scopeId} is currently syncing and cannot be removed`);
    this.name = 'ScopeCurrentlySyncingError';
  }
}

export class ScopeCleanupService {
  /**
   * Remove a scope and all its associated files.
   *
   * Steps:
   * 1. Validate scope exists and belongs to connection
   * 2. Guard: block if scope is currently syncing
   * 3. NULL out message_citations.file_id for affected files
   * 4. Best-effort AI Search cleanup (log + continue on failure)
   * 5. Delete all files (FK cascades handle file_chunks, image_embeddings, message_file_attachments)
   * 6. Delete scope record
   */
  async removeScope(
    connectionId: string,
    scopeId: string,
    userId: string
  ): Promise<ScopeRemovalResult> {
    const repo = getConnectionRepository();

    // 1. Fetch scope — validate it exists and belongs to the connection
    const scope = await repo.findScopeById(scopeId);
    if (!scope) {
      throw new Error(`Scope ${scopeId} not found`);
    }
    if (scope.connection_id !== connectionId) {
      throw new Error(`Scope ${scopeId} does not belong to connection ${connectionId}`);
    }

    // 2. Guard: block removal if scope is currently syncing
    if (scope.sync_status === 'syncing') {
      throw new ScopeCurrentlySyncingError(scopeId);
    }

    // PRD-108: Delete Graph subscription before removing scope
    if (scope.subscription_id) {
      try {
        const { getSubscriptionManager } = await import('@/services/sync/SubscriptionManager');
        await getSubscriptionManager().deleteSubscription(scopeId);
      } catch (subErr) {
        const subErrInfo = subErr instanceof Error
          ? { message: subErr.message, name: subErr.name }
          : { value: String(subErr) };
        logger.warn({ error: subErrInfo, scopeId }, 'Subscription deletion failed (non-fatal)');
      }
    }

    // 3. Fetch files belonging to this scope
    const files = await repo.findFilesByScopeId(scopeId);
    const fileIds = files.map((f) => f.id);

    logger.info(
      { connectionId, scopeId, fileCount: fileIds.length },
      'Starting scope removal'
    );

    // 4. NULL out message_citations.file_id for affected files
    if (fileIds.length > 0) {
      await prisma.$executeRaw`
        UPDATE message_citations
        SET file_id = NULL
        WHERE file_id IN (
          SELECT id FROM files WHERE connection_scope_id = ${scopeId}
        )
      `;

      logger.debug({ scopeId, fileCount: fileIds.length }, 'Citations unlinked');
    }

    // 5. Best-effort AI Search cleanup
    const vectorService = VectorSearchService.getInstance();
    let searchCleanupFailures = 0;

    for (const file of files) {
      try {
        await vectorService.deleteChunksForFile(file.id, userId);
      } catch (error) {
        searchCleanupFailures++;
        const errorInfo = error instanceof Error
          ? { message: error.message, name: error.name }
          : { value: String(error) };
        logger.warn(
          { error: errorInfo, fileId: file.id, scopeId },
          'AI Search cleanup failed for file — continuing'
        );
      }
    }

    if (searchCleanupFailures > 0) {
      logger.warn(
        { scopeId, searchCleanupFailures, totalFiles: fileIds.length },
        'Some AI Search cleanups failed during scope removal'
      );
    }

    // 6. Delete all files for this scope (FK cascades handle chunks, embeddings, attachments)
    if (fileIds.length > 0) {
      await prisma.files.deleteMany({
        where: { connection_scope_id: scopeId },
      });

      logger.debug({ scopeId, filesDeleted: fileIds.length }, 'Files deleted');
    }

    // 7. Delete scope record
    await repo.deleteScopeById(scopeId);

    logger.info(
      { connectionId, scopeId, filesDeleted: fileIds.length, searchCleanupFailures },
      'Scope removal complete'
    );

    return { scopeId, filesDeleted: fileIds.length };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: ScopeCleanupService | null = null;

export function getScopeCleanupService(): ScopeCleanupService {
  if (!instance) {
    instance = new ScopeCleanupService();
  }
  return instance;
}
