'use client';

import { useCallback } from 'react';
import { Upload, Star, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CreateFolderDialog } from './CreateFolderDialog';
import { FileSortControls } from './FileSortControls';
import { useFileUploadTrigger } from './FileUploadZone';
import { useFileStore } from '@/lib/stores/fileStore';
import { cn } from '@/lib/utils';

interface FileToolbarProps {
  className?: string;
  isNarrow?: boolean;
}

export function FileToolbar({ className, isNarrow = false }: FileToolbarProps) {
  const { openFilePicker, isUploading } = useFileUploadTrigger();
  const showFavoritesOnly = useFileStore(state => state.showFavoritesOnly);
  const isLoading = useFileStore(state => state.isLoading);
  const { toggleFavoritesFilter, refreshCurrentFolder } = useFileStore();

  const handleRefresh = useCallback(() => {
    refreshCurrentFolder();
  }, [refreshCurrentFolder]);

  return (
    <div className={cn(
      'flex items-center gap-1 px-2 py-1.5 border-b',
      isNarrow && 'flex-wrap',
      className
    )}>
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
            {!isNarrow && <span>Upload</span>}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Upload files</TooltipContent>
      </Tooltip>

      {/* New Folder button */}
      <CreateFolderDialog />

      <div className="flex-1" />

      {/* Favorites filter toggle */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            pressed={showFavoritesOnly}
            onPressedChange={toggleFavoritesFilter}
            className="h-8"
            aria-label="Show favorites only"
          >
            <Star className={cn(
              'size-4',
              showFavoritesOnly && 'fill-amber-400 text-amber-400'
            )} />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent>
          {showFavoritesOnly ? 'Show all files' : 'Show favorites only'}
        </TooltipContent>
      </Tooltip>

      {/* Sort controls */}
      <FileSortControls />

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
  );
}
