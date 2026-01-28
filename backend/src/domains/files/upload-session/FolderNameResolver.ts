/**
 * FolderNameResolver
 *
 * Resolves duplicate folder names by applying incremental suffixes (1), (2), etc.
 * Used during upload session initialization to prevent folder name collisions.
 *
 * Key Features:
 * - Topological ordering (parents resolved before children)
 * - No limit on suffix numbers (always increments)
 * - Checks both database AND batch for collisions
 *
 * @module domains/files/upload-session/FolderNameResolver
 */

import { createChildLogger } from '@/shared/utils/logger';
import type { Logger } from 'pino';
import type { IFileRepository } from '@/services/files/repository/FileRepository';
import type { FolderInput, RenamedFolderInfo } from '@bc-agent/shared';

/**
 * Result of folder name resolution
 */
export interface FolderNameResolutionResult {
  /** Number of folders that were renamed */
  renamedCount: number;

  /** Details of renamed folders */
  renamedFolders: RenamedFolderInfo[];

  /** Map of tempId -> resolved name */
  resolvedNameMap: Map<string, string>;
}

/**
 * Internal representation of a folder with resolved parent
 */
interface ResolvedFolder {
  tempId: string;
  originalName: string;
  resolvedName: string;
  parentTempId: string | null;
  /** Parent folder ID from database (null = root level in target) */
  resolvedParentId: string | null;
}

/**
 * FolderNameResolver - Resolves duplicate folder names during upload
 *
 * @example
 * ```typescript
 * const resolver = new FolderNameResolver(fileRepo);
 * const result = await resolver.resolveFolderNames(
 *   userId,
 *   folders,
 *   targetFolderId
 * );
 *
 * // result.resolvedNameMap.get('temp-1') -> "Documents (1)"
 * ```
 */
export class FolderNameResolver {
  private logger: Logger;

  constructor(private readonly fileRepo: IFileRepository) {
    this.logger = createChildLogger({ service: 'FolderNameResolver' });
  }

  /**
   * Resolve folder names to avoid duplicates
   *
   * Process:
   * 1. Sort folders topologically (parents first)
   * 2. For each folder:
   *    a. Determine parent folder ID (from DB or from previously resolved folders)
   *    b. Check if name exists in DB or in batch (same parent)
   *    c. If duplicate, find next available suffix
   * 3. Return resolved names
   *
   * @param userId - User ID
   * @param folders - Array of folders to process
   * @param targetFolderId - Target folder ID where root folders will be created
   * @returns Resolution result with renamed folders info
   */
  async resolveFolderNames(
    userId: string,
    folders: FolderInput[],
    targetFolderId: string | null
  ): Promise<FolderNameResolutionResult> {
    this.logger.info(
      { userId, folderCount: folders.length, targetFolderId },
      'Starting folder name resolution'
    );

    // Sort folders topologically (parents before children)
    const sortedFolders = this.sortTopologically(folders);

    // Track resolved folders: tempId -> ResolvedFolder
    const resolvedFolders = new Map<string, ResolvedFolder>();

    // Track names used in this batch per parent (to detect intra-batch collisions)
    // Key: parentKey (parentId or parentTempId), Value: Set of names used
    const usedNamesInBatch = new Map<string, Set<string>>();

    const renamedFolders: RenamedFolderInfo[] = [];
    const resolvedNameMap = new Map<string, string>();

    for (const folder of sortedFolders) {
      // Determine the actual parent folder ID
      let parentFolderId: string | null = targetFolderId;
      let parentKey = `db:${targetFolderId ?? 'root'}`;

      if (folder.parentTempId) {
        const parentResolved = resolvedFolders.get(folder.parentTempId);
        if (parentResolved) {
          // Parent was created in this batch - use its tempId as the key for batch tracking
          // The actual DB ID won't exist until folder is created
          parentKey = `temp:${folder.parentTempId}`;
          // Note: parentFolderId stays as targetFolderId for now; the actual ID
          // will be assigned when the folder is created during upload
          parentFolderId = null; // Will be resolved during folder creation
        }
      }

      // Get or create the set of used names for this parent
      if (!usedNamesInBatch.has(parentKey)) {
        usedNamesInBatch.set(parentKey, new Set());
      }
      const usedNames = usedNamesInBatch.get(parentKey)!;

      // Resolve the folder name
      const resolvedName = await this.resolveUniqueName(
        userId,
        folder.name,
        parentFolderId,
        folder.parentTempId ? null : targetFolderId, // Only check DB for root-level or already-existing parents
        usedNames
      );

      // Track the resolved name in batch
      usedNames.add(resolvedName);

      // Store resolved folder info
      resolvedFolders.set(folder.tempId, {
        tempId: folder.tempId,
        originalName: folder.name,
        resolvedName,
        parentTempId: folder.parentTempId ?? null,
        resolvedParentId: parentFolderId,
      });

      resolvedNameMap.set(folder.tempId, resolvedName);

      // Track if renamed
      if (resolvedName !== folder.name) {
        renamedFolders.push({
          tempId: folder.tempId,
          originalName: folder.name,
          resolvedName,
        });
        this.logger.info(
          { tempId: folder.tempId, originalName: folder.name, resolvedName },
          'Folder renamed to avoid duplicate'
        );
      }
    }

    this.logger.info(
      { userId, renamedCount: renamedFolders.length },
      'Folder name resolution complete'
    );

    return {
      renamedCount: renamedFolders.length,
      renamedFolders,
      resolvedNameMap,
    };
  }

  /**
   * Sort folders topologically so parents come before children
   */
  private sortTopologically(folders: FolderInput[]): FolderInput[] {
    const folderMap = new Map<string, FolderInput>();
    const result: FolderInput[] = [];
    const visited = new Set<string>();

    // Build map
    for (const folder of folders) {
      folderMap.set(folder.tempId, folder);
    }

    // DFS visit
    const visit = (folder: FolderInput): void => {
      if (visited.has(folder.tempId)) return;

      // Visit parent first if it exists in this batch
      if (folder.parentTempId) {
        const parent = folderMap.get(folder.parentTempId);
        if (parent) {
          visit(parent);
        }
      }

      visited.add(folder.tempId);
      result.push(folder);
    };

    // Visit all folders
    for (const folder of folders) {
      visit(folder);
    }

    return result;
  }

  /**
   * Resolve a unique name for a folder
   *
   * @param userId - User ID
   * @param baseName - Original folder name
   * @param dbParentId - Parent folder ID in database (null = root)
   * @param checkDbParentId - Parent ID to check in database (null = skip DB check)
   * @param usedNamesInBatch - Names already used in this batch for the same parent
   * @returns Unique folder name (original or with suffix)
   */
  private async resolveUniqueName(
    userId: string,
    baseName: string,
    dbParentId: string | null,
    checkDbParentId: string | null,
    usedNamesInBatch: Set<string>
  ): Promise<string> {
    // Check if original name is available
    const originalExists = await this.nameExists(
      userId,
      baseName,
      checkDbParentId,
      usedNamesInBatch
    );

    if (!originalExists) {
      return baseName;
    }

    // Find next available suffix
    return this.findNextAvailableName(
      userId,
      baseName,
      checkDbParentId,
      usedNamesInBatch
    );
  }

  /**
   * Check if a name exists (in DB or batch)
   */
  private async nameExists(
    userId: string,
    name: string,
    dbParentId: string | null,
    usedNamesInBatch: Set<string>
  ): Promise<boolean> {
    // Check batch first (faster)
    if (usedNamesInBatch.has(name)) {
      return true;
    }

    // Check database
    if (dbParentId !== null || dbParentId === null) {
      // Always check DB for root level or when we have a parent ID
      const existsInDb = await this.fileRepo.checkFolderExists(userId, name, dbParentId);
      return existsInDb;
    }

    return false;
  }

  /**
   * Find the next available name with suffix
   *
   * Searches for existing folders matching "baseName" or "baseName (N)"
   * and returns "baseName (N+1)" where N is the highest found.
   */
  private async findNextAvailableName(
    userId: string,
    baseName: string,
    dbParentId: string | null,
    usedNamesInBatch: Set<string>
  ): Promise<string> {
    // Get existing names from DB
    const existingNames = await this.fileRepo.findFoldersByNamePattern(
      userId,
      baseName,
      dbParentId
    );

    // Combine with batch names
    const allNames = new Set([...existingNames, ...usedNamesInBatch]);

    // Extract the highest suffix number
    let maxSuffix = 0;
    const suffixPattern = new RegExp(`^${this.escapeRegex(baseName)} \\((\\d+)\\)$`);

    for (const name of allNames) {
      if (name === baseName) {
        // Base name exists, at least need (1)
        maxSuffix = Math.max(maxSuffix, 0);
      } else {
        const match = name.match(suffixPattern);
        if (match) {
          const num = parseInt(match[1], 10);
          maxSuffix = Math.max(maxSuffix, num);
        }
      }
    }

    // Return name with next suffix
    const nextName = `${baseName} (${maxSuffix + 1})`;
    this.logger.debug(
      { baseName, maxSuffix, nextName },
      'Generated unique folder name'
    );
    return nextName;
  }

  /**
   * Escape special regex characters in a string
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

/**
 * Create a new FolderNameResolver instance
 */
export function createFolderNameResolver(fileRepo: IFileRepository): FolderNameResolver {
  return new FolderNameResolver(fileRepo);
}
