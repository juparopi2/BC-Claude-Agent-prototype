/**
 * DuplicateDetectionServiceV2 (PRD-02)
 *
 * Batch-optimized duplicate detection across 3 scopes in max 3 DB queries.
 *
 * Scopes (checked in priority order):
 * 1. **Storage** — Files already processed (pipeline_status IN ('ready','failed') OR NULL for legacy)
 * 2. **Pipeline** — Files currently being processed (pipeline_status IN ('queued','extracting','chunking','embedding'))
 * 3. **Upload** — Files registered/uploaded but not yet queued (pipeline_status IN ('registered','uploaded'))
 *
 * First match wins per tempId (storage > pipeline > upload).
 *
 * @module services/files/DuplicateDetectionServiceV2
 */

import { createChildLogger } from '@/shared/utils/logger';
import { prisma as defaultPrisma } from '@/infrastructure/database/prisma';
import { PIPELINE_STATUS } from '@bc-agent/shared';
import type {
  DuplicateCheckInputV2,
  DuplicateCheckResultV2,
  DuplicateCheckSummary,
  DuplicateMatchInfo,
  DuplicateMatchType,
  DuplicateScope,
} from '@bc-agent/shared';
import type { PrismaClient } from '@prisma/client';

const logger = createChildLogger({ service: 'DuplicateDetectionServiceV2' });

// ============================================================================
// Internal types
// ============================================================================

interface DbFileMatch {
  id: string;
  name: string;
  size_bytes: bigint;
  pipeline_status: string | null;
  parent_folder_id: string | null;
  content_hash: string | null;
}

interface ScopedMatch {
  scope: DuplicateScope;
  matchType: DuplicateMatchType;
  existingFile: DuplicateMatchInfo;
}

// ============================================================================
// Service
// ============================================================================

export class DuplicateDetectionServiceV2 {
  private readonly prisma: PrismaClient;

  constructor(prismaClient?: PrismaClient) {
    this.prisma = prismaClient ?? defaultPrisma;
  }

  /**
   * Check duplicates for a batch of files across all 3 scopes.
   *
   * @param inputs - Files to check (max 1000)
   * @param userId - Owner UUID (UPPERCASE, multi-tenant isolation)
   * @returns Results per tempId + summary statistics
   */
  async checkDuplicates(
    inputs: DuplicateCheckInputV2[],
    userId: string,
  ): Promise<{ results: DuplicateCheckResultV2[]; summary: DuplicateCheckSummary }> {
    if (inputs.length === 0) {
      return {
        results: [],
        summary: this.emptySummary(0),
      };
    }

    // Collect all file names and content hashes for batch queries
    const fileNames = [...new Set(inputs.map((i) => i.fileName))];
    const contentHashes = [
      ...new Set(inputs.map((i) => i.contentHash).filter((h): h is string => !!h)),
    ];

    logger.debug(
      { userId, inputCount: inputs.length, uniqueNames: fileNames.length, uniqueHashes: contentHashes.length },
      'Starting duplicate detection',
    );

    // Run all 3 scope queries in parallel (max 3 DB queries regardless of batch size)
    const [storageFiles, pipelineFiles, uploadFiles] = await Promise.all([
      this.checkStorageScope(userId, fileNames, contentHashes),
      this.checkPipelineScope(userId, fileNames, contentHashes),
      this.checkUploadScope(userId, fileNames, contentHashes),
    ]);

    // Aggregate: first match wins per tempId (storage > pipeline > upload)
    const results = this.aggregateResults(inputs, storageFiles, pipelineFiles, uploadFiles);
    const summary = this.generateSummary(inputs.length, results);

    logger.info(
      { userId, totalChecked: summary.totalChecked, totalDuplicates: summary.totalDuplicates },
      'Duplicate detection completed',
    );

    return { results, summary };
  }

  // --------------------------------------------------------------------------
  // Scope Queries
  // --------------------------------------------------------------------------

  /**
   * Scope 1: Storage — files already processed or legacy files without pipeline_status
   */
  private async checkStorageScope(
    userId: string,
    fileNames: string[],
    contentHashes: string[],
  ): Promise<DbFileMatch[]> {
    return this.prisma.files.findMany({
      where: {
        user_id: userId,
        deletion_status: null,
        is_folder: false,
        OR: [
          { pipeline_status: { in: [PIPELINE_STATUS.READY, PIPELINE_STATUS.FAILED] } },
          { pipeline_status: null },
        ],
        AND: [
          {
            OR: [
              { name: { in: fileNames } },
              ...(contentHashes.length > 0 ? [{ content_hash: { in: contentHashes } }] : []),
            ],
          },
        ],
      },
      select: {
        id: true,
        name: true,
        size_bytes: true,
        pipeline_status: true,
        parent_folder_id: true,
        content_hash: true,
      },
    });
  }

  /**
   * Scope 2: Pipeline — files currently being processed
   */
  private async checkPipelineScope(
    userId: string,
    fileNames: string[],
    contentHashes: string[],
  ): Promise<DbFileMatch[]> {
    return this.prisma.files.findMany({
      where: {
        user_id: userId,
        deletion_status: null,
        is_folder: false,
        pipeline_status: {
          in: [
            PIPELINE_STATUS.QUEUED,
            PIPELINE_STATUS.EXTRACTING,
            PIPELINE_STATUS.CHUNKING,
            PIPELINE_STATUS.EMBEDDING,
          ],
        },
        OR: [
          { name: { in: fileNames } },
          ...(contentHashes.length > 0 ? [{ content_hash: { in: contentHashes } }] : []),
        ],
      },
      select: {
        id: true,
        name: true,
        size_bytes: true,
        pipeline_status: true,
        parent_folder_id: true,
        content_hash: true,
      },
    });
  }

  /**
   * Scope 3: Upload — files registered or uploaded but not yet queued
   */
  private async checkUploadScope(
    userId: string,
    fileNames: string[],
    contentHashes: string[],
  ): Promise<DbFileMatch[]> {
    return this.prisma.files.findMany({
      where: {
        user_id: userId,
        deletion_status: null,
        is_folder: false,
        pipeline_status: {
          in: [PIPELINE_STATUS.REGISTERED, PIPELINE_STATUS.UPLOADED],
        },
        OR: [
          { name: { in: fileNames } },
          ...(contentHashes.length > 0 ? [{ content_hash: { in: contentHashes } }] : []),
        ],
      },
      select: {
        id: true,
        name: true,
        size_bytes: true,
        pipeline_status: true,
        parent_folder_id: true,
        content_hash: true,
      },
    });
  }

  // --------------------------------------------------------------------------
  // Aggregation
  // --------------------------------------------------------------------------

  /**
   * For each input, find the best match across scopes (storage > pipeline > upload).
   * First match wins per tempId.
   */
  private aggregateResults(
    inputs: DuplicateCheckInputV2[],
    storageFiles: DbFileMatch[],
    pipelineFiles: DbFileMatch[],
    uploadFiles: DbFileMatch[],
  ): DuplicateCheckResultV2[] {
    return inputs.map((input) => {
      // Try each scope in priority order
      const match =
        this.findBestMatch(input, storageFiles, 'storage') ??
        this.findBestMatch(input, pipelineFiles, 'pipeline') ??
        this.findBestMatch(input, uploadFiles, 'upload');

      if (!match) {
        return { tempId: input.tempId, isDuplicate: false };
      }

      return {
        tempId: input.tempId,
        isDuplicate: true,
        scope: match.scope,
        matchType: match.matchType,
        existingFile: match.existingFile,
      };
    });
  }

  /**
   * Find the best match for a single input within a scope's file list.
   *
   * Match type priority:
   * 1. name_and_content — both name+folder AND hash match (strongest signal)
   * 2. content — hash match only (cross-folder, more significant than name-only)
   * 3. name — name+folder match only
   */
  private findBestMatch(
    input: DuplicateCheckInputV2,
    files: DbFileMatch[],
    scope: DuplicateScope,
  ): ScopedMatch | null {
    let nameMatch: DbFileMatch | null = null;
    let hashMatch: DbFileMatch | null = null;
    let bothMatch: DbFileMatch | null = null;

    for (const file of files) {
      const nameMatches =
        file.name === input.fileName &&
        (file.parent_folder_id ?? null) === (input.folderId ?? null);

      const hashMatches =
        !!input.contentHash &&
        !!file.content_hash &&
        file.content_hash.toLowerCase() === input.contentHash.toLowerCase();

      if (nameMatches && hashMatches) {
        bothMatch = file;
        break; // Strongest match, stop searching
      } else if (hashMatches && !hashMatch) {
        hashMatch = file;
      } else if (nameMatches && !nameMatch) {
        nameMatch = file;
      }
    }

    // Priority: name_and_content > content > name
    const bestFile = bothMatch ?? hashMatch ?? nameMatch;
    if (!bestFile) return null;

    const matchType: DuplicateMatchType = bothMatch
      ? 'name_and_content'
      : hashMatch
        ? 'content'
        : 'name';

    return {
      scope,
      matchType,
      existingFile: {
        fileId: bestFile.id,
        fileName: bestFile.name,
        fileSize: Number(bestFile.size_bytes),
        pipelineStatus: bestFile.pipeline_status,
        folderId: bestFile.parent_folder_id,
      },
    };
  }

  // --------------------------------------------------------------------------
  // Summary
  // --------------------------------------------------------------------------

  private generateSummary(
    totalChecked: number,
    results: DuplicateCheckResultV2[],
  ): DuplicateCheckSummary {
    const summary = this.emptySummary(totalChecked);

    for (const result of results) {
      if (result.isDuplicate && result.scope && result.matchType) {
        summary.totalDuplicates++;
        summary.byScope[result.scope]++;
        summary.byMatchType[result.matchType]++;
      }
    }

    return summary;
  }

  private emptySummary(totalChecked: number): DuplicateCheckSummary {
    return {
      totalChecked,
      totalDuplicates: 0,
      byScope: { storage: 0, pipeline: 0, upload: 0 },
      byMatchType: { name: 0, content: 0, name_and_content: 0 },
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: DuplicateDetectionServiceV2 | undefined;

/**
 * Get the DuplicateDetectionServiceV2 singleton.
 */
export function getDuplicateDetectionServiceV2(): DuplicateDetectionServiceV2 {
  if (!instance) {
    instance = new DuplicateDetectionServiceV2();
  }
  return instance;
}

/**
 * Reset the singleton (for tests only).
 * @internal
 */
export function __resetDuplicateDetectionServiceV2(): void {
  instance = undefined;
}
