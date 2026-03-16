/**
 * folderTreeStore Tests
 *
 * Tests for folder tree and navigation state management.
 * TDD: Tests written FIRST before implementation.
 *
 * @module __tests__/domains/files/stores/folderTreeStore
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  useFolderTreeStore,
  resetFolderTreeStore,
} from '@/src/domains/files/stores/folderTreeStore';
import { createMockFolder } from '@/__tests__/fixtures/FileFixture';

describe('folderTreeStore', () => {
  beforeEach(() => {
    resetFolderTreeStore();
  });

  describe('initial state', () => {
    it('should have null currentFolderId (root)', () => {
      const state = useFolderTreeStore.getState();
      expect(state.currentFolderId).toBeNull();
    });

    it('should have empty folderPath', () => {
      const state = useFolderTreeStore.getState();
      expect(state.folderPath).toEqual([]);
    });

    it('should have empty expandedFolderIds', () => {
      const state = useFolderTreeStore.getState();
      expect(state.expandedFolderIds).toEqual([]);
    });

    it('should have empty loadingFolderIds', () => {
      const state = useFolderTreeStore.getState();
      expect(state.loadingFolderIds.size).toBe(0);
    });

    it('should have empty treeFolders', () => {
      const state = useFolderTreeStore.getState();
      expect(state.treeFolders).toEqual({});
    });
  });

  describe('setCurrentFolder', () => {
    it('should set currentFolderId', () => {
      const { setCurrentFolder } = useFolderTreeStore.getState();

      setCurrentFolder('folder-123', []);

      expect(useFolderTreeStore.getState().currentFolderId).toBe('folder-123');
    });

    it('should set folderPath for breadcrumb', () => {
      const { setCurrentFolder } = useFolderTreeStore.getState();
      const path = [
        createMockFolder({ id: 'root-folder', name: 'Root' }),
        createMockFolder({ id: 'sub-folder', name: 'Subfolder' }),
      ];

      setCurrentFolder('sub-folder', path);

      const state = useFolderTreeStore.getState();
      expect(state.folderPath).toHaveLength(2);
      expect(state.folderPath[0].name).toBe('Root');
      expect(state.folderPath[1].name).toBe('Subfolder');
    });

    it('should set null for root navigation', () => {
      const { setCurrentFolder } = useFolderTreeStore.getState();

      setCurrentFolder('some-folder', []);
      setCurrentFolder(null, []);

      expect(useFolderTreeStore.getState().currentFolderId).toBeNull();
    });
  });

  describe('navigateUp', () => {
    it('should go to parent folder', () => {
      const { setCurrentFolder, navigateUp } = useFolderTreeStore.getState();
      const parentFolder = createMockFolder({ id: 'parent', name: 'Parent' });
      const childFolder = createMockFolder({ id: 'child', name: 'Child', parentFolderId: 'parent' });

      setCurrentFolder('child', [parentFolder, childFolder]);
      navigateUp();

      const state = useFolderTreeStore.getState();
      expect(state.currentFolderId).toBe('parent');
      expect(state.folderPath).toHaveLength(1);
    });

    it('should go to root when at first level', () => {
      const { setCurrentFolder, navigateUp } = useFolderTreeStore.getState();
      const folder = createMockFolder({ id: 'level-1', name: 'Level 1' });

      setCurrentFolder('level-1', [folder]);
      navigateUp();

      const state = useFolderTreeStore.getState();
      expect(state.currentFolderId).toBeNull();
      expect(state.folderPath).toEqual([]);
    });

    it('should do nothing when already at root', () => {
      const { navigateUp } = useFolderTreeStore.getState();

      // Already at root (initial state)
      navigateUp();

      const state = useFolderTreeStore.getState();
      expect(state.currentFolderId).toBeNull();
      expect(state.folderPath).toEqual([]);
    });
  });

  describe('toggleFolderExpanded', () => {
    it('should add folder to expanded list', () => {
      const { toggleFolderExpanded } = useFolderTreeStore.getState();

      toggleFolderExpanded('folder-1');

      expect(useFolderTreeStore.getState().expandedFolderIds).toContain('folder-1');
    });

    it('should remove folder from expanded list', () => {
      const { toggleFolderExpanded } = useFolderTreeStore.getState();

      toggleFolderExpanded('folder-1'); // Expand
      toggleFolderExpanded('folder-1'); // Collapse

      expect(useFolderTreeStore.getState().expandedFolderIds).not.toContain('folder-1');
    });

    it('should force expand when forceState=true', () => {
      const { toggleFolderExpanded } = useFolderTreeStore.getState();

      toggleFolderExpanded('folder-1', true);
      toggleFolderExpanded('folder-1', true); // Should stay expanded

      expect(useFolderTreeStore.getState().expandedFolderIds).toContain('folder-1');
    });

    it('should force collapse when forceState=false', () => {
      const { toggleFolderExpanded } = useFolderTreeStore.getState();

      toggleFolderExpanded('folder-1', true); // Expand
      toggleFolderExpanded('folder-1', false); // Force collapse

      expect(useFolderTreeStore.getState().expandedFolderIds).not.toContain('folder-1');
    });

    it('should handle multiple folders independently', () => {
      const { toggleFolderExpanded } = useFolderTreeStore.getState();

      toggleFolderExpanded('folder-1');
      toggleFolderExpanded('folder-2');
      toggleFolderExpanded('folder-1'); // Collapse folder-1

      const state = useFolderTreeStore.getState();
      expect(state.expandedFolderIds).not.toContain('folder-1');
      expect(state.expandedFolderIds).toContain('folder-2');
    });
  });

  describe('setTreeFolders', () => {
    it('should cache folders by parentId', () => {
      const { setTreeFolders } = useFolderTreeStore.getState();
      const folders = [
        createMockFolder({ id: 'sub-1', parentFolderId: 'parent' }),
        createMockFolder({ id: 'sub-2', parentFolderId: 'parent' }),
      ];

      setTreeFolders('parent', folders);

      const state = useFolderTreeStore.getState();
      expect(state.treeFolders['parent']).toHaveLength(2);
    });

    it('should use root key for root folders', () => {
      const { setTreeFolders } = useFolderTreeStore.getState();
      const rootFolders = [
        createMockFolder({ id: 'root-1', parentFolderId: null }),
        createMockFolder({ id: 'root-2', parentFolderId: null }),
      ];

      setTreeFolders('root', rootFolders);

      const state = useFolderTreeStore.getState();
      expect(state.treeFolders['root']).toHaveLength(2);
    });

    it('should replace existing cache for same parentId', () => {
      const { setTreeFolders } = useFolderTreeStore.getState();

      setTreeFolders('parent', [createMockFolder({ id: 'old-1' })]);
      setTreeFolders('parent', [createMockFolder({ id: 'new-1' }), createMockFolder({ id: 'new-2' })]);

      const state = useFolderTreeStore.getState();
      expect(state.treeFolders['parent']).toHaveLength(2);
      expect(state.treeFolders['parent'][0].id).toBe('new-1');
    });
  });

  describe('setLoadingFolder', () => {
    it('should add folder to loading set', () => {
      const { setLoadingFolder } = useFolderTreeStore.getState();

      setLoadingFolder('folder-1', true);

      expect(useFolderTreeStore.getState().loadingFolderIds.has('folder-1')).toBe(true);
    });

    it('should remove folder from loading set', () => {
      const { setLoadingFolder } = useFolderTreeStore.getState();

      setLoadingFolder('folder-1', true);
      setLoadingFolder('folder-1', false);

      expect(useFolderTreeStore.getState().loadingFolderIds.has('folder-1')).toBe(false);
    });

    it('should handle multiple folders loading simultaneously', () => {
      const { setLoadingFolder } = useFolderTreeStore.getState();

      setLoadingFolder('folder-1', true);
      setLoadingFolder('folder-2', true);

      const state = useFolderTreeStore.getState();
      expect(state.loadingFolderIds.has('folder-1')).toBe(true);
      expect(state.loadingFolderIds.has('folder-2')).toBe(true);
    });
  });

  describe('getRootFolders', () => {
    it('should return folders from treeFolders root', () => {
      const { setTreeFolders, getRootFolders } = useFolderTreeStore.getState();
      const rootFolders = [
        createMockFolder({ id: 'root-1', name: 'Documents' }),
        createMockFolder({ id: 'root-2', name: 'Images' }),
      ];

      setTreeFolders('root', rootFolders);

      const result = getRootFolders();
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Documents');
    });

    it('should return empty array if no root folders', () => {
      const { getRootFolders } = useFolderTreeStore.getState();

      const result = getRootFolders();
      expect(result).toEqual([]);
    });
  });

  describe('isFolderLoading', () => {
    it('should return true for loading folder', () => {
      const { setLoadingFolder, isFolderLoading } = useFolderTreeStore.getState();

      setLoadingFolder('folder-1', true);

      expect(isFolderLoading('folder-1')).toBe(true);
    });

    it('should return false for non-loading folder', () => {
      const { isFolderLoading } = useFolderTreeStore.getState();

      expect(isFolderLoading('folder-1')).toBe(false);
    });
  });

  describe('isFolderExpanded', () => {
    it('should return true for expanded folder', () => {
      const { toggleFolderExpanded, isFolderExpanded } = useFolderTreeStore.getState();

      toggleFolderExpanded('folder-1');

      expect(isFolderExpanded('folder-1')).toBe(true);
    });

    it('should return false for collapsed folder', () => {
      const { isFolderExpanded } = useFolderTreeStore.getState();

      expect(isFolderExpanded('folder-1')).toBe(false);
    });
  });

  describe('getChildFolders', () => {
    it('should return children for specified parent', () => {
      const { setTreeFolders, getChildFolders } = useFolderTreeStore.getState();
      const children = [
        createMockFolder({ id: 'child-1' }),
        createMockFolder({ id: 'child-2' }),
      ];

      setTreeFolders('parent-1', children);

      const result = getChildFolders('parent-1');
      expect(result).toHaveLength(2);
    });

    it('should return empty array if no children cached', () => {
      const { getChildFolders } = useFolderTreeStore.getState();

      const result = getChildFolders('non-existent');
      expect(result).toEqual([]);
    });
  });

  describe('reset', () => {
    it('should reset navigation state but keep expandedFolderIds', () => {
      const { setCurrentFolder, setTreeFolders, setLoadingFolder, toggleFolderExpanded, reset } =
        useFolderTreeStore.getState();

      // Set various state
      setCurrentFolder('folder-1', [createMockFolder()]);
      setTreeFolders('root', [createMockFolder()]);
      setLoadingFolder('folder-2', true);
      toggleFolderExpanded('folder-3');

      reset();

      const state = useFolderTreeStore.getState();
      expect(state.currentFolderId).toBeNull();
      expect(state.folderPath).toEqual([]);
      expect(state.loadingFolderIds.size).toBe(0);
      expect(state.treeFolders).toEqual({});
      // expandedFolderIds is persisted, so reset clears it too for clean slate
      expect(state.expandedFolderIds).toEqual([]);
    });
  });

  describe('upsertTreeFolder', () => {
    it('should add folder to cached parent children', () => {
      const { setTreeFolders, upsertTreeFolder, getChildFolders } = useFolderTreeStore.getState();

      setTreeFolders('parent-1', [createMockFolder({ id: 'existing-1' })]);
      upsertTreeFolder('parent-1', createMockFolder({ id: 'new-1', name: 'New Folder' }));

      const children = getChildFolders('parent-1');
      expect(children).toHaveLength(2);
      expect(children[1].id).toBe('new-1');
    });

    it('should replace existing folder by ID (no duplicate)', () => {
      const { setTreeFolders, upsertTreeFolder, getChildFolders } = useFolderTreeStore.getState();

      setTreeFolders('parent-1', [
        createMockFolder({ id: 'folder-1', name: 'Old Name' }),
        createMockFolder({ id: 'folder-2' }),
      ]);
      upsertTreeFolder('parent-1', createMockFolder({ id: 'folder-1', name: 'Updated Name' }));

      const children = getChildFolders('parent-1');
      expect(children).toHaveLength(2);
      expect(children[0].name).toBe('Updated Name');
    });

    it('should be no-op if parent not in cache', () => {
      const { upsertTreeFolder } = useFolderTreeStore.getState();

      upsertTreeFolder('uncached-parent', createMockFolder({ id: 'new-1' }));

      const state = useFolderTreeStore.getState();
      expect(state.treeFolders['uncached-parent']).toBeUndefined();
    });

    it('should not affect other parents', () => {
      const { setTreeFolders, upsertTreeFolder, getChildFolders } = useFolderTreeStore.getState();

      setTreeFolders('parent-1', [createMockFolder({ id: 'child-1' })]);
      setTreeFolders('parent-2', [createMockFolder({ id: 'child-2' })]);

      upsertTreeFolder('parent-1', createMockFolder({ id: 'new-1' }));

      expect(getChildFolders('parent-1')).toHaveLength(2);
      expect(getChildFolders('parent-2')).toHaveLength(1);
    });
  });

  describe('removeTreeFolder', () => {
    it('should remove folder from cached parent children', () => {
      const { setTreeFolders, removeTreeFolder, getChildFolders } = useFolderTreeStore.getState();

      setTreeFolders('parent-1', [
        createMockFolder({ id: 'folder-1' }),
        createMockFolder({ id: 'folder-2' }),
      ]);
      removeTreeFolder('parent-1', 'folder-1');

      const children = getChildFolders('parent-1');
      expect(children).toHaveLength(1);
      expect(children[0].id).toBe('folder-2');
    });

    it('should be no-op if parent not in cache', () => {
      const { removeTreeFolder } = useFolderTreeStore.getState();

      removeTreeFolder('uncached-parent', 'folder-1');

      const state = useFolderTreeStore.getState();
      expect(state.treeFolders['uncached-parent']).toBeUndefined();
    });

    it('should be no-op if folder ID not found in parent', () => {
      const { setTreeFolders, removeTreeFolder, getChildFolders } = useFolderTreeStore.getState();

      setTreeFolders('parent-1', [createMockFolder({ id: 'folder-1' })]);
      removeTreeFolder('parent-1', 'non-existent');

      expect(getChildFolders('parent-1')).toHaveLength(1);
    });
  });

  describe('invalidateTreeFolder', () => {
    it('should remove cache entry for parent', () => {
      const { setTreeFolders, invalidateTreeFolder } = useFolderTreeStore.getState();

      setTreeFolders('parent-1', [createMockFolder({ id: 'child-1' })]);
      invalidateTreeFolder('parent-1');

      const state = useFolderTreeStore.getState();
      expect(state.treeFolders['parent-1']).toBeUndefined();
    });

    it('should not affect other parents', () => {
      const { setTreeFolders, invalidateTreeFolder, getChildFolders } = useFolderTreeStore.getState();

      setTreeFolders('parent-1', [createMockFolder({ id: 'child-1' })]);
      setTreeFolders('parent-2', [createMockFolder({ id: 'child-2' })]);

      invalidateTreeFolder('parent-1');

      expect(useFolderTreeStore.getState().treeFolders['parent-1']).toBeUndefined();
      expect(getChildFolders('parent-2')).toHaveLength(1);
    });

    it('should be no-op if parent not in cache', () => {
      const { setTreeFolders, invalidateTreeFolder, getChildFolders } = useFolderTreeStore.getState();

      setTreeFolders('parent-1', [createMockFolder({ id: 'child-1' })]);
      invalidateTreeFolder('non-existent');

      expect(getChildFolders('parent-1')).toHaveLength(1);
    });
  });

  describe('resetFolderTreeStore', () => {
    it('should reset store to initial values (test utility)', () => {
      const { setCurrentFolder, toggleFolderExpanded } = useFolderTreeStore.getState();

      setCurrentFolder('folder-1', [createMockFolder()]);
      toggleFolderExpanded('folder-1');

      resetFolderTreeStore();

      const state = useFolderTreeStore.getState();
      expect(state.currentFolderId).toBeNull();
      expect(state.expandedFolderIds).toEqual([]);
    });
  });

  describe('expandedSections', () => {
    it('should have initial values: local=true, onedrive=false, sharepoint=false', () => {
      const state = useFolderTreeStore.getState();
      expect(state.expandedSections).toEqual({
        local: true,
        onedrive: false,
        sharepoint: false,
      });
    });

    it('should expand a collapsed section', () => {
      const { setSectionExpanded } = useFolderTreeStore.getState();

      setSectionExpanded('onedrive', true);

      expect(useFolderTreeStore.getState().expandedSections.onedrive).toBe(true);
    });

    it('should collapse an expanded section', () => {
      const { setSectionExpanded } = useFolderTreeStore.getState();

      setSectionExpanded('local', false);

      expect(useFolderTreeStore.getState().expandedSections.local).toBe(false);
    });

    it('should be idempotent (setting same value twice is safe)', () => {
      const { setSectionExpanded } = useFolderTreeStore.getState();

      setSectionExpanded('onedrive', true);
      setSectionExpanded('onedrive', true);

      expect(useFolderTreeStore.getState().expandedSections.onedrive).toBe(true);
    });

    it('should not affect other sections when changing one', () => {
      const { setSectionExpanded } = useFolderTreeStore.getState();

      setSectionExpanded('onedrive', true);

      const { expandedSections } = useFolderTreeStore.getState();
      expect(expandedSections.local).toBe(true);
      expect(expandedSections.onedrive).toBe(true);
      expect(expandedSections.sharepoint).toBe(false);
    });

    it('should reset to initial values on resetFolderTreeStore()', () => {
      const { setSectionExpanded } = useFolderTreeStore.getState();

      setSectionExpanded('onedrive', true);
      setSectionExpanded('sharepoint', true);
      setSectionExpanded('local', false);

      resetFolderTreeStore();

      expect(useFolderTreeStore.getState().expandedSections).toEqual({
        local: true,
        onedrive: false,
        sharepoint: false,
      });
    });
  });
});
