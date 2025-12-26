/**
 * useFileSelection Hook
 *
 * Hook for file selection functionality.
 * Wraps selectionStore and provides computed selectedFiles from fileListStore.
 *
 * @module domains/files/hooks/useFileSelection
 */

import { useMemo, useCallback } from 'react';
import { useSelectionStore } from '../stores/selectionStore';
import { useFileListStore } from '../stores/fileListStore';
import type { ParsedFile } from '@bc-agent/shared';

/**
 * useFileSelection return type
 */
export interface UseFileSelectionReturn {
  /** Set of selected file IDs */
  selectedFileIds: Set<string>;
  /** Full file objects for selected IDs */
  selectedFiles: ParsedFile[];
  /** Select a single file (multi=true to add to selection) */
  selectFile: (fileId: string, multi?: boolean) => void;
  /** Range select from last selected to this file */
  selectRange: (fileId: string) => void;
  /** Select all visible files */
  selectAll: () => void;
  /** Clear all selection */
  clearSelection: () => void;
  /** Whether any files are selected */
  hasSelection: boolean;
  /** Number of selected files */
  selectedCount: number;
}

/**
 * Hook for managing file selection
 *
 * Provides file selection state and actions with computed selected file objects.
 * Uses selectionStore for IDs and fileListStore for full file objects.
 *
 * @example
 * ```tsx
 * function FileList({ files }) {
 *   const {
 *     selectedFileIds,
 *     selectFile,
 *     selectRange,
 *     hasSelection
 *   } = useFileSelection();
 *
 *   return files.map(file => (
 *     <FileItem
 *       key={file.id}
 *       file={file}
 *       selected={selectedFileIds.has(file.id)}
 *       onClick={(e) => {
 *         if (e.shiftKey) selectRange(file.id);
 *         else selectFile(file.id, e.ctrlKey || e.metaKey);
 *       }}
 *     />
 *   ));
 * }
 * ```
 */
export function useFileSelection(): UseFileSelectionReturn {
  // Get selection state from store
  const selectedFileIds = useSelectionStore((state) => state.selectedFileIds);
  const selectFileAction = useSelectionStore((state) => state.selectFile);
  const selectRangeAction = useSelectionStore((state) => state.selectRange);
  const selectAllAction = useSelectionStore((state) => state.selectAll);
  const clearSelection = useSelectionStore((state) => state.clearSelection);
  const hasSelectionFn = useSelectionStore((state) => state.hasSelection);
  const getSelectedCount = useSelectionStore((state) => state.getSelectedCount);

  // Get files from file list store
  const files = useFileListStore((state) => state.files);

  // Compute selected file objects
  const selectedFiles = useMemo(
    () => files.filter((file) => selectedFileIds.has(file.id)),
    [files, selectedFileIds]
  );

  // Wrapper for selectFile (direct pass-through)
  const selectFile = useCallback(
    (fileId: string, multi?: boolean) => {
      selectFileAction(fileId, multi);
    },
    [selectFileAction]
  );

  // Wrapper for selectRange that provides all file IDs
  const selectRange = useCallback(
    (fileId: string) => {
      const allFileIds = files.map((f) => f.id);
      selectRangeAction(fileId, allFileIds);
    },
    [files, selectRangeAction]
  );

  // Wrapper for selectAll that provides all file IDs
  const selectAll = useCallback(() => {
    const allFileIds = files.map((f) => f.id);
    selectAllAction(allFileIds);
  }, [files, selectAllAction]);

  return {
    selectedFileIds,
    selectedFiles,
    selectFile,
    selectRange,
    selectAll,
    clearSelection,
    hasSelection: hasSelectionFn(),
    selectedCount: getSelectedCount(),
  };
}
