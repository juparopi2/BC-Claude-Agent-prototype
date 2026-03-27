/**
 * ImageEmbeddingDetector (PRD-304)
 *
 * Detects ready image files that are missing their image_embeddings record.
 * Images do not produce file_chunks — their embeddings are stored in the
 * image_embeddings table. A ready image with no embedding row means the
 * image pipeline did not complete successfully.
 */

import { createChildLogger } from '@/shared/utils/logger';
import { prisma } from '@/infrastructure/database/prisma';
import type { DriftDetector, DetectionResult } from './types';

export class ImageEmbeddingDetector implements DriftDetector<string> {
  readonly name = 'ImageEmbeddingDetector';

  private readonly logger = createChildLogger({ service: 'ImageEmbeddingDetector' });

  async detect(userId: string): Promise<DetectionResult<string>> {
    // ── Collect all ready images for user ─────────────────────────────────

    const readyImages = await prisma.files.findMany({
      where: {
        user_id: userId,
        pipeline_status: 'ready',
        deleted_at: null,
        mime_type: { startsWith: 'image/' },
      },
      select: { id: true },
    });

    if (readyImages.length === 0) {
      return { items: [], count: 0 };
    }

    // ── Find which of those have embeddings ───────────────────────────────

    const imageIds = readyImages.map((f) => f.id);
    const imagesWithEmbs = await prisma.image_embeddings.findMany({
      where: { user_id: userId, file_id: { in: imageIds } },
      select: { file_id: true },
    });

    const embFileIds = new Set(imagesWithEmbs.map((e) => e.file_id.toUpperCase()));

    const items = readyImages
      .filter((f) => !embFileIds.has(f.id.toUpperCase()))
      .map((f) => f.id.toUpperCase());

    this.logger.debug(
      { userId, readyImages: readyImages.length, missingEmbeddings: items.length },
      'ImageEmbeddingDetector: detection complete',
    );

    return { items, count: items.length };
  }
}
