'use client';

import { useEffect, useRef } from 'react';
import { type ImperativePanelHandle } from 'react-resizable-panels';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import { cn } from '@/lib/utils';
import { FILE_SOURCE_TYPE } from '@bc-agent/shared';
import { useFiles, useFolderNavigation, useFileProcessingEvents } from '@/src/domains/files';
import { useSortFilterStore } from '@/src/domains/files/stores/sortFilterStore';
import { useUIPreferencesStore } from '@/src/domains/ui';
import { useSyncEvents } from '@/src/domains/integrations';
import { FileToolbar } from './FileToolbar';
import { FileBreadcrumb } from './FileBreadcrumb';
import { FileUploadZone } from './FileUploadZone';
import { FileDataTable } from './FileDataTable';
import { FolderTree } from './FolderTree';

interface FileExplorerProps {
  className?: string;
  isNarrow?: boolean;
}

export function FileExplorer({ className, isNarrow = false }: FileExplorerProps) {
  const { fetchFiles } = useFiles();
  const { currentFolderId } = useFolderNavigation();
  const sourceTypeFilter = useSortFilterStore((s) => s.sourceTypeFilter);
  const isOneDriveView = sourceTypeFilter === FILE_SOURCE_TYPE.ONEDRIVE;
  const isSidebarVisible = useUIPreferencesStore((state) => state.isFileSidebarVisible);
  const sidebarPanelRef = useRef<ImperativePanelHandle>(null);

  // Activate WebSocket listeners for file processing status updates (D25)
  useFileProcessingEvents();

  // Activate WebSocket listeners for sync status updates (PRD-107)
  useSyncEvents();

  // Load files on mount and when folder changes
  useEffect(() => {
    fetchFiles(currentFolderId);
  }, [fetchFiles, currentFolderId]);

  // Sync sidebar visibility with panel collapse/expand
  useEffect(() => {
    if (!sidebarPanelRef.current) return;
    if (isSidebarVisible) {
      sidebarPanelRef.current.expand();
    } else {
      sidebarPanelRef.current.collapse();
    }
  }, [isSidebarVisible]);

  // Narrow layout (no sidebar)
  if (isNarrow) {
    return (
      <TooltipProvider>
        <div className={cn('flex flex-col h-full min-h-0', className)}>
          <FileToolbar isNarrow />
          <FileBreadcrumb />
          <FileUploadZone disabled={isOneDriveView} className="flex-1 min-h-0 overflow-hidden">
            <FileDataTable />
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

        <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0">
          {/* Resizable sidebar - always mounted, collapsed when hidden */}
          <ResizablePanel
            ref={sidebarPanelRef}
            defaultSize={30}
            minSize={20}
            maxSize={50}
            collapsible
            collapsedSize={0}
            className="min-w-0"
          >
            <FolderTree className="h-full" />
          </ResizablePanel>
          <ResizableHandle className="hover:bg-primary/20 transition-colors" />

          {/* Main content area */}
          <ResizablePanel
            defaultSize={70}
            minSize={40}
            className="min-w-0"
          >
            <div className="flex flex-col h-full min-h-0 overflow-hidden">
              <FileBreadcrumb />
              <FileUploadZone disabled={isOneDriveView} className="flex-1 min-h-0 overflow-hidden">
                <FileDataTable />
              </FileUploadZone>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </TooltipProvider>
  );
}
