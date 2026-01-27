'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import type { ParsedFile } from '@bc-agent/shared';
import { Folder, Upload } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { FileItem } from './FileItem';
import { FileContextMenu } from './FileContextMenu';
import { MultiFileContextMenu } from './MultiFileContextMenu';
import { useFiles, useFileSelection, useFolderNavigation } from '@/src/domains/files';
import { useFileListStore } from '@/src/domains/files/stores/fileListStore';
import { useSelectionStore } from '@/src/domains/files/stores/selectionStore';
import { getFileApiClient } from '@/src/infrastructure/api';
import { triggerDownload } from '@/lib/download';
import { FilePreviewModal } from '@/components/modals/FilePreviewModal';

/**
 * Check if a file type can be previewed
 */
function isPreviewableFile(mimeType: string): boolean {
  // PDF files
  if (mimeType === 'application/pdf') return true;

  // Image files
  if (mimeType.startsWith('image/')) return true;

  // Text-based files
  const textTypes = [
    'text/plain',
    'text/javascript',
    'text/typescript',
    'text/css',
    'text/html',
    'text/xml',
    'text/markdown',
    'text/csv',
    'application/json',
    'application/javascript',
    'application/xml',
  ];
  if (textTypes.includes(mimeType) || mimeType.startsWith('text/')) return true;

  return false;
}

export function FileList() {
  const { sortedFiles: files, isLoading, toggleFavorite } = useFiles();
  const { selectedFileIds, selectFile, selectAll } = useFileSelection();
  const { navigateToFolder } = useFolderNavigation();

  // Get deletion state and keyboard navigation from stores
  const deletingFileIds = useFileListStore((state) => state.deletingFileIds);
  const focusedFileId = useSelectionStore((state) => state.focusedFileId);
  const moveFocus = useSelectionStore((state) => state.moveFocus);
  const extendSelection = useSelectionStore((state) => state.extendSelection);

  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [activePreviewFile, setActivePreviewFile] = useState<ParsedFile | null>(null);

  // Ref for the container element (for keyboard focus)
  const containerRef = useRef<HTMLDivElement>(null);

  // Get all file IDs for keyboard navigation
  const allFileIds = files.map((f) => f.id);

  // Keyboard navigation handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if container has focus or contains the active element
      if (
        !containerRef.current?.contains(document.activeElement) &&
        document.activeElement !== containerRef.current
      ) {
        return;
      }

      // Ctrl+A / Cmd+A - Select all
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        selectAll();
        return;
      }

      // Arrow Up/Down - Move focus or extend selection
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const direction = e.key === 'ArrowUp' ? 'up' : 'down';

        if (e.shiftKey) {
          // Shift+Arrow - Extend selection
          extendSelection(direction, allFileIds);
        } else {
          // Arrow only - Move focus (deselects others)
          moveFocus(direction, allFileIds);
        }
        return;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [allFileIds, selectAll, moveFocus, extendSelection]);

  const handleSelect = useCallback((fileId: string, multi: boolean) => {
    selectFile(fileId, multi);
  }, [selectFile]);

  const handleDoubleClick = useCallback(async (file: ParsedFile) => {
    if (file.isFolder) {
      // Pass full folder data for breadcrumb path construction
      navigateToFolder(file.id, file);
      return;
    }

    // Handle previewable files with the preview modal
    if (isPreviewableFile(file.mimeType)) {
      setActivePreviewFile(file);
      setPreviewModalOpen(true);
      return;
    }

    // Handle other files by downloading them
    try {
      const fileApi = getFileApiClient();

      toast.message('Downloading file', {
        description: `Downloading ${file.name}...`,
      });

      const response = await fileApi.downloadFile(file.id);

      if (response.success) {
        triggerDownload(response.data, file.name);
        toast.success('Download started', {
          description: `${file.name} is downloading.`,
        });
      } else {
        toast.error('Download failed', {
          description: response.error.message || 'Could not download file',
        });
      }
    } catch (error) {
      toast.error('Download failed', {
        description: 'An unexpected error occurred',
      });
      console.error('Download exception:', error);
    }
  }, [navigateToFolder]);

  const handleFavoriteToggle = useCallback((fileId: string) => {
    toggleFavorite(fileId);
  }, [toggleFavorite]);

  // Loading state
  if (isLoading) {
    return (
      <div className="p-2 space-y-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 p-2">
            <Skeleton className="size-5 rounded" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    );
  }

  // Empty state
  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center">
        <Folder className="size-16 text-muted-foreground/30 mb-4" />
        <h3 className="text-lg font-medium text-muted-foreground mb-1">
          No files yet
        </h3>
        <p className="text-sm text-muted-foreground/70 mb-4">
          Drop files here or click upload to get started
        </p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground/50">
          <Upload className="size-4" />
          <span>Drag and drop to upload</span>
        </div>
      </div>
    );
  }

  // Get selected files for multi-selection context menu
  const selectedFiles = files.filter((f) => selectedFileIds.has(f.id));
  const hasMultipleSelected = selectedFiles.length > 1;

  // Render context menu wrapper based on selection state
  const renderWithContextMenu = (file: ParsedFile, fileItem: React.ReactNode) => {
    // If file is selected and multiple files are selected, use multi-file menu
    if (selectedFileIds.has(file.id) && hasMultipleSelected) {
      return (
        <MultiFileContextMenu key={file.id} files={selectedFiles}>
          {fileItem}
        </MultiFileContextMenu>
      );
    }
    // Otherwise use single file menu
    return (
      <FileContextMenu key={file.id} file={file}>
        {fileItem}
      </FileContextMenu>
    );
  };

  // File list
  return (
    <>
    <div
      ref={containerRef}
      tabIndex={0}
      className="outline-none h-full"
    >
      <ScrollArea className="h-full">
        <div className="p-2 space-y-0.5">
          {files.map((file) => {
            const normalizedId = file.id.toUpperCase();
            const fileItem = (
              <FileItem
                file={file}
                isSelected={selectedFileIds.has(file.id)}
                isDeleting={deletingFileIds.has(normalizedId)}
                isFocused={focusedFileId === file.id}
                onSelect={handleSelect}
                onDoubleClick={handleDoubleClick}
                onFavoriteToggle={handleFavoriteToggle}
              />
            );
            return renderWithContextMenu(file, fileItem);
          })}
        </div>
      </ScrollArea>
    </div>
    {activePreviewFile && (
        <FilePreviewModal
          isOpen={previewModalOpen}
          onClose={() => setPreviewModalOpen(false)}
          fileId={activePreviewFile.id}
          fileName={activePreviewFile.name}
          mimeType={activePreviewFile.mimeType}
        />
      )}
    </>
  );
}
