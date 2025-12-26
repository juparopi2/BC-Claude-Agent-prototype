/**
 * useFolderNavigation Hook Tests
 *
 * Tests for folder navigation hook that wraps folderTreeStore.
 *
 * @module __tests__/domains/files/hooks/useFolderNavigation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ParsedFile } from '@bc-agent/shared';
import { useFolderNavigation } from '@/src/domains/files/hooks/useFolderNavigation';
import { resetFolderTreeStore, useFolderTreeStore } from '@/src/domains/files/stores/folderTreeStore';

// Test fixtures
const createMockFolder = (overrides: Partial<ParsedFile> = {}): ParsedFile => ({
  id: `folder-${Math.random().toString(36).substr(2, 9)}`,
  name: 'test-folder',
  mimeType: 'application/folder',
  sizeBytes: 0,
  isFolder: true,
  isFavorite: false,
  parentFolderId: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  userId: 'user-1',
  ...overrides,
});

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
});
