'use client';

import { useState, useCallback } from 'react';
import type { ParsedFile } from '@bc-agent/shared';
import { Folder, Upload } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { FileItem } from './FileItem';
import { FileContextMenu } from './FileContextMenu';
import { useFiles, useFileSelection, useFolderNavigation } from '@/src/domains/files';
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
  const { selectedFileIds, selectFile } = useFileSelection();
  const { navigateToFolder } = useFolderNavigation();

  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [activePreviewFile, setActivePreviewFile] = useState<ParsedFile | null>(null);

  const handleSelect = useCallback((fileId: string, multi: boolean) => {
    selectFile(fileId, multi);
  }, [selectFile]);

  const handleDoubleClick = useCallback(async (file: ParsedFile) => {
    if (file.isFolder) {
      navigateToFolder(file.id);
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

  // File list
  return (
    <>
    <ScrollArea className="h-full">
      <div className="p-2 space-y-0.5">
        {files.map(file => (
          <FileContextMenu key={file.id} file={file}>
            <FileItem
              file={file}
              isSelected={selectedFileIds.has(file.id)}
              onSelect={handleSelect}
              onDoubleClick={handleDoubleClick}
              onFavoriteToggle={handleFavoriteToggle}
            />
          </FileContextMenu>
        ))}
      </div>
    </ScrollArea>
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
