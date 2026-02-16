/**
 * folderPathBuilder Utility Tests
 *
 * Tests for synchronous and asynchronous folder path building utilities.
 *
 * @module __tests__/domains/files/utils/folderPathBuilder
 */

import { describe, it, expect, vi } from 'vitest';
import {
  buildPathToFolder,
  buildPathToFolderAsync,
  type FolderCache,
} from '@/src/domains/files/utils/folderPathBuilder';
import { createMockFolder } from '@/__tests__/fixtures/FileFixture';

// Helper to build a folder cache from arrays
function createCache(entries: Record<string, ReturnType<typeof createMockFolder>[]>): FolderCache {
  return entries;
}

describe('buildPathToFolder (sync)', () => {
  it('should return single-element path for root-level folder', () => {
    const folder = createMockFolder({ id: 'FOLDER-A', parentFolderId: null });
    const cache = createCache({ root: [folder] });

    const path = buildPathToFolder(folder, cache);

    expect(path).toHaveLength(1);
    expect(path[0].id).toBe('FOLDER-A');
  });

  it('should build full path for nested folder with warm cache', () => {
    const rootFolder = createMockFolder({
      id: 'ROOT-FOLDER',
      name: 'Root',
      parentFolderId: null,
    });
    const midFolder = createMockFolder({
      id: 'MID-FOLDER',
      name: 'Mid',
      parentFolderId: 'ROOT-FOLDER',
    });
    const leafFolder = createMockFolder({
      id: 'LEAF-FOLDER',
      name: 'Leaf',
      parentFolderId: 'MID-FOLDER',
    });

    const cache = createCache({
      root: [rootFolder],
      'ROOT-FOLDER': [midFolder],
      'MID-FOLDER': [leafFolder],
    });

    const path = buildPathToFolder(leafFolder, cache);

    expect(path).toHaveLength(3);
    expect(path[0].id).toBe('ROOT-FOLDER');
    expect(path[1].id).toBe('MID-FOLDER');
    expect(path[2].id).toBe('LEAF-FOLDER');
  });

  it('should return partial path when parent is not in cache', () => {
    const midFolder = createMockFolder({
      id: 'MID-FOLDER',
      name: 'Mid',
      parentFolderId: 'UNKNOWN-PARENT',
    });
    const leafFolder = createMockFolder({
      id: 'LEAF-FOLDER',
      name: 'Leaf',
      parentFolderId: 'MID-FOLDER',
    });

    // Cache only has MID as child of root, but ROOT-FOLDER itself is missing
    const cache = createCache({
      'UNKNOWN-PARENT': [midFolder],
    });

    const path = buildPathToFolder(leafFolder, cache);

    // Should walk up to midFolder, then stop because UNKNOWN-PARENT isn't found
    expect(path).toHaveLength(2);
    expect(path[0].id).toBe('MID-FOLDER');
    expect(path[1].id).toBe('LEAF-FOLDER');
  });

  it('should handle empty cache', () => {
    const folder = createMockFolder({
      id: 'FOLDER-A',
      parentFolderId: 'SOME-PARENT',
    });

    const path = buildPathToFolder(folder, {});

    expect(path).toHaveLength(1);
    expect(path[0].id).toBe('FOLDER-A');
  });

  it('should find parent across different cache entries', () => {
    const rootFolder = createMockFolder({
      id: 'ROOT-FOLDER',
      parentFolderId: null,
    });
    const childFolder = createMockFolder({
      id: 'CHILD-FOLDER',
      parentFolderId: 'ROOT-FOLDER',
    });

    // Root folder is cached under 'root', child is cached under ROOT-FOLDER
    const cache = createCache({
      root: [rootFolder],
      'ROOT-FOLDER': [childFolder],
    });

    const path = buildPathToFolder(childFolder, cache);

    expect(path).toHaveLength(2);
    expect(path[0].id).toBe('ROOT-FOLDER');
    expect(path[1].id).toBe('CHILD-FOLDER');
  });
});

describe('buildPathToFolderAsync', () => {
  it('should use cache when all parents are available', async () => {
    const rootFolder = createMockFolder({
      id: 'ROOT-FOLDER',
      parentFolderId: null,
    });
    const childFolder = createMockFolder({
      id: 'CHILD-FOLDER',
      parentFolderId: 'ROOT-FOLDER',
    });

    const cache = createCache({
      root: [rootFolder],
    });

    const fetchFolder = vi.fn();

    const path = await buildPathToFolderAsync(childFolder, cache, fetchFolder);

    expect(path).toHaveLength(2);
    expect(path[0].id).toBe('ROOT-FOLDER');
    expect(path[1].id).toBe('CHILD-FOLDER');
    // Should not have called API since parent was in cache
    expect(fetchFolder).not.toHaveBeenCalled();
  });

  it('should fall back to API when parent is not in cache', async () => {
    const rootFolder = createMockFolder({
      id: 'ROOT-FOLDER',
      name: 'Root',
      parentFolderId: null,
    });
    const childFolder = createMockFolder({
      id: 'CHILD-FOLDER',
      parentFolderId: 'ROOT-FOLDER',
    });

    // Empty cache - nothing available
    const cache = createCache({});

    const fetchFolder = vi.fn().mockResolvedValue(rootFolder);

    const path = await buildPathToFolderAsync(childFolder, cache, fetchFolder);

    expect(path).toHaveLength(2);
    expect(path[0].id).toBe('ROOT-FOLDER');
    expect(path[1].id).toBe('CHILD-FOLDER');
    expect(fetchFolder).toHaveBeenCalledWith('ROOT-FOLDER');
    expect(fetchFolder).toHaveBeenCalledTimes(1);
  });

  it('should handle deeply nested folders with API fallback', async () => {
    const root = createMockFolder({ id: 'L0', parentFolderId: null });
    const level1 = createMockFolder({ id: 'L1', parentFolderId: 'L0' });
    const level2 = createMockFolder({ id: 'L2', parentFolderId: 'L1' });
    const level3 = createMockFolder({ id: 'L3', parentFolderId: 'L2' });

    // Only root is cached
    const cache = createCache({ root: [root] });

    const fetchFolder = vi.fn().mockImplementation((id: string) => {
      const map: Record<string, ReturnType<typeof createMockFolder>> = {
        L2: level2,
        L1: level1,
      };
      return Promise.resolve(map[id] ?? null);
    });

    const path = await buildPathToFolderAsync(level3, cache, fetchFolder);

    expect(path).toHaveLength(4);
    expect(path.map((f) => f.id)).toEqual(['L0', 'L1', 'L2', 'L3']);
    // Should have fetched L2 and L1 (L0 was in cache)
    expect(fetchFolder).toHaveBeenCalledWith('L2');
    expect(fetchFolder).toHaveBeenCalledWith('L1');
  });

  it('should stop when API returns null (missing parent)', async () => {
    const childFolder = createMockFolder({
      id: 'ORPHAN',
      parentFolderId: 'MISSING-PARENT',
    });

    const cache = createCache({});
    const fetchFolder = vi.fn().mockResolvedValue(null);

    const path = await buildPathToFolderAsync(childFolder, cache, fetchFolder);

    expect(path).toHaveLength(1);
    expect(path[0].id).toBe('ORPHAN');
    expect(fetchFolder).toHaveBeenCalledWith('MISSING-PARENT');
  });

  it('should handle root-level folder without API calls', async () => {
    const rootFolder = createMockFolder({
      id: 'ROOT',
      parentFolderId: null,
    });

    const cache = createCache({});
    const fetchFolder = vi.fn();

    const path = await buildPathToFolderAsync(rootFolder, cache, fetchFolder);

    expect(path).toHaveLength(1);
    expect(path[0].id).toBe('ROOT');
    expect(fetchFolder).not.toHaveBeenCalled();
  });

  it('should respect MAX_DEPTH safety limit', async () => {
    // Create a circular-ish scenario: each fetch returns a folder pointing to the next
    let callCount = 0;
    const folder = createMockFolder({
      id: 'START',
      parentFolderId: 'PARENT-0',
    });

    const cache = createCache({});
    const fetchFolder = vi.fn().mockImplementation((id: string) => {
      callCount++;
      return Promise.resolve(
        createMockFolder({
          id,
          parentFolderId: `PARENT-${callCount}`,
        })
      );
    });

    const path = await buildPathToFolderAsync(folder, cache, fetchFolder);

    // Should stop at MAX_DEPTH (50) + 1 (the original folder)
    expect(path.length).toBeLessThanOrEqual(51);
    expect(fetchFolder.mock.calls.length).toBeLessThanOrEqual(50);
  });
});
