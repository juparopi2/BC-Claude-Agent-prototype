'use client';

import { useCallback } from 'react';
import type { ParsedFile } from '@bc-agent/shared';
import { Folder, Upload } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { FileItem } from './FileItem';
import { useFileStore, selectSortedFiles } from '@/lib/stores/fileStore';

interface FileListProps {
  onContextMenu?: (e: React.MouseEvent, file: ParsedFile) => void;
}

export function FileList({ onContextMenu }: FileListProps) {
  const files = useFileStore(selectSortedFiles);
  const isLoading = useFileStore(state => state.isLoading);
  const selectedFileIds = useFileStore(state => state.selectedFileIds);
  const { selectFile, navigateToFolder, toggleFavorite } = useFileStore();

  const handleSelect = useCallback((fileId: string, multi: boolean) => {
    selectFile(fileId, multi);
  }, [selectFile]);

  const handleDoubleClick = useCallback((file: ParsedFile) => {
    if (file.isFolder) {
      navigateToFolder(file.id);
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

  // File list
  return (
    <ScrollArea className="h-full">
      <div className="p-2 space-y-0.5">
        {files.map(file => (
          <FileItem
            key={file.id}
            file={file}
            isSelected={selectedFileIds.has(file.id)}
            onSelect={handleSelect}
            onDoubleClick={handleDoubleClick}
            onFavoriteToggle={handleFavoriteToggle}
            onContextMenu={onContextMenu}
          />
        ))}
      </div>
    </ScrollArea>
  );
}
