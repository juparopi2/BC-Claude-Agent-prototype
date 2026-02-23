/**
 * useFolderNavigation Hook Tests
 *
 * Tests for folder navigation hook that wraps folderTreeStore.
 *
 * @module __tests__/domains/files/hooks/useFolderNavigation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFolderNavigation } from '@/src/domains/files/hooks/useFolderNavigation';
import { resetFolderTreeStore, useFolderTreeStore } from '@/src/domains/files/stores/folderTreeStore';
import { createMockFolder } from '@/__tests__/fixtures/FileFixture';

describe('useFolderNavigation', () => {
  beforeEach(() => {
    resetFolderTreeStore();
  });

  describe('currentFolderId', () => {
    it('should be null initially (root)', () => {
      const { result } = renderHook(() => useFolderNavigation());

      expect(result.current.currentFolderId).toBeNull();
    });

    it('should reflect store state', () => {
      act(() => {
        useFolderTreeStore.getState().setCurrentFolder('folder-123', []);
      });

      const { result } = renderHook(() => useFolderNavigation());

      expect(result.current.currentFolderId).toBe('folder-123');
    });
  });

  describe('folderPath (breadcrumb)', () => {
    it('should be empty initially', () => {
      const { result } = renderHook(() => useFolderNavigation());

      expect(result.current.folderPath).toEqual([]);
    });

    it('should expose folder path from store', () => {
      const path = [
        createMockFolder({ id: 'level-1', name: 'Level 1' }),
        createMockFolder({ id: 'level-2', name: 'Level 2' }),
      ];

      act(() => {
        useFolderTreeStore.getState().setCurrentFolder('level-2', path);
      });

      const { result } = renderHook(() => useFolderNavigation());

      expect(result.current.folderPath).toHaveLength(2);
      expect(result.current.folderPath[0].name).toBe('Level 1');
    });
  });

  describe('rootFolders', () => {
    it('should return empty array initially', () => {
      const { result } = renderHook(() => useFolderNavigation());

      expect(result.current.rootFolders).toEqual([]);
    });

    it('should expose root folders from store', () => {
      const folders = [
        createMockFolder({ id: 'root-1', name: 'Documents' }),
        createMockFolder({ id: 'root-2', name: 'Images' }),
      ];

      act(() => {
        useFolderTreeStore.getState().setTreeFolders('root', folders);
      });

      const { result } = renderHook(() => useFolderNavigation());

      expect(result.current.rootFolders).toHaveLength(2);
    });
  });

  describe('setCurrentFolder', () => {
    it('should navigate to folder', () => {
      const { result } = renderHook(() => useFolderNavigation());
      const folder = createMockFolder({ id: 'target-folder' });

      act(() => {
        result.current.setCurrentFolder('target-folder', [folder]);
      });

      expect(result.current.currentFolderId).toBe('target-folder');
      expect(result.current.folderPath).toHaveLength(1);
    });

    it('should navigate to root with null', () => {
      const { result } = renderHook(() => useFolderNavigation());

      act(() => {
        result.current.setCurrentFolder('some-folder', [createMockFolder()]);
      });

      act(() => {
        result.current.setCurrentFolder(null, []);
      });

      expect(result.current.currentFolderId).toBeNull();
      expect(result.current.folderPath).toEqual([]);
    });
  });

  describe('navigateUp', () => {
    it('should go to parent folder', () => {
      const { result } = renderHook(() => useFolderNavigation());
      const parent = createMockFolder({ id: 'parent', name: 'Parent' });
      const child = createMockFolder({ id: 'child', name: 'Child' });

      act(() => {
        result.current.setCurrentFolder('child', [parent, child]);
      });

      act(() => {
        result.current.navigateUp();
      });

      expect(result.current.currentFolderId).toBe('parent');
    });

    it('should go to root when at first level', () => {
      const { result } = renderHook(() => useFolderNavigation());
      const folder = createMockFolder({ id: 'level-1' });

      act(() => {
        result.current.setCurrentFolder('level-1', [folder]);
      });

      act(() => {
        result.current.navigateUp();
      });

      expect(result.current.currentFolderId).toBeNull();
    });

    it('should do nothing when at root', () => {
      const { result } = renderHook(() => useFolderNavigation());

      act(() => {
        result.current.navigateUp();
      });

      expect(result.current.currentFolderId).toBeNull();
    });
  });

  describe('expandedFolderIds', () => {
    it('should be empty initially', () => {
      const { result } = renderHook(() => useFolderNavigation());

      expect(result.current.expandedFolderIds).toEqual([]);
    });

    it('should expose expanded folders from store', () => {
      act(() => {
        useFolderTreeStore.getState().toggleFolderExpanded('folder-1');
        useFolderTreeStore.getState().toggleFolderExpanded('folder-2');
      });

      const { result } = renderHook(() => useFolderNavigation());

      expect(result.current.expandedFolderIds).toContain('folder-1');
      expect(result.current.expandedFolderIds).toContain('folder-2');
    });
  });

  describe('toggleFolderExpanded', () => {
    it('should expand folder', () => {
      const { result } = renderHook(() => useFolderNavigation());

      act(() => {
        result.current.toggleFolderExpanded('folder-1');
      });

      expect(result.current.expandedFolderIds).toContain('folder-1');
    });

    it('should collapse folder', () => {
      const { result } = renderHook(() => useFolderNavigation());

      act(() => {
        result.current.toggleFolderExpanded('folder-1');
      });

      act(() => {
        result.current.toggleFolderExpanded('folder-1');
      });

      expect(result.current.expandedFolderIds).not.toContain('folder-1');
    });
  });

  describe('isFolderExpanded', () => {
    it('should return true for expanded folder', () => {
      const { result } = renderHook(() => useFolderNavigation());

      act(() => {
        result.current.toggleFolderExpanded('folder-1');
      });

      expect(result.current.isFolderExpanded('folder-1')).toBe(true);
    });

    it('should return false for collapsed folder', () => {
      const { result } = renderHook(() => useFolderNavigation());

      expect(result.current.isFolderExpanded('folder-1')).toBe(false);
    });
  });

  describe('isFolderLoading', () => {
    it('should return false initially', () => {
      const { result } = renderHook(() => useFolderNavigation());

      expect(result.current.isFolderLoading('folder-1')).toBe(false);
    });

    it('should reflect store loading state', () => {
      act(() => {
        useFolderTreeStore.getState().setLoadingFolder('folder-1', true);
      });

      const { result } = renderHook(() => useFolderNavigation());

      expect(result.current.isFolderLoading('folder-1')).toBe(true);
    });
  });

  describe('getChildFolders', () => {
    it('should return empty array if no children cached', () => {
      const { result } = renderHook(() => useFolderNavigation());

      expect(result.current.getChildFolders('non-existent')).toEqual([]);
    });

    it('should return cached children', () => {
      const children = [
        createMockFolder({ id: 'child-1' }),
        createMockFolder({ id: 'child-2' }),
      ];

      act(() => {
        useFolderTreeStore.getState().setTreeFolders('parent-id', children);
      });

      const { result } = renderHook(() => useFolderNavigation());

      expect(result.current.getChildFolders('parent-id')).toHaveLength(2);
    });
  });

  describe('setTreeFolders', () => {
    it('should cache folder children', () => {
      const { result } = renderHook(() => useFolderNavigation());
      const folders = [createMockFolder({ id: 'cached-1' })];

      act(() => {
        result.current.setTreeFolders('parent-id', folders);
      });

      expect(result.current.getChildFolders('parent-id')).toHaveLength(1);
    });
  });

  describe('navigateToFolder', () => {
    it('should navigate to null (root) with empty path', () => {
      const { result } = renderHook(() => useFolderNavigation());

      // Start at some folder
      act(() => {
        result.current.setCurrentFolder('folder-1', [
          createMockFolder({ id: 'folder-1', name: 'F1' }),
        ]);
      });

      act(() => {
        result.current.navigateToFolder(null);
      });

      expect(result.current.currentFolderId).toBeNull();
      expect(result.current.folderPath).toEqual([]);
    });

    it('should preserve current path when no folderData provided', () => {
      const { result } = renderHook(() => useFolderNavigation());
      const existingPath = [createMockFolder({ id: 'L1', name: 'Level 1' })];

      act(() => {
        result.current.setCurrentFolder('L1', existingPath);
      });

      act(() => {
        result.current.navigateToFolder('L1');
      });

      expect(result.current.currentFolderId).toBe('L1');
      expect(result.current.folderPath).toHaveLength(1);
      expect(result.current.folderPath[0].name).toBe('Level 1');
    });

    it('should drill-down from root with cold cache (append child)', () => {
      const { result } = renderHook(() => useFolderNavigation());

      // At root (currentFolderId = null, folderPath = [])
      const childFolder = createMockFolder({
        id: 'L1',
        name: 'Level 1',
        parentFolderId: null, // direct child of root
      });

      act(() => {
        result.current.navigateToFolder('L1', childFolder);
      });

      expect(result.current.currentFolderId).toBe('L1');
      expect(result.current.folderPath).toHaveLength(1);
      expect(result.current.folderPath[0].name).toBe('Level 1');
    });

    it('should drill-down multi-level with cold cache (append path)', () => {
      const { result } = renderHook(() => useFolderNavigation());

      // Navigate root -> L1
      const L1 = createMockFolder({
        id: 'L1',
        name: 'Level 1',
        parentFolderId: null,
      });
      act(() => {
        result.current.navigateToFolder('L1', L1);
      });

      // Navigate L1 -> L2
      const L2 = createMockFolder({
        id: 'L2',
        name: 'Level 2',
        parentFolderId: 'L1',
      });
      act(() => {
        result.current.navigateToFolder('L2', L2);
      });

      // Navigate L2 -> L3
      const L3 = createMockFolder({
        id: 'L3',
        name: 'Level 3',
        parentFolderId: 'L2',
      });
      act(() => {
        result.current.navigateToFolder('L3', L3);
      });

      expect(result.current.currentFolderId).toBe('L3');
      expect(result.current.folderPath).toHaveLength(3);
      expect(result.current.folderPath.map((f) => f.name)).toEqual([
        'Level 1',
        'Level 2',
        'Level 3',
      ]);
    });

    it('should use cached path when cache is warm (complete from root)', () => {
      const { result } = renderHook(() => useFolderNavigation());

      // Simulate warm cache: root has L1, L1 has L2
      const L1 = createMockFolder({
        id: 'L1',
        name: 'Level 1',
        parentFolderId: null,
      });
      const L2 = createMockFolder({
        id: 'L2',
        name: 'Level 2',
        parentFolderId: 'L1',
      });

      act(() => {
        result.current.setTreeFolders('root', [L1]);
        result.current.setTreeFolders('L1', [L2]);
      });

      act(() => {
        result.current.navigateToFolder('L2', L2);
      });

      expect(result.current.currentFolderId).toBe('L2');
      expect(result.current.folderPath).toHaveLength(2);
      expect(result.current.folderPath.map((f) => f.name)).toEqual([
        'Level 1',
        'Level 2',
      ]);
    });
  });
});
