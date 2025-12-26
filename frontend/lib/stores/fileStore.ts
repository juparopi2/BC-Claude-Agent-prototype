/**
 * File Store
 *
 * Zustand store for file management state.
 * Handles files, folders, uploads, sorting, and selection.
 *
 * @module lib/stores/fileStore
 * @deprecated This file is being migrated to domains/files/stores/.
 * Import from '@/src/domains/files' instead.
 *
 * Migration mapping:
 * - File list state → fileListStore
 * - Upload state → uploadStore
 * - Folder navigation → folderTreeStore
 * - Selection → selectionStore
 * - Sort/filter → sortFilterStore
 *
 * Hooks (recommended):
 * - useFiles() - file list, sorting, favorites
 * - useFileUpload() - upload queue and execution
 * - useFolderNavigation() - folder tree, breadcrumbs
 * - useFileSelection() - multi-select, range-select
 *
 * Will be removed in Sprint 7.
 */

import { create } from 'zustand';
import { subscribeWithSelector, persist } from 'zustand/middleware';
import type { ParsedFile, FileSortBy, SortOrder } from '@bc-agent/shared';
import { getFileApiClient } from '@/src/infrastructure/api';
import { nanoid } from 'nanoid';

// Memoization cache for selectors
let cachedSortedFiles: ParsedFile[] = [];
let cachedSortedFilesKey = '';

let cachedFolders: ParsedFile[] = [];
let cachedFoldersKey = '';

let cachedSelectedFiles: ParsedFile[] = [];
let cachedSelectedFilesKey = '';

/**
 * Upload item in queue
 */
export interface UploadItem {
  id: string;        // Unique ID for this upload
  file: File;        // File object
  progress: number;  // 0-100
  status: 'pending' | 'uploading' | 'completed' | 'failed';
  error?: string;
  resultFile?: ParsedFile;  // Result after upload
}

/**
 * File store state
 */
export interface FileState {
  // File data
  files: ParsedFile[];
  currentFolderId: string | null;  // null = root
  selectedFileIds: Set<string>;

  // Folder path for breadcrumb
  folderPath: ParsedFile[];  // From root to current folder

  // Upload state
  uploadQueue: UploadItem[];
  isUploading: boolean;
  uploadProgress: number;  // Overall progress 0-100

  // UI state
  isLoading: boolean;
  error: string | null;

  isSidebarVisible: boolean;

  expandedFolderIds: string[]; // Persisted expanded folders
  loadingFolderIds: Set<string>; // Folders currently fetching children
  treeFolders: Record<string, ParsedFile[]>; // Cached tree structure (parentId -> children)

  // Sort/filter
  sortBy: FileSortBy;
  sortOrder: SortOrder;
  showFavoritesOnly: boolean;

  // Pagination
  totalFiles: number;
  hasMore: boolean;
  currentOffset: number;
  currentLimit: number;
}

/**
 * File store actions
 */
export interface FileActions {
  // Fetch
  fetchFiles: (folderId?: string | null) => Promise<void>;
  refreshCurrentFolder: () => Promise<void>;
  loadMore: () => Promise<void>;

  // Navigation
  navigateToFolder: (folderId: string | null) => Promise<void>;
  navigateUp: () => Promise<void>;

  // CRUD operations
  createFolder: (name: string) => Promise<ParsedFile | null>;
  uploadFiles: (files: File[]) => Promise<void>;
  deleteFiles: (fileIds: string[]) => Promise<boolean>;
  renameFile: (fileId: string, newName: string) => Promise<boolean>;
  moveFiles: (fileIds: string[], targetFolderId: string | null) => Promise<boolean>;
  toggleFavorite: (fileId: string) => Promise<void>;

  // Download
  downloadFile: (fileId: string, fileName: string) => Promise<void>;

  // Selection
  selectFile: (fileId: string, multi?: boolean) => void;
  selectRange: (fileId: string) => void;  // Shift+click
  selectAll: () => void;
  clearSelection: () => void;

  // Sort/filter
  setSort: (sortBy: FileSortBy, sortOrder?: SortOrder) => void;
  toggleSortOrder: () => void;
  toggleFavoritesFilter: () => void;

  // UI actions

  toggleSidebar: () => void;
  toggleFolderExpanded: (folderId: string, forceState?: boolean) => Promise<void>;
  initFolderTree: () => Promise<void>;

  // State management
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearUploadQueue: () => void;
  reset: () => void;
}

export type FileStore = FileState & FileActions;

const initialState: FileState = {
  files: [],
  currentFolderId: null,
  selectedFileIds: new Set(),
  folderPath: [],
  uploadQueue: [],
  isUploading: false,
  uploadProgress: 0,
  isLoading: false,
  error: null,
  isSidebarVisible: true,
  expandedFolderIds: [],
  loadingFolderIds: new Set(),
  treeFolders: {},
  sortBy: 'date',
  sortOrder: 'desc',
  showFavoritesOnly: false,
  totalFiles: 0,
  hasMore: false,
  currentOffset: 0,
  currentLimit: 50,
};

export const useFileStore = create<FileStore>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
    ...initialState,

    // ========================================
    // Fetch Files
    // ========================================
    fetchFiles: async (folderId) => {
      const state = get();
      set({ isLoading: true, error: null, currentOffset: 0 });

      const api = getFileApiClient();
      const result = await api.getFiles({
        folderId: folderId !== undefined ? folderId : state.currentFolderId,
        sortBy: state.sortBy,
        favorites: state.showFavoritesOnly ? true : undefined,
        limit: state.currentLimit,
        offset: 0,
      });

      if (result.success === false) {
        set({
          error: result.error.message,
          isLoading: false,
        });
        return;
      }

      const { files, pagination } = result.data;
      set({
        files,
        totalFiles: pagination.total,
        hasMore: pagination.offset + files.length < pagination.total,
        currentOffset: pagination.offset + files.length,
        isLoading: false,
      });

      // Update currentFolderId if explicitly provided
      if (folderId !== undefined) {
        set({ currentFolderId: folderId });
      }
    },

    refreshCurrentFolder: async () => {
      const { currentFolderId, fetchFiles } = get();
      await fetchFiles(currentFolderId);
    },

    loadMore: async () => {
      const state = get();
      if (!state.hasMore || state.isLoading) return;

      set({ isLoading: true });

      const api = getFileApiClient();
      const result = await api.getFiles({
        folderId: state.currentFolderId,
        sortBy: state.sortBy,
        favorites: state.showFavoritesOnly ? true : undefined,
        limit: state.currentLimit,
        offset: state.currentOffset,
      });

      if (result.success === false) {
        set({
          error: result.error.message,
          isLoading: false,
        });
        return;
      }

      const { files, pagination } = result.data;
      set({
        files: [...state.files, ...files],
        hasMore: pagination.offset + files.length < pagination.total,
        currentOffset: pagination.offset + files.length,
        isLoading: false,
      });
    },

    // ========================================
    // Navigation
    // ========================================
    navigateToFolder: async (folderId) => {
      set({ isLoading: true, error: null });

      const api = getFileApiClient();

      // Build folder path by traversing up the tree
      const folderPath: ParsedFile[] = [];
      if (folderId) {
        const result = await api.getFile(folderId);
        if (result.success) {
          const folder = result.data.file;
          folderPath.push(folder);

          // Traverse up to root
          let currentFolder = folder;
          while (currentFolder.parentFolderId) {
            const parentResult = await api.getFile(currentFolder.parentFolderId);
            if (parentResult.success) {
              folderPath.unshift(parentResult.data.file);
              currentFolder = parentResult.data.file;
            } else {
              break;
            }
          }
        }
      }

      // Fetch files in this folder
      await get().fetchFiles(folderId);

      // Update folder path
      set({ folderPath });
    },

    navigateUp: async () => {
      const { folderPath } = get();
      if (folderPath.length === 0) return;

      // Go to parent folder
      const parentFolderId = folderPath.length > 1
        ? folderPath[folderPath.length - 2]?.id || null
        : null;

      await get().navigateToFolder(parentFolderId);
    },

    // ========================================
    // CRUD Operations
    // ========================================
    createFolder: async (name) => {
      const { currentFolderId } = get();
      set({ isLoading: true, error: null });

      const api = getFileApiClient();
      const result = await api.createFolder({
        name,
        parentFolderId: currentFolderId || undefined,
      });

      if (result.success === false) {
        set({
          error: result.error.message,
          isLoading: false,
        });
        return null;
      }

      const folder = result.data.folder;

      // Add to files list
      // Add to files list and update tree if applicable
      set((state) => {
        const newFiles = [folder, ...state.files];
        const newTotal = state.totalFiles + 1;
        
        // Update tree folders
        let newTreeFolders = state.treeFolders;
        
        // We only update the tree if we have the parent folder loaded in the tree
        // The parent is either the currentFolderId or 'root' if null
        const parentKey = currentFolderId || 'root';
        
        if (state.treeFolders[parentKey]) {
          newTreeFolders = {
            ...state.treeFolders,
            [parentKey]: [folder, ...state.treeFolders[parentKey]]
          };
        }

        return {
          files: newFiles,
          totalFiles: newTotal,
          isLoading: false,
          treeFolders: newTreeFolders
        };
      });

      return folder;
    },

    uploadFiles: async (files) => {
      const { currentFolderId } = get();

      // Create upload items
      const uploadItems: UploadItem[] = files.map((file) => ({
        id: nanoid(),
        file,
        progress: 0,
        status: 'pending',
      }));

      set({
        uploadQueue: uploadItems,
        isUploading: true,
        uploadProgress: 0,
      });

      const api = getFileApiClient();

      // Upload files one by one (could be parallel but sequential is safer)
      for (let i = 0; i < uploadItems.length; i++) {
        const item = uploadItems[i];
        if (!item) continue;

        // Update status to uploading
        set((state) => ({
          uploadQueue: state.uploadQueue.map((q) =>
            q.id === item.id ? { ...q, status: 'uploading' } : q
          ),
        }));

        // Upload single file
        const result = await api.uploadFiles(
          [item.file],
          currentFolderId || undefined,
          (progress) => {
            // Update individual item progress
            set((state) => ({
              uploadQueue: state.uploadQueue.map((q) =>
                q.id === item.id ? { ...q, progress } : q
              ),
            }));

            // Calculate overall progress
            const completedCount = i;
            const currentProgress = progress / 100;
            const totalProgress = ((completedCount + currentProgress) / files.length) * 100;
            set({ uploadProgress: Math.round(totalProgress) });
          }
        );

        if (result.success === false) {
          // Mark as failed
          set((state) => ({
            uploadQueue: state.uploadQueue.map((q) =>
              q.id === item.id
                ? { ...q, status: 'failed', error: result.error.message }
                : q
            ),
          }));
          continue;
        }

        const uploadedFile = result.data.files[0];

        // Update item status
        set((state) => ({
          uploadQueue: state.uploadQueue.map((q) =>
            q.id === item.id
              ? { ...q, status: 'completed', progress: 100, resultFile: uploadedFile }
              : q
          ),
        }));

        // Add to files list
        if (uploadedFile) {
          set((state) => ({
            files: [uploadedFile, ...state.files],
            totalFiles: state.totalFiles + 1,
          }));
        }
      }

      // Upload complete
      set({
        isUploading: false,
        uploadProgress: 100,
      });
    },

    deleteFiles: async (fileIds) => {
      const api = getFileApiClient();
      const results = await Promise.all(fileIds.map((id) => api.deleteFile(id)));

      const success = results.every((r) => r.success);
      if (success) {
        // Remove from files list
        // Remove from files list and tree structure
        set((state) => {
          const newFiles = state.files.filter((f) => !fileIds.includes(f.id));
          
          // Update tree structure: remove these files (folders) from any cached tree nodes
          const newTreeFolders = { ...state.treeFolders };
          let treeUpdated = false;
          
          Object.keys(newTreeFolders).forEach(key => {
            const originalLength = newTreeFolders[key].length;
            const filteredChildren = newTreeFolders[key].filter(f => !fileIds.includes(f.id));
            
            if (filteredChildren.length !== originalLength) {
              newTreeFolders[key] = filteredChildren;
              treeUpdated = true;
            }
          });
          
          return {
            files: newFiles,
            totalFiles: state.totalFiles - fileIds.length,
            selectedFileIds: new Set(),
            treeFolders: treeUpdated ? newTreeFolders : state.treeFolders
          };
        });
      } else {
        set({ error: 'Failed to delete some files' });
      }

      return success;
    },

    renameFile: async (fileId, newName) => {
      const api = getFileApiClient();
      const result = await api.updateFile(fileId, { name: newName });

      if (result.success === false) {
        set({ error: result.error.message });
        return false;
      }

      const updatedFile = result.data.file;

      // Update in files list and tree structure
      set((state) => {
        // 1. Update main files list
        const newFiles = state.files.map((f) =>
          f.id === fileId ? updatedFile : f
        );

        // 2. If it's a folder, update it in the tree cache to reflect name change in sidebar
        let newTreeFolders = state.treeFolders;
        if (updatedFile.isFolder) {
          // It could be in 'root' or any parent's children list
          let treeUpdated = false;
          // Create shallow copy to mutate
          const nextTreeFolders = { ...state.treeFolders };

          Object.keys(nextTreeFolders).forEach((parentId) => {
            const children = nextTreeFolders[parentId];
            if (!children) return;
            
            const childIndex = children.findIndex((c) => c.id === fileId);
            if (childIndex !== -1) {
              // Found it, update the specific item
              const newChildren = [...children];
              newChildren[childIndex] = updatedFile;
              nextTreeFolders[parentId] = newChildren;
              treeUpdated = true;
            }
          });

          if (treeUpdated) {
            newTreeFolders = nextTreeFolders;
          }
        }

        return {
          files: newFiles,
          treeFolders: newTreeFolders
        };
      });
      return true;
    },

    moveFiles: async (fileIds, targetFolderId) => {
      const api = getFileApiClient();
      const results = await Promise.all(
        fileIds.map((id) => api.updateFile(id, { parentFolderId: targetFolderId }))
      );

      const success = results.every((r) => r.success);
      if (success) {
        // Remove from current view if moved to different folder
        const { currentFolderId } = get();
        if (currentFolderId !== targetFolderId) {
          set((state) => ({
            files: state.files.filter((f) => !fileIds.includes(f.id)),
            totalFiles: state.totalFiles - fileIds.length,
            selectedFileIds: new Set(),
          }));
        } else {
          // Update files in place
          set((state) => ({
            files: state.files.map((f) => {
              if (fileIds.includes(f.id)) {
                return { ...f, parentFolderId: targetFolderId };
              }
              return f;
            }),
          }));
        }
      } else {
        set({ error: 'Failed to move some files' });
      }

      return success;
    },

    toggleFavorite: async (fileId) => {
      // Find current file
      const state = get();
      const file = state.files.find((f) => f.id === fileId);
      if (!file) return;

      const newFavoriteStatus = !file.isFavorite;

      // Optimistic update
      set((state) => {
        // If we are currently showing ONLY favorites, and we are UN-favoriting this file,
        // we should remove it from the view immediately.
        if (state.showFavoritesOnly && !newFavoriteStatus) {
           return {
             files: state.files.filter(f => f.id !== fileId),
             totalFiles: Math.max(0, state.totalFiles - 1)
           };
        }

        // Normal case: just update the status
        return {
          files: state.files.map((f) =>
            f.id === fileId ? { ...f, isFavorite: newFavoriteStatus } : f
          ),
        };
      });

      // API call 
      const api = getFileApiClient();
      const result = await api.updateFile(fileId, { isFavorite: newFavoriteStatus });

      if (result.success === false) {
        // Revert on error
        set(() => {
           // Simplest fallback: refresh the folder to get true state
           get().refreshCurrentFolder();
           return { error: result.error.message };
        });
      }
    },

    // ========================================
    // Download
    // ========================================
    downloadFile: async (fileId, fileName) => {
      const api = getFileApiClient();
      const result = await api.downloadFile(fileId);

      if (result.success === false) {
        set({ error: result.error.message });
        return;
      }

      // Create download link
      const blob = result.data;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },

    // ========================================
    // Selection
    // ========================================
    selectFile: (fileId, multi = false) => {
      set((state) => {
        const newSelection = new Set(multi ? state.selectedFileIds : []);

        if (multi && newSelection.has(fileId)) {
          // Deselect if already selected
          newSelection.delete(fileId);
        } else {
          // Select
          newSelection.add(fileId);
        }

        return { selectedFileIds: newSelection };
      });
    },

    selectRange: (fileId) => {
      set((state) => {
        const { files, selectedFileIds } = state;

        // Find indices
        const fileIndex = files.findIndex((f) => f.id === fileId);
        if (fileIndex === -1) return state;

        // Find first selected file
        const selectedIndices = Array.from(selectedFileIds)
          .map((id) => files.findIndex((f) => f.id === id))
          .filter((idx) => idx !== -1);

        if (selectedIndices.length === 0) {
          // No selection, just select this file
          return { selectedFileIds: new Set([fileId]) };
        }

        // Get range from first selected to clicked file
        const startIndex = Math.min(...selectedIndices);
        const endIndex = fileIndex;
        const [min, max] = startIndex < endIndex ? [startIndex, endIndex] : [endIndex, startIndex];

        // Select all files in range
        const rangeIds = files.slice(min, max + 1).map((f) => f.id);
        return { selectedFileIds: new Set(rangeIds) };
      });
    },

    selectAll: () => {
      set((state) => ({
        selectedFileIds: new Set(state.files.map((f) => f.id)),
      }));
    },

    clearSelection: () => {
      set({ selectedFileIds: new Set() });
    },

    // ========================================
    // Sort/Filter
    // ========================================
    setSort: (sortBy, sortOrder) => {
      set({
        sortBy,
        sortOrder: sortOrder || get().sortOrder,
      });
      // Refetch with new sort
      get().refreshCurrentFolder();
    },

    toggleSortOrder: () => {
      set((state) => ({
        sortOrder: state.sortOrder === 'asc' ? 'desc' : 'asc',
      }));
      // Refetch with new sort
      get().refreshCurrentFolder();
    },

    toggleFavoritesFilter: () => {
      set((state) => ({
        showFavoritesOnly: !state.showFavoritesOnly,
      }));
      // Refetch with new filter
      get().refreshCurrentFolder();
    },

    // ========================================
    // UI Actions
    // ========================================
    toggleSidebar: () => {
      set((state) => ({
        isSidebarVisible: !state.isSidebarVisible,
      }));
    },

    toggleFolderExpanded: async (folderId, forceState) => {
      const state = get();
      const isCurrentlyExpanded = state.expandedFolderIds.includes(folderId);
      const shouldExpand = forceState !== undefined ? forceState : !isCurrentlyExpanded;
      
      if (!shouldExpand) {
        // Collapse
        if (isCurrentlyExpanded) {
           set({ expandedFolderIds: state.expandedFolderIds.filter(id => id !== folderId) });
        }
      } else {
        // Expand
        if (!isCurrentlyExpanded) {
           set({ expandedFolderIds: [...state.expandedFolderIds, folderId] });
        }
        
        // Fetch children if not already loaded (and not root, which is loaded via init)
        if (!state.treeFolders[folderId]) {
             set(state => ({ loadingFolderIds: new Set(state.loadingFolderIds).add(folderId) }));
             const api = getFileApiClient();
             const result = await api.getFiles({ folderId });
             
             // Clear loading state
             set(state => {
                 const newLoading = new Set(state.loadingFolderIds);
                 newLoading.delete(folderId);
                 return { loadingFolderIds: newLoading };
             });
             if (result.success) {
               const folders = result.data.files.filter(f => f.isFolder);
               set(state => ({
                 treeFolders: {
                   ...state.treeFolders,
                   [folderId]: folders
                 }
               }));
             }
        }
      }
    },

    initFolderTree: async () => {
      // Load root folders
      const api = getFileApiClient();
      const result = await api.getFiles({ folderId: null });
      if (result.success) {
        const folders = result.data.files.filter(f => f.isFolder);
        set(state => ({
          treeFolders: {
            ...state.treeFolders,
            'root': folders
          }
        }));
      }
    },

    // ========================================
    // State Management
    // ========================================
    setLoading: (isLoading) => set({ isLoading }),
    setError: (error) => set({ error }),
    clearUploadQueue: () => set({ uploadQueue: [], isUploading: false, uploadProgress: 0 }),
    reset: () => set(initialState),
  }),
  {
    name: 'bc-agent-file-store',
    partialize: (state) => ({
      // Persist only UI preferences
      isSidebarVisible: state.isSidebarVisible,
      expandedFolderIds: state.expandedFolderIds,
    }),
  }
  )
  )
);

/**
 * Selector: Get sorted and filtered files
 *
 * Applies client-side sorting (folders first, then by sortBy field).
 * Server already handles favorites filter and primary sort.
 *
 * IMPORTANT: This selector is memoized to prevent infinite loops with useSyncExternalStore.
 * The result is cached and only recalculated when the underlying data changes.
 */
export const selectSortedFiles = (state: FileStore): ParsedFile[] => {
  // Create a cache key from the relevant state
  const cacheKey = `${state.files.map(f => f.id + f.updatedAt).join(',')}|${state.sortBy}|${state.sortOrder}`;

  if (cacheKey === cachedSortedFilesKey) {
    return cachedSortedFiles;
  }

  const filtered = state.files;

  // Sort: folders first, then apply sortBy
  const sorted = [...filtered].sort((a, b) => {
    // Folders always first
    if (a.isFolder && !b.isFolder) return -1;
    if (!a.isFolder && b.isFolder) return 1;

    // Apply sort field
    let comparison = 0;
    switch (state.sortBy) {
      case 'name':
        comparison = a.name.localeCompare(b.name);
        break;
      case 'date':
        comparison = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
        break;
      case 'size':
        comparison = a.sizeBytes - b.sizeBytes;
        break;
    }

    return state.sortOrder === 'asc' ? comparison : -comparison;
  });

  // Update cache
  cachedSortedFilesKey = cacheKey;
  cachedSortedFiles = sorted;

  return sorted;
};

/**
 * Selector: Get only folders (for tree view)
 * Memoized to prevent infinite loops.
 */
export const selectFolders = (state: FileStore): ParsedFile[] => {
  // Use id + updatedAt to detect changes
  const cacheKey = state.files
    .filter(f => f.isFolder)
    .map(f => `${f.id}-${f.updatedAt}`)
    .join(',');

  if (cacheKey === cachedFoldersKey) {
    return cachedFolders;
  }

  const folders = state.files.filter((f) => f.isFolder);

  cachedFoldersKey = cacheKey;
  cachedFolders = folders;

  return folders;
};

/**
 * Selector: Get selected files
 * Memoized to prevent infinite loops.
 */
export const selectSelectedFiles = (state: FileStore): ParsedFile[] => {
  const selectedIds = Array.from(state.selectedFileIds).sort().join(',');
  const fileIds = state.files.map(f => f.id).join(',');
  const cacheKey = `${selectedIds}|${fileIds}`;

  if (cacheKey === cachedSelectedFilesKey) {
    return cachedSelectedFiles;
  }

  const selected = state.files.filter((f) => state.selectedFileIds.has(f.id));

  cachedSelectedFilesKey = cacheKey;
  cachedSelectedFiles = selected;

  return selected;
};

/**
 * Selector: Check if any files are selected
 */
export const selectHasSelection = (state: FileStore): boolean => {
  return state.selectedFileIds.size > 0;
};

// Memoization cache for root folders selector
let cachedRootFolders: ParsedFile[] = [];
let cachedRootFoldersKey = '';

/**
 * Selector: Get root folders for tree view
 * Memoized to prevent infinite loops with useSyncExternalStore.
 */
export const selectRootFolders = (state: FileStore): ParsedFile[] => {
  const rootFolders = state.treeFolders['root'];
  
  // Create cache key from root folder IDs + timestamps
  const cacheKey = rootFolders?.map(f => `${f.id}-${f.updatedAt}`).join(',') || '';
  
  if (cacheKey === cachedRootFoldersKey) {
    return cachedRootFolders;
  }
  
  const result = rootFolders || [];
  cachedRootFoldersKey = cacheKey;
  cachedRootFolders = result;
  
  return result;
};

// Memoized selector for loading state
export const selectIsFolderLoading = (state: FileStore, folderId: string): boolean => {
    return state.loadingFolderIds.has(folderId);
};
