/**
 * FileRepositoryV2 (PRD-01)
 *
 * Prisma-based repository for the unified pipeline_status column.
 * Implements optimistic concurrency via atomic WHERE-clause guards.
 *
 * Key features:
 * - `transitionStatus()` — atomic CAS (Compare-And-Swap) on pipeline_status
 * - Multi-tenant isolation (user_id in every WHERE clause)
 * - Soft-delete aware (deletion_status IS NULL filter)
 *
 * @module services/files/repository
 */

import { createChildLogger } from '@/shared/utils/logger';
import { prisma as defaultPrisma } from '@/infrastructure/database/prisma';
import {
  canTransition,
  getTransitionErrorMessage,
  PIPELINE_STATUS,
  type PipelineStatus,
  type TransitionResult,
} from '@bc-agent/shared';
import type { PrismaClient } from '@prisma/client';

const logger = createChildLogger({ service: 'FileRepositoryV2' });

export class FileRepositoryV2 {
  private readonly prisma: PrismaClient;

  constructor(prismaClient?: PrismaClient) {
    this.prisma = prismaClient ?? defaultPrisma;
  }

  // --------------------------------------------------------------------------
  // transitionStatus — atomic optimistic-concurrency update
  // --------------------------------------------------------------------------

  /**
   * Atomically transition a file's pipeline_status using optimistic concurrency.
   *
   * The UPDATE only succeeds when:
   *   - `id` matches
   *   - `user_id` matches (multi-tenant isolation)
   *   - `pipeline_status` equals the expected `from` value (no concurrent change)
   *   - `deletion_status IS NULL` (file not soft-deleted)
   *
   * @param fileId   - File UUID (UPPERCASE)
   * @param userId   - Owner UUID (UPPERCASE)
   * @param from     - Expected current status
   * @param to       - Desired target status
   * @returns TransitionResult indicating success or failure reason
   */
  async transitionStatus(
    fileId: string,
    userId: string,
    from: PipelineStatus,
    to: PipelineStatus,
  ): Promise<TransitionResult> {
    // Validate the transition is legal before hitting the DB
    if (!canTransition(from, to)) {
      logger.warn({ fileId, userId, from, to }, 'Invalid pipeline transition rejected');
      return {
        success: false,
        previousStatus: from,
        error: getTransitionErrorMessage(from, to),
      };
    }

    // Atomic CAS: UPDATE … WHERE pipeline_status = @from
    const result = await this.prisma.files.updateMany({
      where: {
        id: fileId,
        user_id: userId,
        pipeline_status: from,
        deletion_status: null,
      },
      data: {
        pipeline_status: to,
        updated_at: new Date(),
      },
    });

    if (result.count === 1) {
      logger.debug({ fileId, from, to }, 'Pipeline transition succeeded');
      return { success: true, previousStatus: from };
    }

    // CAS failed — read current status for diagnostics
    const current = await this.prisma.files.findFirst({
      where: { id: fileId, user_id: userId },
      select: { pipeline_status: true, deletion_status: true },
    });

    if (!current) {
      logger.warn({ fileId, userId }, 'Pipeline transition failed: file not found');
      return { success: false, previousStatus: from, error: 'File not found' };
    }

    if (current.deletion_status !== null) {
      logger.warn({ fileId, userId }, 'Pipeline transition failed: file is soft-deleted');
      return { success: false, previousStatus: from, error: 'File is soft-deleted' };
    }

    const actualStatus = (current.pipeline_status ?? 'unknown') as PipelineStatus;
    logger.warn(
      { fileId, expectedStatus: from, actualStatus },
      'Pipeline transition failed: concurrent modification',
    );

    return {
      success: false,
      previousStatus: actualStatus,
      error: `Concurrent modification: expected '${from}', found '${actualStatus}'`,
    };
  }

  // --------------------------------------------------------------------------
  // getPipelineStatus
  // --------------------------------------------------------------------------

  /**
   * Read the current pipeline_status for a file.
   *
   * @param fileId - File UUID (UPPERCASE)
   * @param userId - Owner UUID (UPPERCASE)
   * @returns Current PipelineStatus, or `null` if file not found or status not set
   */
  async getPipelineStatus(fileId: string, userId: string): Promise<PipelineStatus | null> {
    const file = await this.prisma.files.findFirst({
      where: { id: fileId, user_id: userId, deletion_status: null },
      select: { pipeline_status: true },
    });

    if (!file || !file.pipeline_status) {
      return null;
    }

    return file.pipeline_status as PipelineStatus;
  }

  // --------------------------------------------------------------------------
  // findByStatus
  // --------------------------------------------------------------------------

  /**
   * Find files with a given pipeline_status, ordered by created_at ASC.
   *
   * @param status  - Pipeline status to filter by
   * @param options - Optional limit and userId filter
   * @returns Array of file records with id, user_id, name, pipeline_status, created_at
   */
  async findByStatus(
    status: PipelineStatus,
    options?: { limit?: number; userId?: string },
  ): Promise<Array<{ id: string; user_id: string; name: string; pipeline_status: string; created_at: Date | null }>> {
    const where: Record<string, unknown> = {
      pipeline_status: status,
      deletion_status: null,
    };

    if (options?.userId) {
      where.user_id = options.userId;
    }

    const files = await this.prisma.files.findMany({
      where,
      select: {
        id: true,
        user_id: true,
        name: true,
        pipeline_status: true,
        created_at: true,
      },
      orderBy: { created_at: 'asc' },
      take: options?.limit,
    });

    return files as Array<{ id: string; user_id: string; name: string; pipeline_status: string; created_at: Date | null }>;
  }

  // --------------------------------------------------------------------------
  // getStatusDistribution
  // --------------------------------------------------------------------------

  /**
   * Get a count of files grouped by pipeline_status.
   *
   * Only includes files that have a non-null pipeline_status and are not soft-deleted.
   * Returns all 8 pipeline status keys, defaulting to 0 for missing groups.
   *
   * @returns Record mapping each PipelineStatus to its file count
   */
  async getStatusDistribution(): Promise<Record<PipelineStatus, number>> {
    const groups = await this.prisma.files.groupBy({
      by: ['pipeline_status'],
      _count: { id: true },
      where: {
        pipeline_status: { not: null },
        deletion_status: null,
      },
    });

    // Initialize all statuses to 0
    const distribution = Object.fromEntries(
      Object.values(PIPELINE_STATUS).map((s) => [s, 0]),
    ) as Record<PipelineStatus, number>;

    // Fill in actual counts
    for (const group of groups) {
      const status = group.pipeline_status as PipelineStatus;
      if (status in distribution) {
        distribution[status] = group._count.id;
      }
    }

    return distribution;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: FileRepositoryV2 | undefined;

/**
 * Get the FileRepositoryV2 singleton.
 */
export function getFileRepositoryV2(): FileRepositoryV2 {
  if (!instance) {
    instance = new FileRepositoryV2();
  }
  return instance;
}

/**
 * Reset the singleton (for tests only).
 * @internal
 */
export function __resetFileRepositoryV2(): void {
  instance = undefined;
}
