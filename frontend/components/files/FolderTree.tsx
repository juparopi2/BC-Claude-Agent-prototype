'use client';

import { useEffect, useCallback } from 'react';
import { Home, Star, Cloud } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { useFolderNavigation, useFolderTreeStore } from '@/src/domains/files';
import { useSortFilterStore } from '@/src/domains/files/stores/sortFilterStore';
import { useIntegrationListStore } from '@/src/domains/integrations';
import { FolderTreeItem } from './FolderTreeItem';
import type { ParsedFile } from '@bc-agent/shared';
import { PROVIDER_ID } from '@bc-agent/shared';

interface FolderTreeProps {
  className?: string;
}

export function FolderTree({ className }: FolderTreeProps) {
  const { currentFolderId, rootFolders, navigateToFolder, initFolderTree } = useFolderNavigation();
  const showFavoritesOnly = useSortFilterStore((s) => s.showFavoritesOnly);
  const sourceTypeFilter = useSortFilterStore((s) => s.sourceTypeFilter);
  const setSourceTypeFilter = useSortFilterStore((s) => s.setSourceTypeFilter);
  const isRootLoading = useFolderTreeStore((s) => s.loadingFolderIds.has('root'));
  const connections = useIntegrationListStore((s) => s.connections);
  const hasOneDrive = connections.some(
    (c) => c.provider === PROVIDER_ID.ONEDRIVE && c.status === 'connected'
  );

  // Load root folders on mount and when favorites mode changes
  useEffect(() => {
    initFolderTree();
  }, [initFolderTree, showFavoritesOnly]);

  const handleSelect = useCallback((folderId: string | null, folder?: ParsedFile) => {
    // Clear source type filter when navigating to a local folder
    if (sourceTypeFilter) {
      setSourceTypeFilter(null);
    }
    navigateToFolder(folderId, folder);
  }, [navigateToFolder, sourceTypeFilter, setSourceTypeFilter]);

  const handleAllFiles = useCallback(() => {
    setSourceTypeFilter(null);
    navigateToFolder(null);
  }, [setSourceTypeFilter, navigateToFolder]);

  const handleOneDriveClick = useCallback(() => {
    setSourceTypeFilter('onedrive');
    navigateToFolder(null);
  }, [setSourceTypeFilter, navigateToFolder]);

  return (
    <ScrollArea className={cn('h-full', className)}>
      <div className="p-2">
        {/* Root item */}
        <button
          onClick={handleAllFiles}
          className={cn(
            'flex items-center gap-2 w-full py-1.5 px-2 rounded hover:bg-accent/50 transition-colors',
            currentFolderId === null && !sourceTypeFilter && 'bg-accent'
          )}
        >
          {showFavoritesOnly ? (
            <Star className="size-4 fill-amber-400 text-amber-400" />
          ) : (
            <Home className="size-4 text-muted-foreground" />
          )}
          <span className="text-sm font-medium">
            {showFavoritesOnly ? 'Favorites' : 'All Files'}
          </span>
        </button>

        {/* Folder tree — skeleton while loading, items when ready */}
        <div className="mt-1">
          {isRootLoading ? (
            <FolderTreeSkeleton />
          ) : (
            rootFolders.map(folder => (
              <FolderTreeItem
                key={folder.id}
                folder={folder}
                level={0}
                onSelect={handleSelect}
              />
            ))
          )}
        </div>

        {/* OneDrive root (when connected) */}
        {hasOneDrive && (
          <div className="mt-3 pt-3 border-t">
            <button
              onClick={handleOneDriveClick}
              className={cn(
                'flex items-center gap-2 w-full py-1.5 px-2 rounded hover:bg-accent/50 transition-colors',
                sourceTypeFilter === 'onedrive' && 'bg-accent'
              )}
            >
              <Cloud className="size-4" style={{ color: '#0078D4' }} />
              <span className="text-sm font-medium">OneDrive</span>
            </button>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

/** Skeleton that mirrors FolderTreeItem layout: chevron + folder icon + name */
function FolderTreeSkeleton() {
  return (
    <div className="space-y-1">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center gap-1.5 py-1.5 px-2">
          <Skeleton className="size-4 rounded" />
          <Skeleton className="size-4 rounded" />
          <Skeleton className="h-3.5 flex-1 rounded" />
        </div>
      ))}
    </div>
  );
}
