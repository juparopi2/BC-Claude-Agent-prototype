/**
 * StuckDeletionRepairer
 *
 * Resolves files stuck in deletion_status='pending' for more than 1 hour via
 * hierarchical truth resolution:
 *
 *   • RESURRECT — if the file's connection_scope still exists and the parent
 *     connection is 'connected', the deletion was premature (e.g. a race
 *     condition during disconnect/reconnect). Clear deletion fields and
 *     re-queue for processing.
 *
 *   • HARD-DELETE — if the connection is dead/disconnected/expired, or the
 *     scope no longer exists, the deletion was correct but the
 *     FileDeletionWorker stalled. Complete the deletion manually: clean up
 *     vector chunks, hard-delete file_chunks and image_embeddings, then
 *     hard-delete the file row.
 *
 * Per-file try/catch ensures one failure never aborts the rest.
 *
 * @module services/sync/health/repairers
 */

import { createChildLogger } from '@/shared/utils/logger';
import type { StuckDeletionFileRow } from '../detectors/types';
import type { StuckDeletionRepairs } from '../types';

export class StuckDeletionRepairer {
  private readonly logger = createChildLogger({ service: 'StuckDeletionRepairer' });

  async repair(
    userId: string,
    files: StuckDeletionFileRow[],
  ): Promise<StuckDeletionRepairs> {
    if (files.length === 0) return { resurrected: 0, hardDeleted: 0, errors: 0 };

    const { prisma } = await import('@/infrastructure/database/prisma');
    const { getMessageQueue } = await import('@/infrastructure/queue');

    let resurrected = 0;
    let hardDeleted = 0;
    let errors = 0;

    // Batch-load scope+connection context to avoid N+1 queries
    const scopeIds = [...new Set(files.filter((f) => f.connection_scope_id).map((f) => f.connection_scope_id!))];
    const scopeMap = new Map<string, { connectionStatus: string }>();

    if (scopeIds.length > 0) {
      const scopes = await prisma.connection_scopes.findMany({
        where: { id: { in: scopeIds } },
        select: {
          id: true,
          connections: { select: { status: true } },
        },
      });
      for (const scope of scopes) {
        scopeMap.set(scope.id.toUpperCase(), {
          connectionStatus: scope.connections.status,
        });
      }
    }

    for (const file of files) {
      try {
        const scopeContext = file.connection_scope_id
          ? scopeMap.get(file.connection_scope_id.toUpperCase())
          : null;

        // HIERARCHICAL TRUTH RESOLUTION
        // Connection connected + scope exists → RESURRECT
        // Connection dead/missing OR no scope → HARD-DELETE
        const shouldResurrect = scopeContext?.connectionStatus === 'connected';

        if (shouldResurrect) {
          // RESURRECT: clear deletion, re-queue for processing
          const result = await prisma.files.updateMany({
            where: {
              id: file.id,
              deletion_status: 'pending', // Optimistic concurrency guard
            },
            data: {
              deleted_at: null,
              deletion_status: null,
              pipeline_status: 'queued',
              updated_at: new Date(),
            },
          });

          if (result.count === 0) continue; // Already transitioned

          await getMessageQueue().addFileProcessingFlow({
            fileId: file.id,
            batchId: file.connection_scope_id ?? file.id,
            userId,
            mimeType: file.mime_type,
            fileName: file.name,
          });

          resurrected++;
          this.logger.info(
            { fileId: file.id, connectionStatus: scopeContext?.connectionStatus },
            'StuckDeletionRepairer: file resurrected — scope is active',
          );
        } else {
          // HARD-DELETE: connection dead or no scope — complete the deletion
          try {
            // Best-effort vector cleanup
            try {
              const { VectorSearchService } = await import('@/services/search/VectorSearchService');
              await VectorSearchService.getInstance().deleteChunksForFile(file.id, userId);
            } catch { /* best-effort */ }

            // Hard-delete chunks + file
            await prisma.file_chunks.deleteMany({ where: { file_id: file.id } });
            await prisma.image_embeddings.deleteMany({ where: { file_id: file.id } });
            await prisma.files.deleteMany({ where: { id: file.id } });

            hardDeleted++;
            this.logger.info(
              { fileId: file.id, connectionStatus: scopeContext?.connectionStatus ?? 'missing' },
              'StuckDeletionRepairer: file hard-deleted — connection dead or no scope',
            );
          } catch (deleteErr) {
            const errorInfo =
              deleteErr instanceof Error
                ? { message: deleteErr.message, name: deleteErr.name }
                : { value: String(deleteErr) };
            this.logger.warn(
              { fileId: file.id, userId, error: errorInfo },
              'StuckDeletionRepairer: hard-delete failed',
            );
            errors++;
          }
        }
      } catch (err) {
        const errorInfo =
          err instanceof Error
            ? { message: err.message, name: err.name }
            : { value: String(err) };
        this.logger.warn(
          { fileId: file.id, userId, error: errorInfo },
          'StuckDeletionRepairer: repair failed for file',
        );
        errors++;
      }
    }

    this.logger.info(
      { userId, resurrected, hardDeleted, errors, total: files.length },
      'StuckDeletionRepairer: repair complete',
    );

    return { resurrected, hardDeleted, errors };
  }
}
