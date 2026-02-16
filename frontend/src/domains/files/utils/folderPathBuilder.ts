/**
 * Folder Path Builder Utility
 *
 * Builds breadcrumb paths from root to a target folder by walking up
 * the parent chain. Provides both synchronous (cache-only) and
 * asynchronous (with API fallback) versions.
 *
 * @module domains/files/utils/folderPathBuilder
 */

import type { ParsedFile } from '@bc-agent/shared';

/**
 * Cache of folder children keyed by parent ID.
 * Matches the treeFolders shape from folderTreeStore.
 */
export type FolderCache = Record<string, ParsedFile[]>;

/**
 * Callback to fetch a single folder's metadata from the API.
 * Returns null if the folder doesn't exist or can't be fetched.
 */
export type FetchFolderFn = (folderId: string) => Promise<ParsedFile | null>;

/**
 * Find a folder in the cache by its ID.
 * Searches all cached folder lists (root + all children).
 */
function findFolderInCache(
  folderId: string,
  treeFolders: FolderCache,
): ParsedFile | undefined {
  // Check root folders first
  const rootFolders = treeFolders['root'] || [];
  const inRoot = rootFolders.find((f) => f.id === folderId);
  if (inRoot) return inRoot;

  // Search all cached children
  for (const parentId of Object.keys(treeFolders)) {
    const children = treeFolders[parentId];
    const found = children?.find((f) => f.id === folderId);
    if (found) return found;
  }

  return undefined;
}

/**
 * Build the breadcrumb path from root to a given folder
 * using only the in-memory cache.
 *
 * Stops walking if a parent is not found in cache.
 * Use this for in-tree navigation where the cache is warm.
 *
 * @param folder - The target folder
 * @param treeFolders - Cached folder hierarchy from folderTreeStore
 * @returns Array of folders from root to target (inclusive)
 */
export function buildPathToFolder(
  folder: ParsedFile,
  treeFolders: FolderCache,
): ParsedFile[] {
  const path: ParsedFile[] = [folder];

  let currentParentId = folder.parentFolderId;

  while (currentParentId !== null) {
    const parentFolder = findFolderInCache(currentParentId, treeFolders);

    if (parentFolder) {
      path.unshift(parentFolder);
      currentParentId = parentFolder.parentFolderId;
    } else {
      // Parent not found in cache - stop walking
      break;
    }
  }

  return path;
}

/**
 * Build the breadcrumb path from root to a given folder,
 * falling back to the API when parents are not in cache.
 *
 * Use this when navigating to a folder that may not have
 * its ancestors loaded (e.g., "Go to path" from citations).
 *
 * @param folder - The target folder
 * @param treeFolders - Cached folder hierarchy from folderTreeStore
 * @param fetchFolder - Callback to fetch folder metadata from API
 * @returns Array of folders from root to target (inclusive)
 */
export async function buildPathToFolderAsync(
  folder: ParsedFile,
  treeFolders: FolderCache,
  fetchFolder: FetchFolderFn,
): Promise<ParsedFile[]> {
  const path: ParsedFile[] = [folder];

  let currentParentId = folder.parentFolderId;
  // Safety limit to prevent infinite loops (max folder depth)
  const MAX_DEPTH = 50;
  let depth = 0;

  while (currentParentId !== null && depth < MAX_DEPTH) {
    depth++;

    // Try cache first
    let parentFolder = findFolderInCache(currentParentId, treeFolders);

    // Fallback to API if not in cache
    if (!parentFolder) {
      parentFolder = (await fetchFolder(currentParentId)) ?? undefined;
    }

    if (parentFolder) {
      path.unshift(parentFolder);
      currentParentId = parentFolder.parentFolderId;
    } else {
      // Parent truly doesn't exist or API failed - stop
      break;
    }
  }

  return path;
}
