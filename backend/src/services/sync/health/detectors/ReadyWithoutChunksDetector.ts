/**
 * ReadyWithoutChunksDetector (PRD-304)
 *
 * Detects non-image files that have pipeline_status='ready' but have zero
 * file_chunks records. This indicates the text processing pipeline completed
 * without actually producing any searchable chunks (e.g., extraction succeeded
 * but chunking/embedding failed silently, or a race condition).
 *
 * Images are excluded — they store embeddings in image_embeddings, not file_chunks.
 */

import { createChildLogger } from '@/shared/utils/logger';
import { prisma } from '@/infrastructure/database/prisma';
import type { DriftDetector, DetectionResult, DetectedFileRow } from './types';

// ──────────────────────────────────────────────────────────────────────────────
// Detector
// ──────────────────────────────────────────────────────────────────────────────

export class ReadyWithoutChunksDetector implements DriftDetector<DetectedFileRow> {
  readonly name = 'ReadyWithoutChunksDetector';

  private readonly logger = createChildLogger({ service: 'ReadyWithoutChunksDetector' });

  async detect(userId: string): Promise<DetectionResult<DetectedFileRow>> {
    // 1. Get all ready non-image, non-folder files from DB
    const readyFiles = await prisma.files.findMany({
      where: {
        user_id: userId,
        pipeline_status: 'ready',
        deleted_at: null,
        is_folder: false,
        NOT: { mime_type: { startsWith: 'image/' } },
      },
      select: { id: true, name: true, mime_type: true, connection_scope_id: true },
    });

    if (readyFiles.length === 0) {
      return { items: [], count: 0 };
    }

    // 2. Find which of those have at least one chunk
    const fileIds = readyFiles.map((f) => f.id);
    const chunkedFiles = await prisma.file_chunks.findMany({
      where: { file_id: { in: fileIds } },
      distinct: ['file_id'],
      select: { file_id: true },
    });

    // 3. Build a set of file IDs that have chunks
    const chunkedFileIds = new Set(chunkedFiles.map((c) => c.file_id.toUpperCase()));

    // 4. Filter out files that DO have chunks — return only the ones with 0 chunks
    const items: DetectedFileRow[] = readyFiles
      .filter((f) => !chunkedFileIds.has(f.id.toUpperCase()))
      .map((f) => ({
        id: f.id.toUpperCase(),
        name: f.name,
        mime_type: f.mime_type,
        connection_scope_id: f.connection_scope_id,
      }));

    this.logger.debug(
      { userId, readyFiles: readyFiles.length, withoutChunks: items.length },
      'ReadyWithoutChunksDetector: detection complete',
    );

    return { items, count: items.length };
  }
}
