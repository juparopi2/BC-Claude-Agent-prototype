'use client';

import { useCallback, useState, useEffect, useRef } from 'react';
import { Upload, Star, RefreshCw, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CreateFolderDialog } from './CreateFolderDialog';
import { FileSortControls } from './FileSortControls';
import { useFileUploadTrigger } from './FileUploadZone';
import { useSortFilterStore } from '@/src/domains/files/stores/sortFilterStore';
import { useFiles } from '@/src/domains/files';
import { useUIPreferencesStore } from '@/src/domains/ui';
import { cn } from '@/lib/utils';

interface FileToolbarProps {
  className?: string;
  isNarrow?: boolean;
}

export function FileToolbar({ className, isNarrow = false }: FileToolbarProps) {
  const { openFilePicker, isUploading } = useFileUploadTrigger();
  const { showFavoritesFirst, toggleFavoritesFirst } = useSortFilterStore();
  const { isFileSidebarVisible: isSidebarVisible, toggleFileSidebar: toggleSidebar } = useUIPreferencesStore();
  const { isLoading, refreshCurrentFolder } = useFiles();

  const [toolbarWidth, setToolbarWidth] = useState<number>(Infinity);
  const toolbarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!toolbarRef.current) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setToolbarWidth(entry.contentRect.width);
      }
    });

    observer.observe(toolbarRef.current);
    return () => observer.disconnect();
  }, []);

  const isCompact = toolbarWidth < 485;

  const handleRefresh = useCallback(() => {
    refreshCurrentFolder();
  }, [refreshCurrentFolder]);

  return (
    <div
      ref={toolbarRef}
      className={cn(
        'flex items-center gap-1 px-2 py-1.5 border-b',
        'flex-wrap sm:flex-nowrap justify-between', // Wrap on mobile, single row on desktop
        className
      )}
    >

      <div className="flex items-center gap-0">
        
        {/* Sidebar toggle button - first position, only show when not in narrow mode */}
        {!isNarrow && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1"
                onClick={toggleSidebar}
                aria-label={isSidebarVisible ? 'Hide sidebar' : 'Show sidebar'}
              >
                {isSidebarVisible ? (
                  <PanelLeftClose className="size-4" />
                ) : (
                  <PanelLeftOpen className="size-4" />
                )}
                {!isCompact && (
                  <span>{isSidebarVisible ? 'Hide' : 'Show'}</span>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {isSidebarVisible ? 'Hide sidebar' : 'Show sidebar'}
            </TooltipContent>
          </Tooltip>
        )}

        {/* Upload button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1"
              onClick={openFilePicker}
              disabled={isUploading}
            >
              <Upload className="size-4" />
              {!isCompact && <span>Upload</span>}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Upload files</TooltipContent>
        </Tooltip>

        {/* New Folder button */}
        <CreateFolderDialog isCompact={isCompact} />

      </div>
      <div className="flex items-center gap-0">
        {/* Favorites first toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Toggle
              size="sm"
              pressed={showFavoritesFirst}
              onPressedChange={toggleFavoritesFirst}
              className="h-8"
              aria-label="Show favorites first"
            >
              <Star className={cn(
                'size-4',
                showFavoritesFirst && 'fill-amber-400 text-amber-400'
              )} />
            </Toggle>
          </TooltipTrigger>
          <TooltipContent>
            Show favorites first
          </TooltipContent>
        </Tooltip>

        {/* Sort controls */}
        <FileSortControls isCompact={isCompact} />

        {/* Refresh button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8"
              onClick={handleRefresh}
              disabled={isLoading}
            >
              <RefreshCw className={cn(
                'size-4',
                isLoading && 'animate-spin'
              )} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Refresh</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
