'use client';

import { useEffect, useCallback, useState } from 'react';
import type { ParsedFile } from '@bc-agent/shared';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import { cn } from '@/lib/utils';
import { useFileStore } from '@/lib/stores/fileStore';
import { FileToolbar } from './FileToolbar';
import { FileBreadcrumb } from './FileBreadcrumb';
import { FileUploadZone } from './FileUploadZone';
import { FileList } from './FileList';
import { FolderTree } from './FolderTree';
import { FileContextMenu } from './FileContextMenu';

interface FileExplorerProps {
  className?: string;
  isNarrow?: boolean;
}

export function FileExplorer({ className, isNarrow = false }: FileExplorerProps) {
  const { fetchFiles, currentFolderId } = useFileStore();
  const [contextMenuFile, setContextMenuFile] = useState<ParsedFile | null>(null);

  // Load files on mount and when folder changes
  useEffect(() => {
    fetchFiles(currentFolderId);
  }, [fetchFiles, currentFolderId]);

  // Context menu handler
  const handleContextMenu = useCallback((_e: React.MouseEvent, file: ParsedFile) => {
    setContextMenuFile(file);
  }, []);

  // Narrow layout (no sidebar)
  if (isNarrow) {
    return (
      <TooltipProvider>
        <div className={cn('flex flex-col h-full', className)}>
          <FileToolbar isNarrow />
          <FileBreadcrumb />
          <FileUploadZone className="flex-1 overflow-hidden">
            <FileList onContextMenu={handleContextMenu} />
          </FileUploadZone>

          {/* Context menu */}
          {contextMenuFile && (
            <FileContextMenu
              file={contextMenuFile}
              onOpenChange={(open) => {
                if (!open) setContextMenuFile(null);
              }}
            >
              <span className="sr-only">File options</span>
            </FileContextMenu>
          )}
        </div>
      </TooltipProvider>
    );
  }

  // Full layout with sidebar
  return (
    <TooltipProvider>
      <div className={cn('flex flex-col h-full', className)}>
        <FileToolbar />

        <ResizablePanelGroup direction="horizontal" className="flex-1">
          {/* Sidebar with folder tree */}
          <ResizablePanel
            defaultSize={25}
            minSize={15}
            maxSize={40}
            className="border-r"
          >
            <FolderTree className="h-full" />
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Main content */}
          <ResizablePanel defaultSize={75} minSize={50}>
            <div className="flex flex-col h-full">
              <FileBreadcrumb />
              <FileUploadZone className="flex-1 overflow-hidden">
                <FileList onContextMenu={handleContextMenu} />
              </FileUploadZone>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>

        {/* Context menu */}
        {contextMenuFile && (
          <FileContextMenu
            file={contextMenuFile}
            onOpenChange={(open) => {
              if (!open) setContextMenuFile(null);
            }}
          >
            <span className="sr-only">File options</span>
          </FileContextMenu>
        )}
      </div>
    </TooltipProvider>
  );
}
