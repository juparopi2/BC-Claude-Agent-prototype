'use client';

import { useEffect } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useFiles, useFolderNavigation, useFileProcessingEvents } from '@/src/domains/files';
import { useUIPreferencesStore } from '@/src/domains/ui';
import { FileToolbar } from './FileToolbar';
import { FileBreadcrumb } from './FileBreadcrumb';
import { FileUploadZone } from './FileUploadZone';
import { FileList } from './FileList';
import { FolderTree } from './FolderTree';

interface FileExplorerProps {
  className?: string;
  isNarrow?: boolean;
}

export function FileExplorer({ className, isNarrow = false }: FileExplorerProps) {
  const { fetchFiles } = useFiles();
  const { currentFolderId } = useFolderNavigation();
  const isSidebarVisible = useUIPreferencesStore((state) => state.isFileSidebarVisible);

  // Activate WebSocket listeners for file processing status updates (D25)
  useFileProcessingEvents();

  // Load files on mount and when folder changes
  useEffect(() => {
    fetchFiles(currentFolderId);
  }, [fetchFiles, currentFolderId]);

  // Narrow layout (no sidebar)
  if (isNarrow) {
    return (
      <TooltipProvider>
        <div className={cn('flex flex-col h-full min-h-0', className)}>
          <FileToolbar isNarrow />
          <FileBreadcrumb />
          <FileUploadZone className="flex-1 min-h-0 overflow-hidden">
            <FileList />
          </FileUploadZone>
        </div>
      </TooltipProvider>
    );
  }

  // Full layout with sidebar
  return (
    <TooltipProvider>
      <div className={cn('flex flex-col h-full min-h-0', className)}>
        <FileToolbar />

        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Fixed-width sidebar (150px) - conditionally rendered */}
          {isSidebarVisible && (
            <div className="w-[150px] border-r flex-shrink-0">
              <FolderTree className="h-full" />
            </div>
          )}

          {/* Main content area */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <FileBreadcrumb />
            <FileUploadZone className="flex-1 min-h-0 overflow-hidden">
              <FileList />
            </FileUploadZone>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
