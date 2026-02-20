/**
 * Folder Tree Store
 *
 * Zustand store for managing folder tree navigation state.
 * Handles current folder, breadcrumb path, tree expansion, and lazy-loading.
 * Pure state management - API calls live in hooks.
 *
 * @module domains/files/stores/folderTreeStore
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ParsedFile } from '@bc-agent/shared';

/**
 * Folder tree state
 */
export interface FolderTreeState {
  /** Current folder ID (null = root) */
  currentFolderId: string | null;
  /** Breadcrumb trail from root to current folder */
  folderPath: ParsedFile[];
  /** IDs of expanded folders in sidebar (persisted) */
  expandedFolderIds: string[];
  /** IDs of folders currently loading children */
  loadingFolderIds: Set<string>;
  /** Cached folder children by parentId (key 'root' for root folders) */
  treeFolders: Record<string, ParsedFile[]>;
}

/**
 * Folder tree actions
 */
export interface FolderTreeActions {
  /** Navigate to a folder with optional path */
  setCurrentFolder: (folderId: string | null, folderPath: ParsedFile[]) => void;
  /** Navigate up to parent folder */
  navigateUp: () => void;
  /** Toggle folder expanded state in sidebar */
  toggleFolderExpanded: (folderId: string, forceState?: boolean) => void;
  /** Cache folder children */
  setTreeFolders: (parentId: string, folders: ParsedFile[]) => void;
  /** Set loading state for a folder */
  setLoadingFolder: (folderId: string, isLoading: boolean) => void;
  /** Reset all state */
  reset: () => void;
  /** Get root folders from cache */
  getRootFolders: () => ParsedFile[];
  /** Check if a folder is loading */
  isFolderLoading: (folderId: string) => boolean;
  /** Check if a folder is expanded */
  isFolderExpanded: (folderId: string) => boolean;
  /** Get children of a folder from cache */
  getChildFolders: (parentId: string) => ParsedFile[];
  /** Add or update a folder in the cached children of a parent. No-op if parent not cached. */
  upsertTreeFolder: (parentId: string, folder: ParsedFile) => void;
  /** Remove a folder from the cached children of a parent. No-op if parent not cached. */
  removeTreeFolder: (parentId: string, folderId: string) => void;
  /** Invalidate (delete) cached children for a parent, forcing re-fetch on next expand. */
  invalidateTreeFolder: (parentId: string) => void;
}

/**
 * Initial state
 */
const initialState: FolderTreeState = {
  currentFolderId: null,
  folderPath: [],
  expandedFolderIds: [],
  loadingFolderIds: new Set(),
  treeFolders: {},
};

/**
 * Folder Tree store
 *
 * Manages folder navigation and tree expansion state.
 * API calls for folder contents should be handled by hooks.
 *
 * @example
 * ```tsx
 * function FolderTree() {
 *   const { expandedFolderIds, toggleFolderExpanded, getRootFolders } = useFolderTreeStore();
 *   const rootFolders = getRootFolders();
 *
 *   return rootFolders.map(folder => (
 *     <FolderItem
 *       key={folder.id}
 *       folder={folder}
 *       isExpanded={expandedFolderIds.includes(folder.id)}
 *       onToggle={() => toggleFolderExpanded(folder.id)}
 *     />
 *   ));
 * }
 * ```
 */
export const useFolderTreeStore = create<FolderTreeState & FolderTreeActions>()(
  persist(
    (set, get) => ({
      ...initialState,

      setCurrentFolder: (folderId, folderPath) => {
        set({
          currentFolderId: folderId,
          folderPath,
        });
      },

      navigateUp: () => {
        set((state) => {
          const { folderPath } = state;

          // Already at root
          if (folderPath.length === 0) {
            return state;
          }

          // Go to parent (or root if only one level deep)
          if (folderPath.length === 1) {
            return {
              currentFolderId: null,
              folderPath: [],
            };
          }

          // Navigate to parent folder
          const newPath = folderPath.slice(0, -1);
          const parentFolder = newPath[newPath.length - 1];

          return {
            currentFolderId: parentFolder?.id || null,
            folderPath: newPath,
          };
        });
      },

      toggleFolderExpanded: (folderId, forceState) => {
        set((state) => {
          const isCurrentlyExpanded = state.expandedFolderIds.includes(folderId);
          const shouldExpand = forceState !== undefined ? forceState : !isCurrentlyExpanded;

          if (shouldExpand && !isCurrentlyExpanded) {
            return {
              expandedFolderIds: [...state.expandedFolderIds, folderId],
            };
          } else if (!shouldExpand && isCurrentlyExpanded) {
            return {
              expandedFolderIds: state.expandedFolderIds.filter((id) => id !== folderId),
            };
          }

          return state;
        });
      },

      setTreeFolders: (parentId, folders) => {
        set((state) => ({
          treeFolders: {
            ...state.treeFolders,
            [parentId]: folders,
          },
        }));
      },

      setLoadingFolder: (folderId, isLoading) => {
        set((state) => {
          const newLoadingIds = new Set(state.loadingFolderIds);
          if (isLoading) {
            newLoadingIds.add(folderId);
          } else {
            newLoadingIds.delete(folderId);
          }
          return { loadingFolderIds: newLoadingIds };
        });
      },

      reset: () => {
        set({
          ...initialState,
          loadingFolderIds: new Set(),
        });
      },

      getRootFolders: () => {
        return get().treeFolders['root'] || [];
      },

      isFolderLoading: (folderId) => {
        return get().loadingFolderIds.has(folderId);
      },

      isFolderExpanded: (folderId) => {
        return get().expandedFolderIds.includes(folderId);
      },

      getChildFolders: (parentId) => {
        return get().treeFolders[parentId] || [];
      },

      upsertTreeFolder: (parentId, folder) => {
        set((state) => {
          const existing = state.treeFolders[parentId];
          // No-op if parent not cached (folder will appear when user expands that node)
          if (!existing) return state;

          const idx = existing.findIndex((f) => f.id === folder.id);
          const updated = idx >= 0
            ? existing.map((f, i) => (i === idx ? folder : f))
            : [...existing, folder];

          return {
            treeFolders: { ...state.treeFolders, [parentId]: updated },
          };
        });
      },

      removeTreeFolder: (parentId, folderId) => {
        set((state) => {
          const existing = state.treeFolders[parentId];
          if (!existing) return state;

          return {
            treeFolders: {
              ...state.treeFolders,
              [parentId]: existing.filter((f) => f.id !== folderId),
            },
          };
        });
      },

      invalidateTreeFolder: (parentId) => {
        set((state) => {
          if (!(parentId in state.treeFolders)) return state;

          const treeFolders = Object.fromEntries(
            Object.entries(state.treeFolders).filter(([key]) => key !== parentId)
          );
          return { treeFolders };
        });
      },
    }),
    {
      name: 'bc-agent-folder-tree',
      partialize: (state) => ({
        // Only persist expanded folders for UX continuity
        expandedFolderIds: state.expandedFolderIds,
      }),
    }
  )
);

/**
 * Reset store to initial state (for testing)
 */
export function resetFolderTreeStore(): void {
  useFolderTreeStore.setState({
    ...initialState,
    loadingFolderIds: new Set(),
  });
}
