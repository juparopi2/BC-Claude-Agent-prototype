/**
 * FolderDuplicateDetectionServiceV2
 *
 * Checks root-level manifest folders for duplicates against existing folders
 * in the target location. Only root-level folders (no parentTempId) are checked.
 *
 * @module services/files/FolderDuplicateDetectionServiceV2
 */

import { createChildLogger } from '@/shared/utils/logger';
import { prisma as defaultPrisma } from '@/infrastructure/database/prisma';
import { generateUniqueFileName } from '@bc-agent/shared';
import type {
  FolderDuplicateCheckInput,
  CheckFolderDuplicatesResponseV2,
  FolderDuplicateCheckResult,
} from '@bc-agent/shared';
import type { PrismaClient } from '@prisma/client';

const logger = createChildLogger({ service: 'FolderDuplicateDetectionServiceV2' });

// ============================================================================
// Service
// ============================================================================

export class FolderDuplicateDetectionServiceV2 {
  private readonly prisma: PrismaClient;

  constructor(prismaClient?: PrismaClient) {
    this.prisma = prismaClient ?? defaultPrisma;
  }

  /**
   * Check folder duplicates for root-level manifest folders.
   *
   * Only folders without parentTempId are checked (root-level).
   * Nested folders inherit their parent's resolution.
   */
  async checkFolderDuplicates(
    inputs: FolderDuplicateCheckInput[],
    userId: string,
    targetFolderId?: string,
  ): Promise<CheckFolderDuplicatesResponseV2> {
    if (inputs.length === 0) {
      return { results: [], targetFolderPath: null };
    }

    // Filter to root-level folders only
    const rootFolders = inputs.filter((f) => !f.parentTempId);

    if (rootFolders.length === 0) {
      return {
        results: inputs.map((f) => ({
          tempId: f.tempId,
          folderName: f.folderName,
          isDuplicate: false,
          parentFolderId: null,
        })),
        targetFolderPath: null,
      };
    }

    const folderNames = [...new Set(rootFolders.map((f) => f.folderName))];

    logger.debug(
      { userId, inputCount: inputs.length, rootCount: rootFolders.length, targetFolderId },
      'Starting folder duplicate detection',
    );

    // Query existing folders with matching names in the target location
    const [existingFolders, siblingFolderNames] = await Promise.all([
      this.findExistingFolders(userId, folderNames, targetFolderId),
      this.fetchSiblingFolderNames(userId, targetFolderId),
    ]);

    // Build lookup: folderName -> existingFolderId
    const existingMap = new Map<string, string>();
    for (const folder of existingFolders) {
      existingMap.set(folder.name, folder.id);
    }

    // Build results for all inputs
    const results: FolderDuplicateCheckResult[] = inputs.map((input) => {
      // Non-root folders are never flagged as duplicates
      if (input.parentTempId) {
        return {
          tempId: input.tempId,
          folderName: input.folderName,
          isDuplicate: false,
          parentFolderId: null,
        };
      }

      const existingFolderId = existingMap.get(input.folderName);
      if (!existingFolderId) {
        return {
          tempId: input.tempId,
          folderName: input.folderName,
          isDuplicate: false,
          parentFolderId: targetFolderId ?? null,
        };
      }

      // Compute suggested name for "Keep Both"
      const suggestedName = generateUniqueFileName(input.folderName, siblingFolderNames);

      return {
        tempId: input.tempId,
        folderName: input.folderName,
        isDuplicate: true,
        existingFolderId,
        suggestedName,
        parentFolderId: targetFolderId ?? null,
      };
    });

    // Resolve target folder path
    let targetFolderPath: string | null = null;
    if (targetFolderId) {
      const pathMap = await this.resolveFolderPaths(userId, new Set([targetFolderId]));
      targetFolderPath = pathMap.get(targetFolderId.toUpperCase())?.path ?? null;
    }

    const duplicateCount = results.filter((r) => r.isDuplicate).length;
    logger.info(
      { userId, totalChecked: rootFolders.length, totalDuplicates: duplicateCount },
      'Folder duplicate detection completed',
    );

    return { results, targetFolderPath };
  }

  // --------------------------------------------------------------------------
  // Queries
  // --------------------------------------------------------------------------

  private async findExistingFolders(
    userId: string,
    folderNames: string[],
    targetFolderId?: string,
  ): Promise<Array<{ id: string; name: string }>> {
    return this.prisma.files.findMany({
      where: {
        user_id: userId,
        is_folder: true,
        name: { in: folderNames },
        parent_folder_id: targetFolderId ?? null,
        deletion_status: null,
      },
      select: { id: true, name: true },
    });
  }

  private async fetchSiblingFolderNames(
    userId: string,
    targetFolderId?: string,
  ): Promise<Set<string>> {
    const siblings = await this.prisma.files.findMany({
      where: {
        user_id: userId,
        is_folder: true,
        parent_folder_id: targetFolderId ?? null,
        deletion_status: null,
      },
      select: { name: true },
    });

    return new Set(siblings.map((f) => f.name));
  }

  // --------------------------------------------------------------------------
  // Folder Path Resolution (copied from DuplicateDetectionServiceV2)
  // --------------------------------------------------------------------------

  private async resolveFolderPaths(
    userId: string,
    folderIds: Set<string>,
  ): Promise<Map<string, { name: string; path: string }>> {
    const result = new Map<string, { name: string; path: string }>();
    if (folderIds.size === 0) return result;

    const normalizedFolderIds = new Set([...folderIds].map(id => id.toUpperCase()));
    const folderCache = new Map<string, { name: string; parentId: string | null }>();
    let idsToFetch = [...normalizedFolderIds];

    for (let depth = 0; depth < 10 && idsToFetch.length > 0; depth++) {
      const unfetched = idsToFetch.filter((id) => !folderCache.has(id));
      if (unfetched.length === 0) break;

      const folders = await this.prisma.files.findMany({
        where: {
          id: { in: unfetched },
          user_id: userId,
          is_folder: true,
        },
        select: { id: true, name: true, parent_folder_id: true },
      });

      const nextIds: string[] = [];
      for (const folder of folders) {
        const normalizedId = folder.id.toUpperCase();
        const normalizedParentId = folder.parent_folder_id?.toUpperCase() ?? null;
        folderCache.set(normalizedId, { name: folder.name, parentId: normalizedParentId });
        if (normalizedParentId && !folderCache.has(normalizedParentId)) {
          nextIds.push(normalizedParentId);
        }
      }

      for (const id of unfetched) {
        if (!folderCache.has(id)) {
          folderCache.set(id, { name: '', parentId: null });
        }
      }

      idsToFetch = nextIds;
    }

    for (const folderId of normalizedFolderIds) {
      const cached = folderCache.get(folderId);
      if (!cached || !cached.name) continue;

      const segments: string[] = [];
      let currentId: string | null = folderId;

      while (currentId) {
        const folder = folderCache.get(currentId);
        if (!folder || !folder.name) break;
        segments.unshift(folder.name);
        currentId = folder.parentId;
      }

      result.set(folderId, { name: cached.name, path: segments.join(' / ') });
    }

    return result;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: FolderDuplicateDetectionServiceV2 | undefined;

export function getFolderDuplicateDetectionServiceV2(): FolderDuplicateDetectionServiceV2 {
  if (!instance) {
    instance = new FolderDuplicateDetectionServiceV2();
  }
  return instance;
}

export function __resetFolderDuplicateDetectionServiceV2(): void {
  instance = undefined;
}
